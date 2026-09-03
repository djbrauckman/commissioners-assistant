/**
 * in-season.js
 * Advanced weekly metrics (target share, air yards share, WOPR, YPRR)
 * sourced from nflverse via api/advanced-metrics.js. The aggregation
 * itself only ever runs when the user clicks the button — this page just
 * reads whatever's cached and displays a season-to-date rollup.
 * Depends on: nav.js, db-client.js
 */

const POS_COLORS = { QB: '#E8614A', RB: '#3B82F6', WR: '#8B5CF6', TE: '#F59E0B', K: '#10B981', DEF: '#6B7280' };
const POS_TABS = ['ALL', 'RB', 'WR', 'TE'];

let currentRows = [];   // raw weekly rows from the DB
let aggregated = [];    // season-to-date per player
let activePosFilter = 'ALL';

document.addEventListener('DOMContentLoaded', async () => {
  initNav('in-season');

  const bar = document.getElementById('posFilterBar');
  bar.innerHTML = POS_TABS.map(pos => `
    <button class="btn-secondary pos-filter-btn ${pos === 'ALL' ? 'tab-active' : ''}" data-pos="${pos}" onclick="setPosFilter('${pos}')">${pos}</button>
  `).join('');

  await prefillSeason();
  await handleLoadCached();
});

// ─── Season resolution ──────────────────────────────────────────────────────

async function prefillSeason() {
  try {
    const setting = await dbGet('/api/settings?key=current_league_id');
    if (setting && setting.value) {
      const league = await fetch(`https://api.sleeper.app/v1/league/${setting.value}`).then(r => r.json());
      if (league && league.season) {
        document.getElementById('seasonInput').value = league.season;
        return;
      }
    }
  } catch (e) {
    // No current league set (or DB unreachable) — leave the field blank
    // for manual entry.
  }
}

// ─── Load cached data ───────────────────────────────────────────────────────

async function handleLoadCached() {
  const season = document.getElementById('seasonInput').value.trim();
  if (!season) return;
  try {
    currentRows = await dbGet(`/api/advanced-metrics?season=${encodeURIComponent(season)}`);
  } catch (e) {
    document.getElementById('cacheMeta').textContent = `Failed to load: ${e.message}`;
    return;
  }
  aggregated = aggregateSeasonToDate(currentRows);
  const weeks = [...new Set(currentRows.map(r => r.week))].sort((a, b) => a - b);
  document.getElementById('cacheMeta').textContent = weeks.length
    ? `${season} season — cached through week ${weeks[weeks.length - 1]} (${weeks.length} week${weeks.length === 1 ? '' : 's'}, ${aggregated.length} players)`
    : `${season} season — nothing cached yet, click "Run aggregation" above`;
  renderTable();
}

// ─── Aggregation trigger ────────────────────────────────────────────────────

async function handleRunAggregation() {
  const season = document.getElementById('seasonInput').value.trim();
  const statusEl = document.getElementById('runStatus');
  if (!season) {
    statusEl.textContent = 'Enter a season first.';
    statusEl.className = 'warn';
    return;
  }
  statusEl.textContent = 'Downloading and computing from nflverse — this can take up to a minute...';
  statusEl.className = 'status-info';
  try {
    const result = await dbPost('/api/advanced-metrics', { season });
    statusEl.textContent = result.weeksAdded.length
      ? `Added week${result.weeksAdded.length === 1 ? '' : 's'} ${result.weeksAdded.join(', ')} (${result.rowsUpserted} rows).`
      : 'Already up to date — no new weeks found.';
    statusEl.className = 'status-ok';
    await handleLoadCached();
  } catch (e) {
    statusEl.textContent = `Failed: ${e.message}`;
    statusEl.className = 'warn';
  }
}

// ─── Aggregation (client-side, season-to-date) ─────────────────────────────

function aggregateSeasonToDate(rows) {
  const byPlayer = {};
  rows.forEach(r => {
    if (!byPlayer[r.gsisId]) {
      byPlayer[r.gsisId] = {
        gsisId: r.gsisId, playerName: r.playerName, position: r.position, team: r.team,
        weeks: 0, targets: 0, receptions: 0, receivingYards: 0, routesRun: 0,
        targetShareSum: 0, airYardsShareSum: 0, woprSum: 0,
      };
    }
    const p = byPlayer[r.gsisId];
    p.weeks++;
    p.team = r.team; // most recent team on file (handles in-season trades reasonably)
    p.targets += r.targets || 0;
    p.receptions += r.receptions || 0;
    p.receivingYards += r.receivingYards || 0;
    p.routesRun += r.routesRun || 0;
    p.targetShareSum += r.targetShare || 0;
    p.airYardsShareSum += r.airYardsShare || 0;
    p.woprSum += r.wopr || 0;
  });
  // Shares/WOPR are per-week ratios, so season-to-date is their average;
  // YPRR is recomputed from summed totals rather than averaging weekly
  // YPRRs, so a small-sample week doesn't skew it.
  return Object.values(byPlayer).map(p => ({
    ...p,
    targetShare: p.weeks ? p.targetShareSum / p.weeks : null,
    airYardsShare: p.weeks ? p.airYardsShareSum / p.weeks : null,
    wopr: p.weeks ? p.woprSum / p.weeks : null,
    yprr: p.routesRun ? p.receivingYards / p.routesRun : null,
  }));
}

// ─── Render ─────────────────────────────────────────────────────────────────

function setPosFilter(pos) {
  activePosFilter = pos;
  document.querySelectorAll('.pos-filter-btn').forEach(b => b.classList.toggle('tab-active', b.dataset.pos === pos));
  renderTable();
}

function renderTable() {
  const search = document.getElementById('playerSearch').value.trim().toLowerCase();
  const rows = aggregated
    .filter(p => (activePosFilter === 'ALL' || p.position === activePosFilter))
    .filter(p => !search || p.playerName.toLowerCase().includes(search))
    .sort((a, b) => b.receivingYards - a.receivingYards);

  const fmt = (v, d = 1) => v == null ? '—' : v.toFixed(d);
  const fmtPct = v => v == null ? '—' : `${(v * 100).toFixed(1)}%`;

  document.getElementById('metricsTbody').innerHTML = rows.map(p => `
    <tr>
      <td>${p.playerName}</td>
      <td><span class="pos-legend-dot" style="background:${POS_COLORS[p.position] || '#999'};display:inline-block;margin-right:5px"></span>${p.position}</td>
      <td>${p.team}</td>
      <td>${p.weeks}</td>
      <td>${p.targets}</td>
      <td>${p.receptions}</td>
      <td>${p.receivingYards}</td>
      <td>${fmtPct(p.targetShare)}</td>
      <td>${fmtPct(p.airYardsShare)}</td>
      <td>${fmt(p.wopr, 2)}</td>
      <td>${p.routesRun || '—'}</td>
      <td>${fmt(p.yprr, 2)}</td>
    </tr>
  `).join('');
}
