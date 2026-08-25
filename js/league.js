/**
 * league.js
 * Sets/shows the site-wide "current league" (app_settings.current_league_id
 * in the DB), which every other page's prefillLeagueId() reads on load.
 * Depends on: nav.js, db-client.js
 */

document.addEventListener('DOMContentLoaded', async () => {
  initNav('league');
  await loadCurrentLeague();
});

async function loadCurrentLeague() {
  const statusEl = document.getElementById('leagueStatus');
  try {
    const res = await dbGet('/api/settings?key=current_league_id');
    if (res && res.value) {
      document.getElementById('leagueIdInput').value = res.value;
      await previewLeague(res.value, /* silent */ true);
    }
  } catch (e) {
    statusEl.textContent = 'Could not reach the database — has it been set up yet? See SETUP.md.';
    statusEl.className = 'warn';
  }
}

async function previewLeague(id, silent) {
  const previewEl = document.getElementById('leaguePreview');
  if (!id) { previewEl.textContent = ''; return null; }
  try {
    const res = await fetch(`https://api.sleeper.app/v1/league/${id}`);
    if (!res.ok) throw new Error('not found');
    const league = await res.json();
    previewEl.textContent = `${league.name} — ${league.season} season`;
    previewEl.className = 'status-ok';
    return league;
  } catch (e) {
    previewEl.textContent = silent ? '' : 'Could not find a league with that ID.';
    previewEl.className = 'warn';
    return null;
  }
}

async function handlePreviewClick() {
  const id = document.getElementById('leagueIdInput').value.trim();
  await previewLeague(id, false);
}

async function handleSaveLeague() {
  const id = document.getElementById('leagueIdInput').value.trim();
  const statusEl = document.getElementById('leagueStatus');
  statusEl.textContent = '';
  if (!id) {
    statusEl.textContent = 'Enter a league ID first.';
    statusEl.className = 'warn';
    return;
  }

  const league = await previewLeague(id, false);
  if (!league) return;

  try {
    await dbPost('/api/settings', { key: 'current_league_id', value: id });
    localStorage.setItem('lastLeagueId', id); // keep the offline fallback in sync too
    statusEl.textContent = `Saved — every page now defaults to "${league.name}".`;
    statusEl.className = 'status-ok';
  } catch (e) {
    statusEl.textContent = `Failed to save: ${e.message}`;
    statusEl.className = 'warn';
  }
}
