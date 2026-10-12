// Picks a working data provider: the Premier League's own feed first, then ESPN.
import * as premierLeague from './api.js';
import * as espn from './espn.js';

const PROVIDERS = [
  { name: 'Premier League', ...premierLeague },
  { name: 'ESPN', ...espn },
];

let active = null;

/** Try each provider in turn. Resolves to { name, seasons } or throws with every provider's error. */
export async function connect() {
  const errors = [];
  for (const provider of PROVIDERS) {
    try {
      const seasons = await provider.getSeasons();
      if (!seasons.length) throw new Error('no seasons returned');
      active = provider;
      return { name: provider.name, seasons };
    } catch (err) {
      errors.push(`${provider.name}: ${err.name === 'TimeoutError' ? 'no response within 15 seconds' : err.message}`);
    }
  }
  throw new Error(errors.join(' · '));
}

export const getFixtures = (opts) => active.getFixtures(opts);
export const getMatch = (id) => active.getMatch(id);
