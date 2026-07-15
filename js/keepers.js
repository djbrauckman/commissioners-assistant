/**
 * keepers.js
 * Fetches each team's declared keepers from Sleeper and renders them.
 *
 * Sleeper records keepers two different ways depending on draft state:
 *  - Pre-draft: GET /league/{id}/rosters has a "keepers" array of player_ids,
 *    set once managers submit their picks ahead of the draft.
 *  - Post-draft: keepers get baked into the draft as picks flagged
 *    "is_keeper": true on GET /draft/{draft_id}/picks (with player name/
 *    position/team embedded in each pick's metadata) — and Sleeper doesn't
 *    reliably keep the roster-level "keepers" array populated afterward.
 * So for each season we prefer draft picks when the draft has occurred,
 * falling back to the roster array when it hasn't (current/upcoming season).
 *
 * Depends on: nav.js
 */

const SLEEPER = 'https://api.sleeper.app/v1';
const PLAYERS_CACHE_KEY = 'sleeper_players_cache';
const PLAYERS_CACHE_DATE_KEY = 'sleeper_players_cache_date';

let currentKeepersData = null;

document.addEventListener('DOMContentLoaded', () => {
  initNav('keepers');
  const saved = localStorage.getItem('lastLeagueId');
  if (saved) document.getElementById('keepersLeagueId').value = saved;
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

/**
 * Walk the previous_league_id chain from the given league, oldest link last.
 * Returns [{ leagueId, draftId, season, status, maxKeepers, leagueName }, ...] newest-first.
 */
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
      maxKeepers: league.settings?.max_keepers ?? null,
      leagueName: league.name,
    });
    id = league.previous_league_id;
  }
  return chain;
}

// Cache of draftId -> full picks array, so a season's draft only ever
// gets fetched once even when it's referenced both for its own keepers
// and as the "previous season" lookback for a later season's projection.
const draftPicksCache = {};

async function fetchAllDraftPicks(draftId) {
  if (!draftId) return null;
  if (draftPicksCache[draftId] !== undefined) return draftPicksCache[draftId];
  const picks = await apiFetch(`${SLEEPER}/draft/${draftId}/picks`).catch(() => []);
  draftPicksCache[draftId] = picks;
  return picks;
}

/**
 * Fetch keeper picks (is_keeper: true) from a season's draft.
 * Returns null if the draft hasn't happened yet (no picks made) so the
 * caller can fall back to the roster-level "keepers" array instead.
 */
async function fetchDraftKeeperPicks(draftId) {
  const picks = await fetchAllDraftPicks(draftId);
  if (!picks || picks.length === 0) return null;
  return picks.filter(p => p.is_keeper);
}

/**
 * League keeper rule: a player is kept at the round they were drafted
 * (free agents / round-10-or-later picks count as round 10) the first
 * year they're kept, then that round value climbs 3 rounds every year
 * after — e.g. a round-10 FA pickup is an round 10 keeper the first
 * year, a round 7 keeper the next, round 4 the year after that, etc.
 *
 * Since each season's recorded pick round already bakes in the prior
 * history, projecting next year's cost only requires looking at the
 * player's most recent draft pick:
 *  - not drafted last season (true free agent) → base round 10
 *  - drafted last season but NOT as a keeper → this is their first
 *    kept year, so the value is just last year's round (clamped to 10)
 *  - kept last season already → subtract 3 more, floor at round 1
 */
function projectKeeperRound(playerId, prevPickMap) {
  if (!prevPickMap) return null;
  const prev = prevPickMap[playerId];
  if (!prev) return 10;
  const baseRound = Math.min(prev.round, 10);
  return prev.isKeeper ? Math.max(1, baseRound - 3) : baseRound;
}

function describePlayerId(playerId, playersDb) {
  const p = playersDb[playerId];
  if (!p) return { name: `Unknown player (${playerId})`, position: '', team: '', round: null, pickNo: null };
  return {
    name: p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || playerId,
    position: p.fantasy_positions?.[0] || p.position || '',
    team: p.team || 'FA',
    round: null,
    pickNo: null,
  };
}

function describeKeeperPick(pick) {
  const m = pick.metadata || {};
  return {
    name: `${m.first_name || ''} ${m.last_name || ''}`.trim() || pick.player_id,
    position: m.position || '',
    team: m.team || 'FA',
    round: pick.round,
    pickNo: pick.pick_no,
  };
}

// ─── Load ─────────────────────────────────────────────────────────────────────

async function handleLoadKeepers() {
  const leagueId = document.getElementById('keepersLeagueId').value.trim();
  const season   = document.getElementById('keepersSeason').value.trim();
  const errEl    = document.getElementById('loadError');

  if (!leagueId) { errEl.textContent = 'Please enter a league ID.'; errEl.style.display = 'block'; return; }
  errEl.style.display = 'none';
  showProgress(5, 'Fetching league history...');

  try {
    localStorage.setItem('lastLeagueId', leagueId);

    const fullChain = await walkLeagueChain(leagueId);
    let chain = fullChain;
    if (season) {
      chain = fullChain.filter(link => String(link.season) === String(season));
      if (chain.length === 0) throw new Error(`Season ${season} not found in this league's history.`);
    }

    showProgress(15, 'Fetching player database...');
    const playersDb = await fetchPlayers();

    const seasons = [];
    for (let i = 0; i < chain.length; i++) {
      const link = chain[i];
      const pct = 15 + Math.round(((i + 1) / chain.length) * 80);
      showProgress(pct, `Loading ${link.season} season (${i + 1} of ${chain.length})...`);

      const [rosters, users, keeperPicks] = await Promise.all([
        apiFetch(`${SLEEPER}/league/${link.leagueId}/rosters`),
        apiFetch(`${SLEEPER}/league/${link.leagueId}/users`),
        fetchDraftKeeperPicks(link.draftId),
      ]);

      const nameMap = {};
      users.forEach(u => { nameMap[u.user_id] = u.display_name; });

      let teams;
      if (keeperPicks) {
        // Draft has happened — keeper picks are the authoritative source.
        const byRoster = {};
        keeperPicks.forEach(p => {
          if (!byRoster[p.roster_id]) byRoster[p.roster_id] = [];
          byRoster[p.roster_id].push(describeKeeperPick(p));
        });
        teams = rosters.map(r => ({
          rosterId: r.roster_id,
          teamName: nameMap[r.owner_id] || `Team ${r.roster_id}`,
          keepers: (byRoster[r.roster_id] || []).sort((a, b) => a.round - b.round),
        }));
      } else {
        // Draft hasn't happened yet — use the roster's declared keepers,
        // projecting the round each would cost from last season's draft.
        const prevLink = fullChain[fullChain.findIndex(l => l.leagueId === link.leagueId) + 1];
        const prevPicks = prevLink ? await fetchAllDraftPicks(prevLink.draftId) : null;
        let prevPickMap = null;
        if (prevPicks && prevPicks.length) {
          prevPickMap = {};
          prevPicks.forEach(p => { prevPickMap[p.player_id] = { round: p.round, isKeeper: !!p.is_keeper }; });
        }

        teams = rosters.map(r => ({
          rosterId: r.roster_id,
          teamName: nameMap[r.owner_id] || `Team ${r.roster_id}`,
          keepers: (r.keepers || []).map(pid => {
            const desc = describePlayerId(pid, playersDb);
            desc.round = projectKeeperRound(pid, prevPickMap);
            desc.projected = desc.round != null;
            return desc;
          }).sort((a, b) => (a.round ?? Infinity) - (b.round ?? Infinity)),
        }));
      }
      teams.sort((a, b) => a.teamName.localeCompare(b.teamName));

      seasons.push({ ...link, teams });
    }

    currentKeepersData = {
      leagueName: chain[0].leagueName,
      seasons,
    };

    hideProgress();
    renderKeepers(currentKeepersData);
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
  document.getElementById('keepersResults').style.display = 'none';
}
function hideProgress() {
  document.getElementById('progressWrap').style.display = 'none';
}

// ─── Results ──────────────────────────────────────────────────────────────────

function renderKeepers(data) {
  const totalTeams = data.seasons[0]?.teams.length ?? 0;
  document.getElementById('resultsTitle').textContent = data.leagueName;
  document.getElementById('resultsMeta').textContent =
    data.seasons.length > 1
      ? `${data.seasons.length} seasons · ${totalTeams} teams`
      : `${data.seasons[0].season} season · ${totalTeams} teams` +
        (data.seasons[0].maxKeepers != null ? ` · up to ${data.seasons[0].maxKeepers} keepers each` : '');

  const container = document.getElementById('keepersGrid');
  container.innerHTML = '';

  data.seasons.forEach(seasonData => {
    if (data.seasons.length > 1) {
      const header = document.createElement('div');
      header.style.cssText = 'grid-column:1/-1;font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-faint);padding:12px 0 4px;font-family:"DM Mono",monospace';
      header.textContent = `${seasonData.season}` +
        (seasonData.maxKeepers != null ? ` — up to ${seasonData.maxKeepers} keepers each` : '');
      container.appendChild(header);
    }

    seasonData.teams.forEach(team => {
      const card = document.createElement('div');
      card.className = 'manager-card';
      card.innerHTML = `
        <div class="manager-card-header">
          <div class="manager-name">${team.teamName}</div>
          <div class="manager-record">${team.keepers.length} keeper${team.keepers.length === 1 ? '' : 's'}</div>
        </div>
        ${team.keepers.length > 0 ? `
          <table>
            <thead><tr><th>Player</th><th>Pos</th><th>Team</th><th>Kept at</th></tr></thead>
            <tbody>
              ${team.keepers.map(k => `<tr><td>${k.name}</td><td>${k.position}</td><td>${k.team}</td><td>${k.round == null ? '—' : k.pickNo != null ? `Rd ${k.round} · Pick ${k.pickNo}` : `Rd ${k.round} (proj.)`}</td></tr>`).join('')}
            </tbody>
          </table>
        ` : '<div style="font-size:13px;color:var(--text-faint);padding:8px 0">No keepers selected</div>'}
      `;
      container.appendChild(card);
    });
  });

  document.getElementById('keepersResults').style.display = 'block';
}

// ─── Export ───────────────────────────────────────────────────────────────────

function exportKeepersCSV() {
  if (!currentKeepersData) return;
  const { leagueName, seasons } = currentKeepersData;

  let csv = 'League,Season,Team,Player,Position,NFL Team,Round,Pick\n';
  seasons.forEach(({ season, teams }) => {
    teams.forEach(team => {
      if (team.keepers.length === 0) {
        csv += `${leagueName},${season},${team.teamName},,,,,\n`;
      } else {
        team.keepers.forEach(k => {
          csv += `${leagueName},${season},${team.teamName},${k.name},${k.position},${k.team},${k.round ?? ''},${k.pickNo ?? ''}\n`;
        });
      }
    });
  });

  const seasonLabel = seasons.length === 1 ? seasons[0].season : `${seasons[seasons.length - 1].season}-${seasons[0].season}`;
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = `${seasonLabel}_keepers.csv`;
  a.click();
}
