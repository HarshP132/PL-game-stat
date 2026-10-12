// Data layer: talks to the Premier League API (through our local proxy) and
// normalises everything into a single match model consumed by the 3D scene.
import { fixtureColors } from './teams.js';
import { seededRandom } from './rng.js';

const BASE = '/api/pl';
const PL_COMPETITION_ID = 1;

async function getJSON(path) {
  const res = await fetch(BASE + path, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Premier League API returned ${res.status}`);
  return res.json();
}

export async function getSeasons() {
  const data = await getJSON(`/competitions/${PL_COMPETITION_ID}/compseasons?page=0&pageSize=100`);
  return (data.content || []).map((s) => ({ id: s.id, label: s.label }));
}

/** statuses: 'L' live, 'C' completed, 'U' upcoming (comma separated allowed). */
export async function getFixtures({ statuses = 'C', season, page = 0, pageSize = 30 } = {}) {
  const params = new URLSearchParams({
    comps: PL_COMPETITION_ID,
    page,
    pageSize,
    sort: statuses.includes('U') && !statuses.includes('C') ? 'asc' : 'desc',
    statuses,
    altIds: 'true',
  });
  if (season) params.set('compSeasons', season);
  const data = await getJSON(`/fixtures?${params}`);
  return {
    fixtures: (data.content || []).map(normaliseFixture),
    hasMore: data.pageInfo ? data.pageInfo.page < data.pageInfo.numPages - 1 : false,
  };
}

export async function getMatch(id) {
  const [fixture, stats] = await Promise.all([
    getJSON(`/fixtures/${id}?altIds=true`),
    getJSON(`/stats/match/${id}`).catch(() => null),
  ]);
  const match = normaliseFixture(fixture);
  match.stats = normaliseStats(stats, match);
  match.events = normaliseEvents(fixture, match);
  match.shots = synthesiseShots(match);
  return match;
}

function statusOf(s) {
  if (s === 'L') return 'LIVE';
  if (s === 'C') return 'FT';
  return 'UPCOMING';
}

function normaliseTeam(t) {
  const team = t.team || {};
  return {
    id: team.id,
    name: team.name || team.shortName || 'Unknown',
    short: team.shortName || team.name || '?',
    abbr: team.club?.abbr || (team.shortName || 'UNK').slice(0, 3).toUpperCase(),
    score: typeof t.score === 'number' ? t.score : 0,
  };
}

function normaliseFixture(f) {
  const [h, a] = f.teams || [];
  const home = normaliseTeam(h || {});
  const away = normaliseTeam(a || {});
  const colors = fixtureColors(home.abbr, away.abbr);
  home.color = colors.home;
  away.color = colors.away;
  const secs = f.clock?.secs;
  return {
    id: f.id,
    source: 'live',
    status: statusOf(f.status),
    minute: typeof secs === 'number' ? Math.max(1, Math.ceil(secs / 60)) : f.status === 'C' ? 90 : 0,
    clockLabel: f.clock?.label || '',
    kickoff: f.kickoff?.millis || null,
    venue: f.ground?.name || '',
    gameweek: f.gameweek?.gameweek || null,
    home,
    away,
    stats: null,
    events: [],
    shots: [],
  };
}

const STAT_KEYS = {
  possession: 'possession_percentage',
  shots: 'total_scoring_att',
  shotsOnTarget: 'ontarget_scoring_att',
  corners: 'won_corners',
  fouls: 'fk_foul_lost',
  passes: 'total_pass',
  accuratePasses: 'accurate_pass',
  offsides: 'total_offside',
  yellow: 'total_yel_card',
  red: 'total_red_card',
  saves: 'saves',
};

function readTeamStats(data, teamId) {
  const list = data?.[teamId]?.M || data?.[String(teamId)]?.M || [];
  const byName = Object.fromEntries(list.map((s) => [s.name, s.value]));
  const out = {};
  for (const [key, apiName] of Object.entries(STAT_KEYS)) out[key] = Number(byName[apiName] || 0);
  return out;
}

function normaliseStats(raw, match) {
  const data = raw?.data;
  const home = readTeamStats(data, match.home.id);
  const away = readTeamStats(data, match.away.id);
  if (!home.possession && !away.possession) {
    home.possession = 50;
    away.possession = 50;
  }
  for (const t of [home, away]) {
    t.passAccuracy = t.passes ? Math.round((t.accuratePasses / t.passes) * 100) : 0;
  }
  return { home, away };
}

function normaliseEvents(f, match) {
  const people = new Map();
  for (const list of f.teamLists || []) {
    for (const p of [...(list.lineup || []), ...(list.substitutes || [])]) {
      people.set(p.id, p.name?.display || [p.name?.first, p.name?.last].filter(Boolean).join(' '));
    }
  }
  const side = (teamId) => (teamId === match.home.id ? 'home' : teamId === match.away.id ? 'away' : null);
  const events = [];
  let score = [0, 0];

  const sorted = [...(f.events || [])].sort((x, y) => (x.clock?.secs || 0) - (y.clock?.secs || 0));
  for (const e of sorted) {
    const minute = Math.max(1, Math.ceil((e.clock?.secs || 0) / 60));
    const label = e.clock?.label ? e.clock.label.replace(/'00$/, "'").replace(/'\d\d$/, "'") : `${minute}'`;
    const player = people.get(e.personId) || '';
    const desc = String(e.description || '').toUpperCase();
    let team = side(e.teamId);

    if (e.type === 'G') {
      let next = score;
      if (e.score && typeof e.score.homeScore === 'number') next = [e.score.homeScore, e.score.awayScore];
      // The scoring side is whichever score went up (handles own goals cleanly).
      if (next[0] > score[0]) team = 'home';
      else if (next[1] > score[1]) team = 'away';
      else next = team === 'home' ? [score[0] + 1, score[1]] : [score[0], score[1] + 1];
      score = next;
      const type = desc === 'O' ? 'own-goal' : desc === 'P' ? 'penalty' : 'goal';
      events.push({ type, minute, label, team, player, score: [...score] });
    } else if (e.type === 'B') {
      events.push({ type: desc.includes('R') ? 'red' : 'yellow', minute, label, team, player });
    } else if (e.type === 'S' && desc === 'ON') {
      events.push({ type: 'sub', minute, label, team, player });
    } else if (e.type === 'PE' && (e.phase === '1' || e.phase === 1)) {
      events.push({ type: 'ht', minute: 45, label: 'HT', team: null, player: '' });
    }
  }
  if (match.status === 'FT') events.push({ type: 'ft', minute: Math.max(90, match.minute), label: 'FT', team: null, player: '' });
  return events;
}

/**
 * The public API exposes shot totals but not shot locations, so we lay shots out
 * deterministically (seeded by match id) to make the 3D view readable. Goals use
 * the real minutes; locations are illustrative.
 */
export function synthesiseShots(match) {
  const shots = [];
  for (const side of ['home', 'away']) {
    const s = match.stats?.[side] || {};
    const rand = seededRandom(`${match.id}-${side}`);
    const goals = match.events.filter((e) => e.team === side && (e.type === 'goal' || e.type === 'penalty'));
    const total = Math.max(s.shots || 0, goals.length);
    const onTarget = Math.max(s.shotsOnTarget || 0, goals.length);
    for (let i = 0; i < total; i++) {
      const goal = goals[i];
      const minute = goal ? goal.minute : 1 + Math.floor(rand() * Math.max(1, Math.min(match.minute || 90, 94)));
      shots.push(placeShot(rand, side, minute, i < onTarget, Boolean(goal), goal?.type === 'penalty', goal?.player));
    }
  }
  return shots.sort((a, b) => a.minute - b.minute);
}

export function placeShot(rand, team, minute, onTarget, goal, penalty = false, player = '') {
  const depth = penalty ? 11 : goal ? 6 + rand() * 14 : 7 + rand() * 24;
  const z = penalty ? 0 : (rand() - 0.5) * Math.min(36, depth * 1.6);
  const x = team === 'home' ? 52.5 - depth : -52.5 + depth;
  return { team, minute, x, z, onTarget, goal, player, seed: rand() };
}
