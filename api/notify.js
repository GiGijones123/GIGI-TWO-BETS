// Checks everyone's open bets and sends phone alerts. A free scheduler (cron-job.org) opens
// this page every few minutes; it does nothing more than once a minute, so extra visits are harmless.
import { hasDB, redis, hashToObj } from '../lib/db.js';
import { sendTo } from '../lib/push.js';
import { legState } from '../lib/legs.js';
import { LEAGUES, urls, tryJSON, normEvent } from '../lib/espn.js';

export const config = { maxDuration: 60 };

async function gameOf(cache, league, id) {
  const k = `${league}:${id}`;
  if (!(k in cache)) {
    const L = LEAGUES[league];
    const sum = L ? await tryJSON(`${urls.SITE}/${L.path}/summary?event=${id}`) : null;
    const hc = sum?.header?.competitions?.[0];
    cache[k] = hc ? normEvent({ id, date: hc.date, competitions: [hc], shortName: sum.header?.shortName }, league) : null;
  }
  return cache[k];
}
const score = (g) => `${g.away.abbr} ${g.away.score ?? 0}-${g.home.score ?? 0} ${g.home.abbr}`;
const money = (b) => { const st = Number(b.stake) || 0; const o = Number(b.odds) || 0; const win = o > 0 ? (st * o) / 100 : o < 0 ? (st * 100) / Math.abs(o) : 0; return win ? ` +$${win.toFixed(2)}` : ''; };

// Work out which alerts one person should get right now. `once(key)` is true the first time only.
export async function alertsFor(bets, once, cache) {
  const out = [];
  for (const b of bets) {
    const legs = b.legs;
    const states = [];
    for (const l of legs) states.push({ l, g: l.gameId && l.league ? await gameOf(cache, l.league, l.gameId) : null });
    for (const x of states) x.s = legState(x.l, x.g);
    const parlay = legs.length > 1;
    const started = new Set();
    for (const [i, x] of states.entries()) {
      if (!x.s || !x.g) continue;
      if (x.s.st !== 'pre' && !started.has(x.g.id)) {
        started.add(x.g.id);
        if (await once(`${b.id}:g${x.g.id}:start`) && x.g.state === 'in') {
          const picks = states.filter((y) => y.g?.id === x.g.id).map((y) => y.l.pick).join(', ');
          out.push({ title: `${x.g.league === 'nba' ? '🏀' : '🏈'} ${x.g.away.abbr} @ ${x.g.home.abbr} just started`, body: `Your pick: ${picks}`, url: `/#/game/${x.l.league}/${x.g.id}` });
        }
      }
      if (x.s.st === 'hit' && await once(`${b.id}:${i}:hit`)) out.push({ title: `✅ ${x.l.pick} hit!`, body: `${score(x.g)}${parlay ? ` · ${states.filter((y) => y.s?.st === 'hit').length} of ${legs.length} legs in` : ''}`, url: '/#/bets' });
      if (x.s.st === 'miss' && await once(`${b.id}:${i}:miss`)) out.push({ title: `❌ ${x.l.pick} missed`, body: `${score(x.g)}${parlay ? ' · this parlay is done' : ''}`, url: '/#/bets' });
      if (x.s.st === 'live' && x.s.close && await once(`${b.id}:${i}:close`)) out.push({ title: `😬 Down to the wire: ${x.l.pick}`, body: `${score(x.g)} · ${x.g.detail || 'late in the game'}`, url: `/#/game/${x.l.league}/${x.g.id}` });
    }
    const done = states.filter((x) => x.s?.st === 'hit' || x.s?.st === 'push').length;
    const anyMiss = states.some((x) => x.s?.st === 'miss');
    if (parlay && !anyMiss && done === legs.length && await once(`${b.id}:won`)) out.push({ title: '💰 Your parlay hit!', body: `${legs.length} for ${legs.length}${money(b)}. Mark it won in My bets.`, url: '/#/bets' });
    if (parlay && !anyMiss && done === legs.length - 1) {
      const left = states.find((x) => !(x.s?.st === 'hit' || x.s?.st === 'push'));
      if (left?.s && await once(`${b.id}:oneleft`)) out.push({ title: '🔥 One leg away', body: `Only ${left.l.pick} left${left.g ? ` (${left.g.state === 'pre' ? 'not started yet' : score(left.g)})` : ''}`, url: '/#/bets' });
    }
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!hasDB()) return res.status(501).json({ error: 'No database connected' });
  try {
    const free = await redis(['SET', 'push:lock', '1', 'NX', 'EX', 50]);
    if (free !== 'OK') return res.status(200).json({ ok: true, skipped: 'ran less than a minute ago' });
    const site = `https://${req.headers.host}`;
    const users = (await redis(['SMEMBERS', 'push:users'])) || [];
    const cache = {};
    let alerts = 0;
    for (const uid of users) {
      const bets = Object.values(hashToObj(await redis(['HGETALL', `bets:${uid}`]))).filter((b) => b.status === 'pending' && b.legs?.length);
      const once = async (key) => (await redis(['SADD', `push:sent:${uid}`, key])) === 1;
      const out = await alertsFor(bets, once, cache);
      for (const p of out.slice(0, 6)) { await sendTo(uid, p, site); alerts++; }
      if (out.length) await redis(['EXPIRE', `push:sent:${uid}`, 60 * 86400]);
    }
    return res.status(200).json({ ok: true, users: users.length, alerts });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
