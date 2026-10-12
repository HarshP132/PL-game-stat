// Fetches from the Premier League data API. Shared by the local server
// (server.js) and the Vercel serverless function (api/pl.js).
export const API_BASE = (process.env.PL_API_BASE || 'https://footballapi.pulselive.com/football').replace(/\/$/, '');

/** apiPath is everything after /api/pl, e.g. "/fixtures?comps=1". Returns { status, body }. */
export async function fetchPL(apiPath) {
  try {
    const upstream = await fetch(API_BASE + apiPath, {
      headers: {
        // The API only answers requests that look like they come from premierleague.com.
        Origin: 'https://www.premierleague.com',
        Referer: 'https://www.premierleague.com/',
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (PL-game-stat visualiser)',
      },
      signal: AbortSignal.timeout(10_000),
    });
    return { status: upstream.status, body: await upstream.text() };
  } catch (err) {
    return { status: 502, body: JSON.stringify({ error: 'upstream_unreachable', message: err.message }) };
  }
}
