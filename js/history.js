/**
 * history.js
 * Fetches and processes full league history by walking the previous_league_id chain.
 *
 * Per season:
 *   - Final standings (wins, losses, fpts)
 *   - Playoff bracket results (winners bracket)
 *   - Champion
 *
 * All-time:
 *   - Per-manager aggregate record across all seasons
 *   - Head-to-head record matrix (all regular season matchups)
 */

const SLEEPER_H = 'https://api.sleeper.app/v1';
const BRACKET_ROUND_LABELS = { 1: 'Wildcard', 2: 'Semifinals', 3: 'Championship' };

// ─── API ──────────────────────────────────────────────────────────────────────

async function hFetch(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}: ${url}`);
  return res.json();
}

// ─── Chain walker ─────────────────────────────────────────────────────────────

/**
 * Walk previous_league_id chain from the given leagueId.
 * Returns array of league objects ordered newest → oldest.
 */
async function fetchLeagueChain(leagueId) {
  const chain = [];
  let id = leagueId;
  while (id) {
    const league = await hFetch(`${SLEEPER_H}/league/${id}`);
    chain.push(league);
    id = league.previous_league_id || null;
  }
  return chain; // newest first
}

// ─── Per-season data ──────────────────────────────────────────────────────────

async function fetchSeasonData(league, onProgress, progressBase, progressRange) {
  const leagueId = league.league_id;
  const season   = league.season;
  const regularWeeks = league.settings?.playoff_week_start
    ? league.settings.playoff_week_start - 1
    : 13;

  const [rosters, users, winnersRaw] = await Promise.all([
    hFetch(`${SLEEPER_H}/league/${leagueId}/rosters`),
    hFetch(`${SLEEPER_H}/league/${leagueId}/users`),
    hFetch(`${SLEEPER_H}/league/${leagueId}/winners_bracket`).catch(() => []),
  ]);

  // Build name map
  const userMap = {};
  users.forEach(u => { userMap[u.user_id] = u.display_name; });

  // Build roster info
  const rosterMap = {};
  rosters.forEach(r => {
    rosterMap[r.roster_id] = {
      displayName: userMap[r.owner_id] || `Team ${r.roster_id}`,
      ownerId:     r.owner_id,
      wins:        r.settings?.wins   ?? 0,
      losses:      r.settings?.losses ?? 0,
      fpts:        (r.settings?.fpts  ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100,
      division:    r.settings?.division ?? null,
    };
  });

  // Final standings sorted by wins desc, fpts desc
  const standings = Object.entries(rosterMap)
    .map(([rid, r]) => ({ rosterId: parseInt(rid), ...r }))
    .sort((a, b) => b.wins - a.wins || b.fpts - a.fpts);

  // Parse bracket
  const bracketGames = parseBracketGames(winnersRaw, rosterMap);
  const champion     = findChampion(winnersRaw, rosterMap);

  // Fetch all regular season matchups for H2H
  const matchupsByWeek = [];
  for (let week = 1; week <= regularWeeks; week++) {
    const pct = progressBase + Math.round((week / regularWeeks) * progressRange);
    onProgress(pct, `${season} — week ${week}/${regularWeeks}`);
    try {
      const wk = await hFetch(`${SLEEPER_H}/league/${leagueId}/matchups/${week}`);
      matchupsByWeek.push(wk);
    } catch (e) { /* skip */ }
  }

  // Build H2H results for this season from matchup data
  const h2hThisSeason = buildH2HFromMatchups(matchupsByWeek, rosterMap);

  return { season, leagueId, standings, bracketGames, champion, h2hThisSeason, rosterMap };
}

// ─── Bracket parsing ──────────────────────────────────────────────────────────

function parseBracketGames(bracket, rosterMap) {
  const rounds = {};
  bracket.forEach(game => {
    if (game.w == null) return;
    const round     = game.r;
    const label     = BRACKET_ROUND_LABELS[round] || `Round ${round}`;
    const isChamp   = game.p === 1;
    const isThird   = game.p === 3;
    const winner    = rosterMap[game.w]?.displayName || `Team ${game.w}`;
    const loser     = rosterMap[game.l]?.displayName || `Team ${game.l}`;
    const tag       = isChamp ? 'champ' : isThird ? 'third' : round === 1 ? 'wild' : 'semi';
    const tagLabel  = isChamp ? '🏆 Championship' : isThird ? '3rd Place' : label;

    if (!rounds[round]) rounds[round] = { label, games: [] };
    rounds[round].games.push({ winner, loser, tag, tagLabel, isChamp, isThird });
  });

  return Object.entries(rounds)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, r]) => r);
}

function findChampion(bracket, rosterMap) {
  const champGame = bracket.find(g => g.p === 1 && g.w != null);
  if (!champGame) return null;
  return rosterMap[champGame.w]?.displayName || `Team ${champGame.w}`;
}

// ─── H2H from matchups ────────────────────────────────────────────────────────

/**
 * Build H2H win/loss map from raw matchup data.
 * Returns: { "nameA|nameB": { winsA, winsB } }
 * Keyed by sorted display names for cross-season consistency.
 */
function buildH2HFromMatchups(matchupsByWeek, rosterMap) {
  const results = {}; // "rosterIdA-rosterIdB" → { a: wins, b: wins }

  matchupsByWeek.forEach(weekMatchups => {
    // Group by matchup_id
    const byMatchupId = {};
    weekMatchups.forEach(team => {
      const mid = team.matchup_id;
      if (!mid) return;
      if (!byMatchupId[mid]) byMatchupId[mid] = [];
      byMatchupId[mid].push(team);
    });

    Object.values(byMatchupId).forEach(pair => {
      if (pair.length !== 2) return;
      const [teamA, teamB] = pair;
      const ptsA = teamA.points ?? 0;
      const ptsB = teamB.points ?? 0;
      const ridA = teamA.roster_id;
      const ridB = teamB.roster_id;
      const nameA = rosterMap[ridA]?.displayName;
      const nameB = rosterMap[ridB]?.displayName;
      if (!nameA || !nameB) return;

      // Key always sorted alphabetically for cross-season consistency
      const [keyA, keyB] = nameA <= nameB ? [nameA, nameB] : [nameB, nameA];
      const key = `${keyA}|||${keyB}`;
      if (!results[key]) results[key] = { a: keyA, b: keyB, winsA: 0, winsB: 0, total: 0 };

      results[key].total++;
      if (nameA === keyA) {
        if (ptsA > ptsB) results[key].winsA++;
        else if (ptsB > ptsA) results[key].winsB++;
      } else {
        if (ptsB > ptsA) results[key].winsA++;
        else if (ptsA > ptsB) results[key].winsB++;
      }
    });
  });

  return results;
}

// ─── All-time rollups ─────────────────────────────────────────────────────────

function buildAllTimeRecords(seasons) {
  const records = {}; // displayName → { wins, losses, fpts, seasons, championships }

  seasons.forEach(s => {
    s.standings.forEach(mgr => {
      if (!records[mgr.displayName]) {
        records[mgr.displayName] = { wins: 0, losses: 0, fpts: 0, seasons: 0, championships: 0 };
      }
      const r = records[mgr.displayName];
      r.wins   += mgr.wins;
      r.losses += mgr.losses;
      r.fpts   += mgr.fpts;
      r.seasons++;
      if (s.champion === mgr.displayName) r.championships++;
    });
  });

  return Object.entries(records)
    .map(([name, r]) => ({
      name, ...r,
      winPct: r.wins + r.losses > 0
        ? ((r.wins / (r.wins + r.losses)) * 100).toFixed(1)
        : '0.0',
    }))
    .sort((a, b) => parseFloat(b.winPct) - parseFloat(a.winPct) || b.wins - a.wins);
}

function mergeH2H(seasons) {
  const merged = {};
  seasons.forEach(s => {
    Object.entries(s.h2hThisSeason).forEach(([key, val]) => {
      if (!merged[key]) merged[key] = { a: val.a, b: val.b, winsA: 0, winsB: 0, total: 0 };
      merged[key].winsA += val.winsA;
      merged[key].winsB += val.winsB;
      merged[key].total += val.total;
    });
  });
  return merged;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

async function loadLeagueHistory(leagueId, onProgress = () => {}) {
  onProgress(2, 'Loading league chain...');
  const chain = await fetchLeagueChain(leagueId);

  const seasons = [];
  const perSeasonProgress = Math.floor(90 / chain.length);

  for (let i = 0; i < chain.length; i++) {
    const league = chain[i];
    const base   = 5 + i * perSeasonProgress;
    const data   = await fetchSeasonData(league, onProgress, base, perSeasonProgress - 2);
    seasons.push(data);
  }

  // seasons is already newest-first from chain walk
  const allTimeRecords = buildAllTimeRecords(seasons);
  const h2hMatrix      = mergeH2H(seasons);

  onProgress(100, 'Done');

  return { seasons, allTimeRecords, h2hMatrix };
}
