// Accounts: sign up, log in, log out, and "who am I".
// Passwords are salted and hashed (scrypt). The session lives in an HttpOnly cookie.
import crypto from 'node:crypto';
import { hasDB, redis, getJSONKey, setJSONKey, readBody, currentUser, newSession, setSessionCookie, hashPassword, checkPassword, cookieOf } from '../lib/db.js';

const pub = (u) => ({ id: u.id, name: u.name, email: u.email, created: u.created });
const emailOk = (e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!hasDB()) return res.status(501).json({ error: 'Accounts turn on once the free database is connected.', noDB: true });
  try {
    if (req.method === 'GET') {
      const u = await currentUser(req);
      return res.status(200).json({ user: u ? pub(u) : null });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = await readBody(req);
    const action = String(body.action || '');
    if (action === 'logout') {
      const token = cookieOf(req);
      if (token) await redis(['DEL', `sess:${token}`]).catch(() => {});
      setSessionCookie(req, res, '');
      return res.status(200).json({ ok: true });
    }
    const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
    const password = String(body.password || '');
    if (!emailOk(email)) return res.status(400).json({ error: 'Enter a real email address.' });
    // slow down password guessing: 10 tries per email per 15 minutes
    const tries = await redis(['INCR', `tries:${email}`]);
    if (tries === 1) await redis(['EXPIRE', `tries:${email}`, 900]);
    if (tries > 10) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes and try again.' });

    if (action === 'signup') {
      const name = String(body.name || '').trim().slice(0, 40);
      if (!name) return res.status(400).json({ error: 'Add your name.' });
      if (password.length < 8) return res.status(400).json({ error: 'Use at least 8 characters for your password.' });
      const id = crypto.randomUUID();
      const taken = await redis(['SET', `email:${email}`, id, 'NX']);
      if (taken !== 'OK') return res.status(409).json({ error: 'That email already has an account. Log in instead.' });
      const { salt, hash } = hashPassword(password);
      const user = { id, name, email, salt, hash, created: new Date().toISOString() };
      await setJSONKey(`user:${id}`, user);
      setSessionCookie(req, res, await newSession(id));
      await redis(['DEL', `tries:${email}`]);
      return res.status(200).json({ user: pub(user), isNew: true });
    }
    if (action === 'login') {
      const id = await redis(['GET', `email:${email}`]);
      const user = id ? await getJSONKey(`user:${id}`) : null;
      if (!user || !checkPassword(password, user.salt, user.hash)) return res.status(401).json({ error: 'Email or password is wrong.' });
      setSessionCookie(req, res, await newSession(id));
      await redis(['DEL', `tries:${email}`]);
      return res.status(200).json({ user: pub(user) });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
