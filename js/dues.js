/**
 * dues.js
 * Dues tracker for the Fantasy Commissioner Tool.
 *
 * - Pulls managers from Sleeper API
 * - Tracks paid/unpaid status per manager via localStorage
 * - Tracks payout structure (1st/2nd/3rd) with editable amounts
 * - Persists everything to localStorage keyed by leagueId + season
 */

const SLEEPER_BASE = 'https://api.sleeper.app/v1';

let leagueId   = null;
let season     = null;
let duesAmount = 0;
let managers   = []; // [{ rosterId, displayName, paid }]
let payouts    = { first: 0, second: 0, third: 0 };

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initNav('dues');

  // Pre-fill league ID if saved
  const saved = localStorage.getItem('lastLeagueId');
  if (saved) document.getElementById('duesLeagueId').value = saved;
});

// ─── Load ─────────────────────────────────────────────────────────────────────

async function handleDuesLoad() {
  const idInput  = document.getElementById('duesLeagueId').value.trim();
  const szInput  = document.getElementById('duesSeason').value.trim();
  const amtInput = parseFloat(document.getElementById('duesAmount').value);
  const errEl    = document.getElementById('duesLoadError');
  const progEl   = document.getElementById('duesLoadProgress');

  if (!idInput) {
    showError('Please enter a league ID.'); return;
  }
  if (!amtInput || amtInput <= 0) {
    showError('Please enter a dues amount.'); return;
  }

  errEl.style.display = 'none';
  progEl.style.display = 'block';

  try {
    // Walk previous_league_id chain if season specified
    let targetId = idInput;
    if (szInput) targetId = await findLeagueForSeason(idInput, szInput);

    leagueId   = targetId;
    season     = szInput || await fetchSeason(targetId);
    duesAmount = amtInput;

    localStorage.setItem('lastLeagueId', idInput);

    // Fetch managers from Sleeper
    const [rosters, users] = await Promise.all([
      apiFetch(`${SLEEPER_BASE}/league/${leagueId}/rosters`),
      apiFetch(`${SLEEPER_BASE}/league/${leagueId}/users`),
    ]);

    const userMap = {};
    users.forEach(u => { userMap[u.user_id] = u.display_name; });

    // Load saved payment state from localStorage
    const saved = loadSavedState();

    managers = rosters
      .sort((a, b) => a.roster_id - b.roster_id)
      .map(r => ({
        rosterId:    r.roster_id,
        displayName: userMap[r.owner_id] || `Team ${r.roster_id}`,
        paid:        saved.paid?.[r.roster_id] ?? false,
      }));

    // Load saved payouts or calculate defaults
    payouts = saved.payouts || calcDefaultPayouts(managers.length, duesAmount);

    progEl.style.display = 'none';
    document.getElementById('setupBadge').className = 'step-badge done';
    document.getElementById('setupBadge').textContent = '✓';

    renderDuesTracker();
    document.getElementById('duesTracker').style.display = 'block';

  } catch (err) {
    progEl.style.display = 'none';
    showError(`Error: ${err.message}`);
  }
}

// ─── Default payout calculator ────────────────────────────────────────────────

/**
 * Default split: 1st 50%, 2nd 30%, 3rd 20% of total pot.
 */
function calcDefaultPayouts(numManagers, dues) {
  const pot = numManagers * dues;
  return {
    first:  Math.round(pot * 0.50),
    second: Math.round(pot * 0.30),
    third:  Math.round(pot * 0.20),
  };
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderDuesTracker() {
  renderSummary();
  renderTable();
  renderPayouts();
}

function renderSummary() {
  const total    = managers.length * duesAmount;
  const collected = managers.filter(m => m.paid).length * duesAmount;
  const outstanding = total - collected;
  const paidCount = managers.filter(m => m.paid).length;

  document.getElementById('duesSummary').innerHTML = `
    <div class="dues-chip highlight">
      <span>$${collected}</span>collected
    </div>
    <div class="dues-chip ${outstanding > 0 ? 'warn-chip' : ''}">
      <span>$${outstanding}</span>outstanding
    </div>
    <div class="dues-chip">
      <span>$${total}</span>total pot
    </div>
    <div class="dues-chip">
      <span>${paidCount}/${managers.length}</span>paid
    </div>
    <div class="dues-chip">
      <span>$${duesAmount}</span>per manager
    </div>
  `;
}

function renderTable() {
  const tbody = document.getElementById('duesTableBody');
  tbody.innerHTML = '';

  managers.forEach(mgr => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="manager-col">${mgr.displayName}</td>
      <td class="amount-col">$${duesAmount}</td>
      <td>
        <label class="paid-toggle" onclick="togglePaid(${mgr.rosterId})">
          <div class="toggle-track ${mgr.paid ? 'on' : ''}" id="track-${mgr.rosterId}">
            <div class="toggle-thumb"></div>
          </div>
          <span class="toggle-label ${mgr.paid ? 'paid' : ''}" id="label-${mgr.rosterId}">
            ${mgr.paid ? 'Paid' : 'Unpaid'}
          </span>
        </label>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderPayouts() {
  const pot = managers.length * duesAmount;
  const totalPayouts = payouts.first + payouts.second + payouts.third;
  const remainder = pot - totalPayouts;

  const places = [
    { key: 'first',  label: '1st Place', cls: 'first',  emoji: '🥇' },
    { key: 'second', label: '2nd Place', cls: 'second', emoji: '🥈' },
    { key: 'third',  label: '3rd Place', cls: 'third',  emoji: '🥉' },
  ];

  document.getElementById('payoutGrid').innerHTML = places.map(p => {
    const pct = pot > 0 ? Math.round((payouts[p.key] / pot) * 100) : 0;
    return `
      <div class="payout-card">
        <div class="payout-place ${p.cls}">${p.emoji} ${p.label}</div>
        <div class="payout-input-row">
          <input
            type="number"
            value="${payouts[p.key]}"
            min="0"
            step="5"
            id="payout-${p.key}"
            onchange="updatePayout('${p.key}', this.value)"
            style="font-size:18px;font-weight:600;padding:6px 8px"
          />
        </div>
        <div class="payout-pct">${pct}% of pot</div>
      </div>
    `;
  }).join('');

  document.getElementById('payoutRemainder').innerHTML = remainder !== 0
    ? `<span style="color:${remainder > 0 ? 'var(--amber)' : 'var(--red)'}">
        ${remainder > 0 ? `$${remainder} unallocated` : `$${Math.abs(remainder)} over pot`}
        — total pot: $${pot}
       </span>`
    : `<span style="color:var(--green)">✓ Fully allocated — total pot: $${pot}</span>`;
}

// ─── Interactions ─────────────────────────────────────────────────────────────

function togglePaid(rosterId) {
  const mgr = managers.find(m => m.rosterId === rosterId);
  if (!mgr) return;

  mgr.paid = !mgr.paid;

  // Update toggle UI
  const track = document.getElementById(`track-${rosterId}`);
  const label = document.getElementById(`label-${rosterId}`);
  if (mgr.paid) {
    track.classList.add('on');
    label.classList.add('paid');
    label.textContent = 'Paid';
  } else {
    track.classList.remove('on');
    label.classList.remove('paid');
    label.textContent = 'Unpaid';
  }

  saveState();
  renderSummary();
}

function updatePayout(key, value) {
  payouts[key] = parseFloat(value) || 0;
  saveState();

  // Re-render just the remainder line and pct labels
  const pot = managers.length * duesAmount;
  const totalPayouts = payouts.first + payouts.second + payouts.third;
  const remainder = pot - totalPayouts;

  ['first', 'second', 'third'].forEach(k => {
    const pct = pot > 0 ? Math.round((payouts[k] / pot) * 100) : 0;
    const card = document.getElementById(`payout-${k}`)?.closest('.payout-card');
    if (card) {
      const pctEl = card.querySelector('.payout-pct');
      if (pctEl) pctEl.textContent = `${pct}% of pot`;
    }
  });

  document.getElementById('payoutRemainder').innerHTML = remainder !== 0
    ? `<span style="color:${remainder > 0 ? 'var(--amber)' : 'var(--red)'}">
        ${remainder > 0 ? `$${remainder} unallocated` : `$${Math.abs(remainder)} over pot`}
        — total pot: $${pot}
       </span>`
    : `<span style="color:var(--green)">✓ Fully allocated — total pot: $${pot}</span>`;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function storageKey() {
  return `dues_${leagueId}_${season}`;
}

function saveState() {
  const paid = {};
  managers.forEach(m => { paid[m.rosterId] = m.paid; });
  localStorage.setItem(storageKey(), JSON.stringify({ paid, payouts }));
}

function loadSavedState() {
  const raw = localStorage.getItem(storageKey());
  return raw ? JSON.parse(raw) : {};
}

function resetDues() {
  if (!confirm('Reset all payment statuses?')) return;
  managers.forEach(m => { m.paid = false; });
  saveState();
  renderDuesTracker();
}

// ─── Export ───────────────────────────────────────────────────────────────────

function exportDuesCSV() {
  const pot = managers.length * duesAmount;
  let csv = `Fantasy Commissioner Dues — Season ${season}\n\n`;
  csv += `Manager,Dues Owed,Status\n`;
  managers.forEach(m => {
    csv += `${m.displayName},$${duesAmount},${m.paid ? 'Paid' : 'Unpaid'}\n`;
  });
  csv += `\nTotal Pot,$${pot},\n`;
  csv += `\nPayouts\n`;
  csv += `1st Place,$${payouts.first},\n`;
  csv += `2nd Place,$${payouts.second},\n`;
  csv += `3rd Place,$${payouts.third},\n`;

  const a    = document.createElement('a');
  a.href     = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = `${season}_dues.csv`;
  a.click();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

async function fetchSeason(id) {
  const league = await apiFetch(`${SLEEPER_BASE}/league/${id}`);
  return league.season;
}

async function findLeagueForSeason(leagueId, targetSeason) {
  let id = leagueId;
  for (let i = 0; i < 10; i++) {
    const league = await apiFetch(`${SLEEPER_BASE}/league/${id}`);
    if (String(league.season) === String(targetSeason)) return id;
    if (!league.previous_league_id) break;
    id = league.previous_league_id;
  }
  throw new Error(`Season ${targetSeason} not found in this league's history.`);
}

function showError(msg) {
  const el = document.getElementById('duesLoadError');
  el.textContent = msg;
  el.style.display = 'block';
}
