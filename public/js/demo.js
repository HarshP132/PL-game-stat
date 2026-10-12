// Offline match simulator. Powers Demo mode (and a fake "live" match) so the
// visualiser is fun to play with even when the Premier League API is unreachable.
import { DEMO_CLUBS, fixtureColors } from './teams.js';
import { seededRandom } from './rng.js';
import { placeShot } from './api.js';

const SURNAMES = ['Silva', 'Walker', 'Mendes', 'Okafor', 'Diallo', 'Larsen', 'Rossi', 'Kane', 'Murphy', 'Costa',
  'Bernard', 'Haaland', 'Nkunku', 'Ward', 'Fischer', 'Moreno', 'Adeyemi', 'Kovac', 'Dias', 'Mitchell', 'Ortega', 'Sato'];

export class MatchSimulator {
  constructor(homeAbbr, awayAbbr, seed = Date.now()) {
    const home = DEMO_CLUBS.find((c) => c.abbr === homeAbbr) || DEMO_CLUBS[0];
    const away = DEMO_CLUBS.find((c) => c.abbr === awayAbbr) || DEMO_CLUBS[1];
    this.rand = seededRandom(seed);
    const colors = fixtureColors(home.abbr, away.abbr);
    this.strength = { home: home.rating + 3, away: away.rating }; // home advantage
    this.ballMinutes = { home: 0, away: 0 };
    this.subsLeft = { home: 5, away: 5 };
    this.stoppage = 2 + Math.floor(this.rand() * 5);
    this.match = {
      id: `demo-${home.abbr}-${away.abbr}-${seed}`,
      source: 'demo',
      status: 'LIVE',
      minute: 0,
      clockLabel: "0'",
      kickoff: null,
      venue: `${home.name} Stadium (simulated)`,
      gameweek: null,
      home: { id: 'h', name: home.name, short: home.name, abbr: home.abbr, score: 0, color: colors.home },
      away: { id: 'a', name: away.name, short: away.name, abbr: away.abbr, score: 0, color: colors.away },
      stats: { home: emptyStats(), away: emptyStats() },
      events: [],
      shots: [],
    };
  }

  get finished() {
    return this.match.status === 'FT';
  }

  player() {
    return SURNAMES[Math.floor(this.rand() * SURNAMES.length)];
  }

  /** Advance one match minute. */
  step() {
    const m = this.match;
    if (this.finished) return m;
    const r = this.rand;
    m.minute += 1;
    m.clockLabel = m.minute > 90 ? `90+${m.minute - 90}'` : `${m.minute}'`;

    const homeEdge = this.strength.home / (this.strength.home + this.strength.away);
    const pHome = Math.min(0.8, Math.max(0.2, homeEdge + (r() - 0.5) * 0.5));
    const sides = { home: pHome, away: 1 - pHome };
    for (const side of ['home', 'away']) {
      const st = m.stats[side];
      this.ballMinutes[side] += sides[side];
      st.passes += Math.round(sides[side] * (8 + r() * 6));
      st.accuratePasses = Math.round(st.passes * (0.74 + this.strength[side] / 1000));
      st.passAccuracy = Math.round((st.accuratePasses / Math.max(1, st.passes)) * 100);
      if (r() < 0.11 * sides[side] * 2) st.corners += 1;
      if (r() < 0.12) st.fouls += 1;
      if (r() < 0.025) st.offsides += 1;
    }
    const total = this.ballMinutes.home + this.ballMinutes.away;
    m.stats.home.possession = Math.round((this.ballMinutes.home / total) * 100);
    m.stats.away.possession = 100 - m.stats.home.possession;

    if (r() < 0.27) this.shot(r() < pHome ? 'home' : 'away');
    if (r() < 0.035) this.card(r() < 0.5 ? 'home' : 'away', r() < 0.08 ? 'red' : 'yellow');
    if (m.minute > 55) {
      for (const side of ['home', 'away']) {
        if (this.subsLeft[side] > 0 && r() < 0.07) {
          this.subsLeft[side] -= 1;
          m.events.push({ type: 'sub', minute: m.minute, label: m.clockLabel, team: side, player: this.player() });
        }
      }
    }
    if (m.minute === 45) m.events.push({ type: 'ht', minute: 45, label: 'HT', team: null, player: '' });
    if (m.minute >= 90 + this.stoppage) {
      m.status = 'FT';
      m.events.push({ type: 'ft', minute: m.minute, label: 'FT', team: null, player: '' });
    }
    return m;
  }

  shot(side) {
    const m = this.match;
    const st = m.stats[side];
    const other = side === 'home' ? 'away' : 'home';
    const quality = this.strength[side] / 100;
    st.shots += 1;
    const onTarget = this.rand() < 0.3 + quality * 0.1;
    let goal = false;
    if (onTarget) {
      st.shotsOnTarget += 1;
      goal = this.rand() < 0.28 + quality * 0.06;
      if (!goal) m.stats[other].saves += 1;
    }
    const penalty = goal && this.rand() < 0.12;
    const player = this.player();
    m.shots.push(placeShot(this.rand, side, m.minute, onTarget, goal, penalty, player));
    if (goal) {
      m[side].score += 1;
      m.events.push({
        type: penalty ? 'penalty' : 'goal',
        minute: m.minute,
        label: m.clockLabel,
        team: side,
        player,
        score: [m.home.score, m.away.score],
      });
    }
  }

  card(side, type) {
    const m = this.match;
    m.stats[side][type] += 1;
    m.events.push({ type, minute: m.minute, label: m.clockLabel, team: side, player: this.player() });
  }

  runToEnd() {
    while (!this.finished) this.step();
    return this.match;
  }
}

function emptyStats() {
  return { possession: 50, shots: 0, shotsOnTarget: 0, corners: 0, fouls: 0, passes: 0, accuratePasses: 0,
    passAccuracy: 0, offsides: 0, yellow: 0, red: 0, saves: 0 };
}

/** A fixed set of simulated full-time matches for Demo mode. */
export function demoResults() {
  const pairs = [['ARS', 'CHE'], ['LIV', 'MCI'], ['MUN', 'TOT'], ['NEW', 'AVL'], ['BHA', 'WHU'], ['NFO', 'EVE']];
  return pairs.map(([h, a], i) => new MatchSimulator(h, a, 1000 + i * 7919).runToEnd());
}
