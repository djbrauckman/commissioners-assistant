/**
 * draft-research.js
 * Three analyses for draft prep:
 *  A. VORP — ranks players by last completed season's points minus
 *     replacement level, computed from this league's exact roster construction.
 *  B. QB scoring premium — how much extra value this league's passing
 *     scoring (vs a standard 1pt/25yd + 4pt/TD league) creates per QB.
 *  C. Keeper value — compares each team's keeper cost (the round they'd be
 *     kept at, per the league's 3-round-escalation rule) against pasted-in
 *     FantasyPros ADP, with VORP shown alongside as a second value signal.
 *
 * Depends on: nav.js
 */

const SLEEPER = 'https://api.sleeper.app/v1';
const PLAYERS_CACHE_KEY = 'sleeper_players_cache';
const PLAYERS_CACHE_DATE_KEY = 'sleeper_players_cache_date';
const ADP_STORAGE_KEY = 'draft_research_adp_csv';

const BASE_POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const POS_COLORS = { QB: '#E8614A', RB: '#3B82F6', WR: '#8B5CF6', TE: '#F59E0B', K: '#10B981', DEF: '#6B7280' };
const FLEX_ELIGIBILITY = {
  FLEX:       ['RB', 'WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  WRRB_FLEX:  ['RB', 'WR'],
  REC_FLEX:   ['WR', 'TE'],
};
const STANDARD_PASS_YD = 0.04; // 1pt / 25 yards
const STANDARD_PASS_TD = 4;

let currentData   = null;
let lastPlayersDb = null;
let activePosFilter = 'ALL';

document.addEventListener('DOMContentLoaded', () => {
  initNav('draft-research');
  const saved = localStorage.getItem('lastLeagueId');
  if (saved) document.getElementById('drLeagueId').value = saved;
  const savedAdp = localStorage.getItem(ADP_STORAGE_KEY);
  if (savedAdp) document.getElementById('adpInput').value = savedAdp;

  const bar = document.getElementById('posFilterBar');
  bar.innerHTML = ['ALL', ...BASE_POS].map(pos => `
    <button class="btn-secondary pos-filter-btn ${pos === 'ALL' ? 'tab-active' : ''}" data-pos="${pos}" onclick="setPosFilter('${pos}')">${pos === 'ALL' ? 'All' : pos}</button>
  `).join('');
});

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status}: ${url}`);
  return res.json();
}

async function fetchPlayers() {
  const today      = new Date().toDateString();
  const cachedDate = localStorage.getItem(PLAYERS_CACHE_DATE_KEY);
  const cached     = localStorage.getItem(PLAYERS_CACHE_KEY);
  if (cached && cachedDate === today) return JSON.parse(cached);
  const players = await apiFetch(`${SLEEPER}/players/nfl`);
  try {
    localStorage.setItem(PLAYERS_CACHE_KEY, JSON.stringify(players));
    localStorage.setItem(PLAYERS_CACHE_DATE_KEY, today);
  } catch (e) {}
  return players;
}

function getPosition(playerId, playersDb) {
  if (!playerId) return 'UNK';
  if (typeof playerId === 'string' && playerId.length <= 3 && isNaN(playerId)) return 'DEF';
  const p = playersDb[playerId];
  if (!p) return 'UNK';
  return p.fantasy_positions?.[0] || p.position || 'UNK';
}

function playerName(playerId, playersDb) {
  const p = playersDb[playerId];
  if (!p) return `Unknown (${playerId})`;
  return p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || playerId;
}

// Walk previous_league_id chain. Returns array newest-first.
async function walkLeagueChain(leagueId) {
  const chain = [];
  let id = leagueId;
  for (let i = 0; i < 30 && id; i++) {
    const league = await apiFetch(`${SLEEPER}/league/${id}`);
    chain.push({
      leagueId: id,
      draftId: league.draft_id,
      season: league.season,
      status: league.status,
      name: league.name,
      rosterPositions: league.roster_positions || [],
      scoringSettings: league.scoring_settings || {},
    });
    id = league.previous_league_id;
  }
  return chain;
}

// ─── Draft picks (for keeper round projection) ─────────────────────────────────

const draftPicksCache = {};
async function fetchAllDraftPicks(draftId) {
  if (!draftId) return null;
  if (draftPicksCache[draftId] !== undefined) return draftPicksCache[draftId];
  const picks = await apiFetch(`${SLEEPER}/draft/${draftId}/picks`).catch(() => []);
  draftPicksCache[draftId] = picks;
  return picks;
}

/** Same 3-round-escalation keeper rule used on the Keepers page. */
function projectKeeperRound(playerId, prevPickMap) {
  if (!prevPickMap) return null;
  const prev = prevPickMap[playerId];
  if (!prev) return 10;
  const baseRound = Math.min(prev.round, 10);
  return prev.isKeeper ? Math.max(1, baseRound - 3) : baseRound;
}

// ─── VORP calculation ───────────────────────────────────────────────────────────

function parseRosterConstruction(rosterPositions) {
  const baseSlots = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
  const flexSlotTypes = [];
  rosterPositions.forEach(slot => {
    if (slot === 'BN' || slot === 'IR' || slot === 'TAXI') return;
    if (baseSlots[slot] !== undefined) { baseSlots[slot]++; return; }
    if (FLEX_ELIGIBILITY[slot]) flexSlotTypes.push(slot);
  });
  // Narrowest-eligibility flex slots get filled first in the greedy assignment.
  flexSlotTypes.sort((a, b) => FLEX_ELIGIBILITY[a].length - FLEX_ELIGIBILITY[b].length);
  return { baseSlots, flexSlotTypes };
}

function computeVORP(playerTotals, playersDb, numTeams, rosterPositions) {
  const { baseSlots, flexSlotTypes } = parseRosterConstruction(rosterPositions);

  const pools = {};
  BASE_POS.forEach(pos => pools[pos] = []);
  Object.entries(playerTotals).forEach(([pid, pts]) => {
    if (!(pts > 0)) return;
    const pos = getPosition(pid, playersDb);
    if (!pools[pos]) return;
    pools[pos].push({ id: pid, pts });
  });
  BASE_POS.forEach(pos => pools[pos].sort((a, b) => b.pts - a.pts));

  const usedIds = new Set();
  BASE_POS.forEach(pos => {
    const need = numTeams * (baseSlots[pos] || 0);
    for (let i = 0; i < need && i < pools[pos].length; i++) usedIds.add(pools[pos][i].id);
  });

  // Greedily fill flex slots, narrowest-eligibility slot type first, always
  // taking the single highest-points remaining eligible player.
  flexSlotTypes.forEach(slotType => {
    const eligible = FLEX_ELIGIBILITY[slotType];
    for (let i = 0; i < numTeams; i++) {
      let best = null;
      eligible.forEach(pos => {
        const candidate = pools[pos].find(p => !usedIds.has(p.id));
        if (candidate && (!best || candidate.pts > best.pts)) best = candidate;
      });
      if (best) usedIds.add(best.id);
    }
  });

  const replacement = {};
  const startableCounts = {};
  BASE_POS.forEach(pos => {
    const nextUp = pools[pos].find(p => !usedIds.has(p.id));
    replacement[pos] = nextUp ? nextUp.pts : 0;
    startableCounts[pos] = pools[pos].filter(p => usedIds.has(p.id)).length;
  });

  const players = [];
  BASE_POS.forEach(pos => {
    pools[pos].forEach(p => {
      players.push({
        id: p.id,
        name: playerName(p.id, playersDb),
        pos,
        team: playersDb[p.id]?.team || 'FA',
        points: Math.round(p.pts * 10) / 10,
        replacement: Math.round(replacement[pos] * 10) / 10,
        vorp: Math.round((p.pts - replacement[pos]) * 10) / 10,
        starter: usedIds.has(p.id),
      });
    });
  });
  players.sort((a, b) => b.vorp - a.vorp);
  players.forEach((p, i) => { p.overallRank = i + 1; });
  BASE_POS.forEach(pos => {
    let rank = 1;
    players.filter(p => p.pos === pos).forEach(p => { p.posRank = rank++; });
  });

  return {
    players,
    replacement,
    startableCounts,
    numTeams,
    byId: Object.fromEntries(players.map(p => [p.id, p])),
  };
}

// ─── QB scoring premium ─────────────────────────────────────────────────────────

function computeQBScoringPremium(qbPassTotals, playerTotals, playersDb, scoringSettings) {
  const leaguePassYd = scoringSettings.pass_yd ?? 0.05;
  const leaguePassTd = scoringSettings.pass_td ?? 5;

  const rows = Object.entries(qbPassTotals)
    .filter(([pid]) => getPosition(pid, playersDb) === 'QB')
    .map(([pid, s]) => {
      const leagueTotal     = playerTotals[pid] || 0;
      const leaguePassPts   = s.pass_yd * leaguePassYd + s.pass_td * leaguePassTd;
      const standardPassPts = s.pass_yd * STANDARD_PASS_YD + s.pass_td * STANDARD_PASS_TD;
      const delta           = leaguePassPts - standardPassPts;
      const standardTotal   = leagueTotal - delta;
      return {
        id: pid,
        name: playerName(pid, playersDb),
        team: playersDb[pid]?.team || 'FA',
        passYd: Math.round(s.pass_yd),
        passTd: Math.round(s.pass_td),
        leagueTotal: Math.round(leagueTotal * 10) / 10,
        standardTotal: Math.round(standardTotal * 10) / 10,
        delta: Math.round(delta * 10) / 10,
      };
    })
    .filter(r => r.leagueTotal > 0);

  rows.sort((a, b) => b.leagueTotal - a.leagueTotal);
  rows.forEach((r, i) => { r.leagueRank = i + 1; });

  const byStandard = [...rows].sort((a, b) => b.standardTotal - a.standardTotal);
  byStandard.forEach((r, i) => { r.standardRank = i + 1; });
  rows.forEach(r => { r.rankShift = r.standardRank - r.leagueRank; });

  rows.sort((a, b) => b.delta - a.delta);
  return { rows, leaguePassYd, leaguePassTd };
}

// ─── Keeper value ────────────────────────────────────────────────────────────

async function computeKeeperValue(currentLink, priorLink, currentRosters, nameMap, playersDb, vorp) {
  let prevPickMap = null;
  if (priorLink) {
    const prevPicks = await fetchAllDraftPicks(priorLink.draftId);
    if (prevPicks && prevPicks.length) {
      prevPickMap = {};
      prevPicks.forEach(p => { prevPickMap[p.player_id] = { round: p.round, isKeeper: !!p.is_keeper }; });
    }
  }

  const keeperPicks = await fetchAllDraftPicks(currentLink.draftId).catch(() => null);
  const hasDraftHappened = !!(keeperPicks && keeperPicks.length > 0);

  const byRosterKeepers = {};
  if (hasDraftHappened) {
    keeperPicks.filter(p => p.is_keeper).forEach(p => {
      if (!byRosterKeepers[p.roster_id]) byRosterKeepers[p.roster_id] = [];
      byRosterKeepers[p.roster_id].push({ id: p.player_id, round: p.round, projected: false });
    });
  } else {
    currentRosters.forEach(r => {
      byRosterKeepers[r.roster_id] = (r.keepers || []).map(pid => ({
        id: pid,
        round: projectKeeperRound(pid, prevPickMap),
        projected: true,
      }));
    });
  }

  const teams = currentRosters.map(r => {
    const teamName = nameMap[r.owner_id] || `Team ${r.roster_id}`;
    const keepers = (byRosterKeepers[r.roster_id] || []).map(k => {
      const v = vorp.byId[k.id];
      return {
        id: k.id,
        name: playerName(k.id, playersDb),
        pos: getPosition(k.id, playersDb),
        team: playersDb[k.id]?.team || 'FA',
        round: k.round,
        projected: k.projected,
        vorpPts: v ? v.points : null,
        vorp: v ? v.vorp : null,
        overallRank: v ? v.overallRank : null,
        posRank: v ? v.posRank : null,
      };
    });
    return { rosterId: r.roster_id, teamName, keepers };
  });
  teams.sort((a, b) => a.teamName.localeCompare(b.teamName));

  return { teams, hasDraftHappened };
}

// ─── ADP parsing ─────────────────────────────────────────────────────────────

function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[.']/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitCsvLine(line) {
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function parseADPCsv(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const header  = splitCsvLine(lines[0]).map(h => h.toLowerCase());
  let nameIdx = header.findIndex(h => h === 'player' || h === 'name' || h.includes('player'));
  let adpIdx  = header.findIndex(h => h === 'avg' || h === 'adp' || h.includes('adp') || h === 'overall');
  if (nameIdx === -1) nameIdx = 1;
  if (adpIdx === -1) adpIdx = header.length - 1;

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length <= Math.max(nameIdx, adpIdx)) continue;
    let rawName = cols[nameIdx];
    const adp = parseFloat(cols[adpIdx]);
    if (!rawName || isNaN(adp)) continue;
    rawName = rawName.replace(/\s*\([^)]*\)\s*$/, '');
    rows.push({ name: rawName.trim(), adp });
  }
  return rows;
}

function matchADPToPlayers(adpRows, playersDb) {
  const byName = {};
  Object.entries(playersDb).forEach(([pid, p]) => {
    const pos = p.position || p.fantasy_positions?.[0];
    if (!BASE_POS.includes(pos)) return;
    const nm = normalizeName(p.full_name || `${p.first_name || ''} ${p.last_name || ''}`);
    if (nm && !(nm in byName)) byName[nm] = pid;
  });
  const map = {};
  let matched = 0;
  adpRows.forEach(row => {
    const pid = byName[normalizeName(row.name)];
    if (pid) { map[pid] = row.adp; matched++; }
  });
  return { map, matched, total: adpRows.length };
}

function handleApplyADP() {
  const text = document.getElementById('adpInput').value;
  localStorage.setItem(ADP_STORAGE_KEY, text);
  const statusEl = document.getElementById('adpStatus');
  if (!currentData || !lastPlayersDb) {
    statusEl.textContent = 'Load league data first.';
    return;
  }
  const rows = parseADPCsv(text);
  const { map, matched, total } = matchADPToPlayers(rows, lastPlayersDb);
  currentData.adpMap = map;
  statusEl.textContent = total > 0 ? `Matched ${matched} of ${total} pasted players.` : 'Could not parse any rows — check the CSV has a Player column and an ADP/AVG column.';
  renderKeeperValue();
}

// ─── Main load ─────────────────────────────────────────────────────────────────

async function handleLoadDraftResearch() {
  const leagueId = document.getElementById('drLeagueId').value.trim();
  const errEl = document.getElementById('loadError');
  if (!leagueId) { errEl.textContent = 'Please enter a league ID.'; errEl.style.display = 'block'; return; }
  errEl.style.display = 'none';
  showProgress(5, 'Fetching league history...');

  try {
    localStorage.setItem('lastLeagueId', leagueId);
    const chain = await walkLeagueChain(leagueId);
    const currentLink = chain[0];
    const priorLink = chain[1] || null;
    const vorpLink = (priorLink && priorLink.status === 'complete') ? priorLink : chain.find(l => l.status === 'complete');
    if (!vorpLink) throw new Error("No completed season found in this league's history to base VORP on.");

    showProgress(10, 'Fetching player database...');
    const playersDb = await fetchPlayers();
    lastPlayersDb = playersDb;

    showProgress(15, 'Fetching current-season rosters...');
    const [currentRosters, currentUsers] = await Promise.all([
      apiFetch(`${SLEEPER}/league/${currentLink.leagueId}/rosters`),
      apiFetch(`${SLEEPER}/league/${currentLink.leagueId}/users`),
    ]);
    const nameMap = {};
    currentUsers.forEach(u => { nameMap[u.user_id] = u.display_name; });
    const numTeams = currentRosters.length;

    // ── Weekly stats sweep — feeds both VORP totals and QB scoring premium ──
    const playerTotals = {};
    const qbPassTotals = {};
    for (let week = 1; week <= 17; week++) {
      const pct = 15 + Math.round((week / 17) * 55);
      showProgress(pct, `Loading ${vorpLink.season} week ${week}...`);
      let stats;
      try { stats = await apiFetch(`${SLEEPER}/stats/nfl/regular/${vorpLink.season}/${week}`); }
      catch (e) { continue; }
      Object.entries(stats).forEach(([pid, s]) => {
        const pts = s?.pts_half_ppr;
        if (typeof pts === 'number') playerTotals[pid] = (playerTotals[pid] || 0) + pts;
        if (typeof s?.pass_att === 'number' && s.pass_att > 0) {
          if (!qbPassTotals[pid]) qbPassTotals[pid] = { pass_yd: 0, pass_td: 0 };
          qbPassTotals[pid].pass_yd += s.pass_yd || 0;
          qbPassTotals[pid].pass_td += s.pass_td || 0;
        }
      });
    }

    showProgress(72, 'Computing VORP...');
    const vorp = computeVORP(playerTotals, playersDb, numTeams, vorpLink.rosterPositions);

    showProgress(80, 'Computing QB scoring premium...');
    const qbScoring = computeQBScoringPremium(qbPassTotals, playerTotals, playersDb, vorpLink.scoringSettings);

    showProgress(90, 'Loading keeper data...');
    const keeperValue = await computeKeeperValue(currentLink, priorLink, currentRosters, nameMap, playersDb, vorp);

    currentData = {
      leagueName: currentLink.name,
      vorpSeason: vorpLink.season,
      currentSeason: currentLink.season,
      numTeams,
      vorp,
      qbScoring,
      keeperValue,
      adpMap: currentData?.adpMap, // preserve if user pasted ADP before reloading
    };

    hideProgress();
    renderAll(currentData);

    // Re-apply any previously-pasted ADP text now that data is loaded.
    const adpText = document.getElementById('adpInput').value.trim();
    if (adpText) handleApplyADP();
  } catch (err) {
    hideProgress();
    errEl.textContent = `Error: ${err.message}`;
    errEl.style.display = 'block';
  }
}

// ─── Progress ─────────────────────────────────────────────────────────────────

function showProgress(pct, msg) {
  document.getElementById('progressWrap').style.display = 'block';
  document.getElementById('progressLabel').textContent  = msg;
  document.getElementById('progressFill').style.width   = `${pct}%`;
  document.getElementById('drResults').style.display = 'none';
}
function hideProgress() {
  document.getElementById('progressWrap').style.display = 'none';
}

// ─── Render: shell ──────────────────────────────────────────────────────────────

function renderAll(data) {
  document.getElementById('resultsTitle').textContent = data.leagueName;
  document.getElementById('resultsMeta').textContent =
    `VORP + QB scoring based on ${data.vorpSeason} actuals · keepers from ${data.currentSeason} · ${data.numTeams} teams`;

  renderReplacementChips(data);
  renderVorpTable();
  renderQBScoring(data);
  renderKeeperTeamFilter(data);
  renderKeeperValue();

  document.getElementById('drResults').style.display = 'block';
}

// ─── Render: VORP ───────────────────────────────────────────────────────────────

function renderReplacementChips(data) {
  const el = document.getElementById('replacementChips');
  el.innerHTML = BASE_POS.map(pos => `
    <div class="stat-chip">
      <span>${data.vorp.replacement[pos].toFixed(1)}</span>
      ${pos} replacement · ${data.vorp.startableCounts[pos]} startable
    </div>
  `).join('');
}

function setPosFilter(pos) {
  activePosFilter = pos;
  document.querySelectorAll('.pos-filter-btn').forEach(b => b.classList.toggle('tab-active', b.dataset.pos === pos));
  renderVorpTable();
}

function renderVorpTable() {
  if (!currentData) return;
  const search = document.getElementById('playerSearch').value.trim().toLowerCase();
  let rows = currentData.vorp.players.filter(p =>
    (activePosFilter === 'ALL' || p.pos === activePosFilter) &&
    (!search || p.name.toLowerCase().includes(search))
  );
  const total = rows.length;
  rows = rows.slice(0, 150);

  document.getElementById('vorpTbody').innerHTML = rows.map(p => `
    <tr>
      <td>${p.overallRank}</td>
      <td>${p.name}</td>
      <td><span class="pos-legend-dot" style="background:${POS_COLORS[p.pos]};display:inline-block;margin-right:5px"></span>${p.pos}</td>
      <td>${p.team}</td>
      <td>${p.points.toFixed(1)}</td>
      <td>${p.replacement.toFixed(1)}</td>
      <td style="color:${p.vorp >= 0 ? 'var(--green)' : 'var(--red)'};font-weight:600">${p.vorp >= 0 ? '+' : ''}${p.vorp.toFixed(1)}</td>
    </tr>
  `).join('');
  document.getElementById('vorpCount').textContent = `Showing ${rows.length} of ${total}`;
}

function exportVORPCSV() {
  if (!currentData) return;
  let csv = 'Rank,Player,Pos,Team,Points,Replacement,VORP\n';
  currentData.vorp.players.forEach(p => {
    csv += `${p.overallRank},${p.name},${p.pos},${p.team},${p.points},${p.replacement},${p.vorp}\n`;
  });
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = `${currentData.vorpSeason}_vorp.csv`;
  a.click();
}

// ─── Render: QB scoring premium ─────────────────────────────────────────────────

function renderQBScoring(data) {
  const { rows, leaguePassYd, leaguePassTd } = data.qbScoring;
  document.getElementById('qbScoringMeta').textContent =
    `League scoring: ${leaguePassYd}pt/pass yd (1/${Math.round(1 / leaguePassYd)}), ${leaguePassTd}pt/pass TD `
    + `vs standard 0.04pt/yd (1/25), 4pt/TD — sorted by who gains the most extra points from the difference.`;

  document.getElementById('qbScoringTbody').innerHTML = rows.map(r => `
    <tr>
      <td>${r.leagueRank}</td>
      <td>${r.name}</td>
      <td>${r.team}</td>
      <td>${r.passYd}</td>
      <td>${r.passTd}</td>
      <td>${r.leagueTotal.toFixed(1)}</td>
      <td>${r.standardTotal.toFixed(1)}</td>
      <td style="color:${r.delta >= 0 ? 'var(--green)' : 'var(--red)'};font-weight:600">${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(1)}</td>
      <td style="color:${r.rankShift > 0 ? 'var(--green)' : r.rankShift < 0 ? 'var(--red)' : 'var(--text-muted)'}">${r.rankShift > 0 ? '+' : ''}${r.rankShift || 0}</td>
    </tr>
  `).join('');
}

// ─── Render: Keeper value ───────────────────────────────────────────────────────

function renderKeeperTeamFilter(data) {
  const sel = document.getElementById('keeperTeamFilter');
  sel.innerHTML = '<option value="ALL">All teams</option>' +
    data.keeperValue.teams.map(t => `<option value="${t.rosterId}">${t.teamName}</option>`).join('');
}

function renderKeeperValue() {
  if (!currentData) return;
  const filter = document.getElementById('keeperTeamFilter').value;
  const adpMap = currentData.adpMap || {};
  const numTeams = currentData.numTeams;

  let rows = [];
  currentData.keeperValue.teams.forEach(team => {
    if (filter !== 'ALL' && String(team.rosterId) !== filter) return;
    team.keepers.forEach(k => {
      const adp = adpMap[k.id] ?? null;
      const adpRound = adp != null ? Math.max(1, Math.ceil(adp / numTeams)) : null;
      const valueDelta = (adpRound != null && k.round != null) ? adpRound - k.round : null;
      rows.push({ teamName: team.teamName, ...k, adp, adpRound, valueDelta });
    });
  });

  // Biggest bargains first when ADP is loaded, else best VORP first.
  rows.sort((a, b) => {
    if (a.valueDelta != null && b.valueDelta != null) return b.valueDelta - a.valueDelta;
    if (a.valueDelta != null) return -1;
    if (b.valueDelta != null) return 1;
    return (b.vorp ?? -999) - (a.vorp ?? -999);
  });

  document.getElementById('keeperValueTbody').innerHTML = rows.map(k => `
    <tr>
      <td>${k.teamName}</td>
      <td>${k.name}</td>
      <td><span class="pos-legend-dot" style="background:${POS_COLORS[k.pos] || '#999'};display:inline-block;margin-right:5px"></span>${k.pos}</td>
      <td>${k.round != null ? `Rd ${k.round}${k.projected ? ' (proj.)' : ''}` : '—'}</td>
      <td>${k.adp != null ? k.adp.toFixed(1) : '—'}</td>
      <td>${k.adpRound != null ? `Rd ${k.adpRound}` : '—'}</td>
      <td style="${k.valueDelta != null ? `color:${k.valueDelta > 0 ? 'var(--green)' : k.valueDelta < 0 ? 'var(--red)' : 'var(--text-muted)'};font-weight:600` : ''}">${k.valueDelta != null ? (k.valueDelta > 0 ? '+' : '') + k.valueDelta : '—'}</td>
      <td style="${k.vorp != null ? `color:${k.vorp >= 0 ? 'var(--green)' : 'var(--red)'}` : ''}">${k.vorp != null ? (k.vorp >= 0 ? '+' : '') + k.vorp.toFixed(1) : '—'}</td>
      <td>${k.overallRank != null ? `#${k.overallRank} (${k.pos}${k.posRank})` : '—'}</td>
    </tr>
  `).join('');
}

function exportKeeperValueCSV() {
  if (!currentData) return;
  const adpMap = currentData.adpMap || {};
  const numTeams = currentData.numTeams;
  let csv = 'Team,Player,Pos,Kept At,ADP,ADP Round,Value Delta,VORP,VORP Rank\n';
  currentData.keeperValue.teams.forEach(team => {
    team.keepers.forEach(k => {
      const adp = adpMap[k.id] ?? null;
      const adpRound = adp != null ? Math.max(1, Math.ceil(adp / numTeams)) : null;
      const valueDelta = (adpRound != null && k.round != null) ? adpRound - k.round : '';
      csv += `${team.teamName},${k.name},${k.pos},${k.round ?? ''},${adp ?? ''},${adpRound ?? ''},${valueDelta},${k.vorp ?? ''},${k.overallRank ?? ''}\n`;
    });
  });
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = `${currentData.currentSeason}_keeper_value.csv`;
  a.click();
}
