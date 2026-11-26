// Every game for the chosen leagues, refreshed about every 10 seconds.
import { LEAGUES, urls, getJSON, tryJSON, handler, normEvent } from '../lib/espn.js';

// ESPN dates are in US Eastern for the "day" of a game.
function etDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 864e5);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return p.replace(/-/g, '');
}

export async function one(key) {
  const L = LEAGUES[key];
  const base = `${urls.SITE}/${L.path}/scoreboard`;
  let lists;
  if (key === 'nfl' || key === 'cfb') {
    // football scoreboards return the whole current week
    lists = [await getJSON(base + (key === 'cfb' ? '?groups=80&limit=200' : ''))];
  } else {
    lists = await Promise.all([tryJSON(`${base}?dates=${etDate(0)}`), tryJSON(`${base}?dates=${etDate(1)}`)]);
  }
  const seen = new Set();
  const games = [];
  for (const j of lists) for (const ev of j?.events || []) {
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    games.push(normEvent(ev, key));
  }
  // College football has dozens of games; keep live ones and ranked or televised matchups.
  return key === 'cfb' ? games.filter((g) => g.state === 'in' || g.tv).slice(0, 40) : games;
}

export default handler(async (req) => {
  const want = String(req.query?.leagues || 'nfl,nba').split(',').filter((k) => LEAGUES[k]);
  const results = await Promise.allSettled(want.map(one));
  const games = [];
  const errors = [];
  results.forEach((r, i) => (r.status === 'fulfilled' ? games.push(...r.value) : errors.push(want[i])));
  if (!games.length && errors.length) throw Object.assign(new Error('ESPN did not answer. Trying again shortly.'), { status: 502 });
  games.sort((a, b) => new Date(a.date) - new Date(b.date));
  return { updated: new Date().toISOString(), games, errors };
}, { sMaxAge: 8, swr: 20 });
