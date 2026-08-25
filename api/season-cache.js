/**
 * GET  /api/season-cache?league_ids=id1,id2,id3&kind=history|stats
 *      -> { [season]: data } map of every cached season among those league_ids
 * POST /api/season-cache  { league_id, season, kind, data }
 *      -> upserts one season's cached blob
 *
 * IMPORTANT: league_id here is that SEASON's own Sleeper league_id, not
 * whatever root league_id the user typed in — Sleeper mints a new league_id
 * every season (chained via previous_league_id), so a completed season's id
 * never changes, but "this year's league_id" does. Callers walk the chain
 * and pass each season's own id, both when reading (as the league_ids list)
 * and writing (as league_id) — see history.js / stats.js.
 *
 * Only ever written for seasons Sleeper reports as status: "complete" —
 * callers are responsible for that check before POSTing. The in-progress
 * season is always fetched live and never cached here.
 */

const { getSupabase, requireApiKey } = require('./_lib/supabase');

module.exports = async (req, res) => {
  if (!requireApiKey(req, res)) return;
  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { league_ids, kind } = req.query;
    if (!league_ids || !kind) {
      res.status(400).json({ error: 'league_ids and kind are required' });
      return;
    }
    const ids = String(league_ids).split(',').map(s => s.trim()).filter(Boolean);
    const { data, error } = await supabase
      .from('season_cache')
      .select('season, data')
      .in('sleeper_league_id', ids)
      .eq('kind', kind);

    if (error) { res.status(500).json({ error: error.message }); return; }
    const bySeason = {};
    (data || []).forEach(row => { bySeason[row.season] = row.data; });
    res.status(200).json(bySeason);
    return;
  }

  if (req.method === 'POST') {
    const { league_id, season, kind, data } = req.body || {};
    if (!league_id || !season || !kind || data === undefined) {
      res.status(400).json({ error: 'league_id, season, kind, and data are required' });
      return;
    }
    const { error } = await supabase.from('season_cache').upsert({
      sleeper_league_id: league_id,
      season: String(season),
      kind,
      data,
      cached_at: new Date().toISOString(),
    });

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
