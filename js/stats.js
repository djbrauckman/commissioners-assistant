/**
 * stats.js
 * Fetches and processes manager-level stats from the Sleeper API.
 *
 * Data sources:
 *   - /league/{id}/rosters        → roster_id, owner_id, season record
 *   - /league/{id}/users          → owner_id → display_name
 *   - /league/{id}/matchups/{wk}  → weekly starters, players, points
 *   - /stats/nfl/regular/{yr}/{wk}→ per-player pts_half_ppr (undocumented)
 *   - /players/nfl                → player_id → position (cached in localStorage)
 *
 * Output shape (per manager):
 * {
 *   rosterId, displayName,
 *   wins, losses, totalPF,
 *   weeks: [{
 *     week, actualPoints, optimalPoints, efficiencyPct,
 *     byPosition: { QB, RB, WR, TE, FLEX, K, DEF },
 *     benchPoints, starterIds, benchIds
 *   }],
 *   season: { byPosition, avgEfficiency, totalBenchLeft }
 * }
 */

const SLEEPER = 'https://api.sleeper.app/v1';
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const FLEX_POSITIONS = ['RB', 'WR', 'TE'];
const PLAYERS_CACHE_KEY = 'sleeper_players_cache';
const PLAYERS_CACHE_DATE_KEY = 'sleeper_players_cache_date';

// ─── API helpers ─────────────────────────────────────────────────────────────

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

/**
 * Fetch all players — cached in localStorage, refreshed once per day.
 */
async function fetchPlayers() {
  const today = new Date().toDateString();
  const cachedDate = localStorage.getItem(PLAYERS_CACHE_DATE_KEY);
  const cached = localStorage.getItem(PLAYERS_CACHE_KEY);

  if (cached && cachedDate === today) {
    return JSON.parse(cached);
  }

  const players = await apiFetch(`${SLEEPER}/players/nfl`);
  try {
    localStorage.setItem(PLAYERS_CACHE_KEY, JSON.stringify(players));
    localStorage.setItem(PLAYERS_CACHE_DATE_KEY, today);
  } catch (e) {
    // localStorage quota exceeded — just use in-memory
  }
  return players;
}

// ─── Data processing ─────────────────────────────────────────────────────────

/**
 * Build owner_id → display_name map.
 */
function buildUserMap(users) {
  const map = {};
  users.forEach(u => { map[u.user_id] = u.display_name; });
  return map;
}

/**
 * Build roster_id → { displayName, wins, losses, fpts } map.
 */
function buildRosterMap(rosters, userMap) {
  const map = {};
  rosters.forEach(r => {
    map[r.roster_id] = {
      displayName: userMap[r.owner_id] || `Team ${r.roster_id}`,
      wins:        r.settings?.wins    ?? 0,
      losses:      r.settings?.losses  ?? 0,
      fpts:        (r.settings?.fpts   ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100,
    };
  });
  return map;
}

/**
 * Get the fantasy position for a player ID.
 * DEF players have IDs like "ARI", "DAL", etc.
 */
function getPosition(playerId, playersDb) {
  if (!playerId) return 'UNK';
  if (typeof playerId === 'string' && playerId.length <= 3 && isNaN(playerId)) return 'DEF';
  const p = playersDb[playerId];
  if (!p) return 'UNK';
  return p.fantasy_positions?.[0] || p.position || 'UNK';
}

/**
 * Given a team's starters array and the week's stats, calculate points by
 * roster slot position. Sleeper's starters array is ordered by roster slot,
 * so we use the league's roster_positions to map slot → position.
 */
function calcStarterPointsByPosition(starters, statsMap, rosterPositions, playersDb) {
  const byPosition = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DEF: 0 };

  starters.forEach((playerId, idx) => {
    if (!playerId || playerId === '0') return;
    const pts  = statsMap[playerId]?.pts_half_ppr ?? 0;
    const slot = rosterPositions[idx];

    if (!slot) return;

    if (slot === 'FLEX' || slot === 'SUPER_FLEX' || slot === 'WRRB_FLEX' || slot === 'REC_FLEX') {
      byPosition['FLEX'] = (byPosition['FLEX'] || 0) + pts;
    } else if (byPosition[slot] !== undefined) {
      byPosition[slot] += pts;
    } else {
      // fallback — map by actual player position
      const pos = getPosition(playerId, playersDb);
      if (byPosition[pos] !== undefined) byPosition[pos] += pts;
    }
  });

  return byPosition;
}

/**
 * Calculate the optimal lineup from all available players this week.
 * Uses the league's roster_positions to determine how many of each slot to fill.
 */
function calcOptimalPoints(allPlayerIds, statsMap, rosterPositions, playersDb) {
  // Count required starter slots
  const slotCounts = {};
  rosterPositions.forEach(slot => {
    if (slot === 'BN' || slot === 'IR') return;
    slotCounts[slot] = (slotCounts[slot] || 0) + 1;
  });

  // Build player pool with points and positions
  const pool = allPlayerIds
    .filter(id => id && id !== '0')
    .map(id => ({
      id,
      pts: statsMap[id]?.pts_half_ppr ?? 0,
      pos: getPosition(id, playersDb),
    }))
    .sort((a, b) => b.pts - a.pts);

  let optimalTotal = 0;
  const used = new Set();

  // Fill positional slots first (QB, RB, WR, TE, K, DEF)
  const flexSlots = ['FLEX', 'SUPER_FLEX', 'WRRB_FLEX', 'REC_FLEX'];

  Object.entries(slotCounts).forEach(([slot, count]) => {
    if (flexSlots.includes(slot)) return; // handle flex after
    for (let i = 0; i < count; i++) {
      const player = pool.find(p => !used.has(p.id) && p.pos === slot);
      if (player) { optimalTotal += player.pts; used.add(player.id); }
    }
  });

  // Fill flex slots with best remaining eligible players
  flexSlots.forEach(slot => {
    const count = slotCounts[slot] || 0;
    for (let i = 0; i < count; i++) {
      const eligible = slot === 'SUPER_FLEX'
        ? ['QB', 'RB', 'WR', 'TE']
        : FLEX_POSITIONS;
      const player = pool.find(p => !used.has(p.id) && eligible.includes(p.pos));
      if (player) { optimalTotal += player.pts; used.add(player.id); }
    }
  });

  return optimalTotal;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Pull and process all manager stats for a given league/season.
 * Calls onProgress(pct, message) during loading.
 *
 * @param {string} leagueId
 * @param {function} onProgress
 * @returns {Object} { managers: [...], season, leagueName }
 */
async function loadManagerStats(leagueId, onProgress = () => {}) {
  onProgress(5, 'Fetching league info...');
  const { league, rosters, users } = await fetchLeagueData(leagueId);

  const season        = league.season;
  const leagueName    = league.name;
  const rosterPositions = league.roster_positions || [];
  const regularWeeks  = league.settings?.playoff_week_start
    ? league.settings.playoff_week_start - 1
    : 14;

  onProgress(10, 'Fetching player database...');
  const playersDb = await fetchPlayers();

  const userMap   = buildUserMap(users);
  const rosterMap = buildRosterMap(rosters, userMap);

  // Init manager data structure
  const managers = {};
  rosters.forEach(r => {
    managers[r.roster_id] = {
      rosterId:    r.roster_id,
      displayName: rosterMap[r.roster_id].displayName,
      wins:        rosterMap[r.roster_id].wins,
      losses:      rosterMap[r.roster_id].losses,
      fpts:        rosterMap[r.roster_id].fpts,
      weeks:       [],
    };
  });

  // Fetch all weeks
  for (let week = 1; week <= regularWeeks; week++) {
    const pct = 15 + Math.round((week / regularWeeks) * 75);
    onProgress(pct, `Loading week ${week} of ${regularWeeks}...`);

    const [matchups, weekStats] = await Promise.all([
      fetchWeekMatchups(leagueId, week),
      fetchWeekStats(season, week),
    ]);

    matchups.forEach(team => {
      const mgr = managers[team.roster_id];
      if (!mgr) return;

      const starters    = team.starters || [];
      const allPlayers  = team.players  || [];
      const actualPts   = team.points   ?? 0;

      const benchIds    = allPlayers.filter(id => !starters.includes(id));
      const benchPts    = benchIds.reduce((sum, id) =>
        sum + (weekStats[id]?.pts_half_ppr ?? 0), 0);

      const optimalPts  = calcOptimalPoints(allPlayers, weekStats, rosterPositions, playersDb);
      const efficiencyPct = optimalPts > 0
        ? Math.round((actualPts / optimalPts) * 100)
        : 100;

      const byPosition  = calcStarterPointsByPosition(
        starters, weekStats, rosterPositions, playersDb
      );

      mgr.weeks.push({
        week,
        actualPoints:  Math.round(actualPts * 100) / 100,
        optimalPoints: Math.round(optimalPts * 100) / 100,
        efficiencyPct,
        byPosition,
        benchPoints:   Math.round(benchPts * 100) / 100,
        starterIds:    starters,
        benchIds,
      });
    });
  }

  // Compute season-level rollups per manager
  Object.values(managers).forEach(mgr => {
    const seasonByPos = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DEF: 0 };
    let totalEff = 0, totalBench = 0, totalActual = 0, totalOptimal = 0;

    mgr.weeks.forEach(w => {
      Object.entries(w.byPosition).forEach(([pos, pts]) => {
        if (seasonByPos[pos] !== undefined) seasonByPos[pos] += pts;
      });
      totalEff     += w.efficiencyPct;
      totalBench   += w.benchPoints;
      totalActual  += w.actualPoints;
      totalOptimal += w.optimalPoints;
    });

    const weekCount = mgr.weeks.length || 1;
    mgr.season = {
      byPosition:      seasonByPos,
      avgEfficiency:   Math.round(totalEff / weekCount),
      totalBenchLeft:  Math.round(totalBench * 100) / 100,
      totalActual:     Math.round(totalActual * 100) / 100,
      totalOptimal:    Math.round(totalOptimal * 100) / 100,
      avgPointsPerWeek: Math.round((totalActual / weekCount) * 100) / 100,
      bestWeek:        mgr.weeks.reduce((best, w) => w.actualPoints > best.actualPoints ? w : best, mgr.weeks[0] || {}),
      worstWeek:       mgr.weeks.reduce((worst, w) => w.actualPoints < worst.actualPoints ? w : worst, mgr.weeks[0] || {}),
    };
  });

  onProgress(100, 'Done');

  return {
    managers: Object.values(managers).sort((a, b) => b.wins - a.wins || b.fpts - a.fpts),
    season,
    leagueName,
    regularWeeks,
    rosterPositions,
  };
}
