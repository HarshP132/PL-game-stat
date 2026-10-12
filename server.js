// Tiny zero-dependency server: serves the browser app and proxies the
// Premier League data API (which blocks direct browser requests via CORS).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');
const PORT = Number(process.env.PORT) || 3000;
const API_BASE = (process.env.PL_API_BASE || 'https://footballapi.pulselive.com/football').replace(/\/$/, '');
const CACHE_TTL_MS = 10_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const cache = new Map();

async function proxy(req, res, apiPath) {
  const target = API_BASE + apiPath;
  const hit = cache.get(target);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return send(res, hit.status, hit.body, 'application/json; charset=utf-8');
  }
  try {
    const upstream = await fetch(target, {
      headers: {
        Origin: 'https://www.premierleague.com',
        Referer: 'https://www.premierleague.com/',
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (PL-game-stat visualiser)',
      },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await upstream.text();
    if (upstream.ok) cache.set(target, { at: Date.now(), status: upstream.status, body });
    send(res, upstream.status, body, 'application/json; charset=utf-8');
  } catch (err) {
    send(res, 502, JSON.stringify({ error: 'upstream_unreachable', message: err.message }), 'application/json; charset=utf-8');
  }
}

async function serveFile(res, baseDir, relPath) {
  const filePath = path.normalize(path.join(baseDir, relPath));
  if (!filePath.startsWith(baseDir)) return send(res, 403, 'Forbidden');
  try {
    const data = await fs.readFile(filePath);
    send(res, 200, data, MIME[path.extname(filePath)] || 'application/octet-stream');
  } catch {
    send(res, 404, 'Not found');
  }
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = decodeURIComponent(url.pathname);

  if (p.startsWith('/api/pl/')) return proxy(req, res, p.slice('/api/pl'.length) + url.search);
  if (p.startsWith('/vendor/three/')) return serveFile(res, THREE_DIR, p.slice('/vendor/three/'.length));
  return serveFile(res, PUBLIC_DIR, p === '/' ? 'index.html' : p);
});

server.listen(PORT, () => {
  console.log(`PL 3D Stat Visualiser running at http://localhost:${PORT}`);
  console.log(`Proxying Premier League data from ${API_BASE}`);
});
