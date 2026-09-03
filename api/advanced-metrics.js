/**
 * GET  /api/advanced-metrics?season=X
 *      -> [{ season, week, gsisId, playerName, position, team, targets,
 *             receptions, receivingYards, targetShare, airYardsShare, wopr,
 *             routesRun, yprr }, ...] — every cached weekly row for that
 *      season. Small enough (a few thousand rows/season) to hand to the
 *      client and let it do season-to-date aggregation / week filtering.
 *
 * POST /api/advanced-metrics  { season }
 *      -> { season, weeksAdded, rowsUpserted } — the aggregation trigger.
 *      Finds the last cached week for the season, pulls nflverse's public
 *      weekly stats + play participation files, computes whatever weeks
 *      are newer than what's cached, and upserts them. Safe to call
 *      repeatedly / after missing a week — it always catches up from
 *      wherever it left off, never re-does already-cached weeks.
 *
 * Data source: nflverse-data GitHub release assets (plain HTTPS, no auth,
 * but no CORS headers either — this has to run server-side, not from the
 * browser). See db/schema.sql for the routes_run/yprr approximation note.
 */

const { parse } = require('csv-parse/sync');
const { getSupabase, requireApiKey } = require('./_lib/supabase');

const NFLVERSE_BASE = 'https://github.com/nflverse/nflverse-data/releases/download';
const ROUTE_ELIGIBLE_POSITIONS = new Set(['WR', 'TE', 'RB']);

function toNum(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

async function fetchCsv(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const text = await res.text();
  return parse(text, { columns: true, skip_empty_lines: true });
}

/**
 * There's no public "routes run" feed. This approximates it from
 * pbp_participation: for a play where FTN charted a route (the `route`
 * column is non-blank — it's the targeted receiver's route type, but a
 * non-blank value reliably means the play was a passing down), every
 * offensive player on the field at a route-eligible position gets credit
 * for a route run. Noise source: a RB staying in to block on a dropback
 * still counts, since we can't distinguish that from public data.
 */
function computeRoutesRun(participationRows, minWeek) {
  const routes = {}; // `${week}|${gsisId}` -> count
  participationRows.forEach(row => {
    if (!row.route) return;
    const week = parseInt(row.nflverse_game_id?.split('_')[1], 10);
    if (!week || week <= minWeek) return;
    const players = (row.offense_players || '').split(';').filter(Boolean);
    const positions = (row.offense_positions || '').split(';').filter(Boolean);
    players.forEach((gsisId, i) => {
      if (!ROUTE_ELIGIBLE_POSITIONS.has(positions[i])) return;
      const key = `${week}|${gsisId}`;
      routes[key] = (routes[key] || 0) + 1;
    });
  });
  return routes;
}

module.exports = async (req, res) => {
  if (!requireApiKey(req, res)) return;

  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const { season } = req.query;
      if (!season) { res.status(400).json({ error: 'season is required' }); return; }
      const { data, error } = await supabase
        .from('player_weekly_advanced')
        .select('*')
        .eq('season', season)
        .order('week', { ascending: true });

      if (error) { res.status(500).json({ error: error.message }); return; }
      res.status(200).json((data || []).map(r => ({
        season: r.season, week: r.week, gsisId: r.gsis_id, playerName: r.player_name,
        position: r.position, team: r.team, targets: r.targets, receptions: r.receptions,
        receivingYards: r.receiving_yards, targetShare: r.target_share,
        airYardsShare: r.air_yards_share, wopr: r.wopr, routesRun: r.routes_run, yprr: r.yprr,
      })));
      return;
    }

    if (req.method === 'POST') {
      const { season } = req.body || {};
      if (!season) { res.status(400).json({ error: 'season is required' }); return; }

      const { data: maxRow, error: maxErr } = await supabase
        .from('player_weekly_advanced')
        .select('week')
        .eq('season', season)
        .order('week', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (maxErr) { res.status(500).json({ error: maxErr.message }); return; }
      const minWeek = maxRow ? maxRow.week : 0;

      const [statsRows, participationRows] = await Promise.all([
        fetchCsv(`${NFLVERSE_BASE}/stats_player/stats_player_week_${season}.csv`),
        fetchCsv(`${NFLVERSE_BASE}/pbp_participation/pbp_participation_${season}.csv`),
      ]);

      const newStatsRows = statsRows.filter(r =>
        r.season_type === 'REG' && parseInt(r.week, 10) > minWeek
      );

      if (newStatsRows.length === 0) {
        res.status(200).json({ season, weeksAdded: [], rowsUpserted: 0 });
        return;
      }

      const routesMap = computeRoutesRun(participationRows, minWeek);
      const weeksAdded = new Set();

      const upsertRows = newStatsRows.map(r => {
        const week = parseInt(r.week, 10);
        weeksAdded.add(week);
        const routesRun = routesMap[`${week}|${r.player_id}`] ?? null;
        const receivingYards = toNum(r.receiving_yards);
        return {
          season: String(season),
          week,
          gsis_id: r.player_id,
          player_name: r.player_display_name,
          position: r.position,
          team: r.team,
          targets: toNum(r.targets),
          receptions: toNum(r.receptions),
          receiving_yards: receivingYards,
          target_share: toNum(r.target_share),
          air_yards_share: toNum(r.air_yards_share),
          wopr: toNum(r.wopr),
          routes_run: routesRun,
          yprr: routesRun ? receivingYards / routesRun : null,
          updated_at: new Date().toISOString(),
        };
      });

      const { error: upsertErr } = await supabase.from('player_weekly_advanced').upsert(upsertRows);
      if (upsertErr) { res.status(500).json({ error: upsertErr.message }); return; }

      res.status(200).json({
        season,
        weeksAdded: [...weeksAdded].sort((a, b) => a - b),
        rowsUpserted: upsertRows.length,
      });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Two multi-MB nflverse file downloads + parsing can run long as the
// season file grows — default Vercel timeout (10s on Hobby) may not be
// enough by mid/late season. See SETUP.md.
module.exports.config = { maxDuration: 60 };
