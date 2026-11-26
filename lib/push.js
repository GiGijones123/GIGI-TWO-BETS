// Phone alerts (Web Push). Keys are made once and kept in the database, so there is nothing to set up.
import webpush from 'web-push';
import { redis, getJSONKey, setJSONKey, hashToObj } from './db.js';

export async function vapid() {
  let k = await getJSONKey('push:vapid');
  if (!k) {
    const gen = webpush.generateVAPIDKeys();
    await redis(['SET', 'push:vapid', JSON.stringify(gen), 'NX']);
    k = await getJSONKey('push:vapid');
  }
  return k;
}

// Send to every phone this person turned alerts on for. Dead subscriptions get cleaned up.
export async function sendTo(userId, payload, site) {
  const k = await vapid();
  const subs = hashToObj(await redis(['HGETALL', `push:subs:${userId}`]));
  let sent = 0;
  for (const [id, sub] of Object.entries(subs)) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), { vapidDetails: { subject: site || 'https://my-gigipicks.vercel.app', publicKey: k.publicKey, privateKey: k.privateKey }, TTL: 3600, urgency: 'high' });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await redis(['HDEL', `push:subs:${userId}`, id]);
    }
  }
  return sent;
}
export { setJSONKey };
