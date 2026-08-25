/**
 * db-client.js
 * Shared wrapper for calling this project's own /api/* endpoints. Supabase
 * itself lives behind those endpoints — the browser never talks to it
 * directly, and the Supabase service role key never ships to the client.
 *
 * The constant below is a casual deterrent, not real security — the repo
 * is public, so treat this as a "please don't poke around" sign, not a
 * lock. It just needs to match the API_SHARED_SECRET env var set in
 * Vercel. See SETUP.md.
 */

const API_SHARED_SECRET = '648349b2f5e46f690745f84416faf392f42dd8f267f82245';

async function dbFetch(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'x-api-key': API_SHARED_SECRET,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error || ''; } catch (e) { /* body wasn't JSON */ }
    throw new Error(`API error ${res.status}: ${path}${detail ? ` — ${detail}` : ''}`);
  }
  return res.json();
}

function dbGet(path) {
  return dbFetch(path, { method: 'GET' });
}

function dbPost(path, body) {
  return dbFetch(path, { method: 'POST', body: JSON.stringify(body) });
}

/**
 * Fills a "Sleeper league ID" input with the site-wide current league (set
 * on league.html), falling back to this browser's local cache if the DB is
 * unreachable or nothing's been set yet. Used on every page's load so you
 * don't have to re-paste the league ID everywhere — the field stays a
 * normal editable input, this just pre-populates it.
 */
async function prefillLeagueId(inputId) {
  let value = null;
  try {
    const res = await dbGet('/api/settings?key=current_league_id');
    if (res && res.value) value = res.value;
  } catch (e) {
    // DB unavailable (not set up yet, offline, etc.) — fall back below.
  }
  if (!value) value = localStorage.getItem('lastLeagueId');
  const el = document.getElementById(inputId);
  if (value && el) el.value = value;
  return value;
}
