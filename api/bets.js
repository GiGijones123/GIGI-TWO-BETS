// Bet log storage. Signed-in people get their bets saved to their account (free Upstash
// Redis database connected in Vercel), so they show on any phone. Guests keep bets on the phone.
import { hasDB, redis, readBody, currentUser, hashToObj } from '../lib/db.js';

const FIELDS = ['id', 'date', 'app', 'sport', 'desc', 'odds', 'stake', 'status', 'payout', 'grade', 'legs'];
const STATUS = ['pending', 'won', 'lost', 'push', 'cashout'];
const s = (v, n) => String(v ?? '').slice(0, n);

function cleanLeg(l) {
  return { pick: s(l.pick, 120), gameId: s(l.gameId, 20), league: s(l.league, 8), kind: s(l.kind, 10), est: Number(l.est) || null, odds: Number(l.odds) || null, grade: s(l.grade, 2), game: s(l.game, 40), tried: !!l.tried };
}
function clean(b) {
  const out = {};
  for (const f of FIELDS) if (b[f] !== undefined) out[f] = b[f];
  out.id = s(out.id, 40);
  out.desc = s(out.desc, 300);
  out.app = s(out.app, 40);
  out.sport = s(out.sport, 20);
  out.date = s(out.date, 10);
  out.odds = Number(out.odds) || 0;
  out.stake = Math.max(0, Number(out.stake) || 0);
  out.payout = out.payout === undefined || out.payout === null || out.payout === '' ? null : Number(out.payout);
  out.status = STATUS.includes(out.status) ? out.status : 'pending';
  out.grade = s(out.grade, 2);
  out.legs = Array.isArray(out.legs) ? out.legs.slice(0, 20).map(cleanLeg) : [];
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!hasDB()) return res.status(501).json({ error: 'No database connected', local: true });
  try {
    const user = await currentUser(req);
    if (!user) return res.status(501).json({ error: 'Not signed in', local: true, guest: true });
    const KEY = `bets:${user.id}`;
    if (req.method === 'GET') {
      const bets = Object.values(hashToObj(await redis(['HGETALL', KEY])));
      bets.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return res.status(200).json({ bets });
    }
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
