// Tiny helpers shared by the account, bets and alerts functions.
// Storage is a free Upstash Redis database connected in Vercel (Storage tab).
import crypto from 'node:crypto';

const URL_ = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const hasDB = () => !!(URL_() && TOKEN());

export async function redis(cmd) {
  const r = await fetch(URL_(), { method: 'POST', headers: { authorization: `Bearer ${TOKEN()}`, 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
export async function getJSONKey(key) { const v = await redis(['GET', key]); try { return v ? JSON.parse(v) : null; } catch { return null; } }
export const setJSONKey = (key, val, ex) => redis(ex ? ['SET', key, JSON.stringify(val), 'EX', ex] : ['SET', key, JSON.stringify(val)]);
export function hashToObj(h) { const out = {}; for (let i = 1; i < (h || []).length; i += 2) { try { out[h[i - 1]] = JSON.parse(h[i]); } catch {} } return out; }

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

// ---------- sessions ----------
export const COOKIE = 'gp_s';
const DAYS = 120;
export function cookieOf(req, name = COOKIE) {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie || '');
  return m ? decodeURIComponent(m[1]) : '';
}
export function setSessionCookie(req, res, token) {
  const secure = /^https/.test(req.headers['x-forwarded-proto'] || '') || process.env.VERCEL ? '; Secure' : '';
  res.setHeader('Set-Cookie', token
    ? `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAYS * 86400}${secure}`
    : `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}
export async function newSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await redis(['SET', `sess:${token}`, userId, 'EX', DAYS * 86400]);
  return token;
}
// The signed-in user for this request, or null.
export async function currentUser(req) {
  if (!hasDB()) return null;
  const token = cookieOf(req);
  if (!token || token.length > 100) return null;
  const id = await redis(['GET', `sess:${token}`]);
  if (!id) return null;
  const u = await getJSONKey(`user:${id}`);
  return u ? { ...u, token } : null;
}

// ---------- passwords ----------
export function hashPassword(pw, salt = crypto.randomBytes(16).toString('base64url')) {
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('base64url');
  return { salt, hash };
}
export function checkPassword(pw, salt, hash) {
  const a = Buffer.from(hashPassword(pw, salt).hash);
  const b = Buffer.from(String(hash));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
