/**
 * sleeper.js
 * Sleeper API integration for fetching last season's standings.
 * Sleeper API is public — no auth required.
 * Docs: https://docs.sleeper.com
 */

const SLEEPER_BASE = 'https://api.sleeper.app/v1';

/**
 * Fetch basic league info.
 * @param {string} leagueId
 */
async function fetchLeague(leagueId) {
  const res = await fetch(`${SLEEPER_BASE}/league/${leagueId}`);
  if (!res.ok) throw new Error(`League not found: ${leagueId}`);
  return res.json();
}

/**
 * Fetch all rosters in the league.
 * Each roster has: roster_id, owner_id, settings.wins, settings.losses, settings.fpts
 */
async function fetchRosters(leagueId) {
  const res = await fetch(`${SLEEPER_BASE}/league/${leagueId}/rosters`);
  if (!res.ok) throw new Error('Failed to fetch rosters');
  return res.json();
}

/**
 * Fetch all users (managers) in the league.
 * Each user has: user_id, display_name, metadata.team_name
 */
async function fetchUsers(leagueId) {
  const res = await fetch(`${SLEEPER_BASE}/league/${leagueId}/users`);
  if (!res.ok) throw new Error('Failed to fetch users');
  return res.json();
}

/**
 * Build a map of owner_id -> display name (team name if set, else username).
 */
function buildNameMap(users) {
  const map = {};
  users.forEach(u => {
    map[u.user_id] = u.display_name;
  });
  return map;
}

/**
 * Fetch last season's standings from Sleeper, split by division.
 *
 * Sleeper stores division in roster.settings.division (1-indexed integer).
 * Teams are ranked within their division by: wins desc → fpts desc.
 *
 * @param {string} leagueId - Sleeper league ID
 * @returns {Object} {
 *   divisionRankings: { "Division A": ["Team1", "Team2", ...], "Division B": [...] },
 *   leagueName: string,
 *   season: string
 * }
 */
async function fetchLastSeasonStandings(leagueId) {
  const [league, rosters, users] = await Promise.all([
    fetchLeague(leagueId),
    fetchRosters(leagueId),
    fetchUsers(leagueId),
  ]);

  const nameMap = buildNameMap(users);

  // Group rosters by division (Sleeper uses 1, 2, etc.)
  const byDivision = {};
  rosters.forEach(roster => {
    const div = roster.settings?.division ?? 1;
    if (!byDivision[div]) byDivision[div] = [];
    byDivision[div].push({
      name: nameMap[roster.owner_id] || `Team ${roster.roster_id}`,
      wins: roster.settings?.wins ?? 0,
      losses: roster.settings?.losses ?? 0,
      fpts: roster.settings?.fpts ?? 0,
      fpts_decimal: roster.settings?.fpts_decimal ?? 0,
    });
  });

  // Sort each division: wins desc, then total fpts desc
  const divisionRankings = {};
  Object.entries(byDivision)
    .sort(([a], [b]) => Number(a) - Number(b))
    .forEach(([divNum, teams], idx) => {
      const letter = String.fromCharCode(65 + idx);
      const sorted = teams.sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        const fptsA = a.fpts + a.fpts_decimal / 100;
        const fptsB = b.fpts + b.fpts_decimal / 100;
        return fptsB - fptsA;
      });
      divisionRankings[`Division ${letter}`] = sorted.map(t => t.name);
    });

  return {
    divisionRankings,
    teamNames: Object.values(divisionRankings).flat(),
    leagueName: league.name,
    season: league.season,
  };
}