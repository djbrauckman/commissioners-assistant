/**
 * GET    /api/gut-check?season=X  -> entries for that season, newest week first
 * POST   /api/gut-check  { season, week, playedPlayer, playedPoints,
 *                          consideredPlayer, consideredPoints, processNote, id? }
 *        -> inserts a new entry, or updates the existing one when `id` is set
 * DELETE /api/gut-check?id=N  -> removes an entry
 *
 * pointsDiff (played minus considered) is computed by Postgres as a
 * generated column — never sent from here, so it can't go stale on edit.
 */

const { getSupabase, requireApiKey } = require('./_lib/supabase');

function isNum(v) {
  return v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v));
}

function toRow(body) {
  const { season, week, playedPlayer, playedPoints, consideredPlayer, consideredPoints, processNote } = body || {};
  if (!season || !isNum(week)) return { error: 'season and week are required' };
  if (!playedPlayer || !consideredPlayer) return { error: 'both player names are required' };
  if (!isNum(playedPoints) || !isNum(consideredPoints)) return { error: 'both point totals are required' };
  return {
    row: {
      season: String(season),
      week: parseInt(week, 10),
      played_player: String(playedPlayer).trim(),
      played_points: Number(playedPoints),
      considered_player: String(consideredPlayer).trim(),
      considered_points: Number(consideredPoints),
      process_note: String(processNote || '').trim(),
    },
  };
}

module.exports = async (req, res) => {
  if (!requireApiKey(req, res)) return;

  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const { season } = req.query;
      if (!season) { res.status(400).json({ error: 'season is required' }); return; }
      const { data, error } = await supabase
        .from('gut_check')
        .select('*')
        .eq('season', season)
        .order('week', { ascending: false })
        .order('id', { ascending: false });

      if (error) { res.status(500).json({ error: error.message }); return; }
      res.status(200).json((data || []).map(r => ({
        id: r.id, season: r.season, week: r.week,
        playedPlayer: r.played_player, playedPoints: Number(r.played_points),
        consideredPlayer: r.considered_player, consideredPoints: Number(r.considered_points),
        pointsDiff: Number(r.points_diff), processNote: r.process_note,
      })));
      return;
    }

    if (req.method === 'POST') {
      const { row, error: invalid } = toRow(req.body);
      if (invalid) { res.status(400).json({ error: invalid }); return; }

      const id = req.body.id;
      const { error } = id
        ? await supabase.from('gut_check').update(row).eq('id', id)
        : await supabase.from('gut_check').insert(row);

      if (error) { res.status(500).json({ error: error.message }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) { res.status(400).json({ error: 'id is required' }); return; }
      const { error } = await supabase.from('gut_check').delete().eq('id', id);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
