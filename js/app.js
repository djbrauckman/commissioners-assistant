/**
 * app.js
 * UI wiring for the Fantasy Commissioner Tool.
 * Depends on: divisions.js, schedule.js, sleeper.js
 */

let currentDivisions = {};
let currentSchedule = [];
let rivalryWeek = null;
let lastSeasonRankings = null;
let yearVal = new Date().getFullYear();

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  rebuildTeamInputs();
  document.getElementById('numTeams').addEventListener('change', rebuildTeamInputs);
  document.getElementById('numDivs').addEventListener('change', rebuildTeamInputs);
});

// ─── Sleeper Import (Step 1) ──────────────────────────────────────────────────

async function importFromSleeper() {
  const leagueId = document.getElementById('sleeperLeagueIdInput').value.trim();
  const season   = document.getElementById('sleeperSeasonInput').value.trim();
  const status   = document.getElementById('sleeperImportStatus');

  if (!leagueId) {
    status.textContent = 'Please enter a league ID.';
    status.className = 'warn';
    return;
  }

  status.textContent = 'Fetching from Sleeper...';
  status.className = 'status-info';

  try {
    let targetLeagueId = leagueId;
    if (season) {
      targetLeagueId = await findLeagueForSeason(leagueId, season);
    }

    const { divisionRankings, teamNames, leagueName, season: fetchedSeason } =
      await fetchLastSeasonStandings(targetLeagueId);

    // Store rankings for rivalry week generation later
    lastSeasonRankings = divisionRankings;

    // Auto-populate team name inputs with Sleeper display names
    const inputs = document.getElementById('teamInputs').querySelectorAll('input');
    teamNames.forEach((name, i) => {
      if (inputs[i]) inputs[i].value = name;
    });

    status.textContent = `✓ Loaded ${teamNames.length} teams from ${leagueName} (${fetchedSeason})`;
    status.className = 'status-ok';

  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    status.className = 'warn';
  }
}

// ─── Step 1: Team Setup ───────────────────────────────────────────────────────

function rebuildTeamInputs() {
  const n  = parseInt(document.getElementById('numTeams').value);
  const nd = parseInt(document.getElementById('numDivs').value);
  const err = document.getElementById('errorMsg');

  if (n % nd !== 0) {
    err.textContent = `Can't evenly split ${n} teams into ${nd} divisions.`;
    err.style.display = 'block';
  } else {
    err.style.display = 'none';
  }

  const container = document.getElementById('teamInputs');
  const existing  = [...container.querySelectorAll('input')].map(i => i.value);
  container.innerHTML = '';

  for (let i = 0; i < n; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'team-input-wrap';

    const inp = document.createElement('input');
    inp.type        = 'text';
    inp.placeholder = `Team ${i + 1}`;
    inp.value       = existing[i] || '';

    const num = document.createElement('span');
    num.className   = 'team-num';
    num.textContent = i + 1;

    wrap.appendChild(inp);
    wrap.appendChild(num);
    container.appendChild(wrap);
  }
}

function getTeamNames() {
  return [...document.getElementById('teamInputs').querySelectorAll('input')]
    .map((inp, i) => inp.value.trim() || `Team ${i + 1}`);
}

function handleGo() {
  const n  = parseInt(document.getElementById('numTeams').value);
  const nd = parseInt(document.getElementById('numDivs').value);
  if (n % nd !== 0) return;

  randomizeDivisions();
  document.getElementById('step2').style.display = 'block';
  document.getElementById('goBtn').style.display  = 'none';
  markStepDone('badge1');
}

// ─── Step 2: Divisions ────────────────────────────────────────────────────────

function randomizeDivisions() {
  const nd = parseInt(document.getElementById('numDivs').value);
  currentDivisions = generateDivisions(getTeamNames(), nd);
  renderDivisions();
}

function renderDivisions() {
  const container = document.getElementById('divDisplay');
  container.innerHTML = '';

  Object.entries(currentDivisions).forEach(([name, members], idx) => {
    const card = document.createElement('div');
    card.className = 'div-card';
    card.innerHTML = `<div class="div-name">
      <div class="div-dot" style="background:${DIV_COLORS[idx]}"></div>${name}
    </div>`;

    members.forEach(m => {
      const p = document.createElement('div');
      p.className   = 'team-pill';
      p.textContent = m;
      card.appendChild(p);
    });

    container.appendChild(card);
  });
}

// ─── Step 3: Schedule ─────────────────────────────────────────────────────────

function generateSchedule() {
  const numWeeks   = parseInt(document.getElementById('numWeeks').value);
  currentSchedule  = buildSchedule(currentDivisions, numWeeks);

  // Auto-generate rivalry week if Sleeper data was loaded
  if (lastSeasonRankings) {
    rivalryWeek = buildRivalryWeek(currentDivisions, lastSeasonRankings);
  }

  renderSchedule();
  document.getElementById('step3').style.display = 'block';
  markStepDone('badge2');
  document.getElementById('step3').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderSchedule() {
  const totalGames = currentSchedule.reduce((s, w) => s + w.length, 0);
  const crossCount = currentSchedule.flat().filter(m => m.type === 'cross').length;
  const nd         = Object.keys(currentDivisions).length;
  const numWeeks   = parseInt(document.getElementById('numWeeks').value);

  document.getElementById('statBar').innerHTML = `
    <div class="stat-chip"><span>${currentSchedule.length + (rivalryWeek ? 1 : 0)}</span>total weeks</div>
    <div class="stat-chip"><span>${totalGames}</span>regular matchups</div>
    <div class="stat-chip"><span>${nd}</span>divisions</div>
    <div class="stat-chip"><span>${crossCount}</span>cross-div games</div>
    ${rivalryWeek ? `<div class="stat-chip"><span>Wk ${numWeeks + 1}</span>rivalry week</div>` : ''}
  `;

  const grid = document.getElementById('schedGrid');
  grid.innerHTML = '';

  currentSchedule.forEach((week, wi) => {
    grid.appendChild(buildWeekBlock(`Week ${wi + 1}`, week));
  });

  renderRivalryWeek();
}

function renderRivalryWeek() {
  const container = document.getElementById('rivalryWeekDisplay');
  container.innerHTML = '';
  if (!rivalryWeek || rivalryWeek.length === 0) return;

  const numWeeks = parseInt(document.getElementById('numWeeks').value);
  container.appendChild(buildWeekBlock(`Week ${numWeeks + 1} — Rivalry Week`, rivalryWeek, true));
}

function buildWeekBlock(label, matchups, isRivalry = false) {
  const block = document.createElement('div');
  block.className = 'week-block';
  block.style.breakInside = 'avoid';

  const weekLabel       = document.createElement('div');
  weekLabel.className   = isRivalry ? 'week-label rivalry-label' : 'week-label';
  weekLabel.textContent = label;
  block.appendChild(weekLabel);

  matchups.forEach(m => {
    const row       = document.createElement('div');
    row.className   = 'matchup-row';
    const typeClass = m.type === 'div' ? 'tag-div' : m.type === 'rivalry' ? 'tag-rivalry' : 'tag-cross';
    const typeLabel = m.type === 'div' ? 'div' : m.type === 'rivalry' ? `rivalry ${m.label || ''}` : 'cross';

    row.innerHTML = `
      <span class="matchup-away">${m.away}</span>
      <span class="matchup-at">@</span>
      <span class="matchup-home">${m.home}</span>
      <span class="matchup-type ${typeClass}">${typeLabel}</span>
    `;
    block.appendChild(row);
  });

  return block;
}

// ─── Sleeper helpers (used by importFromSleeper) ──────────────────────────────

async function findLeagueForSeason(leagueId, targetSeason) {
  let id = leagueId;
  for (let i = 0; i < 10; i++) {
    const league = await fetchLeague(id);
    if (String(league.season) === String(targetSeason)) return id;
    if (!league.previous_league_id) break;
    id = league.previous_league_id;
  }
  throw new Error(`Could not find season ${targetSeason} in this league's history.`);
}

// ─── Export ───────────────────────────────────────────────────────────────────

function exportTxt() {
  let out = `${yearVal} Fantasy Football Schedule\n${'='.repeat(35)}\n\n`;

  Object.entries(currentDivisions).forEach(([name, members]) => {
    out += `${name}: ${members.join(', ')}\n`;
  });
  out += '\n';

  currentSchedule.forEach((week, wi) => {
    out += `Week ${wi + 1}\n`;
    week.forEach(m => (out += `${m.away} @ ${m.home}\n`));
    out += '\n';
  });

  if (rivalryWeek && rivalryWeek.length > 0) {
    const numWeeks = parseInt(document.getElementById('numWeeks').value);
    out += `Week ${numWeeks + 1} — Rivalry Week\n`;
    rivalryWeek.forEach(m => (out += `${m.away} @ ${m.home} (${m.label || 'rivalry'})\n`));
  }

  download(`${yearVal}_schedule.txt`, out);
}

function exportCsv() {
  let out = 'Week,Away,Home,Type,Label\n';

  currentSchedule.forEach((week, wi) => {
    week.forEach(m => (out += `${wi + 1},${m.away},${m.home},${m.type},\n`));
  });

  if (rivalryWeek && rivalryWeek.length > 0) {
    const numWeeks = parseInt(document.getElementById('numWeeks').value);
    rivalryWeek.forEach(m => {
      out += `${numWeeks + 1},${m.away},${m.home},rivalry,${m.label || ''}\n`;
    });
  }

  download(`${yearVal}_schedule.csv`, out);
}

function download(filename, text) {
  const a   = document.createElement('a');
  a.href    = 'data:text/plain;charset=utf-8,' + encodeURIComponent(text);
  a.download = filename;
  a.click();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function markStepDone(badgeId) {
  const badge     = document.getElementById(badgeId);
  badge.className = 'step-badge done';
  badge.textContent = '✓';
}

function resetAll() {
  currentDivisions  = {};
  currentSchedule   = [];
  rivalryWeek       = null;
  lastSeasonRankings = null;

  document.getElementById('step2').style.display = 'none';
  document.getElementById('step3').style.display = 'none';
  document.getElementById('goBtn').style.display  = 'flex';

  ['badge1', 'badge2'].forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) { el.className = 'step-badge'; el.textContent = i + 1; }
  });

  document.getElementById('rivalryWeekDisplay').innerHTML = '';
  document.getElementById('sleeperImportStatus').textContent = '';

  rebuildTeamInputs();
}
