/**
 * GET  /api/dues?league_id=X&season=Y  -> { duesAmount, payouts, paid } | null
 * POST /api/dues  { league_id, season, duesAmount, payouts, paid }  -> upserts the whole row
 *
 * Dues state is small, so writes always replace the full row rather than
 * doing partial/field-level updates.
 */

const { getSupabase, requireApiKey } = require('./_lib/supabase');

module.exports = async (req, res) => {
  if (!requireApiKey(req, res)) return;
  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { league_id, season } = req.query;
    if (!league_id || !season) {
      res.status(400).json({ error: 'league_id and season are required' });
      return;
    }
    const { data, error } = await supabase
      .from('dues_state')
      .select('dues_amount, payouts, paid')
      .eq('sleeper_league_id', league_id)
      .eq('season', season)
      .maybeSingle();

    if (error) { res.status(500).json({ error: error.message }); return; }
    if (!data) { res.status(200).json(null); return; }
    res.status(200).json({ duesAmount: Number(data.dues_amount), payouts: data.payouts, paid: data.paid });
    return;
  }

  if (req.method === 'POST') {
    const { league_id, season, duesAmount, payouts, paid } = req.body || {};
    if (!league_id || !season) {
      res.status(400).json({ error: 'league_id and season are required' });
      return;
    }
    const { error } = await supabase.from('dues_state').upsert({
      sleeper_league_id: league_id,
      season: String(season),
      dues_amount: duesAmount ?? 0,
      payouts: payouts ?? {},
      paid: paid ?? {},
      updated_at: new Date().toISOString(),
    });

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
