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
  // Fake AI too, so AI Check can be tried without a key or any cost.
  if (!process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = 'mock';
    process.env.ANTHROPIC_BASE_URL = `http://localhost:${Number(process.env.PORT) || 3000}/mock-ai`;
  }
}
const mockAI = (body) => {
  const read = !!body.output_config?.format?.schema?.properties?.readable;
  const out = read
    ? { readable: true, problem: '', app: 'DraftKings', betType: 'parlay', stake: 10, payout: 26.4, odds: 164, placed: '', legs: [
        { text: 'Amon-Ra St. Brown over 80.5 receiving yards', sport: 'NFL', player: 'Amon-Ra St. Brown', team: 'DET', opponent: 'CHI', market: 'receiving_yards', line: 80.5, side: 'over', odds: -115, status: 'open' },
        { text: 'Lions -3.5', sport: 'NFL', player: '', team: 'Lions', opponent: 'Bears', market: 'spread', line: -3.5, side: 'team', odds: -110, status: 'open' }] }
    : { grade: 'B', verdict: 'okay', headline: 'Solid, but the spread is tight', summary: 'St. Brown clears this line most weeks. The Lions spread is close to a coin flip.', legs: [
        { index: 0, call: 'keep', why: 'He beat 80.5 in 4 of his last 5 games and averages 92 yards.', change: '' },
        { index: 1, call: 'change', why: 'ESPN gives Detroit about 58%, which is closer to a 2.5 point edge.', change: 'Take Lions moneyline or buy down to -2.5' }], tips: ['Two-leg parlays pay more but both must hit.', 'Check injury news an hour before kickoff.'] };
  return { id: 'msg_mock', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(out) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
};

// MOCK_DB=1 fakes the Upstash Redis database in memory, so accounts and alerts can be tried locally.
const MEM = new Map();
if (process.env.MOCK_DB) {
  process.env.KV_REST_API_URL = `http://localhost:${PORT}/mock-redis`;
  process.env.KV_REST_API_TOKEN = 'mock';
}
function mockRedis([cmd, key, ...a]) {
  const now = Date.now();
  const e = MEM.get(key); if (e && e.exp && e.exp < now) MEM.delete(key);
  const get = () => MEM.get(key)?.v;
  const put = (v, exp = MEM.get(key)?.exp) => MEM.set(key, { v, exp });
  switch (String(cmd).toUpperCase()) {
    case 'GET': return get() ?? null;
    case 'SET': { const nx = a.includes('NX'); if (nx && get() !== undefined) return null; const i = a.indexOf('EX'); put(a[0], i > 0 ? now + Number(a[i + 1]) * 1000 : undefined); return 'OK'; }
    case 'DEL': return MEM.delete(key) ? 1 : 0;
    case 'INCR': { const v = Number(get() || 0) + 1; put(String(v)); return v; }
    case 'EXPIRE': { const x = MEM.get(key); if (x) x.exp = now + Number(a[0]) * 1000; return x ? 1 : 0; }
    case 'HSET': { const h = get() || {}; let n = 0; for (let i = 0; i < a.length; i += 2) { if (!(a[i] in h)) n++; h[a[i]] = a[i + 1]; } put(h); return n; }
    case 'HGETALL': return Object.entries(get() || {}).flat();
    case 'HDEL': { const h = get() || {}; let n = 0; for (const f of a) if (f in h) { delete h[f]; n++; } put(h); return n; }
    case 'HLEN': return Object.keys(get() || {}).length;
    case 'SADD': { const s = get() || []; let n = 0; for (const m of a) if (!s.includes(m)) { s.push(m); n++; } put(s); return n; }
    case 'SMEMBERS': return get() || [];
    default: throw new Error('mock redis: ' + cmd);
  }
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname.startsWith('/mock-ai/')) {
    let s = ''; for await (const c of req) s += c;
    await new Promise((r) => setTimeout(r, 800));
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify(mockAI(JSON.parse(s))));
  }
  if (u.pathname.startsWith('/mock-redis')) {
    let s = ''; for await (const c of req) s += c;
    res.setHeader('content-type', 'application/json');
    try { return res.end(JSON.stringify({ result: mockRedis(JSON.parse(s)) })); } catch (e) { return res.end(JSON.stringify({ error: e.message })); }
  }
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
