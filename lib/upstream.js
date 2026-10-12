// Fetches from the football data sources. Shared by the local server
// (server.js) and the Vercel serverless functions (api/pl.js, api/espn.js).
export const SOURCES = {
  // Premier League website data (unofficial, only answers "premierleague.com" requests).
  pl: {
    base: (process.env.PL_API_BASE || 'https://footballapi.pulselive.com/football').replace(/\/$/, ''),
    headers: { Origin: 'https://www.premierleague.com', Referer: 'https://www.premierleague.com/' },
  },
  // ESPN's public Premier League feed (unofficial, no key needed).
  espn: {
    base: 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1',
    headers: {},
  },
};

/** apiPath is everything after /api/<source>, e.g. "/scoreboard?dates=20251004". Returns { status, body }. */
export async function fetchSource(source, apiPath) {
  const { base, headers } = SOURCES[source];
  try {
    const upstream = await fetch(base + apiPath, {
      headers: { ...headers, Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (PL-game-stat visualiser)' },
      signal: AbortSignal.timeout(10_000),
    });
    return { status: upstream.status, body: await upstream.text() };
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? 'timed out after 10s' : err.cause?.code || err.cause?.message || err.message;
    return { status: 502, body: JSON.stringify({ error: 'upstream_unreachable', message: `could not reach ${base} (${reason})` }) };
  }
}

/** Vercel function handler for /api/<source>/* (vercel.json rewrites the path into ?path=). */
export function vercelHandler(source) {
  return async function handler(req, res) {
    const prefix = `/api/${source}/`;
    const url = new URL(req.url, 'http://localhost');
    let apiPath = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length - 1) : `/${url.searchParams.get('path') || ''}`;
    url.searchParams.delete('path');
    const query = url.searchParams.toString();
    if (query) apiPath += `?${query}`;

    const { status, body } = await fetchSource(source, apiPath);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // Let Vercel's CDN share responses between visitors for a few seconds.
    if (status === 200) res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
    res.status(status).send(body);
  };
}
