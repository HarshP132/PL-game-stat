// Tiny zero-dependency server: serves the browser app and proxies the
// Premier League data API (which blocks direct browser requests via CORS).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_BASE, fetchPL } from './lib/upstream.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
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
const JSON_TYPE = 'application/json; charset=utf-8';

async function proxy(req, res, apiPath) {
  const hit = cache.get(apiPath);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return send(res, 200, hit.body, JSON_TYPE);
  const { status, body } = await fetchPL(apiPath);
  if (status === 200) cache.set(apiPath, { at: Date.now(), body });
  send(res, status, body, JSON_TYPE);
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
  return serveFile(res, PUBLIC_DIR, p === '/' ? 'index.html' : p);
});

server.listen(PORT, () => {
  console.log(`PL 3D Stat Visualiser running at http://localhost:${PORT}`);
  console.log(`Proxying Premier League data from ${API_BASE}`);
});
