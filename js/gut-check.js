/**
 * gut-check.js
 * A log of start/sit decisions: the player you played vs. the one you
 * considered, each with their outcome, plus a process note. Backed by
 * api/gut-check.js; points gained/lost is computed by the DB.
 * Depends on: nav.js, db-client.js
 */

// A decision within this many points either way is noise, not a right or
// wrong call.
const GUT_THRESHOLD = 2;

let entries = [];
let editingId = null;

document.addEventListener('DOMContentLoaded', async () => {
  initNav('gut-check');
  const season = await getCurrentSeason();
  if (season) document.getElementById('seasonInput').value = season;
  await loadEntries();
});

// ─── Classification ─────────────────────────────────────────────────────────

function classify(diff) {
  if (diff >= GUT_THRESHOLD) return 'good';
  if (diff <= -GUT_THRESHOLD) return 'bad';
  return 'even';
}

function fmtSigned(n) {
  const v = Math.round(n * 100) / 100;
  return `${v > 0 ? '+' : ''}${v}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ─── Load ───────────────────────────────────────────────────────────────────

async function loadEntries() {
  const season = document.getElementById('seasonInput').value.trim();
  if (!season) { entries = []; render(); return; }
  try {
    entries = await dbGet(`/api/gut-check?season=${encodeURIComponent(season)}`);
  } catch (e) {
    document.getElementById('listMeta').textContent = `Failed to load: ${e.message}`;
    return;
  }
  render();
}

// ─── Save / edit / delete ───────────────────────────────────────────────────

function setStatus(msg, cls) {
  const el = document.getElementById('formStatus');
  el.textContent = msg;
  el.className = cls;
}

async function handleSave() {
  const body = {
    season: document.getElementById('seasonInput').value.trim(),
    week: document.getElementById('weekInput').value,
    playedPlayer: document.getElementById('playedName').value.trim(),
    playedPoints: document.getElementById('playedPts').value,
    consideredPlayer: document.getElementById('consideredName').value.trim(),
    consideredPoints: document.getElementById('consideredPts').value,
    processNote: document.getElementById('processNote').value.trim(),
  };
  if (editingId) body.id = editingId;

  try {
    await dbPost('/api/gut-check', body);
  } catch (e) {
    setStatus(`Failed to save: ${e.message}`, 'warn');
    return;
  }
  setStatus(editingId ? 'Entry updated.' : 'Entry saved.', 'status-ok');
  cancelEdit(/* keepStatus */ true);
  await loadEntries();
}

function startEdit(id) {
  const e = entries.find(x => x.id === id);
  if (!e) return;
  editingId = id;
  document.getElementById('weekInput').value = e.week;
  document.getElementById('playedName').value = e.playedPlayer;
  document.getElementById('playedPts').value = e.playedPoints;
  document.getElementById('consideredName').value = e.consideredPlayer;
  document.getElementById('consideredPts').value = e.consideredPoints;
  document.getElementById('processNote').value = e.processNote;
  document.getElementById('formTitle').textContent = 'Edit decision';
  document.getElementById('formBadge').textContent = '✎';
  document.getElementById('saveBtn').textContent = 'Save changes →';
  document.getElementById('cancelBtn').style.display = '';
  setStatus('', 'status-info');
  document.getElementById('formTitle').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Clears everything except season and week — you usually log several
// decisions for the same week back to back.
function cancelEdit(keepStatus) {
  editingId = null;
  ['playedName', 'playedPts', 'consideredName', 'consideredPts', 'processNote']
    .forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('formTitle').textContent = 'Log a decision';
  document.getElementById('formBadge').textContent = '+';
  document.getElementById('saveBtn').textContent = 'Save entry →';
  document.getElementById('cancelBtn').style.display = 'none';
  if (!keepStatus) setStatus('', 'status-info');
}

async function deleteEntry(id) {
  if (!confirm('Delete this entry?')) return;
  try {
    await dbDelete(`/api/gut-check?id=${encodeURIComponent(id)}`);
  } catch (e) {
    setStatus(`Failed to delete: ${e.message}`, 'warn');
    return;
  }
  if (editingId === id) cancelEdit();
  await loadEntries();
}

// ─── Render ─────────────────────────────────────────────────────────────────

function render() {
  const counts = { good: 0, even: 0, bad: 0 };
  let net = 0;
  entries.forEach(e => { counts[classify(e.pointsDiff)]++; net += e.pointsDiff; });

  document.getElementById('listMeta').textContent = entries.length
    ? `${entries.length} decision${entries.length === 1 ? '' : 's'} logged`
    : 'Nothing logged for this season yet';

  document.getElementById('summaryChips').innerHTML = entries.length ? `
    <div class="stat-chip"><span>${fmtSigned(net)}</span>net points</div>
    <div class="stat-chip"><span style="color:var(--green)">${counts.good}</span>right calls</div>
    <div class="stat-chip"><span style="color:var(--amber)">${counts.even}</span>negligible</div>
    <div class="stat-chip"><span style="color:var(--red)">${counts.bad}</span>wrong calls</div>
  ` : '';

  document.getElementById('entriesTbody').innerHTML = entries.map(e => `
    <tr>
      <td>${e.week}</td>
      <td>${escapeHtml(e.playedPlayer)}</td>
      <td>${e.playedPoints}</td>
      <td>${escapeHtml(e.consideredPlayer)}</td>
      <td>${e.consideredPoints}</td>
      <td><span class="gc-diff gc-${classify(e.pointsDiff)}">${fmtSigned(e.pointsDiff)}</span></td>
      <td class="gc-note">${escapeHtml(e.processNote)}</td>
      <td class="gc-actions">
        <button class="btn-secondary" onclick="startEdit(${e.id})">Edit</button>
        <button class="btn-secondary" onclick="deleteEntry(${e.id})">Delete</button>
      </td>
    </tr>
  `).join('');
}
