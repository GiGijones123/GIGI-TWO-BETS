import { enrichPlays } from './plays.js';

// Helpers that read ESPN's free public JSON and turn it into small, tidy objects
// for the site. ESPN changes field names now and then, so every reader here is
// defensive: a missing field gives an empty value instead of an error.

export const LEAGUES = {
  nfl: { path: 'football/nfl', label: 'NFL', sport: 'football', head: 'nfl', k: 6.4, coverScale: 3 },
  nba: { path: 'basketball/nba', label: 'NBA', sport: 'basketball', head: 'nba', k: 7, coverScale: 2.5 },
  cfb: { path: 'football/college-football', label: 'College FB', sport: 'football', head: 'college-football', k: 7, coverScale: 2.5 },
  nhl: { path: 'hockey/nhl', label: 'NHL', sport: 'hockey', head: 'nhl', k: 1.2, coverScale: 6 },
};

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const SITE_V2 = 'https://site.api.espn.com/apis/v2/sports';
const WEB = 'https://site.web.api.espn.com/apis/common/v3/sports';

export function league(req) {
  const key = String(req.query?.league || 'nfl').toLowerCase();
  if (!LEAGUES[key]) throw Object.assign(new Error('Unknown league'), { status: 400 });
  return [key, LEAGUES[key]];
}

export async function getJSON(url, { timeout = 8000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (BetsDaily)' } });
    if (!r.ok) throw Object.assign(new Error(`ESPN ${r.status}`), { status: r.status === 404 ? 404 : 502 });
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export async function tryJSON(url, opts) {
  try { return await getJSON(url, opts); } catch { return null; }
}

// Wrap an API handler: sets edge caching so many viewers share one ESPN call.
export function handler(fn, { sMaxAge = 10, swr = 30 } = {}) {
  return async (req, res) => {
    try {
      const body = await fn(req, res);
      res.setHeader('Cache-Control', `public, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.status(200).send(JSON.stringify(body));
    } catch (e) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(e.status || 500).json({ error: e.message || 'Something went wrong' });
    }
  };
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/,/g, '');
  const n = parseFloat(s.includes('-') && !s.startsWith('-') ? s.split('-')[0] : s);
  return Number.isFinite(n) ? n : null;
};
export { num };

export const headshot = (L, id) => (id ? `https://a.espncdn.com/i/headshots/${L.head}/players/full/${id}.png` : '');

function team(c = {}) {
  const t = c.team || {};
  const rec = (c.records || c.record || []).find?.((r) => r.type === 'total' || r.name === 'overall' || r.name === 'All Splits') || (c.records || c.record || [])[0];
  return {
    id: t.id,
    abbr: t.abbreviation || '',
    name: t.shortDisplayName || t.name || t.displayName || '',
    full: t.displayName || '',
    logo: t.logo || t.logos?.[0]?.href || '',
    color: t.color ? `#${t.color}` : '#555',
    alt: t.alternateColor ? `#${t.alternateColor}` : '#999',
    record: rec?.summary || rec?.displayValue || '',
    score: c.score !== undefined && c.score !== '' ? num(c.score?.displayValue ?? c.score?.value ?? c.score) : null,
    winner: !!c.winner,
  };
}

function odds(o) {
  if (!o) return null;
  return {
    provider: o.provider?.name || 'Sportsbook',
    details: o.details || '',
    overUnder: num(o.overUnder),
    spread: num(o.spread), // home spread, negative = home favoured
    homeML: num(o.homeTeamOdds?.moneyLine ?? o.moneyline?.home?.close?.odds),
    awayML: num(o.awayTeamOdds?.moneyLine ?? o.moneyline?.away?.close?.odds),
    homeFav: o.homeTeamOdds?.favorite,
  };
}

export function normEvent(ev, key) {
  const comp = ev.competitions?.[0] || {};
  const st = comp.status || ev.status || {};
  const cs = comp.competitors || [];
  const home = cs.find((c) => c.homeAway === 'home') || cs[0] || {};
  const away = cs.find((c) => c.homeAway === 'away') || cs[1] || {};
  const sit = comp.situation || {};
  const H = team(home);
  const A = team(away);
  const poss = sit.possession;
  return {
    id: String(ev.id),
    league: key,
    date: ev.date || comp.date,
    name: ev.shortName || ev.name || '',
    state: st.type?.state || 'pre',
    detail: st.type?.shortDetail || st.type?.detail || '',
    period: st.period || 0,
    clock: st.displayClock || '',
    completed: !!st.type?.completed,
    home: { ...H, possession: !!poss && poss === H.id },
    away: { ...A, possession: !!poss && poss === A.id },
    odds: odds(comp.odds?.[0]),
    tv: (comp.broadcasts || []).flatMap((b) => b.names || []).join(', ') || comp.geoBroadcasts?.[0]?.media?.shortName || '',
    venue: comp.venue?.fullName || '',
    weather: ev.weather ? `${ev.weather.temperature ?? ''}° ${ev.weather.displayValue || ''}`.trim() : '',
    lastPlay: sit.lastPlay?.text || '',
    downDistance: sit.downDistanceText || sit.shortDownDistanceText || '',
    redZone: !!sit.isRedZone,
    homeWinPct: num(sit.lastPlay?.probability?.homeWinPercentage),
  };
}

// ---------- summary (one game) ----------

function statMap(keys = [], values = []) {
  const out = {};
  keys.forEach((k, i) => {
    const raw = values[i];
    if (/[-/]/.test(k) && typeof raw === 'string' && /\d[-/]\d/.test(raw)) {
      const [a, b] = k.split(/[-/]/);
      const [x, y] = raw.split(/[-/]/);
      out[a] = num(x);
      out[b] = num(y);
    }
    out[k] = typeof raw === 'string' && /^-?[\d.,]+$/.test(raw) ? num(raw) : raw;
  });
  if (out.totalRebounds !== undefined && out.rebounds === undefined) out.rebounds = out.totalRebounds;
  return out;
}

function boxPlayers(box = {}) {
  const players = {};
  const starters = {};
  for (const t of box.players || []) {
    const tid = t.team?.id;
    for (const cat of t.statistics || []) {
      const keys = cat.keys || cat.names || [];
      for (const a of cat.athletes || []) {
        const id = a.athlete?.id;
        if (!id) continue;
        const p = (players[id] ||= { id, name: a.athlete.displayName, teamId: tid, headshot: a.athlete.headshot?.href || '', stats: {} });
        Object.assign(p.stats, statMap(keys, a.stats || []));
        if (a.starter) (starters[tid] ||= []).push({ id, name: a.athlete.displayName, jersey: a.athlete.jersey, pos: a.athlete.position?.abbreviation || '', headshot: a.athlete.headshot?.href || '' });
      }
    }
  }
  return { players, starters };
}

const INJ = /\binjur(ed|y)\b|\bshaken up\b|\bleft the game\b|\bquestionable to return\b|\bout for the game\b|\bhelped off\b|\bcart(ed)? off\b|\bin the blue tent\b|\bconcussion\b/i;

function playsOf(sum, teamsById) {
  const list = [];
  const push = (p, teamId) => {
    if (!p || !p.text) return;
    const tid = p.team?.id || p.start?.team?.id || teamId;
    list.push({
      id: String(p.id || p.sequenceNumber || list.length),
      text: p.text,
      type: p.type?.text || '',
      period: p.period?.number || p.period || 0,
      periodLabel: p.period?.displayValue || '',
      clock: p.clock?.displayValue || '',
      team: teamsById[tid]?.abbr || '',
      teamId: tid ? String(tid) : '',
      participants: (p.participants || []).map((x) => String(x.athlete?.id || '')).filter(Boolean),
      scoreValue: num(p.scoreValue) || 0,
      scoring: !!p.scoringPlay,
      away: num(p.awayScore),
      home: num(p.homeScore),
      wall: p.wallclock || '',
      down: p.start?.shortDownDistanceText || p.start?.downDistanceText || '',
      injury: INJ.test(p.text),
    });
  };
  if (sum.drives) {
    for (const d of sum.drives.previous || []) for (const p of d.plays || []) push(p, d.team?.id);
    if (sum.drives.current) for (const p of sum.drives.current.plays || []) push(p, sum.drives.current.team?.id);
  } else if (Array.isArray(sum.plays)) {
    for (const p of sum.plays) push(p);
  }
  // de-dupe (current drive can repeat the last previous drive)
  const seen = new Set();
  return list.filter((p) => (seen.has(p.id) ? false : seen.add(p.id))).reverse();
}

export function normSummary(sum, key) {
  const L = LEAGUES[key];
  const hc = sum.header?.competitions?.[0] || {};
  const g = normEvent({ id: sum.header?.id, date: hc.date, competitions: [hc], shortName: sum.header?.shortName }, key);
  // header lacks odds/situation; take them from other parts
  const pc = (sum.pickcenter || []).map(odds).filter(Boolean);
  if (pc[0] && (!g.odds || !g.odds.details)) g.odds = pc[0];
  const teamsById = { [g.home.id]: g.home, [g.away.id]: g.away };
  const { players, starters } = boxPlayers(sum.boxscore);
  const plays = playsOf(sum, teamsById);
  enrichPlays([...plays].reverse(), players, [String(g.away.id), String(g.home.id)], { [g.away.abbr]: String(g.away.id), [g.home.abbr]: String(g.home.id) }, L.sport, (id) => headshot(L, id));
  for (const p of plays) { delete p.participants; delete p.scoreValue; }
  if (!g.lastPlay && plays[0]) g.lastPlay = plays[0].text;
  if (sum.situation?.downDistanceText) g.downDistance = sum.situation.downDistanceText;
  const wp = sum.winprobability;
  if (Array.isArray(wp) && wp.length) {
    g.homeWinPct = num(wp[wp.length - 1].homeWinPercentage) * 100;
    // win chance swing on each play, from the side of the team that had the ball
    const byPlay = new Map(wp.filter((w) => w.playId).map((w) => [String(w.playId), num(w.homeWinPercentage)]));
    let prev = null;
    for (const p of [...plays].reverse()) {
      const h = byPlay.get(p.id);
      if (h === undefined || h === null) continue;
      if (prev !== null && p.teamId) {
        const d = (h - prev) * 100 * (p.teamId === String(g.home.id) ? 1 : -1);
        if (Math.abs(d) >= 0.5) p.swing = Math.round(d * 10) / 10;
      }
      prev = h;
    }
  }

  const injuries = {};
  for (const t of sum.injuries || []) {
    const tid = t.team?.id;
    injuries[tid] = (t.injuries || []).map((i) => ({
      id: i.athlete?.id,
      name: i.athlete?.displayName || '',
      pos: i.athlete?.position?.abbreviation || '',
      headshot: i.athlete?.headshot?.href || headshot(L, i.athlete?.id),
      status: i.status || i.type?.description || '',
      detail: [...new Set([i.details?.type, i.details?.detail, i.details?.side].filter((x) => x && !/not specified/i.test(x)))].join(' · ') || '',
      returnDate: i.details?.returnDate || '',
    }));
  }

  const lastFive = {};
  for (const t of sum.lastFiveGames || []) {
    lastFive[t.team?.id] = (t.events || []).map((e) => ({ result: e.gameResult || '', score: e.score || '', opp: e.opponent?.abbreviation || '', atVs: e.atVs || '', date: e.gameDate || '' }));
  }

  const leaders = [];
  for (const t of sum.leaders || []) {
    for (const cat of t.leaders || []) {
      const top = cat.leaders?.[0];
      if (top) leaders.push({ teamId: t.team?.id, cat: cat.displayName || cat.name, id: top.athlete?.id, name: top.athlete?.displayName, value: top.displayValue, headshot: top.athlete?.headshot?.href || headshot(L, top.athlete?.id) });
    }
  }

  const teamBox = (sum.boxscore?.teams || []).map((t) => ({
    id: t.team?.id,
    abbr: t.team?.abbreviation,
    stats: (t.statistics || []).map((s) => ({ name: s.name, label: s.label || s.displayName || s.name, value: s.displayValue })),
  }));

  const pred = sum.predictor;
  const predictor = pred ? { home: num(pred.homeTeam?.gameProjection), away: num(pred.awayTeam?.gameProjection) } : null;


  return {
    game: g,
    odds: pc,
    predictor,
    injuries,
    lastFive,
    leaders,
    teamBox,
    plays: plays.slice(0, 60),
    liveInjuries: plays.filter((p) => p.injury).slice(0, 10),
    box: players,
    starters,
    gameInfo: { venue: sum.gameInfo?.venue?.fullName || g.venue, weather: sum.gameInfo?.weather ? `${sum.gameInfo.weather.temperature ?? ''}° ${sum.gameInfo.weather.displayValue || ''}`.trim() : '' },
  };
}

export const urls = { SITE, SITE_V2, WEB };
