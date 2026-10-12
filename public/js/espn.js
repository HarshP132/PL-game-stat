// ESPN Premier League data provider (through our proxy). Produces the same
// match model as api.js so the rest of the app doesn't care where data came from.
import { getJSON } from './http.js';
import { fixtureColors } from './teams.js';
import { synthesiseShots } from './api.js';

const BASE = '/api/espn';
const DAY_MS = 86_400_000;
// ESPN abbreviations that differ from the Premier League's own.
const ABBR_ALIASES = { MNC: 'MCI', MAN: 'MUN', NOT: 'NFO', BRI: 'BHA', WHM: 'WHU', WLV: 'WOL', SPU: 'TOT' };

const ymd = (date) => date.toISOString().slice(0, 10).replace(/-/g, '');
const seasonCache = new Map();

/** ESPN has no season list, so build one from the calendar (seasons run August–May). */
export async function getSeasons() {
  await getJSON(`${BASE}/scoreboard`); // confirms the feed is reachable
  const now = new Date();
  const current = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return Array.from({ length: 6 }, (_, i) => {
    const y = current - i;
    return { id: y, label: `${y}/${String(y + 1).slice(2)}` };
  });
}

/** statuses: 'L' live, 'C' completed, 'U' upcoming. Pages are sliced client-side. */
export async function getFixtures({ statuses = 'C', season, page = 0, pageSize = 30 } = {}) {
  const now = Date.now();
  let events;
  if (statuses === 'L') {
    events = (await getJSON(`${BASE}/scoreboard?dates=${ymd(new Date(now - DAY_MS))}-${ymd(new Date(now + DAY_MS))}`)).events;
  } else if (statuses === 'U') {
    events = (await getJSON(`${BASE}/scoreboard?dates=${ymd(new Date(now))}-${ymd(new Date(now + 21 * DAY_MS))}&limit=100`)).events;
  } else {
    const y = season || new Date().getUTCFullYear();
    if (!seasonCache.has(y)) seasonCache.set(y, getJSON(`${BASE}/scoreboard?dates=${y}0801-${y + 1}0630&limit=500`).then((d) => d.events));
    try {
      events = await seasonCache.get(y);
    } catch (err) {
      seasonCache.delete(y);
      throw err;
    }
  }
  const want = { L: 'LIVE', C: 'FT', U: 'UPCOMING' }[statuses] || 'FT';
  const list = (events || []).map(normaliseEvent).filter((f) => f.status === want);
  list.sort((a, b) => (want === 'UPCOMING' ? a.kickoff - b.kickoff : b.kickoff - a.kickoff));
  const start = page * pageSize;
  return { fixtures: list.slice(start, start + pageSize), hasMore: list.length > start + pageSize };
}

export async function getMatch(id) {
  const d = await getJSON(`${BASE}/summary?event=${encodeURIComponent(id)}`);
  const comp = d.header?.competitions?.[0] || {};
  const match = normaliseEvent({ id, date: comp.date, status: comp.status, competitions: [comp] });
  match.venue = d.gameInfo?.venue?.fullName || match.venue;
  match.stats = normaliseStats(d.boxscore?.teams || [], match);
  match.events = normaliseKeyEvents(d.keyEvents || [], match);
  match.shots = synthesiseShots(match);
  return match;
}

function normaliseTeam(c = {}) {
  const t = c.team || {};
  const abbr = (t.abbreviation || (t.shortDisplayName || 'UNK').slice(0, 3)).toUpperCase();
  return {
    id: String(t.id ?? ''),
    name: t.displayName || t.name || 'Unknown',
    short: t.shortDisplayName || t.displayName || '?',
    abbr: ABBR_ALIASES[abbr] || abbr,
    score: Number(typeof c.score === 'object' ? c.score?.value : c.score) || 0,
  };
}

function parseMinute(text) {
  const m = /(\d+)'?(?:\s*\+\s*(\d+))?/.exec(text || '');
  return m ? Number(m[1]) + Number(m[2] || 0) : 0;
}

function normaliseEvent(e) {
  const comp = e.competitions?.[0] || {};
  const competitors = comp.competitors || [];
  const home = normaliseTeam(competitors.find((c) => c.homeAway === 'home') || competitors[0]);
  const away = normaliseTeam(competitors.find((c) => c.homeAway === 'away') || competitors[1]);
  const colors = fixtureColors(home.abbr, away.abbr);
  home.color = colors.home;
  away.color = colors.away;

  const status = comp.status || e.status || {};
  const type = status.type || {};
  const state = type.state === 'in' ? 'LIVE' : type.state === 'post' && type.completed !== false ? 'FT' : 'UPCOMING';
  const clock = status.displayClock && status.displayClock !== "0'" ? status.displayClock : '';
  const minute = state === 'FT' ? 90 : parseMinute(clock) || Math.ceil((status.clock || 0) / 60);
  return {
    id: String(e.id ?? comp.id),
    source: 'live',
    status: state,
    minute: Math.max(state === 'LIVE' ? 1 : 0, minute),
    clockLabel: type.shortDetail === 'HT' ? 'HT' : clock,
    kickoff: Date.parse(e.date || comp.date) || null,
    venue: comp.venue?.fullName || '',
    gameweek: null,
    home,
    away,
    stats: null,
    events: [],
    shots: [],
  };
}

function normaliseStats(teams, match) {
  const empty = () => ({ possession: 0, shots: 0, shotsOnTarget: 0, corners: 0, fouls: 0, passes: 0, accuratePasses: 0,
    passAccuracy: 0, offsides: 0, yellow: 0, red: 0, saves: 0 });
  const out = { home: empty(), away: empty() };
  for (const t of teams) {
    const side = t.homeAway || (String(t.team?.id) === match.home.id ? 'home' : 'away');
    const v = Object.fromEntries((t.statistics || []).map((s) => [s.name, parseFloat(s.displayValue ?? s.value) || 0]));
    Object.assign(out[side], {
      possession: v.possessionPct || 0,
      shots: v.totalShots || 0,
      shotsOnTarget: v.shotsOnTarget || 0,
      corners: v.wonCorners || 0,
      fouls: v.foulsCommitted || 0,
      passes: v.totalPasses || 0,
      accuratePasses: v.accuratePasses || 0,
      offsides: v.offsides || 0,
      yellow: v.yellowCards || 0,
      red: v.redCards || 0,
      saves: v.saves || 0,
    });
  }
  if (out.home.possession || out.away.possession) {
    out.home.possession = Math.round(out.home.possession || 100 - out.away.possession);
    out.away.possession = 100 - out.home.possession;
  } else {
    out.home.possession = out.away.possession = 50;
  }
  for (const s of [out.home, out.away]) s.passAccuracy = s.passes ? Math.round((s.accuratePasses / s.passes) * 100) : 0;
  return out;
}

function normaliseKeyEvents(keyEvents, match) {
  const events = [];
  const score = [0, 0];
  const side = (teamId) => (String(teamId) === match.home.id ? 'home' : String(teamId) === match.away.id ? 'away' : null);
  for (const ev of keyEvents) {
    const kind = `${ev.type?.type || ''} ${ev.type?.text || ''}`.toLowerCase();
    const label = ev.clock?.displayValue || '';
    const minute = parseMinute(label) || Math.max(1, Math.ceil((ev.clock?.value || 0) / 60));
    const team = side(ev.team?.id);
    const player = ev.participants?.[0]?.athlete?.displayName || '';
    const missed = /miss|saved/.test(kind);

    if (ev.scoringPlay || (kind.includes('goal') && !missed) || (kind.includes('penalty') && kind.includes('scored'))) {
      if (!team) continue;
      score[team === 'home' ? 0 : 1] += 1;
      const type = kind.includes('own') ? 'own-goal' : kind.includes('penalty') ? 'penalty' : 'goal';
      events.push({ type, minute, label: label || `${minute}'`, team, player, score: [...score] });
    } else if (kind.includes('yellow')) {
      events.push({ type: kind.includes('red') ? 'red' : 'yellow', minute, label, team, player });
    } else if (kind.includes('red')) {
      events.push({ type: 'red', minute, label, team, player });
    } else if (kind.includes('substitution')) {
      events.push({ type: 'sub', minute, label, team, player });
    } else if (kind.includes('halftime')) {
      events.push({ type: 'ht', minute: 45, label: 'HT', team: null, player: '' });
    }
  }
  // ESPN may attach an own goal to the conceding team; trust the final score if they disagree.
  if (score[0] !== match.home.score || score[1] !== match.away.score) {
    const tally = [0, 0];
    for (const e of events) {
      if (!e.score) continue;
      if (e.type === 'own-goal') e.team = e.team === 'home' ? 'away' : 'home';
      tally[e.team === 'home' ? 0 : 1] += 1;
      e.score = [...tally];
    }
  }
  if (match.status === 'FT') events.push({ type: 'ft', minute: Math.max(90, match.minute), label: 'FT', team: null, player: '' });
  return events;
}
