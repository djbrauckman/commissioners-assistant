/**
 * stats.js
 * Fetches and processes manager-level stats from the Sleeper API.
 * Covers regular season weeks + playoff weeks (15-17) separately.
 */

const SLEEPER = 'https://api.sleeper.app/v1';
const FLEX_POSITIONS = ['RB', 'WR', 'TE'];
const PLAYERS_CACHE_KEY = 'sleeper_players_cache';
const PLAYERS_CACHE_DATE_KEY = 'sleeper_players_cache_date';

const PLAYOFF_WEEKS    = [15, 16, 17];
const PLAYOFF_ROUND_LABELS = { 15: 'Wildcard', 16: 'Semifinals', 17: 'Championship' };

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status}: ${url}`);
  return res.json();
}

async function fetchLeagueData(leagueId) {
  const [league, rosters, users] = await Promise.all([
    apiFetch(`${SLEEPER}/league/${leagueId}`),
    apiFetch(`${SLEEPER}/league/${leagueId}/rosters`),
    apiFetch(`${SLEEPER}/league/${leagueId}/users`),
  ]);
  return { league, rosters, users };
}

async function fetchWeekMatchups(leagueId, week) {
  return apiFetch(`${SLEEPER}/league/${leagueId}/matchups/${week}`);
}

async function fetchWeekStats(season, week) {
  return apiFetch(`${SLEEPER}/stats/nfl/regular/${season}/${week}`);
}

async function fetchBrackets(leagueId) {
  const [winners, losers] = await Promise.all([
    apiFetch(`${SLEEPER}/league/${leagueId}/winners_bracket`),
    apiFetch(`${SLEEPER}/league/${leagueId}/losers_bracket`).catch(() => []),
  ]);
  return { winners, losers };
}

async function fetchPlayers() {
  const today      = new Date().toDateString();
  const cachedDate = localStorage.getItem(PLAYERS_CACHE_DATE_KEY);
  const cached     = localStorage.getItem(PLAYERS_CACHE_KEY);
  if (cached && cachedDate === today) return JSON.parse(cached);
  const players = await apiFetch(`${SLEEPER}/players/nfl`);
  try {
    localStorage.setItem(PLAYERS_CACHE_KEY, JSON.stringify(players));
    localStorage.setItem(PLAYERS_CACHE_DATE_KEY, today);
  } catch (e) {}
  return players;
}

// ─── Data processing ──────────────────────────────────────────────────────────

function buildUserMap(users) {
  const map = {};
  users.forEach(u => { map[u.user_id] = u.display_name; });
  return map;
}

function buildRosterMap(rosters, userMap) {
  const map = {};
  rosters.forEach(r => {
    map[r.roster_id] = {
      displayName: userMap[r.owner_id] || `Team ${r.roster_id}`,
      wins:   r.settings?.wins   ?? 0,
      losses: r.settings?.losses ?? 0,
      fpts:   (r.settings?.fpts  ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100,
    };
  });
  return map;
}

function getPosition(playerId, playersDb) {
  if (!playerId) return 'UNK';
  if (typeof playerId === 'string' && playerId.length <= 3 && isNaN(playerId)) return 'DEF';
  const p = playersDb[playerId];
  if (!p) return 'UNK';
  return p.fantasy_positions?.[0] || p.position || 'UNK';
}

function calcStarterPointsByPosition(starters, statsMap, rosterPositions, playersDb) {
  const byPosition = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DEF: 0 };
  const flexSlots  = ['FLEX', 'SUPER_FLEX', 'WRRB_FLEX', 'REC_FLEX'];
  starters.forEach((playerId, idx) => {
    if (!playerId || playerId === '0') return;
    const pts  = statsMap[playerId]?.pts_half_ppr ?? 0;
    const slot = rosterPositions[idx];
    if (!slot) return;
    if (flexSlots.includes(slot)) {
      byPosition['FLEX'] = (byPosition['FLEX'] || 0) + pts;
    } else if (byPosition[slot] !== undefined) {
      byPosition[slot] += pts;
    } else {
      const pos = getPosition(playerId, playersDb);
      if (byPosition[pos] !== undefined) byPosition[pos] += pts;
    }
  });
  return byPosition;
}

function calcOptimalPoints(allPlayerIds, statsMap, rosterPositions, playersDb) {
  const flexSlots  = ['FLEX', 'SUPER_FLEX', 'WRRB_FLEX', 'REC_FLEX'];
  const slotCounts = {};
  rosterPositions.forEach(slot => {
    if (slot === 'BN' || slot === 'IR') return;
    slotCounts[slot] = (slotCounts[slot] || 0) + 1;
  });
  const pool = allPlayerIds
    .filter(id => id && id !== '0')
    .map(id => ({ id, pts: statsMap[id]?.pts_half_ppr ?? 0, pos: getPosition(id, playersDb) }))
    .sort((a, b) => b.pts - a.pts);
  let optimalTotal = 0;
  const used = new Set();
  Object.entries(slotCounts).forEach(([slot, count]) => {
    if (flexSlots.includes(slot)) return;
    for (let i = 0; i < count; i++) {
      const player = pool.find(p => !used.has(p.id) && p.pos === slot);
      if (player) { optimalTotal += player.pts; used.add(player.id); }
    }
  });
  flexSlots.forEach(slot => {
    const count = slotCounts[slot] || 0;
    for (let i = 0; i < count; i++) {
      const eligible = slot === 'SUPER_FLEX' ? ['QB', 'RB', 'WR', 'TE'] : FLEX_POSITIONS;
      const player = pool.find(p => !used.has(p.id) && eligible.includes(p.pos));
      if (player) { optimalTotal += player.pts; used.add(player.id); }
    }
  });
  return optimalTotal;
}

/**
 * Process a single week's matchups into per-manager week data.
 */
function processWeekMatchups(matchups, weekStats, rosterPositions, playersDb, managers) {
  matchups.forEach(team => {
    const mgr = managers[team.roster_id];
    if (!mgr) return;
    const starters   = team.starters || [];
    const allPlayers = team.players  || [];
    const actualPts  = team.points   ?? 0;
    const benchIds   = allPlayers.filter(id => !starters.includes(id));
    const benchPts   = benchIds.reduce((s, id) => s + (weekStats[id]?.pts_half_ppr ?? 0), 0);
    const optimalPts = calcOptimalPoints(allPlayers, weekStats, rosterPositions, playersDb);
    const effPct     = optimalPts > 0 ? Math.round((actualPts / optimalPts) * 100) : 100;
    const byPosition = calcStarterPointsByPosition(starters, weekStats, rosterPositions, playersDb);
    return {
      matchupId:    team.matchup_id,
      actualPoints: Math.round(actualPts  * 100) / 100,
      optimalPoints:Math.round(optimalPts * 100) / 100,
      efficiencyPct: effPct,
      byPosition,
      benchPoints:  Math.round(benchPts * 100) / 100,
      starterIds:   starters,
      benchIds,
    };
  });
}

/**
 * Parse the winners bracket into a readable playoff results map.
 * Returns: { byRosterId: { [rosterId]: { round, result, opponent, score, oppScore } } }
 */
function parseBracket(winners, rosterMap) {
  const results = {}; // rosterId → array of playoff game results

  winners.forEach(game => {
    if (game.w == null) return; // game not yet played
    const round     = game.r;
    const label     = PLAYOFF_ROUND_LABELS[14 + round] || `Round ${round}`;
    const winnerId  = game.w;
    const loserId   = game.l;
    const isFinal   = game.p === 1; // p=1 is championship
    const isThird   = game.p === 3;

    const winnerName = rosterMap[winnerId]?.displayName || `Team ${winnerId}`;
    const loserName  = rosterMap[loserId]?.displayName  || `Team ${loserId}`;

    if (!results[winnerId]) results[winnerId] = [];
    if (!results[loserId])  results[loserId]  = [];

    results[winnerId].push({
      round, label,
      result:   isFinal ? '🏆 Champion' : isThird ? '3rd Place' : 'Won',
      opponent: loserName,
    });
    results[loserId].push({
      round, label,
      result:   isFinal ? 'Runner-up' : isThird ? '4th Place' : 'Lost',
      opponent: winnerName,
    });
  });

  return results;
}

// ─── Rollup helpers ───────────────────────────────────────────────────────────

function rollupWeeks(weeks) {
  const byPos = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DEF: 0 };
  let totalEff = 0, totalBench = 0, totalActual = 0, totalOptimal = 0;
  weeks.forEach(w => {
    Object.entries(w.byPosition).forEach(([p, pts]) => { if (byPos[p] !== undefined) byPos[p] += pts; });
    totalEff     += w.efficiencyPct;
    totalBench   += w.benchPoints;
    totalActual  += w.actualPoints;
    totalOptimal += w.optimalPoints;
  });
  const n = weeks.length || 1;
  return {
    byPosition:       byPos,
    avgEfficiency:    Math.round(totalEff / n),
    totalBenchLeft:   Math.round(totalBench  * 100) / 100,
    totalActual:      Math.round(totalActual * 100) / 100,
    totalOptimal:     Math.round(totalOptimal* 100) / 100,
    avgPointsPerWeek: Math.round((totalActual / n)  * 100) / 100,
    bestWeek:  weeks.length ? weeks.reduce((b, w) => w.actualPoints > b.actualPoints ? w : b, weeks[0]) : null,
    worstWeek: weeks.length ? weeks.reduce((b, w) => w.actualPoints < b.actualPoints ? w : b, weeks[0]) : null,
  };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

async function loadManagerStats(leagueId, onProgress = () => {}) {
  onProgress(5, 'Fetching league info...');
  const { league, rosters, users } = await fetchLeagueData(leagueId);

  const season          = league.season;
  const leagueName      = league.name;
  const rosterPositions = league.roster_positions || [];
  const regularWeeks    = league.settings?.playoff_week_start
    ? league.settings.playoff_week_start - 1
    : 13;

  onProgress(10, 'Fetching player database...');
  const [playersDb, brackets] = await Promise.all([
    fetchPlayers(),
    fetchBrackets(leagueId),
  ]);

  const userMap   = buildUserMap(users);
  const rosterMap = buildRosterMap(rosters, userMap);

  // Init manager structures
  const managers = {};
  rosters.forEach(r => {
    managers[r.roster_id] = {
      rosterId:    r.roster_id,
      displayName: rosterMap[r.roster_id].displayName,
      wins:        rosterMap[r.roster_id].wins,
      losses:      rosterMap[r.roster_id].losses,
      fpts:        rosterMap[r.roster_id].fpts,
      weeks:       [],       // regular season weeks
      playoffWeeks:[],       // playoff weeks
      madePlayoffs: false,
    };
  });

  // ── Regular season ────────────────────────────────────────────────────────
  for (let week = 1; week <= regularWeeks; week++) {
    const pct = 15 + Math.round((week / (regularWeeks + PLAYOFF_WEEKS.length)) * 70);
    onProgress(pct, `Regular season — week ${week} of ${regularWeeks}...`);
    const [matchups, weekStats] = await Promise.all([
      fetchWeekMatchups(leagueId, week),
      fetchWeekStats(season, week),
    ]);
    matchups.forEach(team => {
      const mgr = managers[team.roster_id];
      if (!mgr) return;
      const starters   = team.starters || [];
      const allPlayers = team.players  || [];
      const actualPts  = team.points   ?? 0;
      const benchIds   = allPlayers.filter(id => !starters.includes(id));
      const benchPts   = benchIds.reduce((s, id) => s + (weekStats[id]?.pts_half_ppr ?? 0), 0);
      const optimalPts = calcOptimalPoints(allPlayers, weekStats, rosterPositions, playersDb);
      const effPct     = optimalPts > 0 ? Math.round((actualPts / optimalPts) * 100) : 100;
      const byPosition = calcStarterPointsByPosition(starters, weekStats, rosterPositions, playersDb);
      mgr.weeks.push({
        week,
        matchupId:    team.matchup_id,
        actualPoints: Math.round(actualPts   * 100) / 100,
        optimalPoints:Math.round(optimalPts  * 100) / 100,
        efficiencyPct: effPct,
        byPosition,
        benchPoints:  Math.round(benchPts * 100) / 100,
        starterIds: starters,
        benchIds,
      });
    });
  }

  // ── Playoff weeks ─────────────────────────────────────────────────────────
  for (let i = 0; i < PLAYOFF_WEEKS.length; i++) {
    const week = PLAYOFF_WEEKS[i];
    const pct  = 15 + Math.round(((regularWeeks + i + 1) / (regularWeeks + PLAYOFF_WEEKS.length)) * 70);
    onProgress(pct, `Playoffs — ${PLAYOFF_ROUND_LABELS[week]}...`);

    let matchups, weekStats;
    try {
      [matchups, weekStats] = await Promise.all([
        fetchWeekMatchups(leagueId, week),
        fetchWeekStats(season, week),
      ]);
    } catch (e) {
      continue; // playoffs may not have happened yet
    }

    // Only process teams that actually have matchup data this week
    const activeRosterIds = new Set(matchups.map(t => t.roster_id));
    activeRosterIds.forEach(rid => {
      if (managers[rid]) managers[rid].madePlayoffs = true;
    });

    matchups.forEach(team => {
      const mgr = managers[team.roster_id];
      if (!mgr) return;
      const starters   = team.starters || [];
      const allPlayers = team.players  || [];
      const actualPts  = team.points   ?? 0;
      const benchIds   = allPlayers.filter(id => !starters.includes(id));
      const benchPts   = benchIds.reduce((s, id) => s + (weekStats[id]?.pts_half_ppr ?? 0), 0);
      const optimalPts = calcOptimalPoints(allPlayers, weekStats, rosterPositions, playersDb);
      const effPct     = optimalPts > 0 ? Math.round((actualPts / optimalPts) * 100) : 100;
      const byPosition = calcStarterPointsByPosition(starters, weekStats, rosterPositions, playersDb);
      mgr.playoffWeeks.push({
        week,
        roundLabel:   PLAYOFF_ROUND_LABELS[week] || `Week ${week}`,
        matchupId:    team.matchup_id,
        actualPoints: Math.round(actualPts   * 100) / 100,
        optimalPoints:Math.round(optimalPts  * 100) / 100,
        efficiencyPct: effPct,
        byPosition,
        benchPoints:  Math.round(benchPts * 100) / 100,
        starterIds: starters,
        benchIds,
      });
    });
  }

  // ── Bracket results ───────────────────────────────────────────────────────
  const bracketResults = parseBracket(brackets.winners, rosterMap);

  // ── Rollups ───────────────────────────────────────────────────────────────
  Object.values(managers).forEach(mgr => {
    mgr.season  = rollupWeeks(mgr.weeks);
    mgr.playoffs = {
      ...rollupWeeks(mgr.playoffWeeks),
      games:   bracketResults[mgr.rosterId] || [],
      madeIt:  mgr.madePlayoffs,
    };
  });

  onProgress(100, 'Done');

  return {
    managers: Object.values(managers).sort((a, b) => b.wins - a.wins || b.fpts - a.fpts),
    season,
    leagueName,
    regularWeeks,
    rosterPositions,
    hasBracket: brackets.winners.length > 0,
  };
}