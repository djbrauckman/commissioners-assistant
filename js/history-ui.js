/**
 * history-ui.js
 * Rendering and interaction for the league history page.
 * Depends on: nav.js, history.js
 */

let historyData = null;

document.addEventListener('DOMContentLoaded', () => {
  initNav('history');
  const saved = localStorage.getItem('lastLeagueId');
  if (saved) document.getElementById('historyLeagueId').value = saved;
});

// ─── Load ─────────────────────────────────────────────────────────────────────

async function handleHistoryLoad() {
  const leagueId = document.getElementById('historyLeagueId').value.trim();
  const errEl    = document.getElementById('historyLoadError');

  if (!leagueId) {
    errEl.textContent = 'Please enter a league ID.';
    errEl.style.display = 'block';
    return;
  }

  errEl.style.display = 'none';
  showHistoryProgress(2, 'Starting...');

  try {
    localStorage.setItem('lastLeagueId', leagueId);
    historyData = await loadLeagueHistory(leagueId, (pct, msg) => {
      showHistoryProgress(pct, msg);
    });
    hideHistoryProgress();
    renderHistory(historyData);
  } catch (err) {
    hideHistoryProgress();
    errEl.textContent = `Error: ${err.message}`;
    errEl.style.display = 'block';
  }
}

// ─── Progress ─────────────────────────────────────────────────────────────────

function showHistoryProgress(pct, msg) {
  const wrap = document.getElementById('historyProgressWrap');
  wrap.style.display = 'block';
  document.getElementById('historyProgressLabel').textContent = msg;
  document.getElementById('historyProgressFill').style.width  = `${pct}%`;
  document.getElementById('historyResults').style.display = 'none';
}

function hideHistoryProgress() {
  document.getElementById('historyProgressWrap').style.display = 'none';
}

// ─── Main render ──────────────────────────────────────────────────────────────

function renderHistory(data) {
  const { seasons, allTimeRecords, h2hMatrix } = data;

  renderAllTimeRecords(allTimeRecords);
  renderH2HMatrix(h2hMatrix, allTimeRecords);
  renderSeasonList(seasons);

  document.getElementById('historyResults').style.display = 'block';
}

// ─── All-time records ─────────────────────────────────────────────────────────

function renderAllTimeRecords(records) {
  const container = document.getElementById('allTimeGrid');
  container.innerHTML = '';

  records.forEach(r => {
    const isWinning = parseFloat(r.winPct) >= 50;
    const card = document.createElement('div');
    card.className = 'alltime-card';
    card.innerHTML = `
      <div class="alltime-name">${r.name}</div>
      <div class="alltime-record ${isWinning ? 'winning' : 'losing'}">${r.wins}-${r.losses}</div>
      <div style="font-size:11px;color:var(--text-muted);font-family:'DM Mono',monospace">${r.winPct}% win rate</div>
      <div class="alltime-chips">
        <div class="alltime-chip"><strong>${r.seasons}</strong> seasons</div>
        <div class="alltime-chip"><strong>${r.fpts.toFixed(0)}</strong> all-time pts</div>
        ${r.championships > 0
          ? `<div class="alltime-chip" style="background:var(--amber-bg);color:var(--amber-text);border-color:var(--amber)">
               <strong>🏆 ×${r.championships}</strong>
             </div>`
          : ''}
      </div>
    `;
    container.appendChild(card);
  });
}

// ─── H2H matrix ───────────────────────────────────────────────────────────────

function renderH2HMatrix(h2hMatrix, allTimeRecords) {
  const container = document.getElementById('h2hMatrixWrap');
  container.innerHTML = '';

  // Get all unique manager names
  const names = allTimeRecords.map(r => r.name);
  if (names.length === 0) return;

  // Build lookup: "nameA" → { vs "nameB": { winsForA, total } }
  const lookup = {};
  names.forEach(n => { lookup[n] = {}; });

  Object.values(h2hMatrix).forEach(({ a, b, winsA, winsB, total }) => {
    if (!lookup[a]) lookup[a] = {};
    if (!lookup[b]) lookup[b] = {};
    lookup[a][b] = { wins: winsA, total };
    lookup[b][a] = { wins: winsB, total };
  });

  // Build table
  const table = document.createElement('table');
  table.className = 'matrix-table';

  // Header row
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.innerHTML = `<th class="row-header">vs →</th>` +
    names.map(n => `<th title="${n}">${n.length > 8 ? n.slice(0, 8) + '…' : n}</th>`).join('');
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body rows
  const tbody = document.createElement('tbody');
  names.forEach(rowName => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="row-header">${rowName}</td>`;
    names.forEach(colName => {
      const td = document.createElement('td');
      if (rowName === colName) {
        td.className = 'matrix-cell-self';
        td.textContent = '—';
      } else {
        const matchup = lookup[rowName]?.[colName];
        if (!matchup || matchup.total === 0) {
          td.textContent = '—';
          td.style.color = 'var(--text-faint)';
        } else {
          const losses = matchup.total - matchup.wins;
          td.textContent = `${matchup.wins}-${losses}`;
          if (matchup.wins > losses)       td.className = 'matrix-cell-win';
          else if (matchup.wins < losses)  td.className = 'matrix-cell-loss';
          else                             td.className = 'matrix-cell-even';
        }
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  container.appendChild(table);
}

// ─── Season list ──────────────────────────────────────────────────────────────

function renderSeasonList(seasons) {
  const container = document.getElementById('seasonList');
  container.innerHTML = '';

  seasons.forEach((s, idx) => {
    const card = document.createElement('div');
    card.className = 'season-card';

    card.innerHTML = `
      <div class="season-card-header" onclick="toggleSeason(${idx})">
        <div class="season-year">${s.season} Season</div>
        <div style="display:flex;align-items:center;gap:16px">
          ${s.champion
            ? `<div class="season-champion">🏆 ${s.champion}</div>`
            : '<div style="font-size:13px;color:var(--text-faint)">Season in progress</div>'}
          <div class="season-toggle" id="toggle-${idx}">▼</div>
        </div>
      </div>
      <div class="season-card-body" id="season-body-${idx}">
        ${buildSeasonBody(s)}
      </div>
    `;

    // Auto-open most recent season
    if (idx === 0) {
      card.querySelector('.season-card-body').classList.add('open');
      card.querySelector('.season-toggle').textContent = '▲';
    }

    container.appendChild(card);
  });
}

function toggleSeason(idx) {
  const body   = document.getElementById(`season-body-${idx}`);
  const toggle = document.getElementById(`toggle-${idx}`);
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  toggle.textContent = isOpen ? '▼' : '▲';
}

function buildSeasonBody(s) {
  return `
    <div class="season-grid">
      <div class="season-section">
        <h4>Final Standings</h4>
        ${buildStandingsTable(s.standings)}
      </div>
      <div class="season-section">
        <h4>Playoff Results</h4>
        ${buildBracketResults(s.bracketGames)}
      </div>
    </div>
  `;
}

function buildStandingsTable(standings) {
  if (!standings.length) return '<div style="font-size:13px;color:var(--text-faint)">No data</div>';

  const rows = standings.map((mgr, idx) => `
    <tr>
      <td class="rank-col">${idx + 1}</td>
      <td>${mgr.displayName}</td>
      <td class="record-col">${mgr.wins}-${mgr.losses}</td>
      <td class="pts-col">${mgr.fpts.toFixed(1)}</td>
    </tr>
  `).join('');

  return `
    <table class="standings-table">
      <thead>
        <tr>
          <th>#</th><th>Manager</th><th>W-L</th><th style="text-align:right">Pts</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function buildBracketResults(bracketGames) {
  if (!bracketGames.length) {
    return '<div style="font-size:13px;color:var(--text-faint)">No bracket data</div>';
  }

  // Sort rounds: championship last
  const sorted = [...bracketGames].sort((a, b) => {
    const order = { Wildcard: 0, Semifinals: 1, Championship: 2 };
    return (order[a.label] ?? 99) - (order[b.label] ?? 99);
  });

  return sorted.map(round => `
    <div class="bracket-round">
      <div class="bracket-round-label">${round.label}</div>
      ${round.games.map(g => `
        <div class="bracket-game">
          <span class="bracket-winner">${g.winner}</span>
          <span class="bracket-vs">def.</span>
          <span class="bracket-loser">${g.loser}</span>
          <span class="bracket-tag tag-${g.tag}">${g.tagLabel}</span>
        </div>
      `).join('')}
    </div>
  `).join('');
}

// ─── Export ───────────────────────────────────────────────────────────────────

function exportHistoryCSV() {
  if (!historyData) return;
  const { seasons, allTimeRecords } = historyData;

  let csv = 'All-Time Records\nManager,Wins,Losses,Win%,Seasons,Championships,Total Pts\n';
  allTimeRecords.forEach(r => {
    csv += `${r.name},${r.wins},${r.losses},${r.winPct}%,${r.seasons},${r.championships},${r.fpts.toFixed(1)}\n`;
  });

  csv += '\nSeason-by-Season Standings\nSeason,Rank,Manager,Wins,Losses,Pts,Champion\n';
  seasons.forEach(s => {
    s.standings.forEach((mgr, idx) => {
      csv += `${s.season},${idx + 1},${mgr.displayName},${mgr.wins},${mgr.losses},${mgr.fpts.toFixed(1)},${s.champion === mgr.displayName ? 'YES' : ''}\n`;
    });
  });

  const a    = document.createElement('a');
  a.href     = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'league_history.csv';
  a.click();
}
