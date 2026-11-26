// Bet log storage. Uses a free Upstash Redis database when one is connected
// in Vercel (Storage tab). Without it the site keeps bets on the phone instead.
//
// Optional: set BETS_PASSCODE in Vercel so only people who know it can add or change bets.

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const PASS = process.env.BETS_PASSCODE || '';
const KEY = 'betsdaily:bets';

async function redis(cmd) {
  const r = await fetch(URL_, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

const FIELDS = ['id', 'date', 'app', 'sport', 'desc', 'odds', 'stake', 'status', 'payout'];
const STATUS = ['pending', 'won', 'lost', 'push', 'cashout'];

function clean(b) {
  const out = {};
  for (const f of FIELDS) if (b[f] !== undefined) out[f] = b[f];
  out.id = String(out.id || '').slice(0, 40);
  out.desc = String(out.desc || '').slice(0, 200);
  out.app = String(out.app || '').slice(0, 40);
  out.sport = String(out.sport || '').slice(0, 20);
  out.date = String(out.date || '').slice(0, 10);
  out.odds = Number(out.odds) || 0;
  out.stake = Math.max(0, Number(out.stake) || 0);
  out.payout = out.payout === undefined || out.payout === null || out.payout === '' ? null : Number(out.payout);
  out.status = STATUS.includes(out.status) ? out.status : 'pending';
  return out;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN) return res.status(501).json({ error: 'No database connected', local: true, needsPass: !!PASS });
  try {
    if (req.method === 'GET') {
      const h = (await redis(['HGETALL', KEY])) || [];
      const bets = [];
      for (let i = 1; i < h.length; i += 2) { try { bets.push(JSON.parse(h[i])); } catch {} }
      bets.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return res.status(200).json({ bets, needsPass: !!PASS });
    }
    if (PASS && req.headers['x-bets-pass'] !== PASS) return res.status(401).json({ error: 'Wrong passcode' });
    if (req.method === 'POST') {
      const body = await readBody(req);
      const list = Array.isArray(body.bets) ? body.bets : [body];
      const args = [];
      for (const b of list.slice(0, 500)) {
        const c = clean(b);
        if (!c.id || !c.desc) continue;
        args.push(c.id, JSON.stringify(c));
      }
      if (args.length) await redis(['HSET', KEY, ...args]);
      return res.status(200).json({ ok: true, saved: args.length / 2 });
    }
    if (req.method === 'DELETE') {
      const id = String(req.query?.id || '');
      if (!id) return res.status(400).json({ error: 'Missing id' });
      await redis(['HDEL', KEY, id]);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
