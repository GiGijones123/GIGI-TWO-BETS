// Turn phone alerts on or off for the signed-in person, and send a test alert.
import crypto from 'node:crypto';
import { hasDB, redis, readBody, currentUser } from '../lib/db.js';
import { vapid, sendTo } from '../lib/push.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!hasDB()) return res.status(501).json({ error: 'Alerts turn on once the free database is connected.', noDB: true });
  try {
    if (req.method === 'GET') {
      const k = await vapid();
      const user = await currentUser(req);
      const n = user ? await redis(['HLEN', `push:subs:${user.id}`]) : 0;
      return res.status(200).json({ publicKey: k.publicKey, signedIn: !!user, phones: n || 0 });
    }
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Log in first to turn on alerts.' });
    const body = await readBody(req);
    const site = `https://${req.headers.host}`;
    if (body.action === 'subscribe') {
      const sub = body.subscription;
      if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return res.status(400).json({ error: 'Bad subscription' });
      const id = crypto.createHash('sha256').update(sub.endpoint).digest('hex').slice(0, 24);
      await redis(['HSET', `push:subs:${user.id}`, id, JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } })]);
      await redis(['SADD', 'push:users', user.id]);
      await sendTo(user.id, { title: 'Alerts are on 🔔', body: 'We will ping you when your picks hit, miss or get close.', url: '/#/bets' }, site);
      return res.status(200).json({ ok: true });
    }
    if (body.action === 'unsubscribe') {
      const ep = String(body.endpoint || '');
      if (ep) await redis(['HDEL', `push:subs:${user.id}`, crypto.createHash('sha256').update(ep).digest('hex').slice(0, 24)]);
      return res.status(200).json({ ok: true });
    }
    if (body.action === 'test') {
      const n = await sendTo(user.id, { title: 'Test alert ✅', body: 'Alerts are working on this phone.', url: '/#/bets' }, site);
      return res.status(200).json({ ok: true, sent: n });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
