// Vercel serverless function: proxies /api/pl/* to the Premier League data API
// (vercel.json rewrites /api/pl/<path> to /api/pl?path=<path>).
import { fetchPL } from '../lib/upstream.js';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let apiPath = url.pathname.startsWith('/api/pl/') ? url.pathname.slice('/api/pl'.length) : `/${url.searchParams.get('path') || ''}`;
  url.searchParams.delete('path');
  const query = url.searchParams.toString();
  if (query) apiPath += `?${query}`;

  const { status, body } = await fetchPL(apiPath);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // Let Vercel's CDN share responses between visitors for a few seconds.
  if (status === 200) res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
  res.status(status).send(body);
}
