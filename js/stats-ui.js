/**
 * stats-ui.js
 * Rendering and interaction for the stats page.
 * Depends on: nav.js, stats.js
 */

const POS_COLORS = {
  QB: '#E8614A', RB: '#3B82F6', WR: '#8B5CF6',
  TE: '#F59E0B', FLEX: '#6366F1', K: '#10B981', DEF: '#6B7280',
};
const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'];

let currentData    = null;
let selectedRoster = null;
let activeTab      = 'regular'; // 'regular' | 'playoffs'

document.addEventListener('DOMContentLoaded', () => {
  initNav('stats');
  const saved = localStorage.getItem('lastLeagueId');
  if (saved) document.getElementById('statsLeagueId').value = saved;
});

// ─── Load ─────────────────────────────────────────────────────────────────────

async function handleLoadStats() {
  const leagueId = document.getElementById('statsLeagueId').value.trim();
  const season   = document.getElementById('statsSeason').value.trim();
  const errEl    = document.getElementById('loadError');

  if (!leagueId) { errEl.textContent = 'Please enter a league ID.'; errEl.style.display = 'block'; return; }
  errEl.style.display = 'none';
  showProgress(0, 'Starting...');

  try {
    let targetId = leagueId;
    if (season) targetId = await findLeagueForSeason(leagueId, season);
    localStorage.setItem('lastLeagueId', leagueId);
    currentData = await loadManagerStats(targetId, (pct, msg) => showProgress(pct, msg));
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
  document.getElementById('progressWrap').style.display = 'block';
  document.getElementById('progressLabel').textContent  = msg;
  document.getElementById('progressFill').style.width   = `${pct}%`;
  document.getElementById('statsResults').style.display = 'none';
}
function hideProgress() {
  document.getElementById('progressWrap').style.display = 'none';
}

// ─── Results ─────────────────────────────────────────────────────────────────

function renderResults(data) {
  const { managers, season, leagueName, regularWeeks, hasBracket } = data;

  document.getElementById('resultsTitle').textContent = leagueName;
  document.getElementById('resultsMeta').textContent  =
    `${season} season · ${regularWeeks} regular season weeks · ${managers.length} managers`;

  // Show/hide playoff tab based on bracket data
  document.getElementById('playoffTabBtn').style.display = hasBracket ? 'inline-block' : 'none';

  renderManagerCards(managers);
  document.getElementById('statsResults').style.display = 'block';
}

// ─── Tab switching ────────────────────────────────────────────────────────────

function switchTab(tab) {
  activeTab = tab;
  closeDetail();

  document.getElementById('regularTabBtn').classList.toggle('tab-active',  tab === 'regular');
  document.getElementById('playoffTabBtn').classList.toggle('tab-active',  tab === 'playoffs');

  renderManagerCards(currentData.managers);
}

// ─── Manager cards ────────────────────────────────────────────────────────────

function renderManagerCards(managers) {
  const grid = document.getElementById('managerGrid');
  grid.innerHTML = '';

  const isPlayoffs = activeTab === 'playoffs';

  if (isPlayoffs) {
    const playoffManagers = managers.filter(m => m.playoffs.madeIt);
    const missedManagers  = managers.filter(m => !m.playoffs.madeIt);

    if (playoffManagers.length === 0) {
      grid.innerHTML = '<div class="state-empty"><strong>No playoff data yet</strong>Season may not be complete.</div>';
      return;
    }

    // Sort playoff managers by bracket finish
    playoffManagers.sort((a, b) => {
      const aWins = a.playoffs.games.filter(g => g.result.includes('Won') || g.result.includes('🏆') || g.result.includes('3rd')).length;
      const bWins = b.playoffs.games.filter(g => g.result.includes('Won') || g.result.includes('🏆') || g.result.includes('3rd')).length;
      return bWins - aWins || b.playoffs.totalActual - a.playoffs.totalActual;
    });

    playoffManagers.forEach(mgr => grid.appendChild(buildManagerCard(mgr, true)));

    if (missedManagers.length > 0) {
      const divider = document.createElement('div');
      divider.style.cssText = 'grid-column:1/-1;font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-faint);padding:4px 0 8px;font-family:"DM Mono",monospace';
      divider.textContent = 'Did not qualify';
      grid.appendChild(divider);
      missedManagers.forEach(mgr => {
        const card = buildManagerCard(mgr, true);
        card.style.opacity = '0.5';
        grid.appendChild(card);
      });
    }
  } else {
    managers.forEach(mgr => grid.appendChild(buildManagerCard(mgr, false)));
  }
}

function buildManagerCard(mgr, isPlayoffs) {
  const card = document.createElement('div');
  card.className = 'manager-card';
  card.dataset.rosterId = mgr.rosterId;
  card.onclick = () => showDetail(mgr.rosterId);

  const stats     = isPlayoffs ? mgr.playoffs : mgr.season;
  const totalPts  = stats.totalActual || 0;
  const byPos     = stats.byPosition  || {};

  const isWinning = mgr.wins > mgr.losses;
  const isLosing  = mgr.wins < mgr.losses;
  const recordCls = isWinning ? 'winning' : isLosing ? 'losing' : '';

  const segments = POS_ORDER
    .filter(pos => (byPos[pos] || 0) > 0)
    .map(pos => ({ pos, pct: Math.round((byPos[pos] / totalPts) * 100), pts: byPos[pos].toFixed(1) }));

  // Playoff finish badge
  const finishGame = mgr.playoffs.games?.find(g =>
    g.result.includes('🏆') || g.result.includes('Runner') ||
    g.result.includes('3rd') || g.result.includes('4th')
  );
  const finishBadge = finishGame
    ? `<div style="font-size:11px;background:var(--amber-bg);color:var(--amber-text);padding:2px 8px;border-radius:4px;font-weight:500">${finishGame.result}</div>`
    : (isPlayoffs && mgr.playoffs.madeIt ? '' : '');

  card.innerHTML = `
    <div class="manager-card-header">
      <div>
        <div class="manager-name">${mgr.displayName}</div>
        ${isPlayoffs && finishBadge ? `<div style="margin-top:4px">${finishBadge}</div>` : ''}
      </div>
      <div class="manager-record ${recordCls}">${mgr.wins}-${mgr.losses}</div>
    </div>

    ${totalPts > 0 ? `
    <div class="pos-bar-wrap">
      <div class="pos-bar-label">
        <span>Points by position</span>
        <span>${totalPts.toFixed(1)} pts</span>
      </div>
      <div class="pos-bar-track">
        ${segments.map(s => `<div class="pos-bar-seg" style="width:${s.pct}%;background:${POS_COLORS[s.pos]}" title="${s.pos}: ${s.pts}pts"></div>`).join('')}
      </div>
      <div class="pos-legend">
        ${segments.map(s => `
          <div class="pos-legend-item">
            <div class="pos-legend-dot" style="background:${POS_COLORS[s.pos]}"></div>
            <span>${s.pos} ${s.pct}%</span>
          </div>`).join('')}
      </div>
    </div>` : '<div style="font-size:13px;color:var(--text-faint);padding:8px 0">No playoff data</div>'}

    <div class="manager-chips">
      <div class="manager-chip"><span>${stats.avgEfficiency || '—'}%</span>avg efficiency</div>
      <div class="manager-chip"><span>${stats.avgPointsPerWeek || '—'}</span>pts/week</div>
      <div class="manager-chip"><span>${(stats.totalBenchLeft || 0).toFixed(0)}</span>bench left</div>
      <div class="manager-chip"><span>${stats.bestWeek?.actualPoints ?? '—'}</span>best week</div>
    </div>
  `;
  return card;
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function showDetail(rosterId) {
  const mgr = currentData.managers.find(m => m.rosterId === rosterId);
  if (!mgr) return;

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
  const isPlayoffs = activeTab === 'playoffs';
  const stats = isPlayoffs ? mgr.playoffs : mgr.season;
  const weeks = isPlayoffs ? mgr.playoffWeeks : mgr.weeks;

  const posRows = POS_ORDER
    .filter(pos => (stats.byPosition[pos] || 0) > 0)
    .map(pos => {
      const pts = stats.byPosition[pos];
      const pct = stats.totalActual > 0 ? ((pts / stats.totalActual) * 100).toFixed(1) : 0;
      return `<tr>
        <td><span style="display:inline-flex;align-items:center;gap:6px">
          <span style="width:8px;height:8px;border-radius:2px;background:${POS_COLORS[pos]};display:inline-block"></span>${pos}
        </span></td>
        <td>${pts.toFixed(1)}</td><td>${pct}%</td>
      </tr>`;
    }).join('');

  const weekRows = weeks.map(w => {
    const effCls = w.efficiencyPct >= 90 ? 'eff-high' : w.efficiencyPct >= 75 ? 'eff-mid' : 'eff-low';
    const label  = w.roundLabel || `Wk ${w.week}`;
    return `<tr>
      <td>${label}</td>
      <td>${w.actualPoints.toFixed(2)}</td>
      <td>${w.optimalPoints.toFixed(2)}</td>
      <td class="${effCls}">${w.efficiencyPct}%</td>
      <td>${w.benchPoints.toFixed(2)}</td>
    </tr>`;
  }).join('');

  // Playoff bracket results
  const bracketHTML = isPlayoffs && mgr.playoffs.games?.length > 0
    ? `<div class="summary-section" style="margin-bottom:1.25rem">
        <h3>Playoff results</h3>
        <table>
          <thead><tr><th>Round</th><th>Result</th><th>Opponent</th></tr></thead>
          <tbody>
            ${mgr.playoffs.games.map(g => `
              <tr>
                <td>${g.label}</td>
                <td style="font-weight:500;color:${g.result.includes('🏆') || g.result.includes('Won') ? 'var(--green)' : 'var(--text-muted)'}">${g.result}</td>
                <td>${g.opponent}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '';

  return `
    ${bracketHTML}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:1.25rem">
      <div class="summary-section">
        <h3>${isPlayoffs ? 'Playoff' : 'Season'} summary</h3>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${!isPlayoffs ? `<div class="manager-chip"><span>${mgr.wins}-${mgr.losses}</span>record</div>` : ''}
          <div class="manager-chip"><span>${stats.totalActual.toFixed(1)}</span>total pts</div>
          <div class="manager-chip"><span>${stats.avgPointsPerWeek}</span>avg pts/wk</div>
          <div class="manager-chip"><span>${stats.avgEfficiency}%</span>avg efficiency</div>
          <div class="manager-chip"><span>${stats.totalBenchLeft.toFixed(1)}</span>bench left</div>
          <div class="manager-chip"><span>${stats.totalOptimal.toFixed(1)}</span>optimal total</div>
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
    ${weeks.length > 0 ? `
    <div class="summary-section">
      <h3>Weekly breakdown</h3>
      <div class="weekly-table-wrap">
        <table>
          <thead><tr><th>Week</th><th>Actual</th><th>Optimal</th><th>Efficiency</th><th>Bench left</th></tr></thead>
          <tbody>${weekRows}</tbody>
        </table>
      </div>
    </div>` : ''}
  `;
}

// ─── Export ───────────────────────────────────────────────────────────────────

function exportStatsCSV() {
  if (!currentData) return;
  const { managers, season, leagueName } = currentData;
  const isPlayoffs = activeTab === 'playoffs';
  const label = isPlayoffs ? 'Playoffs' : 'Regular Season';

  let csv = `League,Season,Type,Manager,W,L,Total Pts,Avg Pts/Wk,Avg Efficiency %,Bench Left,QB,RB,WR,TE,FLEX,K,DEF\n`;
  managers.forEach(m => {
    const s  = isPlayoffs ? m.playoffs : m.season;
    const bp = s.byPosition || {};
    csv += [
      leagueName, season, label, m.displayName,
      m.wins, m.losses,
      (s.totalActual || 0).toFixed(1), s.avgPointsPerWeek || 0, s.avgEfficiency || 0,
      (s.totalBenchLeft || 0).toFixed(1),
      (bp.QB||0).toFixed(1),(bp.RB||0).toFixed(1),(bp.WR||0).toFixed(1),
      (bp.TE||0).toFixed(1),(bp.FLEX||0).toFixed(1),(bp.K||0).toFixed(1),(bp.DEF||0).toFixed(1),
    ].join(',') + '\n';
  });

  const a = document.createElement('a');
  a.href  = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = `${season}_${isPlayoffs ? 'playoff' : 'regular'}_stats.csv`;
  a.click();
}