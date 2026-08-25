/**
 * GET  /api/settings?key=X   -> { value } | null
 * POST /api/settings  { key, value }  -> upserts
 *
 * Generic key/value store for small site-wide preferences — currently just
 * "current_league_id" (set from league.html, read by every other page).
 * Mirrors season_cache's 'kind' column philosophy: new settings later don't
 * need new tables or endpoints.
 */

const { getSupabase, requireApiKey } = require('./_lib/supabase');

module.exports = async (req, res) => {
  if (!requireApiKey(req, res)) return;
  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { key } = req.query;
    if (!key) { res.status(400).json({ error: 'key is required' }); return; }
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle();

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json(data ? { value: data.value } : null);
    return;
  }

  if (req.method === 'POST') {
    const { key, value } = req.body || {};
    if (!key || value === undefined) {
      res.status(400).json({ error: 'key and value are required' });
      return;
    }
    const { error } = await supabase.from('app_settings').upsert({
      key,
      value: String(value),
      updated_at: new Date().toISOString(),
    });

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
