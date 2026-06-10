/**
 * stats-ui.js
 * Rendering and interaction for the stats page.
 * Depends on: nav.js, stats.js
 */

const POS_COLORS = {
  QB:   '#E8614A',
  RB:   '#3B82F6',
  WR:   '#8B5CF6',
  TE:   '#F59E0B',
  FLEX: '#6366F1',
  K:    '#10B981',
  DEF:  '#6B7280',
};
const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'];

let currentData    = null;
let selectedRoster = null;

document.addEventListener('DOMContentLoaded', () => {
  initNav('stats');

  // Pre-fill league ID if stored from schedule page
  const saved = localStorage.getItem('lastLeagueId');
  if (saved) document.getElementById('statsLeagueId').value = saved;
});

// ─── Load ─────────────────────────────────────────────────────────────────────

async function handleLoadStats() {
  const leagueId = document.getElementById('statsLeagueId').value.trim();
  const season   = document.getElementById('statsSeason').value.trim();
  const errEl    = document.getElementById('loadError');

  if (!leagueId) {
    errEl.textContent = 'Please enter a league ID.';
    errEl.style.display = 'block';
    return;
  }

  errEl.style.display = 'none';
  showProgress(0, 'Starting...');

  try {
    // If season specified, walk previous_league_id chain
    let targetId = leagueId;
    if (season) {
      targetId = await findLeagueForSeason(leagueId, season);
    }

    localStorage.setItem('lastLeagueId', leagueId);

    currentData = await loadManagerStats(targetId, (pct, msg) => {
      showProgress(pct, msg);
    });

    hideProgress();
    renderResults(currentData);

  } catch (err) {
    hideProgress();
    errEl.textContent = `Error: ${err.message}`;
    errEl.style.display = 'block';
  }
}

async function findLeagueForSeason(leagueId, targetSeason) {
  for (let id = leagueId, i = 0; i < 10; i++) {
    const res    = await fetch(`https://api.sleeper.app/v1/league/${id}`);
    const league = await res.json();
    if (String(league.season) === String(targetSeason)) return id;
    if (!league.previous_league_id) break;
    id = league.previous_league_id;
  }
  throw new Error(`Season ${targetSeason} not found in this league's history.`);
}

// ─── Progress ─────────────────────────────────────────────────────────────────

function showProgress(pct, msg) {
  const wrap = document.getElementById('progressWrap');
  wrap.style.display = 'block';
  document.getElementById('progressLabel').textContent = msg;
  document.getElementById('progressFill').style.width  = `${pct}%`;
  document.getElementById('statsResults').style.display = 'none';
}

function hideProgress() {
  document.getElementById('progressWrap').style.display = 'none';
}

// ─── Results ─────────────────────────────────────────────────────────────────

function renderResults(data) {
  const { managers, season, leagueName, regularWeeks } = data;

  document.getElementById('resultsTitle').textContent = leagueName;
  document.getElementById('resultsMeta').textContent  =
    `${season} season · ${regularWeeks} regular season weeks · ${managers.length} managers`;

  renderManagerCards(managers);
  document.getElementById('statsResults').style.display = 'block';
}

function renderManagerCards(managers) {
  const grid = document.getElementById('managerGrid');
  grid.innerHTML = '';

  // Calculate league totals for bar scaling
  const maxTotal = Math.max(...managers.map(m => m.season.totalActual));

  managers.forEach(mgr => {
    const card = buildManagerCard(mgr, maxTotal);
    grid.appendChild(card);
  });
}

function buildManagerCard(mgr, maxTotal) {
  const card = document.createElement('div');
  card.className = 'manager-card';
  card.dataset.rosterId = mgr.rosterId;
  card.onclick = () => showDetail(mgr.rosterId);

  const isWinning = mgr.wins > mgr.losses;
  const isLosing  = mgr.wins < mgr.losses;
  const recordClass = isWinning ? 'winning' : isLosing ? 'losing' : '';

  const totalPts = mgr.season.totalActual;
  const byPos    = mgr.season.byPosition;

  // Position bar segments as % of total scored
  const segments = POS_ORDER
    .filter(pos => byPos[pos] > 0)
    .map(pos => ({
      pos,
      pct: Math.round((byPos[pos] / totalPts) * 100),
      pts: byPos[pos].toFixed(1),
    }));

  card.innerHTML = `
    <div class="manager-card-header">
      <div class="manager-name">${mgr.displayName}</div>
      <div class="manager-record ${recordClass}">${mgr.wins}-${mgr.losses}</div>
    </div>

    <div class="pos-bar-wrap">
      <div class="pos-bar-label">
        <span>Points by position</span>
        <span>${totalPts.toFixed(1)} pts</span>
      </div>
      <div class="pos-bar-track">
        ${segments.map(s =>
          `<div class="pos-bar-seg" style="width:${s.pct}%; background:${POS_COLORS[s.pos]}" title="${s.pos}: ${s.pts}pts"></div>`
        ).join('')}
      </div>
      <div class="pos-legend">
        ${segments.map(s => `
          <div class="pos-legend-item">
            <div class="pos-legend-dot" style="background:${POS_COLORS[s.pos]}"></div>
            <span>${s.pos} ${s.pct}%</span>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="manager-chips">
      <div class="manager-chip"><span>${mgr.season.avgEfficiency}%</span>avg efficiency</div>
      <div class="manager-chip"><span>${mgr.season.avgPointsPerWeek}</span>pts/week</div>
      <div class="manager-chip"><span>${mgr.season.totalBenchLeft.toFixed(0)}</span>bench pts left</div>
      <div class="manager-chip"><span>${mgr.season.bestWeek?.actualPoints ?? '—'}</span>best week</div>
    </div>
  `;

  return card;
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function showDetail(rosterId) {
  const mgr = currentData.managers.find(m => m.rosterId === rosterId);
  if (!mgr) return;

  // Highlight selected card
  document.querySelectorAll('.manager-card').forEach(c => c.classList.remove('selected'));
  document.querySelector(`[data-roster-id="${rosterId}"]`)?.classList.add('selected');
  selectedRoster = rosterId;

  const panel = document.getElementById('detailPanel');
  document.getElementById('detailName').textContent = mgr.displayName;
  document.getElementById('detailBody').innerHTML   = buildDetailHTML(mgr);

  panel.classList.add('visible');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeDetail() {
  document.getElementById('detailPanel').classList.remove('visible');
  document.querySelectorAll('.manager-card').forEach(c => c.classList.remove('selected'));
  selectedRoster = null;
}

function buildDetailHTML(mgr) {
  const s = mgr.season;

  // Season position breakdown
  const posRows = POS_ORDER
    .filter(pos => s.byPosition[pos] > 0)
    .map(pos => {
      const pts = s.byPosition[pos];
      const pct = s.totalActual > 0 ? ((pts / s.totalActual) * 100).toFixed(1) : 0;
      return `
        <tr>
          <td><span style="display:inline-flex;align-items:center;gap:6px">
            <span style="width:8px;height:8px;border-radius:2px;background:${POS_COLORS[pos]};display:inline-block"></span>
            ${pos}
          </span></td>
          <td>${pts.toFixed(1)}</td>
          <td>${pct}%</td>
        </tr>
      `;
    }).join('');

  // Weekly breakdown table
  const weekRows = mgr.weeks.map(w => {
    const effClass = w.efficiencyPct >= 90 ? 'eff-high' : w.efficiencyPct >= 75 ? 'eff-mid' : 'eff-low';
    return `
      <tr>
        <td>Wk ${w.week}</td>
        <td>${w.actualPoints.toFixed(2)}</td>
        <td>${w.optimalPoints.toFixed(2)}</td>
        <td class="${effClass}">${w.efficiencyPct}%</td>
        <td>${w.benchPoints.toFixed(2)}</td>
      </tr>
    `;
  }).join('');

  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:1.25rem">

      <div class="summary-section">
        <h3>Season summary</h3>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          <div class="manager-chip"><span>${mgr.wins}-${mgr.losses}</span>record</div>
          <div class="manager-chip"><span>${s.totalActual.toFixed(1)}</span>total pts</div>
          <div class="manager-chip"><span>${s.avgPointsPerWeek}</span>avg pts/wk</div>
          <div class="manager-chip"><span>${s.avgEfficiency}%</span>avg efficiency</div>
          <div class="manager-chip"><span>${s.totalBenchLeft.toFixed(1)}</span>total bench left</div>
          <div class="manager-chip"><span>${s.totalOptimal.toFixed(1)}</span>optimal total</div>
        </div>
      </div>

      <div class="summary-section">
        <h3>Points by position</h3>
        <table>
          <thead><tr><th>Pos</th><th>Pts</th><th>%</th></tr></thead>
          <tbody>${posRows}</tbody>
        </table>
      </div>

    </div>

    <div class="summary-section">
      <h3>Weekly breakdown</h3>
      <div class="weekly-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Week</th>
              <th>Actual</th>
              <th>Optimal</th>
              <th>Efficiency</th>
              <th>Bench left</th>
            </tr>
          </thead>
          <tbody>${weekRows}</tbody>
        </table>
      </div>
    </div>
  `;
}

// ─── Export ───────────────────────────────────────────────────────────────────

function exportStatsCSV() {
  if (!currentData) return;

  const { managers, season, leagueName } = currentData;
  let csv = `League,Season,Manager,W,L,Total Pts,Avg Pts/Wk,Avg Efficiency %,Bench Left,QB Pts,RB Pts,WR Pts,TE Pts,FLEX Pts,K Pts,DEF Pts\n`;

  managers.forEach(m => {
    const s  = m.season;
    const bp = s.byPosition;
    csv += [
      leagueName, season, m.displayName,
      m.wins, m.losses,
      s.totalActual.toFixed(1),
      s.avgPointsPerWeek,
      s.avgEfficiency,
      s.totalBenchLeft.toFixed(1),
      (bp.QB  || 0).toFixed(1),
      (bp.RB  || 0).toFixed(1),
      (bp.WR  || 0).toFixed(1),
      (bp.TE  || 0).toFixed(1),
      (bp.FLEX|| 0).toFixed(1),
      (bp.K   || 0).toFixed(1),
      (bp.DEF || 0).toFixed(1),
    ].join(',') + '\n';
  });

  const a    = document.createElement('a');
  a.href     = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = `${season}_manager_stats.csv`;
  a.click();
}
