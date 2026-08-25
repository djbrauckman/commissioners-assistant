/**
 * Shared server-side helpers for the api/ functions.
 * The Supabase service role key lives only here, read from env vars set in
 * Vercel project settings — it is never sent to the browser. The browser
 * only ever talks to our own /api/* endpoints, guarded by requireApiKey().
 */

const { createClient } = require('@supabase/supabase-js');

let client = null;

function getSupabase() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

/**
 * Casual deterrent, not real security — the repo is public, so this
 * constant is readable by anyone who looks. What it actually protects is
 * the Supabase service role key, which never leaves the server; worst case
 * without this check is someone spamming junk rows. Returns true if the
 * request is authorized; writes a 401 and returns false otherwise (caller
 * should just `return` when this is false).
 */
function requireApiKey(req, res) {
  const provided = req.headers['x-api-key'];
  const expected = process.env.API_SHARED_SECRET;
  if (!expected || provided !== expected) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

module.exports = { getSupabase, requireApiKey };
