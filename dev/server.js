// Local test server: serves public/ and runs api/*.js the way Vercel does.
//   npm run dev    -> real ESPN data
//   npm run mock   -> made-up data from dev/mock-espn.js (works offline)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

if (process.env.ESPN_MOCK) {
  const { mockFetch } = await import('./mock-espn.js');
  const real = globalThis.fetch;
  globalThis.fetch = (url, opts) => (/espn\.com/.test(String(url)) ? mockFetch(String(url)) : real(url, opts));
  console.log('Using mock ESPN data');
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname.startsWith('/api/')) {
    const name = u.pathname.slice(5).replace(/[^a-z]/g, '');
    try {
      const mod = await import(join(root, 'api', `${name}.js`));
      req.query = Object.fromEntries(u.searchParams);
      res.status = (c) => { res.statusCode = c; return res; };
      res.json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      res.send = (b) => res.end(b);
      return await mod.default(req, res);
    } catch (e) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: e.message }));
    }
  }
  const path = normalize(u.pathname === '/' ? '/index.html' : u.pathname).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(root, 'public', path));
    res.setHeader('content-type', TYPES[extname(path)] || 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
}).listen(PORT, () => console.log(`GIGI Picks on http://localhost:${PORT}`));
