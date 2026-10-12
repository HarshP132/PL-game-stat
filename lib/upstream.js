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

/**
 * Work out which data source and upstream path a request is for. Handles both
 * "/api/espn/scoreboard?x=1" and the form Vercel's rewrite produces,
 * "/api/espn?path=scoreboard&x=1". Returns null for non-API requests.
 */
export function resolveApiRequest(rawUrl) {
  const url = new URL(rawUrl, 'http://localhost');
  const m = url.pathname.match(/^\/api\/(pl|espn)(\/.*)?$/);
  if (!m) return null;
  let apiPath = m[2] && m[2] !== '/' ? m[2] : `/${url.searchParams.get('path') || ''}`;
  url.searchParams.delete('path');
  const query = url.searchParams.toString();
  if (query) apiPath += `?${query}`;
  return { source: m[1], apiPath };
}

/** Vercel function handler for /api/<source>/*. */
export function vercelHandler(source) {
  return async function handler(req, res) {
    const { apiPath } = resolveApiRequest(req.url.startsWith('/api/') ? req.url : `/api/${source}${req.url}`) || { apiPath: '/' };
    const { status, body } = await fetchSource(source, apiPath);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // Let Vercel's CDN share responses between visitors for a few seconds.
    if (status === 200) res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
    res.status(status).send(body);
  };
}
