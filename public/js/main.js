import { StadiumScene } from './scene.js';
import { getSeasons, getFixtures, getMatch } from './api.js';
import { MatchSimulator, demoResults } from './demo.js';
import { DEMO_CLUBS } from './teams.js';

const LIVE_POLL_MS = 20_000;
const $ = (sel) => document.querySelector(sel);

const state = {
  tab: 'live',
  apiOk: false,
  seasons: [],
  season: null,
  resultsPage: 0,
  match: null,
  selectedKey: null,
  pollTimer: null,
  simTimer: null,
  demoMatches: null,
};

const tooltip = $('#tooltip');
const scene = createScene();

function createScene() {
  try {
    return new StadiumScene($('#stage'), {
      onHover(info) {
        if (!info || !info.html) return (tooltip.hidden = true);
        tooltip.hidden = false;
        tooltip.innerHTML = info.html;
        tooltip.style.left = `${info.x}px`;
        tooltip.style.top = `${info.y}px`;
      },
    });
  } catch (err) {
    console.error(err);
    window.__plFail?.(`<b>Your browser couldn't start 3D graphics (WebGL 2).</b> The match lists and stats still work.
      Try Chrome or an up-to-date Safari, and make sure hardware acceleration is turned on in your browser settings.`);
    // Stand-in so the rest of the app works without the 3D view.
    return { setMatch() {}, setView() {}, setAutoRotate() {}, celebrate() {} };
  }
}

// ------------------------------------------------------------------ chrome
document.querySelectorAll('[data-view]').forEach((btn) =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b === btn));
    scene.setView(btn.dataset.view);
  }),
);
$('#orbit').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(on));
  scene.setAutoRotate(on);
});
document.querySelectorAll('[role=tab]').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
document.querySelectorAll('.panel-toggle').forEach((btn) =>
  btn.addEventListener('click', () => {
    const target = document.getElementById(btn.dataset.target);
    const open = !target.classList.contains('open');
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('open'));
    target.classList.toggle('open', open);
  }),
);

function setSource(ok, text) {
  const pill = $('#source');
  pill.className = `pill ${ok ? 'ok' : 'warn'}`;
  pill.textContent = text;
}

// ------------------------------------------------------------------ tabs
async function showTab(tab) {
  state.tab = tab;
  document.querySelectorAll('[role=tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#tools').innerHTML = '';
  $('#fixtures').innerHTML = '';
  if (tab === 'live') return renderLive();
  if (tab === 'results') return renderResults();
  return renderDemo();
}

async function renderLive() {
  const tools = $('#tools');
  if (!state.apiOk) {
    tools.innerHTML = `<p>The Premier League API isn't reachable right now, so live data is unavailable.</p>
      <p>Reason: ${escapeHtml(state.apiError || 'unknown')}</p>
      <button class="primary" id="simNow">▶ Watch a simulated live match</button>`;
    $('#simNow').onclick = () => showTab('demo').then(() => startSimulation());
    return;
  }
  tools.innerHTML = `<button id="refreshLive">↻ Refresh</button>`;
  $('#refreshLive').onclick = renderLive;
  setList([{ loading: true }]);
  try {
    const { fixtures: live } = await getFixtures({ statuses: 'L', pageSize: 20 });
    if (state.tab !== 'live') return;
    if (live.length) return setList(live);
    const { fixtures: upcoming } = await getFixtures({ statuses: 'U', season: state.season, pageSize: 10 });
    if (state.tab !== 'live') return;
    tools.insertAdjacentHTML('beforeend', `<p>No Premier League matches are live right now. Coming up next:</p>
      <button class="primary" id="simNow">▶ Or watch a simulated live match</button>`);
    $('#simNow').onclick = () => showTab('demo').then(() => startSimulation());
    setList(upcoming, 'No upcoming fixtures found.');
  } catch (err) {
    setList([], `Couldn't load live matches: ${err.message}`);
  }
}

async function renderResults() {
  const tools = $('#tools');
  if (!state.apiOk) {
    tools.innerHTML = `<p>The Premier League API isn't reachable. Try the Demo tab for simulated matches.</p>
      <p>Reason: ${escapeHtml(state.apiError || 'unknown')}</p>`;
    return;
  }
  tools.innerHTML = `<select id="season" aria-label="Season">${state.seasons
    .map((s) => `<option value="${s.id}" ${s.id === state.season ? 'selected' : ''}>${s.label}</option>`)
    .join('')}</select>`;
  $('#season').onchange = (e) => {
    state.season = Number(e.target.value);
    renderResults();
  };
  state.resultsPage = 0;
  setList([{ loading: true }]);
  await loadResultsPage(true);
}

async function loadResultsPage(reset) {
  try {
    const { fixtures, hasMore } = await getFixtures({ statuses: 'C', season: state.season, page: state.resultsPage });
    if (state.tab !== 'results') return;
    if (reset) $('#fixtures').innerHTML = '';
    appendList(fixtures, 'No completed matches for this season yet.');
    if (hasMore) {
      const li = document.createElement('li');
      li.innerHTML = `<button class="more">Load more…</button>`;
      li.querySelector('button').onclick = () => {
        li.remove();
        state.resultsPage += 1;
        loadResultsPage(false);
      };
      $('#fixtures').append(li);
    }
  } catch (err) {
    setList([], `Couldn't load results: ${err.message}`);
  }
}

function renderDemo() {
  const options = (sel) => DEMO_CLUBS.map((c) => `<option value="${c.abbr}" ${c.abbr === sel ? 'selected' : ''}>${c.name}</option>`).join('');
  $('#tools').innerHTML = `
    <p>Simulated matches — not real results. Great for exploring the visuals when nothing is live.</p>
    <div class="row">
      <select id="simHome" aria-label="Home team">${options('ARS')}</select>
      <select id="simAway" aria-label="Away team">${options('LIV')}</select>
    </div>
    <div class="row">
      <select id="simSpeed" aria-label="Speed">
        <option value="1000">1 min / sec</option>
        <option value="400" selected>Fast</option>
        <option value="120">Turbo</option>
      </select>
      <button class="primary" id="simGo">▶ Kick off</button>
    </div>
    <p>Or replay a simulated full-time match:</p>`;
  $('#simGo').onclick = () => startSimulation();
  state.demoMatches ||= demoResults();
  setList(state.demoMatches);
}

// ------------------------------------------------------------------ fixture list
function setList(items, emptyText) {
  $('#fixtures').innerHTML = '';
  appendList(items, emptyText);
}

function appendList(items, emptyText = 'Nothing here.') {
  const ul = $('#fixtures');
  if (!items.length) {
    ul.insertAdjacentHTML('beforeend', `<li class="empty">${escapeHtml(emptyText)}</li>`);
    return;
  }
  for (const f of items) {
    const li = document.createElement('li');
    if (f.loading) {
      li.className = 'empty';
      li.textContent = 'Loading…';
      ul.append(li);
      continue;
    }
    const key = String(f.id);
    const score = f.status === 'UPCOMING' ? 'vs' : `${f.home.score} – ${f.away.score}`;
    const when = f.status === 'LIVE'
      ? `<span class="live-dot">● LIVE ${escapeHtml(f.clockLabel || `${f.minute}'`)}</span>`
      : f.kickoff ? new Date(f.kickoff).toLocaleString([], { dateStyle: 'medium', timeStyle: f.status === 'UPCOMING' ? 'short' : undefined }) : 'Simulated';
    li.innerHTML = `<button class="${key === state.selectedKey ? 'selected' : ''}">
      <div class="fx-teams"><span><i class="swatch" style="background:${f.home.color}"></i>${escapeHtml(f.home.abbr)}</span>
      <span class="fx-score">${score}</span><span class="away">${escapeHtml(f.away.abbr)}<i class="swatch" style="background:${f.away.color};margin:0 0 0 4px"></i></span></div>
      <div class="fx-meta"><span>${when}</span><span>${f.gameweek ? `GW ${f.gameweek}` : ''}</span></div>
    </button>`;
    li.querySelector('button').onclick = () => {
      document.querySelectorAll('.fixtures button').forEach((b) => b.classList.remove('selected'));
      li.querySelector('button').classList.add('selected');
      openMatch(f);
    };
    ul.append(li);
  }
}

// ------------------------------------------------------------------ match loading
function stopTimers() {
  clearInterval(state.pollTimer);
  clearInterval(state.simTimer);
  state.pollTimer = state.simTimer = null;
}

async function openMatch(fixture) {
  stopTimers();
  state.selectedKey = String(fixture.id);
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('open'));
  if (fixture.source === 'demo') return show(fixture, true);

  $('#matchHead').innerHTML = `<p class="muted">Loading ${escapeHtml(fixture.home.name)} v ${escapeHtml(fixture.away.name)}…</p>`;
  try {
    const match = await getMatch(fixture.id);
    if (state.selectedKey !== String(fixture.id)) return;
    show(match, true);
    if (match.status === 'LIVE') {
      state.pollTimer = setInterval(async () => {
        try {
          const next = await getMatch(fixture.id);
          if (state.selectedKey !== String(fixture.id)) return;
          show(next, false);
          if (next.status !== 'LIVE') stopTimers();
        } catch (err) {
          setSource(false, `Live update failed: ${err.message}`);
        }
      }, LIVE_POLL_MS);
    }
  } catch (err) {
    $('#matchHead').innerHTML = `<p class="muted">Couldn't load this match: ${escapeHtml(err.message)}</p>`;
  }
}

function startSimulation() {
  stopTimers();
  const home = $('#simHome')?.value || 'ARS';
  let away = $('#simAway')?.value || 'LIV';
  if (away === home) away = home === 'LIV' ? 'ARS' : 'LIV';
  const speed = Number($('#simSpeed')?.value || 400);
  const sim = new MatchSimulator(home, away);
  state.selectedKey = sim.match.id;
  document.querySelectorAll('.fixtures button').forEach((b) => b.classList.remove('selected'));
  show(sim.match, true);
  state.simTimer = setInterval(() => {
    show(sim.step(), false);
    if (sim.finished) stopTimers();
  }, speed);
}

/** Render a match everywhere; on updates, celebrate any new goals. */
function show(match, fresh) {
  const prev = state.match;
  const sameMatch = prev && prev.id === match.id;
  const prevGoals = sameMatch ? prev.home.score + prev.away.score : null;
  // Snapshot so later in-place simulator mutations don't confuse goal diffing.
  state.match = structuredClone(match);
  scene.setMatch(match, { fresh: fresh || !sameMatch });
  renderDetails(match);
  if (!fresh && sameMatch && match.home.score + match.away.score > prevGoals) {
    const side = match.home.score > prev.home.score ? 'home' : 'away';
    celebrate(side, match);
  }
}

function celebrate(side, match) {
  scene.celebrate(side);
  const banner = $('#goal-banner');
  banner.hidden = true;
  void banner.offsetWidth; // restart the CSS animation
  banner.textContent = `GOAL! ${match[side].abbr}`;
  banner.style.color = '#fff';
  banner.hidden = false;
}

// ------------------------------------------------------------------ details panel
function renderDetails(m) {
  const status = m.status === 'LIVE' ? `<span class="live-dot">● LIVE ${escapeHtml(m.clockLabel || `${m.minute}'`)}</span>` : m.status === 'FT' ? 'Full time' : 'Upcoming';
  $('#matchHead').innerHTML = `
    <div class="teams"><span><i class="swatch" style="background:${m.home.color}"></i>${escapeHtml(m.home.name)}</span>
    <span>${escapeHtml(m.away.name)}<i class="swatch" style="background:${m.away.color};margin:0 0 0 4px"></i></span></div>
    <div class="score">${m.home.score} – ${m.away.score}</div>
    <div class="sub">${status}${m.venue ? ` · ${escapeHtml(m.venue)}` : ''}</div>`;

  const s = m.stats;
  const rows = s ? [
    ['Possession', s.home.possession, s.away.possession, '%'],
    ['Shots', s.home.shots, s.away.shots],
    ['Shots on target', s.home.shotsOnTarget, s.away.shotsOnTarget],
    ['Corners', s.home.corners, s.away.corners],
    ['Passes', s.home.passes, s.away.passes],
    ['Pass accuracy', s.home.passAccuracy, s.away.passAccuracy, '%'],
    ['Saves', s.home.saves, s.away.saves],
    ['Fouls', s.home.fouls, s.away.fouls],
    ['Offsides', s.home.offsides, s.away.offsides],
    ['Yellow cards', s.home.yellow, s.away.yellow],
    ['Red cards', s.home.red, s.away.red],
  ] : [];
  $('#stats').innerHTML = rows.length ? rows.map(([name, h, a, unit = '']) => {
    const total = h + a || 1;
    return `<div class="stat"><div class="stat-row"><span>${h}${unit}</span><span>${name}</span><span>${a}${unit}</span></div>
      <div class="bar"><i style="width:${(h / total) * 100}%;background:${m.home.color}"></i><i style="width:${(a / total) * 100}%;background:${m.away.color}"></i></div></div>`;
  }).join('') : '<p class="muted">No stats yet.</p>';

  const icons = { goal: '⚽', penalty: '⚽', 'own-goal': '⚽', yellow: '🟨', red: '🟥', sub: '🔁', ht: '⏸', ft: '🏁' };
  const notable = m.events.filter((e) => e.type !== 'sub' || m.events.length < 40);
  $('#events').innerHTML = notable.length ? [...notable].reverse().map((e) => {
    const extra = e.type === 'own-goal' ? ' (OG)' : e.type === 'penalty' ? ' (pen)' : e.score ? ` ${e.score[0]}–${e.score[1]}` : '';
    const who = e.team ? `${escapeHtml(e.player || m[e.team].abbr)}${extra}` : e.type === 'ht' ? 'Half time' : 'Full time';
    return `<li class="${e.team || ''}"><span class="min">${escapeHtml(e.label)}</span><span>${icons[e.type] || '•'}</span><span>${who}</span></li>`;
  }).join('') : '<li class="muted">Nothing yet.</li>';

  $('#note').textContent = m.source === 'demo'
    ? 'Simulated match: all teams, players and stats are generated.'
    : 'Shot positions in 3D are illustrative — the Premier League feed provides shot totals, not locations. Goals, cards and subs use real minutes.';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ------------------------------------------------------------------ boot
window.__plStarted = true;
(async function boot() {
  // Draw something straight away; the Premier League API can take a few seconds.
  state.demoMatches = demoResults();
  show(state.demoMatches[0], true);
  try {
    state.seasons = await getSeasons();
    if (!state.seasons.length) throw new Error('no seasons returned');
    state.season = state.seasons[0].id;
    state.apiOk = true;
    setSource(true, 'Premier League data');
  } catch (err) {
    state.apiError = err.name === 'TimeoutError' ? 'no response within 15 seconds' : err.message;
    setSource(false, 'Demo mode · PL API offline');
  }
  await showTab(state.apiOk ? 'live' : 'demo');
})();
