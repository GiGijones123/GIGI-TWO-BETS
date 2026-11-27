// GIGI Picks — live site. Plain JavaScript, no build step.
// Data comes from our own /api/* routes, which read ESPN's free public feeds.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const store = {
  get(k, d) { try { const v = localStorage.getItem('bd:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('bd:' + k, JSON.stringify(v)); } catch {} },
};

const LG = {
  nfl: { label: 'NFL', k: 6.4, cover: 3, tot: 1.5, hfa: 1.5, sport: 'football' },
  nba: { label: 'NBA', k: 7, cover: 2.5, tot: 0.8, hfa: 2, sport: 'basketball' },
  cfb: { label: 'College FB', k: 7, cover: 2.5, tot: 1.2, hfa: 2.5, sport: 'football' },
  nhl: { label: 'NHL', k: 1.2, cover: 6, tot: 6, hfa: 0.2, sport: 'hockey' },
};
const ALL_LEAGUES = ['nfl', 'nba', 'cfb', 'nhl'];

const S = {
  games: [], updated: null, err: false,
  sums: {}, teams: {}, players: {}, daily: null, news: null,
  filter: store.get('filter', 'all'),
  gameTab: 'matchup', side: 'away', unit: 'offense',
  bets: [], betsMode: 'local', betsNeedPass: false, period: 'week',
  lastSeen: {}, flash: new Set(), pickLists: {}, slip: [], autoProps: {}, user: null, noDB: false,
};

async function api(path, opts) {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `Error ${r.status}`), { status: r.status, body: j });
  return j;
}

// ---------- formatting ----------
const fmtTime = (d) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDay = (d) => {
  const x = new Date(d); const t = new Date();
  const day = (a) => new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const diff = Math.round((day(x) - day(t)) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return x.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
};
const ml = (v) => (v === null || v === undefined ? '' : v > 0 ? `+${v}` : `${v}`);
const sgn = (v) => (v > 0 ? `+${v}` : v === 0 ? 'PK' : `${v}`);
const money = (v) => `${v < 0 ? '-' : v > 0 ? '+' : ''}$${Math.abs(v).toFixed(Math.abs(v) >= 1000 ? 0 : 2).replace(/\.00$/, '')}`;
function countdown(iso) {
  let s = Math.max(0, Math.floor((new Date(iso) - Date.now()) / 1000));
  if (s <= 0) return 'Starting';
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  if (d) return `${d}d ${h}h ${m}m`;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
const periodName = (g) => {
  if (g.league === 'nhl') return g.period > 3 ? 'OT' : `P${g.period}`;
  if (g.league === 'nba') return g.period > 4 ? `OT${g.period - 4 > 1 ? g.period - 4 : ''}` : `Q${g.period}`;
  return g.period > 4 ? 'OT' : `Q${g.period}`;
};
const shortName = (n = '') => {
  const p = n.split(' ').filter(Boolean);
  if (p.length < 2) return n;
  let last = p[p.length - 1];
  if (/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(last) && p.length > 2) last = p[p.length - 2];
  return `${p[0][0]}.${last}`;
};
const initials = (n = '') => n.split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('');

// a team colour that stands out on the dark background
function tc(t, fallback) {
  const lum = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return 0; const n = parseInt(m[1], 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
  if (lum(t.color) > 0.28) return t.color;
  if (lum(t.alt) > 0.28) return t.alt;
  return fallback;
}
const colors = (g) => { const a = tc(g.away, '#36e2ff'); let h = tc(g.home, '#ff3d8b'); if (a === h) h = '#ff3d8b'; return [a, h]; };

function logo(t, cls = 'tlogo') {
  if (t.logo) return `<img class="${cls}" src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'tfall',textContent:'${esc(t.abbr)}',style:'background:${esc(t.color)}'}))">`;
  return `<span class="tfall" style="background:${esc(t.color)}">${esc(t.abbr)}</span>`;
}
const face = (src, name, cls = '') => src
  ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" onerror="this.outerHTML='<span class=&quot;ini&quot;>${esc(initials(name))}</span>'">`
  : `<span class="ini">${esc(initials(name))}</span>`;

// ---------- daily notes (hand-picked lines and notes, optional) ----------
async function loadDaily() {
  try {
    const d = await api('/data/daily.json');
    const age = (Date.now() - new Date(d.date + 'T12:00:00Z')) / 864e5;
    S.daily = age < 2.5 ? d : { ...d, picks: [], props: [], games: [], stale: true };
  } catch { S.daily = null; }
}
const gameKey = (g) => `${LG[g.league].label.split(' ')[0].toUpperCase()}:${g.away.abbr}@${g.home.abbr}`;
const curatedGame = (g) => S.daily?.games?.find((x) => x.key === gameKey(g));
const curatedPick = (g) => S.daily?.picks?.find((x) => x.game === gameKey(g));

// ---------- estimates ----------
function homeSpread(g, o) {
  if (!o) return null;
  const m = /([A-Z]{2,4})\s*([+-]?\d+(\.\d+)?)/.exec(o.details || '');
  if (m) {
    const v = parseFloat(m[2]);
    if (m[1] === g.home.abbr) return v;
    if (m[1] === g.away.abbr) return -v;
  }
  if (/even|pk|pick/i.test(o.details || '')) return 0;
  return o.spread ?? null;
}

// Players hurt during the game who have not come back (newest news wins).
function hurtList(sum) {
  const seen = new Map();
  for (const p of sum?.liveInjuries || []) for (const x of p.injured || []) { const k = String(x.id || x.name); if (!seen.has(k)) seen.set(k, x); }
  return [...seen.values()].filter((x) => !x.returned);
}
// How much one injury moves the expected margin, from what the player has done in this game.
function hurtWeight(g, sum, x) {
  const st = sum?.box?.[x.id]?.stats || {};
  const L = LG[g.league];
  if (L.sport === 'football') {
    if ((st.passingAttempts || 0) >= 3) return { w: 5, role: 'the starting QB' };
    if ((st.rushingAttempts || 0) >= 4 || (st.receptions || 0) >= 2 || (st.receivingYards || 0) >= 25 || (st.totalTackles || 0) >= 3) return { w: 1.5, role: 'a key player' };
    return { w: 0.7, role: '' };
  }
  if (L.sport === 'basketball') return (st.minutes || 0) >= 15 || (st.points || 0) >= 8 ? { w: 3, role: 'a main player' } : { w: 1, role: '' };
  return { w: 0, role: '' };
}

function estimate(g, sum, nA, nH, { ignoreHurt = false } = {}) {
  const L = LG[g.league];
  const o = sum?.odds?.[0] || g.odds;
  const reasons = [];
  let margin = null;
  let pH = sum?.predictor?.home;
  if (pH !== null && pH !== undefined) {
    pH = pH > 1 ? pH / 100 : pH;
    pH = clamp(pH, 0.02, 0.98);
    margin = L.k * Math.log(pH / (1 - pH));
    const fav = pH >= 0.5 ? g.home : g.away;
    reasons.push(`ESPN's model gives ${fav.name} a ${Math.round(Math.max(pH, 1 - pH) * 100)}% chance to win.`);
  }
  if (nA?.ppg && nH?.ppg && nA?.oppg && nH?.oppg) {
    const projH = (nH.ppg + nA.oppg) / 2 + L.hfa / 2;
    const projA = (nA.ppg + nH.oppg) / 2 - L.hfa / 2;
    const m2 = projH - projA;
    margin = margin === null ? m2 : (margin + m2) / 2;
  }
  const picks = [];
  const hs = homeSpread(g, o);
  // In-game injuries: shift the expected margin against the team that lost a player.
  const hurt = ignoreHurt ? [] : hurtList(sum);
  let shift = 0;
  for (const x of hurt) {
    const { w, role } = hurtWeight(g, sum, x);
    const isHome = x.team === g.home.abbr;
    if (!isHome && x.team !== g.away.abbr) continue;
    shift += isHome ? -w : w;
    reasons.push(`🚑 ${x.name} (${x.team})${role ? ', ' + role + ',' : ''} got hurt during the game and hasn't come back. That lowers ${isHome ? g.home.name : g.away.name}' chances, so the pick accounts for it.`);
  }
  if (shift) { if (margin === null && hs !== null) margin = -hs; if (margin !== null) margin += shift; }
  if (margin !== null && hs !== null && g.league !== 'nhl') {
    const diff = margin + hs; // > 0 means home beats the number
    const pct = clamp(50 + Math.abs(diff) * L.cover, 50, 66);
    const homeSide = diff > 0;
    const t = homeSide ? g.home : g.away;
    const line = homeSide ? hs : -hs;
    picks.push({ kind: 'spread', pick: `${t.abbr} ${sgn(line)}`, est: Math.round(pct), team: t, odds: -110 });
  }
  if (o?.overUnder && nA?.ppg && nH?.ppg && nA?.oppg && nH?.oppg) {
    const proj = (nH.ppg + nA.oppg) / 2 + (nA.ppg + nH.oppg) / 2;
    const d = proj - o.overUnder;
    picks.push({ kind: 'total', pick: `${d > 0 ? 'Over' : 'Under'} ${o.overUnder}`, est: Math.round(clamp(50 + Math.abs(d) * L.tot, 50, 64)), proj });
    reasons.push(`Season scoring points to about ${proj.toFixed(1)} total points; the line is ${o.overUnder}.`);
  }
  if (nA?.ppg && nH?.ppg) {
    reasons.push(`${g.away.name} score ${nA.ppg.toFixed(1)} and allow ${nA.oppg?.toFixed(1) ?? '?'} a game. ${g.home.name} score ${nH.ppg.toFixed(1)} and allow ${nH.oppg?.toFixed(1) ?? '?'}.`);
  }
  const outs = (tid) => (sum?.injuries?.[tid] || []).filter((i) => /out|ir|doubtful|suspend/i.test(i.status));
  const oa = outs(g.away.id); const oh = outs(g.home.id);
  if (oa.length || oh.length) reasons.push(`Missing: ${g.away.abbr} ${oa.length} (${oa.slice(0, 3).map((i) => i.name).join(', ') || 'none'}), ${g.home.abbr} ${oh.length} (${oh.slice(0, 3).map((i) => i.name).join(', ') || 'none'}).`);
  const lf = (tid) => { const l = sum?.lastFive?.[tid] || []; const w = l.filter((x) => x.result === 'W').length; return l.length ? `${w}-${l.length - w}` : ''; };
  if (lf(g.away.id) && lf(g.home.id)) reasons.push(`Last 5: ${g.away.abbr} ${lf(g.away.id)}, ${g.home.abbr} ${lf(g.home.id)}.`);

  picks.sort((a, b) => b.est - a.est);
  const cur = curatedPick(g);
  // A hand-picked pick stands until someone gets hurt; then the live numbers take over.
  if (cur && !(hurt.length && picks[0])) {
    if (hurt.length) reasons.push('Someone got hurt after this pick was made, so double-check it before betting.');
    const kind = /^(over|under)\b/i.test(cur.pick) ? 'total' : 'spread';
    return { top: { pick: cur.pick, est: cur.est, odds: cur.odds, book: cur.book, why: cur.why, curated: true, kind }, alt: picks.filter((x) => x.kind !== kind), reasons, hurt };
  }
  // After an injury, lead with the side pick so it is clear how the injury moved it.
  if (cur && hurt.length) { const sp = picks.find((x) => x.kind === 'spread'); if (sp) return { top: sp, alt: picks.filter((x) => x !== sp), reasons, hurt }; }
  return { top: picks[0] || null, alt: picks.slice(1), reasons, hurt };
}

// ---------- grades + parlay math ----------
// A pick's grade: how far its estimated chance is above what the odds need to break even.
const decOdds = (am) => { const a = Number(am) || -110; return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a); };
const amOdds = (dec) => (dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1)));
const breakEven = (am) => 100 / decOdds(am);
function gradeOf(est, odds = -110) {
  const edge = est - breakEven(odds);
  return edge >= 6 ? 'A' : edge >= 3.5 ? 'B' : edge >= 1.5 ? 'C' : edge >= 0 ? 'D' : 'F';
}
const kindLabel = { spread: 'Side', total: 'Total', prop: 'Player prop' };

// Player picks made from each key player's recent games. We pick a "safe line" a bit under what
// he usually does, then estimate how often he clears it. Real app lines may differ.
const PROP_STATS = { QB: ['passingYards'], RB: ['rushingYards', 'receptions'], WR: ['receivingYards', 'receptions'], TE: ['receivingYards', 'receptions'], NBA: ['points', 'rebounds', 'assists', 'threePointFieldGoalsMade'] };
const PROP_ODDS = -200;
async function loadPlayer(league, id) {
  const k = `${league}:${id}`;
  if (S.players[k]) return S.players[k];
  try { const p = await api(`/api/player?league=${league}&id=${id}`); S.players[k] = p; return p; } catch { return null; }
}
function propFromLog(p, stats) {
  let best = null;
  for (const st of stats) {
    const vals = (p.log?.games || []).map((x) => x.stats?.[st]).filter((v) => v !== null && v !== undefined).slice(0, 10);
    if (vals.length < 5) continue;
    const sorted = [...vals].sort((a, b) => a - b);
    const q = sorted[Math.floor(vals.length * 0.2)];
    const line = Math.floor(q) - 0.5;
    if (line < (st === 'threePointFieldGoalsMade' || st === 'receptions' || st === 'assists' || st === 'rebounds' ? 1.5 : 9.5)) continue;
    const hits = vals.filter((v) => v > line).length;
    const est = Math.round(((hits + 1) / (vals.length + 2)) * 88);
    const avg = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
    if (!best || est > best.est) best = { st, line, hits, n: vals.length, est, avg };
  }
  return best;
}
async function autoProps(g) {
  const c = S.autoProps[g.id];
  if (c && Date.now() - c.at < 20 * 60e3) return c.list;
  if (g.league === 'nhl' || g.league === 'cfb') return [];
  const [tA, tH] = await Promise.all([loadTeam(g.league, g.away.id), loadTeam(g.league, g.home.id)]);
  const cands = [];
  for (const [t, team] of [[tA, g.away], [tH, g.home]]) {
    if (!t?.lineup) continue;
    if (g.league === 'nba') for (const x of (t.lineup.starters || []).slice(0, 5)) cands.push({ ...x, pos: 'NBA', team });
    else {
      const off = t.lineup.offense || [];
      const take = (re, n) => off.filter((x) => re.test(x.label)).slice(0, n);
      for (const x of [...take(/^QB$/, 1), ...take(/^RB$|^HB$/, 1), ...take(/^WR$/, 2), ...take(/^TE$/, 1)]) cands.push({ ...x, pos: x.label === 'HB' ? 'RB' : x.label, team });
    }
  }
  const list = [];
  await Promise.all(cands.filter((x) => x.id).map(async (x) => {
    const p = await loadPlayer(g.league, x.id);
    if (!p || /out|doubt|injured reserve/i.test(p.bio?.injury || '')) return;
    const best = propFromLog(p, PROP_STATS[x.pos] || []);
    if (!best || best.est < 62) return;
    const name = p.bio?.name || x.name;
    const lbl = (STAT_LABEL[best.st] || best.st).toLowerCase();
    list.push({ id: `${g.id}:prop:${x.id}:${best.st}`, gameId: g.id, league: g.league, game: `${g.away.abbr} @ ${g.home.abbr}`, kind: 'prop', pick: `${name} over ${best.line} ${lbl}`, player: name, playerId: x.id, est: best.est, odds: PROP_ODDS, why: `Went over ${best.line} in ${best.hits} of his last ${best.n} games (averages ${best.avg}). Check your app's line; it may be higher.`, auto: true });
  }));
  const seen = new Set();
  const uniq = list.filter((x) => (seen.has(x.player) ? false : seen.add(x.player)));
  S.autoProps[g.id] = { at: Date.now(), list: uniq };
  return uniq;
}


// Every pick we have for one game (side, total, player props), best first.
function gamePicks(g, sum, nA, nH) {
  const e = estimate(g, sum, nA, nH);
  const hurt = new Set((e.hurt || []).map((x) => x.name));
  const out = new Set(Object.values(sum?.injuries || {}).flat().filter((i) => /out|injured reserve|\bir\b|doubt|susp/i.test(i.status)).map((i) => i.name));
  const list = [];
  const label = `${g.away.abbr} @ ${g.home.abbr}`;
  for (const p of [e.top, ...e.alt].filter(Boolean)) {
    const kind = p.kind || (/^(over|under)\b/i.test(p.pick) ? 'total' : 'spread');
    list.push({ id: `${g.id}:${kind}:${p.pick}`, gameId: g.id, league: g.league, game: label, kind, pick: p.pick, est: p.est, odds: p.odds || -110, why: p.why || (kind === 'total' && p.proj ? `Season scoring points to about ${p.proj.toFixed(1)} total points.` : kind === 'spread' ? "From ESPN's win model and both teams' season scoring." : ''), curated: !!p.curated });
  }
  for (const x of (S.daily?.props || []).filter((y) => y.game === gameKey(g))) {
    const bad = hurt.has(x.player) || out.has(x.player);
    list.push({ id: `${g.id}:prop:${x.player}:${x.stat}`, gameId: g.id, league: g.league, game: label, kind: 'prop', pick: `${x.player} ${x.lean} ${x.line} ${String(x.stat).toLowerCase()}`, est: x.est, odds: x.odds || -115, why: x.why, bad });
  }
  const have = new Set(list.filter((x) => x.kind === 'prop').map((x) => x.pick.split(' ').slice(0, 2).join(' ')));
  for (const x of S.autoProps[g.id]?.list || []) if (!have.has(x.player.split(' ').slice(0, 2).join(' ')) && !hurt.has(x.player) && !out.has(x.player)) list.push(x);
  list.sort((a, b) => (b.bad ? -99 : b.est - breakEven(b.odds)) - (a.bad ? -99 : a.est - breakEven(a.odds)));
  return { e, list };
}

// ---------- data loading + live polling ----------
let sbTimer = null;
async function loadScoreboard() {
  try {
    const j = await api(`/api/scoreboard?leagues=${ALL_LEAGUES.join(',')}`);
    for (const g of j.games) {
      const prev = S.lastSeen[g.id];
      if (g.lastPlay && prev && prev !== g.lastPlay) S.flash.add(g.id);
      if (g.lastPlay) S.lastSeen[g.id] = g.lastPlay;
    }
    S.games = j.games;
    S.updated = Date.now();
    S.err = false;
  } catch {
    S.err = true;
  }
  pulse();
  onData();
  clearTimeout(sbTimer);
  const anyLive = S.games.some((g) => g.state === 'in');
  const soon = S.games.some((g) => g.state === 'pre' && new Date(g.date) - Date.now() < 15 * 60e3);
  sbTimer = setTimeout(loadScoreboard, anyLive ? 10e3 : soon ? 30e3 : 90e3);
}

const inflight = new Map();
async function loadSum(league, id, maxAge = 60e3) {
  const c = S.sums[id];
  if (c && Date.now() - c.at < maxAge) return c.data;
  if (inflight.has(id)) return inflight.get(id);
  const p = api(`/api/game?league=${league}&id=${id}`).then((data) => {
    const old = S.sums[id]?.data;
    const lp = old?.liveInjuries?.[0]?.id;
    if (lp && data.liveInjuries?.[0]?.id !== lp) S.flash.add('inj' + id);
    S.sums[id] = { data, at: Date.now() };
    return data;
  }).catch(() => c?.data || null).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}
async function loadTeam(league, id) {
  const k = `${league}:${id}`;
  const c = S.teams[k];
  if (c && Date.now() - c.at < 15 * 60e3) return c.data;
  try { const data = await api(`/api/team?league=${league}&id=${id}`); S.teams[k] = { data, at: Date.now() }; return data; } catch { return c?.data || null; }
}

// Fetch game details for live games and those starting soon (for missing players and picks).
let warmBusy = false;
async function warmSummaries() {
  if (warmBusy) return;
  warmBusy = true;
  const want = S.games.filter((g) => (g.league === 'nfl' || g.league === 'nba') && (g.state === 'in' || (g.state === 'pre' && new Date(g.date) - Date.now() < 36 * 3600e3)));
  const queue = [...want];
  const work = async () => {
    while (queue.length) {
      const g = queue.shift();
      await loadSum(g.league, g.id, g.state === 'in' ? 20e3 : 10 * 60e3);
    }
  };
  await Promise.all([work(), work(), work(), work()]);
  warmBusy = false;
  if (route().name === 'games') renderGamesBody();
}

function pulse() {
  const el = $('#pulse');
  el.classList.toggle('on', !S.err && !!S.updated);
  el.classList.toggle('err', S.err);
  const live = S.games.filter((g) => g.state === 'in').length;
  $('#pulseText').textContent = S.err ? 'Reconnecting' : live ? `${live} live` : S.updated ? 'Up to date' : 'Connecting';
}

// ---------- router ----------
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [a, b, c] = h.split('/');
  if (a === 'game' && b && c) return { name: 'game', league: b, id: c };
  if (a === 'bets') return { name: 'bets' };
  if (a === 'news') return { name: 'news' };
  if (a === 'check') return { name: 'check' };
  if (a === 'guide') return { name: 'guide' };
  if (a === 'builder') return { name: 'builder' };
  if (a === 'season') return { name: 'season' };
  if (a === 'share' && b) return { name: 'share', code: b };
  if (a === 'import' && b) return { name: 'import', code: b };
  return { name: 'games' };
}
function setTab(name) {
  $$('#tabbar a').forEach((a) => { if (a.dataset.tab !== name) a.removeAttribute('aria-current'); else a.setAttribute('aria-current', 'page'); });
}
let gameTimer = null;
function render() {
  const r = route();
  clearTimeout(gameTimer);
  setTab(r.name === 'game' || r.name === 'season' ? 'games' : r.name === 'guide' ? 'bets' : r.name === 'share' ? 'builder' : r.name);
  if (r.name === 'games') renderGames();
  else if (r.name === 'game') renderGame(r);
  else if (r.name === 'season') renderSeason();
  else if (r.name === 'bets') renderBets();
  else if (r.name === 'check') renderCheck();
  else if (r.name === 'guide') renderGuide();
  else if (r.name === 'builder') renderBuilder();
  else if (r.name === 'share') renderShare(r);
  else if (r.name === 'import') { importBets(r.code); return; }
  else renderNews();
  const v = $('#view'); v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter');
}
function onData() {
  const r = route();
  if (r.name === 'bets') for (const el of $$('[data-lc]')) { const b = S.bets.find((x) => x.id === el.dataset.lc); if (b) el.innerHTML = liveChanceText(b); }
  const dlg = $('#sheet'); if (dlg?.open && dlg._bet) openBet(dlg._bet, true);
  if (r.name === 'games') { renderGamesBody(); warmSummaries(); }
  else if (r.name === 'game') renderGameLive(r);
}

// ---------- GAMES ----------
function renderGames() {
  const v = $('#view');
  v.innerHTML = `
    ${moveBanner()}
    ${viewSwitch('today')}
    <div id="myOpen"></div>
    <div id="tickerWrap"></div>
    <div class="chips" id="chips" role="group" aria-label="Sport">
      ${['all', ...ALL_LEAGUES].map((k) => `<button data-filter="${k}" aria-pressed="${S.filter === k}">${k === 'all' ? 'All sports' : LG[k].label}</button>`).join('')}
    </div>
    <div id="lists">${S.games.length ? '' : '<div class="games"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>'}</div>
    <p class="foot">Picks and percentages are estimates, not sure things. Bet only what you can afford to lose. Live data from ESPN.</p>`;
  if (S.games.length) renderGamesBody();
}

function setHTML(el, html) {
  if (!el || el._h === html) return;
  const x = el.firstElementChild?.scrollLeft;
  el.innerHTML = html;
  el._h = html;
  if (x && el.firstElementChild) el.firstElementChild.scrollLeft = x;
}

// Swap a box's content with a short slide-in, only when the thing it shows really changed.
function swapIn(box, html, id) {
  if (!box || box._h === html) return;
  const fresh = box._id !== undefined && box._id !== id;
  box.innerHTML = html;
  box._h = html; box._id = id;
  if (fresh) { box.classList.remove('popped'); void box.offsetWidth; box.classList.add('popped'); }
}

// Keep a list of plays in sync without redrawing it: old rows stay put (photos stay loaded),
// new plays slide in at the top.
function syncFeed(feed, plays, g) {
  if (!feed) return;
  const first = !feed._ready;
  const have = new Map([...feed.children].map((n) => [n.dataset.pid, n]));
  const nodes = plays.map((p) => {
    const html = playRow(p, g);
    const pid = String(p.id);
    let n = have.get(pid);
    if (n && n._h === html) return n;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    const fresh = wrap.firstElementChild;
    fresh.dataset.pid = pid; fresh._h = html;
    if (!first && !n) fresh.classList.add('slide-in');
    return fresh;
  });
  feed.replaceChildren(...nodes);
  feed._ready = true;
}

function renderGamesBody() {
  if (!$('#lists')) return;
  { const open = (S.bets || []).filter((b) => b.status === 'pending');
    setHTML($('#myOpen'), open.length ? `<div class="myopen"><div class="hd"><h3>Your open bets</h3><a href="#/bets" class="est">See all ›</a></div><div class="strip">${open.slice(0, 8).map((b) => { const bc = betChance(b); const pc = bc ? Math.round(bc.p * 100) : null; return `<button class="ob" data-openbet="${esc(b.id)}"><span class="obt">${esc(betLegs(b).length > 1 ? betLegs(b).length + '-leg parlay' : betLegs(b)[0]?.pick || b.desc)}</span><span class="obp ${pc === null ? '' : pc >= 60 ? 'good' : pc >= 35 ? 'mid' : 'bad'}">${pc === null ? '—' : pctTxt(bc.p)}</span><span class="obs">${bc?.live ? '🔴 live chance' : 'to hit'} · $${esc(b.stake)}</span></button>`; }).join('')}</div></div>` : ''); }
  const shown = S.games.filter((g) => S.filter === 'all' || g.league === S.filter);
  const live = shown.filter((g) => g.state === 'in');

  // live ticker: latest play + latest injury from each live game
  const items = [];
  for (const g of live) {
    const inj = S.sums[g.id]?.data?.liveInjuries?.[0];
    if (inj) items.push({ g, text: injShort(inj), inj: true, when: `${inj.periodLabel || periodName(g)} ${inj.clock}` });
    const lp = S.sums[g.id]?.data?.plays?.[0];
    if (lp || g.lastPlay) items.push({ g, text: lp ? playShort(lp) : g.lastPlay, when: `${periodName(g)} ${g.clock}` });
  }
  setHTML($('#tickerWrap'), items.length ? `<h2>Live feed <span class="count">${live.length} live</span></h2><div class="ticker">${items.map((t) => `
    <button class="tick ${t.inj ? 'inj' : ''} ${S.flash.has(t.inj ? 'inj' + t.g.id : t.g.id) ? 'flash' : ''}" data-go="${t.g.league}/${t.g.id}">
      <span class="h"><span>${t.inj ? '🚑 Injury' : '🔴 Last play'} · ${esc(t.g.away.abbr)} ${t.g.away.score ?? ''} – ${esc(t.g.home.abbr)} ${t.g.home.score ?? ''}</span><span>${esc(t.when)}</span></span>
      <p>${esc(t.text)}</p>
    </button>`).join('')}</div>` : '');


  if (!shown.length) {
    setHTML($('#lists'), `<div class="empty">No ${S.filter === 'all' ? '' : LG[S.filter].label + ' '}games on the board right now.</div>`);
    return;
  }
  const pre = shown.filter((g) => g.state === 'pre');
  const post = shown.filter((g) => g.state === 'post').sort((a, b) => new Date(b.date) - new Date(a.date)).filter((g) => Date.now() - new Date(g.date) < 36 * 3600e3);
  const byDay = {};
  for (const g of pre) (byDay[fmtDay(g.date)] ||= []).push(g);
  let html = '';
  if (live.length) html += `<h2>🔴 Live now <span class="count">${live.length}</span></h2><div class="games">${live.map(gameCard).join('')}</div>`;
  for (const [day, list] of Object.entries(byDay)) html += `<h2>${esc(day)} <span class="count">${list.length}</span></h2><div class="games">${list.map(gameCard).join('')}</div>`;
  if (post.length) html += `<h2>Final <span class="count">${post.length}</span></h2><div class="games">${post.map(gameCard).join('')}</div>`;
  setHTML($('#lists'), html);
  S.flash.clear();
}

function gameCard(g) {
  const sum = S.sums[g.id]?.data;
  const o = sum?.odds?.[0] || g.odds;
  const live = g.state === 'in';
  const post = g.state === 'post';
  const row = (t, other) => `
    <div class="trow">${logo(t)}
      <div><div class="tn">${esc(t.name)}${live && t.possession ? '<i class="poss" title="Has the ball"></i>' : ''}</div><div class="tr">${esc(t.record)}</div></div>
      ${g.state !== 'pre' ? `<div class="sc ${post && t.score < other.score ? 'lose' : ''}">${t.score ?? ''}</div>` : ''}
    </div>`;
  let when;
  if (live) when = `<div class="when"><span class="livepill"><i></i>LIVE</span><span class="clock">${esc(periodName(g))} ${esc(g.clock)}</span>${g.downDistance ? `<span class="lbl">${esc(g.downDistance)}</span>` : ''}</div>`;
  else if (post) when = `<div class="when"><span class="final">${esc(g.detail || 'Final')}</span><span class="lbl">${esc(fmtDay(g.date))}</span></div>`;
  else when = `<div class="when"><span><span class="lbl">Starts in</span><br><span class="cd" data-cd="${esc(g.date)}">${countdown(g.date)}</span></span><span class="lbl" style="text-align:right">${esc(fmtTime(g.date))}<br>${esc(g.tv || '')}</span></div>`;

  const outs = (t) => (sum?.injuries?.[t.id] || []).filter((i) => /out|ir|doubtful/i.test(i.status));
  const oa = outs(g.away); const oh = outs(g.home);
  const outLine = sum && (oa.length || oh.length) ? `<div class="outs"><b>Out:</b> ${oa.length ? `${esc(g.away.abbr)} ${esc(oa.slice(0, 2).map((i) => shortName(i.name)).join(', '))}${oa.length > 2 ? ` +${oa.length - 2}` : ''}` : ''}${oa.length && oh.length ? ' · ' : ''}${oh.length ? `${esc(g.home.abbr)} ${esc(oh.slice(0, 2).map((i) => shortName(i.name)).join(', '))}${oh.length > 2 ? ` +${oh.length - 2}` : ''}` : ''}</div>` : '';
  const e = g.state === 'pre' ? estimate(g, sum) : null;
  const inj = live ? sum?.liveInjuries?.[0] : null;
  return `
  <button class="gc ${live ? 'is-live' : ''}" data-go="${g.league}/${g.id}" style="--ca:${esc(g.away.color)};--ch:${esc(g.home.color)}" aria-label="${esc(g.away.full)} at ${esc(g.home.full)}">
    <div class="gtop"><span class="tag t-lg">${esc(LG[g.league].label)}</span><span>${esc(g.venue || '')}</span></div>
    ${row(g.away, g.home)}${row(g.home, g.away)}
    ${when}
    ${live && g.lastPlay ? `<div class="lp ${S.flash.has(g.id) ? 'flash' : ''}"><b>Last play</b>${esc(sum?.plays?.[0] ? playShort(sum.plays[0]) : g.lastPlay)}</div>` : ''}
    ${inj ? `<div class="lp inj"><b style="color:var(--loss)">Injury</b>${esc(injShort(inj))}</div>` : ''}
    ${o ? `<div class="odds">${o.details ? `<span><b>${g.league === 'nhl' ? 'Favorite' : 'Spread'}</b>${esc(o.details)}</span>` : ''}${o.overUnder ? `<span><b>O/U</b>${o.overUnder}</span>` : ''}${o.awayML ? `<span><b>ML</b>${esc(g.away.abbr)} ${ml(o.awayML)} · ${esc(g.home.abbr)} ${ml(o.homeML)}</span>` : ''}</div>` : ''}
    ${outLine}
    ${e?.top ? `<div><span class="tag t-pick">Pick: ${esc(e.top.pick)} · ${e.top.est}%</span></div>` : ''}
  </button>`;
}

// ---------- GAME SCREEN ----------
function findGame(r) {
  return S.games.find((g) => g.id === r.id) || S.sums[r.id]?.data?.game || null;
}

async function renderGame(r) {
  const v = $('#view');
  v.innerHTML = `<button class="back" data-back>‹ All games</button><div id="hero"><div class="skel" style="height:260px"></div></div>
    <div id="gpick"></div>
    <div id="wpBox"></div>
    <div class="stick"><div class="seg" id="gtabs">${['matchup', 'lineups', 'plays'].map((t) => `<button data-gtab="${t}" aria-pressed="${S.gameTab === t}">${t === 'matchup' ? 'Matchup' : t === 'lineups' ? 'Lineups' : 'Play by play'}</button>`).join('')}</div></div>
    <div id="gbody"><div class="skel"></div></div>`;
  window.scrollTo(0, 0);
  const sum = await loadSum(r.league, r.id, 8e3);
  if (route().id !== r.id) return;
  if (!sum && !findGame(r)) { $('#gbody').innerHTML = '<div class="empty">Could not load this game. Pull down to refresh or try again in a minute.</div>'; return; }
  renderGameLive(r);
  renderGamePick(r);
  renderGameBody(r);
  pollGame(r);
}

// Picks for this one game, right under the score. Re-worked on every update, so an injury moves it.
async function renderGamePick(r) {
  const box = $('#gpick');
  if (!box) return;
  const sum = S.sums[r.id]?.data;
  const g = S.games.find((x) => x.id === r.id) || sum?.game;
  if (!g) return;
  const [tA, tH] = await Promise.all([loadTeam(g.league, g.away.id), loadTeam(g.league, g.home.id)]);
  if (route().id !== r.id || !$('#gpick')) return;
  if (!S.autoProps[g.id] && g.state === 'pre') autoProps(g).then(() => { if (route().id === r.id) { $('#gpick')._h = null; renderGamePick(r); } });
  const { e, list } = gamePicks(g, sum, tA?.numbers, tH?.numbers);
  const base = estimate(g, sum, tA?.numbers, tH?.numbers, { ignoreHurt: true });
  const changed = e.top && base.top && base.top.pick !== e.top.pick;
  if (!list.length) { swapIn(box, '', 'none'); return; }
  const label = g.state === 'pre' ? 'Picks for this game' : g.state === 'in' ? 'Picks · updated live' : 'Pre-game picks';
  const inSlip = new Set((S.slip || []).map((x) => x.id));
  const slides = list.map((p, k) => `<div class="pslide">
      <div class="pk"><span>${kindLabel[p.kind]}${k === 0 ? ' · best pick' : ''}</span><span class="grade g${p.bad ? 'F' : gradeOf(p.est, p.odds)}">${p.bad ? 'F' : gradeOf(p.est, p.odds)}</span></div>
      <div class="p ${p.bad ? 'struck' : ''}">${esc(p.pick)}</div>
      <div class="pm"><span class="tag t-pick">${p.est}% estimated</span>${p.odds ? `<span class="est">${esc(ml(p.odds))}</span>` : ''}</div>
      ${changed && p.pick === e.top?.pick ? `<div class="chg">🔄 Changed after an injury · was ${esc(base.top.pick)}</div>` : ''}
      <p class="pw">${p.bad ? '⚠️ Hurt or ruled out, skip this one.' : esc(p.why || '')}</p>
      ${p.bad || g.state === 'post' ? '' : `<button class="addleg ${inSlip.has(p.id) ? 'on' : ''}" data-addleg="${esc(p.id)}">${inSlip.has(p.id) ? '✓ In your parlay' : '+ Add to parlay'}</button>`}
    </div>`).join('');
  const html = `<div class="sec pickcard">
    <div class="hd"><h3>${label}</h3>${list.length > 1 ? `<span class="est">swipe ‹ › ${list.length} picks</span>` : ''}</div>
    <div class="pop-in"><div class="pslides">${slides}</div>
    ${list.length > 1 ? `<div class="dots">${list.map((_, k) => `<i class="${k === 0 ? 'on' : ''}"></i>`).join('')}</div>` : ''}
    ${e.reasons.filter((x) => x.startsWith('🚑')).map((x) => `<p class="hurtnote">${esc(x)}</p>`).join('')}
    ${e.reasons.some((x) => !x.startsWith('🚑')) ? `<details class="whyd"><summary>Why these picks</summary><ul class="why">${e.reasons.filter((x) => !x.startsWith('🚑')).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}</div>
    <div class="est">Estimates from ESPN's win model, season scoring, the line and injuries. Not a sure thing.</div></div>`;
  S.pickLists[g.id] = list;
  const sc0 = $('.pslides', box); const x0 = sc0?.scrollLeft || 0;
  swapIn(box, html, `${e.top?.pick}|${(e.hurt || []).length}|${list.length}`);
  const sc = $('.pslides', box);
  if (sc && sc !== sc0) { sc.scrollLeft = x0; }
  if (sc && !sc._l) {
    sc._l = true;
    sc.addEventListener('scroll', () => { const k = Math.round(sc.scrollLeft / sc.clientWidth); $$('.dots i', box).forEach((d, n) => d.classList.toggle('on', n === k)); }, { passive: true });
  }
}

function pollGame(r) {
  clearTimeout(gameTimer);
  const g = findGame(r);
  const live = g?.state === 'in';
  gameTimer = setTimeout(async () => {
    if (route().id !== r.id) return;
    const before = S.sums[r.id]?.data?.plays?.[0]?.id;
    await loadSum(r.league, r.id, 0);
    if (route().id !== r.id) return;
    renderGameLive(r);
    renderGamePick(r);
    { const gg = S.games.find((x) => x.id === r.id) || S.sums[r.id]?.data?.game; if (gg) setHTML($('#whoMissing'), missingHTML(gg, S.sums[r.id]?.data)); }
    if (S.gameTab === 'plays' && S.sums[r.id]?.data?.plays?.[0]?.id !== before) renderGameBody(r);
    pollGame(r);
  }, live ? 8e3 : 60e3);
}

function renderGameLive(r) {
  const el = $('#hero');
  if (!el) return;
  const sum = S.sums[r.id]?.data;
  const sb = S.games.find((x) => x.id === r.id);
  // freshest of scoreboard and summary
  const g = sb && sum ? { ...sum.game, ...sb, odds: sb.odds || sum.game.odds } : sb || sum?.game;
  if (!g) return;
  if (g.state !== 'pre' && sum?.game?.wpLine?.length > 1) wpMount(g, sum.game.wpLine);
  const live = g.state === 'in';
  const post = g.state === 'post';
  let mid;
  if (live) mid = `<span class="livepill"><i></i>LIVE</span><span class="clock">${esc(periodName(g))} ${esc(g.clock)}</span>${g.downDistance ? `<span class="dd">${esc(g.downDistance)}${g.redZone ? ' · RED ZONE' : ''}</span>` : ''}`;
  else if (post) mid = `<span class="final">${esc(g.detail || 'Final')}</span>`;
  else mid = `<span class="lbl" style="font-size:12px;font-weight:800;color:var(--mute)">KICKOFF IN</span><span class="cd clock" data-cd="${esc(g.date)}" style="color:var(--gold)">${countdown(g.date)}</span><span class="dd" style="color:var(--mute)">${esc(fmtDay(g.date))} ${esc(fmtTime(g.date))}${g.tv ? ' · ' + esc(g.tv) : ''}</span>`;
  const side = (t) => `<div class="side">${logo(t)}<div class="tn">${esc(t.name)}${live && t.possession ? '<i class="poss"></i>' : ''}</div><div class="tr">${esc(t.record)}</div>${g.state !== 'pre' ? `<div class="big">${t.score ?? 0}</div>` : ''}</div>`;
  let wp = '';
  const hp = live || post ? g.homeWinPct : sum?.predictor?.home;
  if (hp !== null && hp !== undefined && !post) {
    const h = clamp(hp > 1 ? hp : hp * 100, 0, 100);
    wp = `<div class="wp"><div class="lab"><span>${esc(g.away.abbr)} ${Math.round(100 - h)}%</span><span>${live ? 'Win chance (live)' : 'Win chance (ESPN model)'}</span><span>${esc(g.home.abbr)} ${Math.round(h)}%</span></div><div class="trk"><i style="width:${100 - h}%;background:${esc(colors(g)[0])}"></i><i style="width:${h}%;background:${esc(colors(g)[1])}"></i></div></div>`;
  }
  const lastPlay = sum?.plays?.[0];
  const inj = sum?.liveInjuries?.[0];
  const top = `<div class="vs">${side(g.away)}<div class="mid">${mid}</div>${side(g.home)}</div>${wp}`;
  const playHTML = `<div class="k">${live ? 'Latest play' : 'Final play'} <span>${lastPlay ? esc(`${lastPlay.periodLabel || ''} ${lastPlay.clock}`) : ''}</span></div><div class="pop-in">${lastPlay ? playAnim(lastPlay, g.league) + actorsHTML(lastPlay, { compact: true }) : esc(g.lastPlay || 'Waiting for the first play')}</div>`;
  const injHTML = `<div class="k">Latest injury <span>${inj ? esc(`${inj.periodLabel || ''} ${inj.clock}`) : ''}</span></div><div class="pop-in">${inj ? (inj.injured?.length ? injuredHTML(inj) : esc(inj.text)) : 'No in-game injuries reported so far.'}</div>`;
  // Build the frame once per game, then only swap the parts that changed so nothing flickers.
  const key = `${g.id}:${live || post ? 1 : 0}`;
  if (el._key !== key) {
    el.innerHTML = `<div class="hero" style="--ca:${esc(g.away.color)};--ch:${esc(g.home.color)}"><div id="hTop"></div>${live || post ? '<div class="livebox" role="button" tabindex="0" aria-label="See every play"><div class="lb" id="hPlay"></div><div class="lb inj" id="hInj"></div><div class="seeall">See every play ›</div></div>' : ''}</div>`;
    el._key = key;
  }
  setHTML($('#hTop', el), top);
  swapIn($('#hPlay', el), playHTML, lastPlay?.id || g.lastPlay);
  swapIn($('#hInj', el), injHTML, inj?.id);
  S.flash.delete(g.id); S.flash.delete('inj' + g.id);
}

async function renderGameBody(r) {
  const body = $('#gbody');
  if (!body) return;
  const sum = S.sums[r.id]?.data;
  const g = S.games.find((x) => x.id === r.id) || sum?.game;
  if (!g) return;
  if (S.gameTab === 'plays') return renderPlays(body, g, sum);
  body.innerHTML = '<div class="skel"></div>';
  const [tA, tH] = await Promise.all([loadTeam(g.league, g.away.id), loadTeam(g.league, g.home.id)]);
  if (route().id !== r.id || !$('#gbody')) return;
  if (S.gameTab === 'matchup') renderMatchup(body, g, sum, tA, tH);
  else if (S.gameTab === 'lineups') renderLineups(body, g, sum, tA, tH);
}

function scale(label, a, h, g, { lowerBetter = false, fmt = (x) => x.toFixed(1), note = '' } = {}) {
  if (a === null || a === undefined || h === null || h === undefined) return '';
  const va = lowerBetter ? 1 / Math.max(a, 0.1) : a;
  const vh = lowerBetter ? 1 / Math.max(h, 0.1) : h;
  const pa = (va / (va + vh)) * 100;
  const [ca, ch] = colors(g);
  const better = Math.abs(pa - 50) < 2 ? 'Even' : pa > 50 ? `${g.away.abbr} better` : `${g.home.abbr} better`;
  return `<div class="scale"><div class="lab"><span>${esc(g.away.abbr)} ${fmt(a)}</span><span>${esc(label)}</span><span>${fmt(h)} ${esc(g.home.abbr)}</span></div>
    <div class="trk"><i style="width:${pa}%;background:${esc(ca)}"></i><i style="width:${100 - pa}%;background:${esc(ch)}"></i></div>
    <div class="v">${esc(better)}${note ? ' · ' + esc(note) : ''}</div></div>`;
}

function styleBar(t, n, L) {
  if (L.sport === 'football' && n?.passAtt && n?.rushAtt) {
    const p = (n.passAtt / (n.passAtt + n.rushAtt)) * 100;
    const lab = p >= 58 ? 'Pass-heavy' : p <= 48 ? 'Run-heavy' : 'Balanced';
    return `<div class="style"><div class="lab" style="display:flex;justify-content:space-between;font-weight:800;font-size:14px"><span>${esc(t.name)}</span><span class="tag">${lab}</span></div><div class="trk"><i style="width:${p}%;background:var(--cyan)">Pass ${Math.round(p)}%</i><i style="width:${100 - p}%;background:var(--orange)">Run ${Math.round(100 - p)}%</i></div></div>`;
  }
  if (L.sport === 'basketball' && n?.threeAtt && n?.fgAtt) {
    const p = (n.threeAtt / n.fgAtt) * 100;
    const lab = p >= 42 ? '3-point heavy' : p <= 35 ? 'Inside first' : 'Balanced';
    return `<div class="style"><div class="lab" style="display:flex;justify-content:space-between;font-weight:800;font-size:14px"><span>${esc(t.name)}</span><span class="tag">${lab}</span></div><div class="trk"><i style="width:${p}%;background:var(--cyan)">3PT ${Math.round(p)}%</i><i style="width:${100 - p}%;background:var(--orange)">2PT ${Math.round(100 - p)}%</i></div></div>`;
  }
  return '';
}

// Who's missing: players hurt during this game first (updates live), then the pre-game injury report.
function missingHTML(g, sum) {
  const latest = new Map();
  for (const p of sum?.liveInjuries || []) for (const x of p.injured || []) { const k = String(x.id || x.name); if (!latest.has(k)) latest.set(k, { ...x, when: `${p.periodLabel || (p.period ? 'Q' + p.period : '')} ${p.clock}`.trim() }); }
  const live = [...latest.values()];
  const tagCls = (st) => (/out|injured reserve|\bir\b|doubt|susp|pup/i.test(st) ? 't-out' : /quest|day/i.test(st) ? 't-q' : 't-ok');
  const row = (img, name, pos, detail, tag, cls) => `<div class="ip">${img ? `<img src="${esc(img)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<span class="ph"></span>'}<div><div class="nm">${esc(name)} ${pos ? `<span class="est">${esc(pos)}</span>` : ''}</div>${detail ? `<div class="dt">${esc(detail)}</div>` : ''}</div><span class="tag ${cls}">${esc(tag)}</span></div>`;
  const team = (t) => {
    const hurt = live.filter((x) => x.team === t.abbr);
    const names = new Set(hurt.map((x) => x.name));
    const list = (sum?.injuries?.[t.id] || []).filter((i) => !names.has(i.name));
    const rows = [
      ...hurt.map((x) => row(x.headshot, x.name, '', x.returned ? `Hurt earlier, back in the game` : `Hurt during the game${x.when ? ' · ' + x.when : ''}`, x.returned ? 'Back in' : 'Hurt in game', x.returned ? 't-ok' : 't-out live-hurt')),
      ...list.slice(0, 12).map((i) => row(i.headshot, i.name, i.pos, i.detail, i.status, tagCls(i.status))),
    ];
    return `<div class="tn" style="font-size:18px;margin-bottom:6px">${esc(t.name)}</div>${rows.length ? `<div class="inj">${rows.join('')}</div>` : '<div class="est">No injuries listed.</div>'}`;
  };
  return `<div class="hd"><h3>Who's missing</h3>${g.state === 'in' ? '<span class="est">updates live</span>' : ''}</div><div class="grid2"><div>${team(g.away)}</div><div>${team(g.home)}</div></div>`;
}

function renderMatchup(body, g, sum, tA, tH) {
  const L = LG[g.league];
  const nA = tA?.numbers; const nH = tH?.numbers;
  const e = estimate(g, sum, nA, nH);
  const cg = curatedGame(g);
  const books = sum?.odds?.length ? sum.odds : g.odds ? [g.odds] : [];
  const rk = (r, n) => (r ? ` (#${r}${n ? ' of ' + n : ''})` : '');

  // verdict sentence
  let verdict = '';
  if (nA?.ppg && nH?.ppg && nA?.oppg && nH?.oppg) {
    const off = nA.ppg - nH.ppg; const def = nH.oppg - nA.oppg;
    const tol = L.sport === 'basketball' ? 2 : 1.5;
    if (Math.abs(off) < tol && Math.abs(def) < tol) verdict = 'These two are about even';
    else verdict = `${Math.abs(off) < tol ? 'Even on offense' : `${off > 0 ? g.away.name : g.home.name} have the better offense`}. ${Math.abs(def) < tol ? 'Even on defense' : `${def > 0 ? g.away.name : g.home.name} have the better defense`}.`;
  }
  const form = (t) => {
    const l = sum?.lastFive?.[t.id] || [];
    return l.length ? `<div class="form" title="Last 5">${l.map((x) => `<i class="${esc(x.result)}" title="${esc(x.atVs)} ${esc(x.opp)} ${esc(x.score)}">${esc(x.result)}</i>`).join('')}</div>` : '';
  };

  body.innerHTML = `
    ${cg?.note ? `<div class="sec"><h3>The story</h3><p style="margin:0">${esc(cg.note)}</p></div>` : ''}
    <div class="sec"><div class="hd"><h3>Odds</h3><span class="est">updates live</span></div>
      ${books.length ? `<div class="scroll"><table><thead><tr><th>Book</th><th>Spread</th><th class="n">Total</th><th class="n">${esc(g.away.abbr)} ML</th><th class="n">${esc(g.home.abbr)} ML</th></tr></thead><tbody>
      ${books.map((b) => `<tr><td>${esc(b.provider)}</td><td>${esc(b.details || '')}</td><td class="n">${b.overUnder ?? ''}</td><td class="n">${ml(b.awayML)}</td><td class="n">${ml(b.homeML)}</td></tr>`).join('')}
      ${(cg?.books || []).map((b) => `<tr><td>${esc(b.book)} <span class="est">earlier</span></td><td>${esc(b.spread || '')}</td><td class="n">${esc(b.total || '')}</td><td class="n" colspan="2">${esc(b.ml || '')}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="est">No lines posted yet.</div>'}
    </div>
    <div class="sec"><div class="hd"><h3>Who's better</h3></div>
      ${verdict ? `<div class="verdict">${esc(verdict)}</div>` : ''}
      ${scale('Points scored', nA?.ppg, nH?.ppg, g, { note: nA?.ppgRank ? `${g.away.abbr}${rk(nA.ppgRank, nA.teams)}, ${g.home.abbr}${rk(nH?.ppgRank, nH?.teams)}` : '' })}
      ${scale('Points allowed (defense)', nA?.oppg, nH?.oppg, g, { lowerBetter: true, note: 'fewer is better' })}
      ${L.sport === 'football' ? scale('Passing yards / game', nA?.passYpg, nH?.passYpg, g) + scale('Rushing yards / game', nA?.rushYpg, nH?.rushYpg, g) : ''}
      ${L.sport === 'basketball' ? scale('Field goal %', nA?.fgPct, nH?.fgPct, g) + scale('3-point %', nA?.threePct, nH?.threePct, g) + scale('Rebounds', nA?.reb, nH?.reb, g) : ''}
      ${styleBar(g.away, nA, L)}${styleBar(g.home, nH, L)}
      ${!nA && !nH ? '<div class="est">Season numbers are not available right now.</div>' : ''}
      <div class="grid2" style="align-items:center"><div class="est">${esc(g.away.abbr)} last 5</div>${form(g.away) || '<span class="est">—</span>'}<div class="est">${esc(g.home.abbr)} last 5</div>${form(g.home) || '<span class="est">—</span>'}</div>
    </div>
    <div class="sec" id="whoMissing">${missingHTML(g, sum)}</div>
    ${sum?.teamBox?.length && g.state !== 'pre' ? `<div class="sec"><h3>Team stats today</h3><div class="scroll"><table><thead><tr><th></th><th class="n">${esc(sum.teamBox[0]?.abbr)}</th><th class="n">${esc(sum.teamBox[1]?.abbr)}</th></tr></thead><tbody>${(sum.teamBox[0]?.stats || []).slice(0, 14).map((s, i) => `<tr><td>${esc(s.label)}</td><td class="n">${esc(s.value)}</td><td class="n">${esc(sum.teamBox[1]?.stats?.[i]?.value ?? '')}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
  `;
}

// lineup field
const OL = /^(LT|LG|C|RG|RT|OT|T|G|OL)$/;
const DL = /^(LDE|RDE|DE|DT|LDT|RDT|NT|EDGE|DL)$/;
const LBX = /LB$/;

function renderLineups(body, g, sum, tA, tH) {
  const L = LG[g.league];
  const t = S.side === 'home' ? g.home : g.away;
  const td = S.side === 'home' ? tH : tA;
  const injured = Object.fromEntries((sum?.injuries?.[t.id] || []).map((i) => [String(i.id), i]));
  const leaders = new Set((sum?.leaders || []).map((x) => String(x.id)));
  const box = sum?.box || {};
  const rosterById = Object.fromEntries((td?.roster || []).map((p) => [p.id, p]));

  const card = (p) => {
    const id = String(p.id || '');
    const r = rosterById[id] || {};
    const inj = injured[id];
    const hurt = inj && /out|ir|doubt/i.test(inj.status);
    const q = inj && !hurt;
    const label = p.label || p.pos || '';
    const tier = hurt ? 'hurt' : leaders.has(id) || /^QB$/.test(label) ? 'gold' : OL.test(label) ? 'silver' : '';
    const bs = box[id]?.stats;
    let st = '';
    if (bs) {
      if (bs.passingYards !== undefined) st = `${bs.passingYards} pass yds`;
      else if (bs.rushingYards !== undefined) st = `${bs.rushingYards} rush yds`;
      else if (bs.receivingYards !== undefined) st = `${bs.receptions ?? 0} rec · ${bs.receivingYards} yds`;
      else if (bs.totalTackles !== undefined) st = `${bs.totalTackles} tkl`;
      else if (bs.points !== undefined) st = `${bs.points} pts · ${bs.rebounds ?? 0} reb`;
    }
    if (!st) st = [r.height || p.height, r.weight || p.weight].filter(Boolean).join(' · ') || (r.exp !== undefined ? `${r.exp} yrs pro` : '');
    const name = p.name || r.name || '';
    return `<div class="slot"><button class="pc ${tier}" data-player="${esc(g.league)}:${esc(id)}" ${id ? '' : 'disabled'} aria-label="${esc(name)}, ${esc(label)}">
      <div class="ph">${face(p.headshot || r.headshot, name)}${p.jersey || r.jersey ? `<span class="num">${esc(p.jersey || r.jersey)}</span>` : ''}${hurt ? '<span class="flag">OUT</span>' : q ? `<span class="flag q">${esc(inj.status.slice(0, 1))}</span>` : ''}</div>
      <div class="nm">${esc(shortName(name))}</div>
      ${st ? `<div class="st">${esc(st)}</div>` : ''}
      ${p.backups?.length ? `<div class="bk">2: ${esc(shortName(p.backups[0]))}</div>` : ''}
    </button><span class="pl">${esc(label.replace(/\d+$/, ''))}</span></div>`;
  };

  const rowOf = (arr) => (arr.length ? `<div class="frow" style="--n:${Math.min(arr.length, 6)}">${arr.map(card).join('')}</div>` : '');
  let field = '';
  let note = '';
  if (L.sport === 'football') {
    const lu = td?.lineup || {};
    const list = (S.unit === 'defense' ? lu.defense : lu.offense) || [];
    if (S.unit === 'offense') {
      // drawn like the field from behind the offense: receivers, line, QB, backs
      const line = list.filter((p) => OL.test(p.label));
      const qb = list.filter((p) => p.label === 'QB');
      const backs = list.filter((p) => /^(RB|FB|HB)/.test(p.label));
      const recv = list.filter((p) => !line.includes(p) && !qb.includes(p) && !backs.includes(p));
      const te = recv.filter((p) => p.label === 'TE');
      const wrs = recv.filter((p) => p.label !== 'TE');
      const half = Math.ceil(wrs.length / 2);
      field = [[...wrs.slice(0, half), ...te, ...wrs.slice(half)], line, qb, backs].map(rowOf).join('');
    } else {
      const dl = list.filter((p) => DL.test(p.label));
      const lb = list.filter((p) => LBX.test(p.label) && !dl.includes(p));
      const db = list.filter((p) => !dl.includes(p) && !lb.includes(p));
      field = [db, lb, dl].map(rowOf).join('');
    }
    if (!list.length) field = '<div class="empty">ESPN has not posted this lineup yet.</div>';
    note = lu.guessed ? 'Built from the roster because ESPN has no depth chart for this team yet, so starters may differ.' : `From ESPN's depth chart${lu.formation?.[S.unit] ? ` (${lu.formation[S.unit]})` : ''}. Gold = team leaders and QB, grey = ruled out.`;
  } else {
    const live = sum?.starters?.[t.id];
    const list = live?.length ? live.map((p) => ({ ...p, label: p.pos })) : td?.lineup?.starters || [];
    field = list.length ? [list.slice(2, 5), list.slice(0, 2)].map(rowOf).join('') : '<div class="empty">Starters not posted yet.</div>';
    note = live?.length ? 'Confirmed starters from the box score.' : td?.lineup?.guessed ? 'Projected from the roster; confirmed starters show once the game begins.' : 'From the depth chart; confirmed starters show once the game begins.';
  }

  body.innerHTML = `
    <div class="sec">
      <div class="seg">${[g.away, g.home].map((x, i) => `<button data-side="${i ? 'home' : 'away'}" aria-pressed="${(S.side === 'home') === !!i}">${esc(x.name)}</button>`).join('')}</div>
      ${L.sport === 'football' ? `<div class="seg">${['offense', 'defense'].map((u) => `<button data-unit="${u}" aria-pressed="${S.unit === u}">${u === 'offense' ? 'Offense' : 'Defense'}</button>`).join('')}</div>` : ''}
      <div class="field">${field}</div>
      <div class="est">${esc(note)} Tap any player for their card.</div>
    </div>
    ${td?.roster?.length ? `<details class="sec"><summary style="cursor:pointer;font-weight:800">Full roster (${td.roster.length})</summary><div class="inj" style="margin-top:10px">${td.roster.map((p) => `<button class="ip" style="background:none;padding:0;min-height:0;text-align:left;font-weight:400;justify-content:start" data-player="${esc(g.league)}:${esc(p.id)}"><img src="${esc(p.headshot)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><div><div class="nm">${esc(p.name)}</div><div class="dt">#${esc(p.jersey)} · ${esc(p.pos)}</div></div><span class="tag ${p.status && /out|ir/i.test(p.status) ? 't-out' : ''}">${esc(p.status || p.pos)}</span></button>`).join('')}</div></details>` : ''}`;
}

function renderPlays(body, g, sum) {
  const plays = sum?.plays || [];
  if (!plays.length) { body._plays = null; body.innerHTML = `<div class="empty">${g.state === 'pre' ? `Plays show up here once the game starts. Kickoff ${esc(fmtDay(g.date))} at ${esc(fmtTime(g.date))}.` : 'No plays yet.'}</div>`; return; }
  const inj = sum.liveInjuries || [];
  const scoring = plays.filter((p) => p.scoring);
  const lists = { all: plays, score: scoring, inj };
  if (!lists[S.playFilter]?.length && S.playFilter !== 'all') S.playFilter = 'all';
  const f = S.playFilter || 'all';
  const chips = `<div class="seg pf" id="pfilter">${[['all', g.state === 'in' ? '🔴 Live' : 'All', plays.length], ['score', 'Scoring', scoring.length], ['inj', 'Injuries', inj.length]].map(([k, l, n]) => `<button data-pf="${k}" aria-pressed="${f === k}" ${n ? '' : 'disabled'}>${l}${k !== 'all' ? ` <span class="count">${n}</span>` : ''}</button>`).join('')}</div>`;
  if (body._plays !== `${g.id}:${f}` || !$('#fAll', body)) {
    body.innerHTML = `<div class="sec"><div class="hd"><h3>${g.state === 'in' ? 'Live plays' : 'Plays'}</h3><span class="est">newest first${g.state === 'in' ? ' · new plays slide in' : ''}</span></div><div id="pfWrap"></div><div class="feed" id="fAll"></div></div>`;
    body._plays = `${g.id}:${f}`;
  }
  setHTML($('#pfWrap', body), chips);
  syncFeed($('#fAll', body), lists[f], g);
}
// Short play cards: photo of who made the play, what they did, who stopped them, totals after the play.
const pface = (x, cls) => `<span class="${cls}">${x.headshot ? `<img src="${esc(x.headshot)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<i>${esc(initials(x.name))}</i></span>`;
function actorsHTML(p, { compact = false } = {}) {
  const who = p.who || [];
  const def = p.defense || [];
  if (!who.length && !def.length) return `<div class="ptext">${esc(p.text)}</div>`;
  const [m, ...rest] = who;
  let h = '';
  if (m) h += `<div class="actor">${pface(m, 'ph big')}<div><div class="an">${esc(m.name)}</div><div class="al">${esc(m.line)}</div>${m.total ? `<div class="at">${esc(m.total)}</div>` : ''}</div></div>`;
  if (!compact) for (const x of [...rest, ...def]) h += `<div class="actor sm">${pface(x, 'ph')}<div><span class="an">${esc(x.name)}</span> <span class="al">${esc(x.line)}</span>${x.total ? ` <span class="at">${esc(x.total)}</span>` : ''}</div></div>`;
  else if (def[0]) h += `<div class="actor sm">${pface(def[0], 'ph')}<div><span class="al">${esc(def[0].line)}:</span> <span class="an">${esc(def[0].name)}</span>${def[0].total ? ` <span class="at">${esc(def[0].total)}</span>` : ''}</div></div>`;
  return h;
}
const injuredHTML = (p) => (p.injured || []).map((x) => `<div class="actor sm injr ${x.returned ? 'back' : ''}">${pface(x, 'ph')}<div><span class="an">${esc(x.name)}</span> <span class="al">${x.returned ? '✅ back in the game' : '🚑 hurt on the play'}</span></div></div>`).join('');
const playShort = (p) => (p?.who?.[0] ? `${p.who[0].name}: ${p.who[0].line}${p.defense?.[0] ? ` (${p.defense[0].line.toLowerCase()} by ${p.defense[0].name})` : ''}` : p?.text || '');
const injShort = (p) => (p?.injured?.length ? p.injured.map((x) => `${x.name} (${x.team}) ${x.returned ? 'is back in the game' : 'got hurt'}`).join(' · ') : p?.text || '');
// A short one-time animation for a new play: a spiral for a pass, a runner for a run, a waving
// yellow flag for a penalty, goal posts on a score, and basketball shots into a hoop. Pure CSS, only on new plays.
const FB_SVG = '<svg class="fb" viewBox="0 0 32 18" width="30" height="17"><path d="M1 9C7 0.5 25 0.5 31 9C25 17.5 7 17.5 1 9Z" fill="#8a4a22" stroke="#4d2410" stroke-width="1"/><path d="M5 5.2C7 4.4 7 13.6 5 12.8M27 5.2C25 4.4 25 13.6 27 12.8" stroke="#f3eadf" stroke-width="1.1" fill="none"/><g class="laces" stroke="#f3eadf" stroke-linecap="round"><path d="M10.5 9H21.5" stroke-width="1.3"/><path d="M12 7.3V10.7M14 7.3V10.7M16 7.3V10.7M18 7.3V10.7M20 7.3V10.7" stroke-width="1.1"/></g><path class="shine" d="M8 5.5C12 3.4 20 3.4 24 5.5" stroke="#ffffff55" stroke-width="1.2" fill="none"/></svg>';
const FLAG_SVG = '<svg class="flag" viewBox="0 0 34 34" width="34" height="34"><path d="M5 3V32" stroke="#d9d9d9" stroke-width="2.2" stroke-linecap="round"/><g class="cloth"><path d="M6 4C12 2 17 7 24 5C27 4 29 4 31 4.5V17C29 16.5 27 16.5 24 17.5C17 19.5 12 14.5 6 16.5Z" fill="#ffd400" stroke="#c9a400" stroke-width="1"/><path d="M8 8C13 6.5 18 10.5 25 9" stroke="#fff3" stroke-width="1.4" fill="none"/></g></svg>';
const POST_SVG = '<svg class="gpost" viewBox="0 0 30 42" width="30" height="42"><path d="M15 41V20M3 20H27M3 20V2M27 20V2" stroke="#ffd400" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>';
const BB_SVG = '<svg class="bb" viewBox="0 0 20 20" width="19" height="19"><circle cx="10" cy="10" r="9" fill="#e8742a" stroke="#7a3510" stroke-width="1"/><path d="M1 10H19M10 1V19M3.6 3.6C7 7 7 13 3.6 16.4M16.4 3.6C13 7 13 13 16.4 16.4" stroke="#7a3510" stroke-width="1" fill="none"/></svg>';
const HOOP_SVG = '<svg class="hoop" viewBox="0 0 34 42" width="34" height="42"><path d="M31 2V26" stroke="#e8e8e8" stroke-width="2.4" stroke-linecap="round"/><path d="M29 14H22" stroke="#e8e8e8" stroke-width="1.6"/><g class="net"><path d="M5 16L8 30M10 16L11 30M15 16L14 30M20 16L17 30M8 30H17M6 22H19M7 26H18" stroke="#ffffffcc" stroke-width="1" fill="none"/></g><ellipse cx="12.5" cy="15" rx="9" ry="2.2" fill="none" stroke="#ff5a1f" stroke-width="2.2"/></svg>';
function playKind(p, league) {
  const t = `${p.type || ''} ${p.who?.[0]?.line || ''} ${p.text || ''}`;
  if (league === 'nba' || league === 'cbb') {
    if (/block/i.test(t)) return 'bblock';
    if (/turnover|steal|bad pass|lost ball|traveling/i.test(t)) return 'bsteal';
    if (/rebound/i.test(t)) return 'breb';
    if (/shot|jumper|layup|dunk|free throw|three point|hook|tip|fadeaway|makes|misses/i.test(t)) {
      if (/miss/i.test(t)) return 'bmiss';
      if (/dunk|alley oop/i.test(t)) return 'bdunk';
      if (/three point|3-pt|3pt/i.test(t)) return 'b3';
      return 'bmake';
    }
    return '';
  }
  if (/penalty|\bflag\b/i.test(t)) return 'flag';
  if (/sack/i.test(t)) return 'sack';
  if (/field goal|extra point|punt|kickoff|kick/i.test(t)) return 'kick';
  if (/pass|catch|reception|incomplete|intercept|threw/i.test(t)) return 'pass';
  if (/run|rush|scramble|kneel/i.test(t)) return 'run';
  return '';
}
function playAnim(p, league) {
  if (!['nfl', 'cfb', 'nba', 'cbb'].includes(league)) return '';
  const k = playKind(p, league);
  if (!k) return '';
  if (k[0] === 'b') {
    const ball = `<span class="arcy"><span class="tilt">${BB_SVG}</span></span>`;
    const hoop = k === 'bsteal' || k === 'breb' || k === 'bblock' ? '' : `<span class="goal">${HOOP_SVG}</span>`;
    return `<div class="panim hoopz ${k}" aria-hidden="true"><span class="lane"><span class="mover">${ball}</span></span>${k === 'bblock' ? '<b class="swat">✋</b>' : ''}${hoop}</div>`;
  }
  const t = `${p.type || ''} ${p.text || ''} ${p.who?.[0]?.line || ''}`;
  const score = k === 'flag' || k === 'sack' ? '' : /touchdown|\bTD\b/i.test(t) ? 'td' : k === 'kick' && /field goal|extra point/i.test(t) && (p.scoring || /\bgood\b/i.test(t)) && !/no good|missed|blocked/i.test(t) ? 'fg' : '';
  const icon = k === 'run' ? '<b class="runner">🏃</b>' : k === 'sack' ? '<b class="boom">💥</b>' : k === 'flag' ? FLAG_SVG : `<span class="arcy"><span class="tilt">${FB_SVG}</span></span>`;
  return `<div class="panim ${k}${score ? ' scored ' + score : ''}" aria-hidden="true"><span class="lane"><span class="mover">${icon}</span></span>${k === 'flag' ? '<span class="flagtxt">FLAG</span>' : ''}${score ? `<span class="goal">${POST_SVG}</span>` : ''}</div>`;
}
function agoText(iso) {
  const ms = Date.now() - new Date(iso);
  if (!iso || !(ms >= 0)) return '';
  const m = Math.floor(ms / 60e3);
  return m < 1 ? 'now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}
// One play as a feed card: who made it (big photo), what happened, their totals, who else was in on it.
function playRow(p, g) {
  const who = p.who || []; const def = p.defense || [];
  const [m, ...rest] = who;
  const cls = `${p.injured?.some((x) => !x.returned) ? 'inj' : p.scoring ? 'score' : ''} ${p.voided ? 'void' : ''}`;
  const tm = g && p.teamId ? (String(g.home.id) === p.teamId ? g.home : String(g.away.id) === p.teamId ? g.away : null) : null;
  const score = g && p.away !== null && p.away !== undefined ? `${esc(g.away.abbr)} ${p.away}-${p.home} ${esc(g.home.abbr)}` : '';
  const meta = [score, `${esc(p.periodLabel || (p.period ? 'Q' + p.period : ''))} ${esc(p.clock)}`.trim(), esc(p.down || '')].filter(Boolean).join(' · ');
  const swing = p.swing ? `<span class="swing ${p.swing > 0 ? 'up' : 'dn'}" title="Win chance change">${p.swing > 0 ? '▲' : '▼'}${Math.abs(p.swing)}%</span>` : '';
  const photo = m || p.injured?.[0] || null;
  const av = `<div class="fav">${photo ? pface(photo, 'ph') : `<span class="ph">${tm?.logo ? `<img src="${esc(tm.logo)}" alt="" style="object-fit:contain;padding:8px" onerror="this.remove()">` : ''}<i>${esc(p.team || '')}</i></span>`}${tm ? `<span class="tb" style="background:${esc(tm.color)}">${esc(tm.abbr)}</span>` : p.team ? `<span class="tb">${esc(p.team)}</span>` : ''}</div>`;
  const head = m ? m.line : p.type || 'Play';
  const sub = [];
  if (m) sub.push(`<div class="fl1"><b>${esc(m.name)}</b>${m.total ? ` · ${esc(m.total)}` : ''}</div>`);
  for (const x of rest) sub.push(`<div class="fl2">${pface(x, 'mini')}${esc(x.name)}${x.total ? ` · ${esc(x.total)}` : ''} <span class="fr">${esc(x.line)}</span></div>`);
  for (const x of def) sub.push(`<div class="fl2">${pface(x, 'mini')}<span class="fr">${esc(x.line)}:</span> ${esc(x.name)}${x.total ? ` · ${esc(x.total)}` : ''}</div>`);
  if (!m && !p.injured?.length) sub.push(`<div class="fl2">${esc(p.text)}</div>`);
  for (const x of p.injured || []) sub.push(`<div class="fl2 ${x.returned ? 'back' : 'hurt'}">${pface(x, 'mini')}${x.returned ? '✅' : '🚑'} ${esc(x.name)} ${x.returned ? 'back in the game' : 'hurt on the play'}</div>`);
  return `<div class="play feedp ${cls}">${av}<div class="pbody">${playAnim(p, g?.league)}<div class="fmeta"><span>${meta}${p.wall ? ` · <span data-ago="${esc(p.wall)}">${agoText(p.wall)}</span>` : ''}</span>${swing}</div><div class="fhead">${esc(head)}${p.voided ? ' <span class="est">no play</span>' : ''}</div>${sub.join('')}</div></div>`;
}

// ---------- PAST GAMES / SEASONS ----------
const viewSwitch = (on) => `<div class="seg" style="margin:4px 0 10px"><button data-view="today" aria-pressed="${on === 'today'}">Today &amp; upcoming</button><button data-view="season" aria-pressed="${on === 'season'}">Past games</button></div>`;
// The current season is worked out from today's date, so it rolls over on its own each year.
function currentSeason(lg, d = new Date()) {
  const y = d.getFullYear(); const m = d.getMonth() + 1;
  if (lg === 'nfl' || lg === 'cfb') return m >= 8 ? y : y - 1;
  return m >= 10 ? y + 1 : y;
}
const seasonLabel = (lg, s) => (lg === 'nfl' || lg === 'cfb' ? `${s} season` : `${s - 1}-${String(s).slice(2)}`);
const fmtDateKey = (k) => new Date(`${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

S.sLeague = store.get('sLeague', 'nfl');
S.sSeason = null;
S.sSel = null;
S.sData = null;

async function renderSeason() {
  const v = $('#view');
  const lg = S.sLeague;
  const cur = currentSeason(lg);
  const season = S.sSeason || cur;
  v.innerHTML = `
    <h1>Past games</h1>
    <p class="sub">Every result, any season. This season starts over on its own each year.</p>
    ${viewSwitch('season')}
    <div class="chips" role="group" aria-label="Sport">${ALL_LEAGUES.map((k) => `<button data-sleague="${k}" aria-pressed="${lg === k}">${LG[k].label}</button>`).join('')}</div>
    <label style="margin:6px 0 10px">Season<select id="seasonPick">${[0, 1, 2, 3, 4, 5].map((i) => cur - i).map((s) => `<option value="${s}" ${s === season ? 'selected' : ''}>${esc(seasonLabel(lg, s))}${s === cur ? ' (this season)' : ''}</option>`).join('')}</select></label>
    <div id="seasonNav"></div>
    <div id="seasonList"><div class="games"><div class="skel"></div><div class="skel"></div></div></div>`;
  window.scrollTo(0, 0);
  const qs = new URLSearchParams({ league: lg, season: String(season) });
  if (S.sSel?.week) { qs.set('week', S.sSel.week); qs.set('type', S.sSel.type); }
  if (S.sSel?.date) qs.set('date', S.sSel.date);
  let d;
  try { d = await api(`/api/season?${qs}`); } catch (e) {
    if (route().name === 'season') $('#seasonList').innerHTML = `<div class="empty">Could not load that season right now. ${esc(e.message)}</div>`;
    return;
  }
  if (route().name !== 'season' || S.sLeague !== lg) return;
  S.sData = d;
  S.sSel = d.selected;
  drawSeasonBody();
}

function drawSeasonBody() {
  const d = S.sData;
  if (!d || !$('#seasonNav')) return;
  if (d.calendar.kind === 'weeks') {
    $('#seasonNav').innerHTML = `<div class="chips" id="weekChips">${d.calendar.items.map((w) => `<button data-week="${esc(w.type)}:${esc(w.week)}" aria-pressed="${w.type === d.selected.type && w.week === d.selected.week}">${esc(w.label)}</button>`).join('')}</div>`;
    const on = $('#weekChips [aria-pressed=true]');
    if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
  } else {
    const days = d.calendar.items;
    const i = days.indexOf(d.selected.date);
    const prev = i > 0 ? days[i - 1] : null;
    const next = i >= 0 && i < days.length - 1 ? days[i + 1] : null;
    $('#seasonNav').innerHTML = `<div class="lineadj"><button ${prev ? `data-day="${prev}"` : 'disabled'} aria-label="Previous game day">‹</button><div style="text-align:center"><div class="est">Game day</div><b style="font-size:22px">${esc(fmtDateKey(d.selected.date))}</b></div><button ${next ? `data-day="${next}"` : 'disabled'} aria-label="Next game day">›</button></div>`;
  }
  const games = d.games;
  if (!games.length) { $('#seasonList').innerHTML = '<div class="empty">No games on this date.</div>'; return; }
  const done = games.filter((g) => g.state === 'post');
  const byDay = {};
  for (const g of games) (byDay[new Date(g.date).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })] ||= []).push(g);
  $('#seasonList').innerHTML = `<p class="est" style="margin:10px 0 0">${done.length} of ${games.length} games final · ${esc(seasonLabel(d.league, d.season))}</p>` +
    Object.entries(byDay).map(([day, list]) => `<h2>${esc(day)} <span class="count">${list.length}</span></h2><div class="games">${list.map(gameCard).join('')}</div>`).join('');
}

// ---------- PLAYER CARD ----------
const STAT_LABEL = {
  passingYards: 'Pass yds', passingTouchdowns: 'Pass TD', completions: 'Completions', passingAttempts: 'Pass att', interceptions: 'INT',
  rushingYards: 'Rush yds', rushingAttempts: 'Carries', rushingTouchdowns: 'Rush TD',
  receivingYards: 'Rec yds', receptions: 'Catches', receivingTargets: 'Targets', receivingTouchdowns: 'Rec TD', longReception: 'Long catch',
  totalTackles: 'Tackles', sacks: 'Sacks',
  points: 'Points', rebounds: 'Rebounds', assists: 'Assists', threePointFieldGoalsMade: '3-pointers', steals: 'Steals', blocks: 'Blocks',
  goals: 'Goals', shotsTotal: 'Shots', saves: 'Saves',
};
const CURATED_STAT = { 'Passing yards': 'passingYards', 'Rushing yards': 'rushingYards', 'Receiving yards': 'receivingYards', Receptions: 'receptions', Points: 'points', Rebounds: 'rebounds', Assists: 'assists' };
function propStats(league, pos) {
  if (league === 'nba') return ['points', 'rebounds', 'assists', 'threePointFieldGoalsMade'];
  if (league === 'nhl') return ['goals', 'shotsTotal', 'saves'];
  if (pos === 'QB') return ['passingYards', 'passingTouchdowns', 'completions', 'rushingYards'];
  if (/RB|FB|HB/.test(pos)) return ['rushingYards', 'rushingAttempts', 'receivingYards', 'receptions'];
  if (/WR|TE/.test(pos)) return ['receivingYards', 'receptions', 'longReception'];
  return ['totalTackles', 'sacks'];
}

async function openPlayer(league, id) {
  const dlg = $('#sheet');
  dlg._bet = null;
  dlg.innerHTML = `<div class="sheet"><div class="grab"><button data-close>Close</button></div><div class="skel" style="height:300px"></div></div>`;
  if (!dlg.open) dlg.showModal();
  let p = S.players[`${league}:${id}`];
  if (!p) {
    try { p = await api(`/api/player?league=${league}&id=${id}`); S.players[`${league}:${id}`] = p; }
    catch { dlg.querySelector('.skel').outerHTML = '<div class="empty">Could not load this player right now.</div>'; return; }
  }
  const statsOf = (pp) => propStats(league, pp.bio.pos).filter((k) => pp.log.games.some((x) => x.stats[k] !== null && x.stats[k] !== undefined));
  const curated = S.daily?.props?.find((x) => x.player === p.bio.name);
  const cStat = curated ? CURATED_STAT[curated.stat] : null;
  const ctx = { p, stats: statsOf(p) };
  const cur = currentSeason(league);
  const seasons = p.seasons?.length ? p.seasons.slice(0, 5) : [0, 1, 2].map((i) => ({ value: String(cur - i), label: seasonLabel(league, cur - i) }));
  const state = { stat: cStat && ctx.stats.includes(cStat) ? cStat : ctx.stats[0], line: null, season: seasons[0]?.value, seasons, latest: seasons[0]?.value };
  const draw = () => drawPlayer(dlg, league, ctx.p, ctx.stats, state, state.season === state.latest ? curated : null);
  dlg._redraw = (fn) => { fn(state); draw(); };
  dlg._season = async (season) => {
    state.season = season; state.line = null;
    const k = `${league}:${id}:${season}`;
    try {
      const np = S.players[k] || (await api(`/api/player?league=${league}&id=${id}&season=${season}`));
      S.players[k] = np;
      ctx.p = { ...ctx.p, log: np.log };
      ctx.stats = statsOf(ctx.p);
      if (!ctx.stats.includes(state.stat)) state.stat = ctx.stats[0];
    } catch { ctx.p = { ...ctx.p, log: { games: [] } }; ctx.stats = []; }
    draw();
  };
  draw();
}

function drawPlayer(dlg, league, p, stats, state, curated) {
  const b = p.bio;
  const games = p.log.games.filter((x) => x.stats[state.stat] !== null && x.stats[state.stat] !== undefined);
  const vals = games.map((x) => x.stats[state.stat]);
  const last10 = vals.slice(0, 10);
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const isCurated = curated && CURATED_STAT[curated.stat] === state.stat;
  if (state.line === null) state.line = isCurated ? curated.line : Math.floor(median(last10)) + 0.5;
  const line = state.line;
  const hits = (a) => a.filter((x) => x > line).length;
  const l5 = vals.slice(0, 5);
  const pct = (a) => (a.length ? Math.round((hits(a) / a.length) * 100) : 0);
  const seasonAvg = avg(vals);

  // today: is the player's team in a game we have live data for?
  const r = route();
  const sum = r.name === 'game' ? S.sums[r.id]?.data : null;
  const g = sum?.game;
  const todayVal = sum?.box?.[b.id]?.stats?.[state.stat];
  let today = '';
  if (state.season !== state.latest) { /* past season: no live check */ } else if (g && todayVal !== undefined && todayVal !== null) {
    const done = g.state === 'post';
    const hit = todayVal > line;
    today = `<div class="today ${done ? (hit ? 'hit' : 'miss') : ''}"><div><div style="font-size:12px;font-weight:800;text-transform:uppercase">${done ? 'Today, final' : `Today, live · ${esc(periodName(g))} ${esc(g.clock)}`}</div>${done ? (hit ? 'Hit the line ✅' : 'Missed the line ❌') : hit ? 'Already over the line ✅' : `Needs ${(line - todayVal + 0.5).toFixed(1).replace(/\.0$/, '')} more`}</div><b>${todayVal}</b></div>`;
  } else if (g && g.state === 'pre') {
    today = `<div class="today"><div><div style="font-size:12px;font-weight:800;text-transform:uppercase">Today</div>Kickoff ${esc(fmtTime(g.date))}. We will track this line live.</div><b>${line}</b></div>`;
  }

  // reasons
  const why = [];
  if (isCurated && curated.why) why.push(curated.why);
  const why2 = state.season === state.latest ? S.daily?.players?.[b.name]?.why : null;
  if (why2 && !why.includes(why2)) why.push(why2);
  if (vals.length >= 3) {
    const l3 = avg(vals.slice(0, 3));
    const trend = l3 > seasonAvg * 1.12 ? 'trending up' : l3 < seasonAvg * 0.88 ? 'trending down' : 'steady';
    why.push(`Averaging ${l3.toFixed(1)} ${STAT_LABEL[state.stat].toLowerCase()} over the last 3 games against ${seasonAvg.toFixed(1)} this season (${trend}).`);
    const best = games.reduce((m, x) => (x.stats[state.stat] > (m?.stats[state.stat] ?? -1) ? x : m), null);
    if (best) why.push(`Best game: ${best.stats[state.stat]} ${best.atVs || 'vs'} ${best.opp}${best.result ? ` (${best.result} ${best.score})` : ''}.`);
  }
  if (g && sum) {
    const oppId = g.home.abbr === b.team || g.home.name === b.teamName ? g.away.id : g.home.id;
    const opp = g.home.id === oppId ? g.home : g.away;
    const tn = S.teams[`${league}:${oppId}`]?.data?.numbers;
    if (tn?.oppg) why.push(`${opp.name} allow ${tn.oppg.toFixed(1)} points a game${tn.oppgRank ? `, #${tn.oppgRank} of ${tn.teams}` : ''} (${tn.oppgRank && tn.teams && tn.oppgRank > tn.teams / 2 ? 'a softer defense' : 'a tougher defense'}).`);
  }
  if (b.injury) why.push(`Injury report: ${b.injury}.`);

  // bars
  const shown = games.slice(0, 10).reverse();
  const max = Math.max(line * 1.3, ...shown.map((x) => x.stats[state.stat]), 1);
  const lineTop = 100 - (line / max) * 100;
  const step = line >= 40 ? 5 : 1;

  dlg.innerHTML = `<div class="sheet" style="--tc:${esc(S.games.find((x) => x.home.abbr === b.team)?.home.color || S.games.find((x) => x.away.abbr === b.team)?.away.color || '#ff9b3d')}">
    <div class="grab"><button data-close>Close</button></div>
    <div style="display:grid;gap:14px">
    <div class="phead">
      <div class="pphoto">${face(b.headshot, b.name)}${b.teamLogo ? `<img class="tl" src="${esc(b.teamLogo)}" alt="">` : ''}</div>
      <div><div class="pmeta">${esc(b.teamName || b.team)}${b.jersey ? ` · #${esc(b.jersey)}` : ''}</div><h2 class="pname">${esc(b.name)}</h2><div class="pmeta">${esc(b.posName || b.pos)}${b.injury ? ` · <span class="tag t-q">${esc(b.injury)}</span>` : ''}</div></div>
    </div>
    <div class="bio">
      ${[['Age', b.age], ['Height', b.height], ['Weight', b.weight], ['College', b.college], ['Experience', b.exp], ['Hometown', b.birthPlace], ['Draft', b.draft]].filter((x) => x[1]).map((x) => `<div>${esc(x[0])}<b>${esc(x[1])}</b></div>`).join('')}
    </div>
    ${p.season ? `<div><div class="est" style="margin-bottom:6px">${esc(p.season.label)}</div><div class="tiles">${p.season.items.slice(0, 8).map(([k, v]) => `<div>${esc(k)}<b>${esc(v)}</b></div>`).join('')}</div></div>` : ''}
    ${state.seasons?.length > 1 ? `<div><div class="est" style="margin-bottom:4px">Season</div><div class="chips">${state.seasons.map((x) => `<button data-pseason="${esc(x.value)}" aria-pressed="${x.value === state.season}">${esc(x.label)}</button>`).join('')}</div></div>` : ''}
    ${stats.length ? `
    <h3 style="margin-top:6px">Prop tracker${state.season !== state.latest ? ` <span class="tag">${esc(state.seasons.find((x) => x.value === state.season)?.label || '')}</span>` : ''}</h3>
    <div class="chips">${stats.map((k) => `<button data-stat="${k}" aria-pressed="${k === state.stat}">${esc(STAT_LABEL[k] || k)}</button>`).join('')}</div>
    <div class="lineadj"><button data-line="-${step}" aria-label="Lower line">−</button><div style="text-align:center"><div class="est">${isCurated ? `${esc(curated.book)} line` : 'Line (estimated, tap to adjust)'}</div><b>${line}</b></div><button data-line="${step}" aria-label="Raise line">+</button></div>
    ${today}
    <div class="hitbox">
      <div class="${pct(l5) >= 60 ? 'good' : pct(l5) <= 40 ? 'bad' : ''}">Last 5<b>${pct(l5)}%</b>${hits(l5)} of ${l5.length} over</div>
      <div class="${pct(last10) >= 60 ? 'good' : pct(last10) <= 40 ? 'bad' : ''}">Last 10<b>${pct(last10)}%</b>${hits(last10)} of ${last10.length} over</div>
      <div>Average<b>${seasonAvg.toFixed(1)}</b>${vals.length} games</div>
    </div>
    ${shown.length ? `<div><div class="bars"><div class="ln" style="top:calc(20px + ${lineTop}% * (130/150))"><span>${line}</span></div>${shown.map((x) => { const v = x.stats[state.stat]; return `<div class="b ${v > line ? 'h' : 'm'}" title="${esc(x.date.slice(0, 10))}">${v}<i style="height:${(v / max) * 100}%"></i></div>`; }).join('')}</div>
      <div class="blabs">${shown.map((x) => `<span>${esc(x.atVs === '@' ? '@' : '')}${esc(x.opp)}</span>`).join('')}</div>
      <div class="est" style="margin-top:4px">Green = went over the line, red = stayed under. Oldest on the left.</div></div>` : '<div class="est">No game log yet this season.</div>'}
    ${isCurated ? `<div class="note">Lean: <b>${esc(curated.lean)} ${curated.line}</b> · ${curated.est}% estimated${curated.over ? ` · Over ${ml(curated.over)} / Under ${ml(curated.under)}` : ''}</div>` : ''}
    ` : `<div class="empty">No games logged for this season.</div>`}
    ${why.length ? `<div><h3>Why the numbers look like this</h3><ul class="why" style="margin-top:6px">${why.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    ${p.log.games.length ? `<details><summary style="cursor:pointer;font-weight:800">Game log</summary><div class="scroll" style="margin-top:8px"><table><thead><tr><th>Date</th><th>Opp</th><th>Result</th>${stats.map((k) => `<th class="n">${esc(STAT_LABEL[k] || k)}</th>`).join('')}</tr></thead><tbody>${p.log.games.slice(0, 17).map((x) => `<tr><td>${esc(new Date(x.date).toLocaleDateString([], { month: 'numeric', day: 'numeric' }))}</td><td>${esc(x.atVs)} ${esc(x.opp)}</td><td>${esc(x.result)} ${esc(x.score)}</td>${stats.map((k) => `<td class="n">${x.stats[k] ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>` : ''}
    <div class="est">Hit rates use past games against the line shown. Estimates only.</div>
    </div></div>`;
}

// ---------- MY BETS ----------
const Bets = {
  local() { return store.get('bets', []); },
  saveLocal(list) { store.set('bets', list); },
  async load() {
    try {
      const r = await fetch('/api/bets');
      if (r.status === 501) { S.betsMode = 'local'; S.bets = this.local(); return; }
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      S.betsMode = 'cloud'; S.betsNeedPass = !!j.needsPass; S.bets = j.bets || [];
    } catch { S.betsMode = 'local'; S.bets = this.local(); }
  },
  async put(list) {
    if (S.betsMode === 'cloud') {
      const r = await fetch('/api/bets', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bets-pass': store.get('pass', '') }, body: JSON.stringify({ bets: list }) });
      if (r.status === 401) {
        const pass = prompt('Enter your bet log passcode');
        if (pass === null) throw new Error('No passcode');
        store.set('pass', pass);
        return this.put(list);
      }
      if (!r.ok) throw new Error('Could not save');
    }
    for (const b of list) { const i = S.bets.findIndex((x) => x.id === b.id); if (i >= 0) S.bets[i] = b; else S.bets.unshift(b); }
    if (S.betsMode === 'local') this.saveLocal(S.bets);
  },
  async del(id) {
    if (S.betsMode === 'cloud') {
      const r = await fetch(`/api/bets?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'x-bets-pass': store.get('pass', '') } });
      if (!r.ok) throw new Error('Could not delete');
    }
    S.bets = S.bets.filter((b) => b.id !== id);
    if (S.betsMode === 'local') this.saveLocal(S.bets);
  },
};
function profit(b) {
  const st = Number(b.stake) || 0;
  if (b.status === 'won') {
    if (b.payout) return Number(b.payout) - st;
    const o = Number(b.odds) || 0;
    return o > 0 ? (st * o) / 100 : o < 0 ? (st * 100) / Math.abs(o) : 0;
  }
  if (b.status === 'lost') return -st;
  if (b.status === 'cashout') return (Number(b.payout) || 0) - st;
  return 0;
}
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function renderBets() {
  const v = $('#view');
  v.innerHTML = `<h1>My bets</h1><p class="sub">Log every bet to see if you are up or down.</p><a class="guidebtn" href="#/guide"><span>💰</span><div><b>Money guide</b><small>Find your unit size and how much to bet</small></div><i>›</i></a><div id="betsBody"><div class="skel"></div></div>`;
  await Bets.load();
  if (route().name !== 'bets') return;
  drawBets();
  fillAllOpen();
}

function periodRange(p) {
  const now = new Date(); const start = new Date(now);
  if (p === 'week') start.setDate(now.getDate() - 6);
  else if (p === 'month') start.setDate(now.getDate() - 29);
  else if (p === 'year') { start.setMonth(now.getMonth() - 11); start.setDate(1); }
  else start.setFullYear(1970);
  start.setHours(0, 0, 0, 0);
  return start;
}

function drawBets() {
  const el = $('#betsBody');
  if (!el) return;
  const start = periodRange(S.period);
  const inP = S.bets.filter((b) => new Date(b.date + 'T12:00:00') >= start);
  const settled = inP.filter((b) => b.status !== 'pending');
  const net = settled.reduce((s, b) => s + profit(b), 0);
  const staked = settled.reduce((s, b) => s + (Number(b.stake) || 0), 0);
  const w = settled.filter((b) => b.status === 'won').length;
  const l = settled.filter((b) => b.status === 'lost').length;
  const pu = settled.filter((b) => b.status === 'push').length;
  const pending = inP.filter((b) => b.status === 'pending');
  const zone = Math.abs(net) < 0.005 ? 'even' : net > 0 ? 'up' : 'down';

  // chart buckets
  const buckets = [];
  if (S.period === 'year' || S.period === 'all') {
    const months = S.period === 'year' ? 12 : Math.max(1, Math.min(24, (() => { const ds = S.bets.map((b) => new Date(b.date)); if (!ds.length) return 1; const first = new Date(Math.min(...ds)); const n = new Date(); return (n.getFullYear() - first.getFullYear()) * 12 + n.getMonth() - first.getMonth() + 1; })()));
    const n = new Date();
    for (let i = months - 1; i >= 0; i--) { const d = new Date(n.getFullYear(), n.getMonth() - i, 1); buckets.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString([], { month: 'short' }), v: 0 }); }
    for (const b of settled) { const k = String(b.date).slice(0, 7); const x = buckets.find((y) => y.key === k); if (x) x.v += profit(b); }
  } else {
    const days = S.period === 'week' ? 7 : 30;
    for (let i = days - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; buckets.push({ key: k, label: S.period === 'week' ? d.toLocaleDateString([], { weekday: 'short' }) : String(d.getDate()), v: 0 }); }
    for (const b of settled) { const x = buckets.find((y) => y.key === b.date); if (x) x.v += profit(b); }
  }
  let run = 0; for (const b of buckets) { run += b.v; b.cum = run; }
  const W = 600, H = 220, pad = 26;
  const mx = Math.max(1, ...buckets.map((b) => Math.abs(b.v)), ...buckets.map((b) => Math.abs(b.cum)));
  const y = (v) => H / 2 - (v / mx) * (H / 2 - pad);
  const bw = (W - 20) / buckets.length;
  const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Profit and loss chart">
    <line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="#ffffff33"/>
    ${buckets.map((b, i) => `<rect x="${10 + i * bw + bw * 0.15}" width="${bw * 0.7}" y="${Math.min(y(0), y(b.v))}" height="${Math.abs(y(b.v) - y(0)) || 0}" rx="3" fill="${b.v >= 0 ? '#34e39a' : '#ff4d6a'}"/>`).join('')}
    <polyline fill="none" stroke="#b6ff3b" stroke-width="3" stroke-linejoin="round" points="${buckets.map((b, i) => `${10 + i * bw + bw / 2},${y(b.cum)}`).join(' ')}"/>
    ${buckets.map((b, i) => (buckets.length <= 12 || i % 5 === 0 ? `<text x="${10 + i * bw + bw / 2}" y="${H - 4}" text-anchor="middle">${esc(b.label)}</text>` : '')).join('')}
  </svg>`;

  const localCount = Bets.local().length;
  el.innerHTML = `
    <div class="seg" style="margin-bottom:12px">${['week', 'month', 'year', 'all'].map((p) => `<button data-period="${p}" aria-pressed="${S.period === p}">${p === 'all' ? 'All' : p[0].toUpperCase() + p.slice(1)}</button>`).join('')}</div>
    <div class="zone">
      <div class="verd ${zone}"><div class="zl">${zone === 'up' ? "You're up" : zone === 'down' ? "You're down" : 'Even'}</div><div class="bn">${money(net)}</div>
        <div class="kpis"><div>Record<b>${w}-${l}${pu ? '-' + pu : ''}</b></div><div>Win rate<b>${w + l ? Math.round((w / (w + l)) * 100) : 0}%</b></div><div>Return<b>${staked ? Math.round((net / staked) * 100) : 0}%</b></div><div>Pending<b>${pending.length}</b></div></div></div>
      <div class="chart"><div class="est">Bars: profit or loss per ${S.period === 'year' || S.period === 'all' ? 'month' : 'day'}. Line: running total.</div>${svg}</div>
    </div>
    ${(() => {
      const row = (b) => `
      <div class="betrow"><div><button class="ds dsbtn" data-openbet="${esc(b.id)}">${esc(b.desc)} <span class="open">›</span></button>${b.status === 'pending' ? `<div class="lc" data-lc="${esc(b.id)}">${liveChanceText(b)}</div>` : ''}<div class="mt">${esc(b.date)} · ${esc(b.app)} · ${esc(b.sport)} · ${b.odds ? esc(ml(Number(b.odds))) + ' · ' : ''}$${esc(b.stake)}</div>
        <div style="display:flex;gap:6px;margin-top:6px"><select data-status="${esc(b.id)}" aria-label="Result">${['pending', 'won', 'lost', 'push', 'cashout'].map((s) => `<option value="${s}" ${b.status === s ? 'selected' : ''}>${s === 'cashout' ? 'Cashed out' : s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select><button class="ghost" style="min-height:36px;padding:4px 8px" data-del="${esc(b.id)}">Delete</button></div></div>
        <div class="pl ${profit(b) > 0 ? 'pos' : profit(b) < 0 ? 'neg' : ''}">${b.status === 'pending' ? '<span class="tag">Open</span>' : money(profit(b))}</div></div>`;
      const sorted = S.bets.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const open = sorted.filter((b) => b.status === 'pending');
      const done = sorted.filter((b) => b.status !== 'pending');
      return `
    <h2>Open bets <span class="count">${open.length}</span></h2>
    <div style="display:grid;gap:8px">${open.length ? open.map(row).join('') : '<div class="empty">No open bets. Add one below.</div>'}</div>
    <h2>Add a bet</h2>
    <div class="addways">
      <a class="addway" href="#/check"><span>📸</span><b>Scan a slip</b><small>AI fills it in</small></a>
      <a class="addway" href="#/builder"><span>🧱</span><b>Build a parlay</b><small>From today's picks</small></a>
      <button class="addway" data-typebet><span>✍️</span><b>Type it in</b><small>Any bet</small></button>
    </div>
    <div id="typeBet" ${S.typeBet ? '' : 'hidden'}>
    <form class="bet sec" id="betForm">
      <label class="wide">What did you bet?<input name="desc" required maxlength="200" placeholder="e.g. Lions +1.5 or Amon-Ra over 80.5 rec yds"></label>
      <label>App<select name="app"><option>DraftKings</option><option>PrizePicks</option><option>FanDuel</option><option>Other</option></select></label>
      <label>Sport<select name="sport"><option>NFL</option><option>NBA</option><option>College FB</option><option>NHL</option><option>Other</option></select></label>
      <label>Date<input name="date" type="date" value="${today()}" required></label>
      <label>Odds<input name="odds" inputmode="numeric" placeholder="-110 or +150"></label>
      <label>Stake ($)<input name="stake" inputmode="decimal" required placeholder="10"></label>
      <label>Payout if won ($)<input name="payout" inputmode="decimal" placeholder="optional, e.g. PrizePicks"></label>
      <label>Result<select name="status"><option value="pending">Pending</option><option value="won">Won</option><option value="lost">Lost</option><option value="push">Push</option><option value="cashout">Cashed out</option></select></label>
      <button class="pri wide" type="submit">Save bet</button>
    </form>
    </div>
    ${done.length ? `<h2>Settled <span class="count">${done.length}</span></h2><div style="display:grid;gap:8px">${done.map(row).join('')}</div>` : ''}
    <div class="note" style="margin-top:14px">${S.betsMode === 'cloud' ? '☁️ Saved to your account, so you see the same bets on any phone.' : '📱 Saved on this phone.'}</div>
    ${S.betsMode === 'cloud' && localCount ? `<button style="margin-top:8px" data-migrate>Move ${localCount} bets from this phone to the cloud</button>` : ''}`;
    })()}`;
}

// ---------- AI CHECK ----------
// Snap a bet slip: the server reads it with AI, pulls ESPN numbers and grades each pick.
const CK = { img: null, type: 'image/jpeg', res: null, busy: false, err: '' };

function shrinkImage(file) {
  return new Promise((ok, bad) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const max = 1600;
      const k = Math.min(1, max / Math.max(im.width, im.height));
      const c = document.createElement('canvas');
      c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      ok(c.toDataURL('image/jpeg', 0.85));
    };
    im.onerror = () => { URL.revokeObjectURL(url); bad(new Error('Could not open that picture')); };
    im.src = url;
  });
}

function renderCheck() {
  const v = $('#view');
  v.innerHTML = `<h1>AI Check</h1><p class="sub">Add a screenshot of your bet. AI reads it, checks the real numbers on ESPN and tells you what to keep or change.</p><div id="ckBody"></div>`;
  drawCheck();
}

function drawCheck(step = -1) {
  const el = $('#ckBody');
  if (!el) return;
  const steps = ['Reading your slip', 'Pulling player and game numbers', 'Grading each pick'];
  const pick = `<label class="drop"><span class="big">📸</span><b>${CK.img ? 'Use a different picture' : 'Add your bet slip'}</b><span>Screenshot from DraftKings, PrizePicks, FanDuel or a photo</span><input type="file" accept="image/*" id="ckFile"></label>`;
  let html = CK.img ? `<img class="slipimg${CK.res ? ' small' : ''}" src="${CK.img}" alt="Your bet slip">` : '';
  if (CK.busy) {
    html += `<div class="thinking">${steps.map((s, i) => `<div class="st ${i < step ? 'done' : i === step ? 'on' : ''}">${i < step ? '✓' : i === step ? '⏳' : '○'} ${s}</div>`).join('')}<div class="est">Usually takes 10 to 30 seconds.</div></div>`;
  } else {
    html = pick + html;
    if (CK.img && !CK.res) html += `<div class="ckbtns"><button class="pri" data-ckgo>Check my bet</button></div>`;
  }
  if (CK.err) html += `<div class="note" style="margin-top:12px">⚠️ ${esc(CK.err)}</div>`;
  if (CK.res && !CK.busy) html += checkResult(CK.res);
  el.innerHTML = html;
}

function factChips(f) {
  const p = f?.player;
  const out = [];
  const rate = (lbl, r) => r && r.games ? `<span>${lbl} <b>${r.hits}/${r.games}</b> · avg <b>${r.avg}</b></span>` : '';
  if (p) {
    if (p.stat === 'anytime_td' && p.last10) out.push(`<span>TD in <b>${p.last10.hits} of ${p.last10.games}</b> recent games</span>`);
    else out.push(rate('Last 5', p.last5), rate('Last 10', p.last10), rate('Season', p.season));
    if (p.injury && p.injury !== 'none listed') out.push(`<span>🚑 <b>${esc(p.injury)}</b></span>`);
  }
  const g = f?.game;
  if (g) {
    if (g.odds?.line) out.push(`<span>Line <b>${esc(g.odds.line)}</b>${g.odds.total ? ` · O/U <b>${esc(g.odds.total)}</b>` : ''}</span>`);
    if (g.espnWinChance) out.push(`<span>ESPN win chance ${Object.entries(g.espnWinChance).filter(([, x]) => x !== null).map(([k, x]) => `${esc(k)} <b>${Math.round(x)}%</b>`).join(' · ')}</span>`);
  }
  return out.filter(Boolean).join('');
}

function checkResult(r) {
  const { slip, grade, facts = [] } = r;
  if (!grade) return '';
  const legs = slip.legs || [];
  const legCards = legs.map((l, i) => {
    const gl = grade.legs.find((x) => x.index === i) || grade.legs[i] || { call: 'keep', why: '', change: '' };
    const p = facts[i]?.player;
    const faceHTML = p?.headshot ? `<span class="ph"><img src="${esc(p.headshot)}" alt="" onerror="this.remove()"><i>${esc(initials(p.name))}</i></span>` : `<span class="ph"><i>${esc(initials(l.player || l.team))}</i></span>`;
    const tap = p?.id ? ` data-player="${esc(p.league)}:${esc(p.id)}"` : '';
    return `<div class="legcard"><div class="top">${tap ? `<button class="ghost" style="padding:0;min-height:0;background:none"${tap} aria-label="Open player card">${faceHTML}</button>` : faceHTML}<div class="lt">${esc(l.text)}${l.odds ? ` <span class="est">${esc(ml(l.odds))}</span>` : ''}</div><span class="call ${esc(gl.call)}">${esc(gl.call.toUpperCase())}</span></div>
      <div class="facts">${factChips(facts[i])}</div>
      <p class="why">${esc(gl.why)}</p>${gl.change ? `<p class="swap">➜ ${esc(gl.change)}</p>` : ''}</div>`;
  }).join('');
  const sports = [...new Set(legs.map((l) => l.sport))];
  const desc = legs.length === 1 ? legs[0].text : `${legs.length}-leg ${slip.betType === 'pickem' ? 'pick\'em' : 'parlay'}: ${legs.map((l) => l.text).join('; ')}`;
  const status = legs.length && legs.every((l) => l.status === 'won') ? 'won' : legs.some((l) => l.status === 'lost') ? 'lost' : 'pending';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(slip.placed) ? slip.placed : today();
  const sel = (name, opts, cur) => `<select name="${name}">${opts.map((o) => `<option ${o === cur ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  return `
    <div class="gradecard g-${esc(grade.verdict)}"><div class="gl">${esc(grade.grade)}</div><div><h3>${esc(grade.headline)}</h3><p>${esc(grade.summary)}</p></div></div>
    <h2>Pick by pick <span class="count">${legs.length}</span></h2>
    <div style="display:grid;gap:10px">${legCards}</div>
    ${grade.tips?.length ? `<h2>Tips</h2><ul class="tips">${grade.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    <p class="est" style="margin-top:12px">AI estimates from ESPN numbers. Not a sure thing, bet what you can afford.</p>
    <h2>Save to My bets</h2>
    <p class="sub">Filled in from your slip. Fix anything that looks off.</p>
    <form class="bet sec" id="ckForm">
      <label class="wide">What did you bet?<input name="desc" required maxlength="300" value="${esc(desc)}"></label>
      <label>App${sel('app', ['DraftKings', 'PrizePicks', 'FanDuel', 'Other'], slip.app)}</label>
      <label>Sport${sel('sport', ['NFL', 'NBA', 'College FB', 'NHL', 'Other'], sports.length === 1 ? sports[0] : 'Other')}</label>
      <label>Date<input name="date" type="date" value="${esc(date)}" required></label>
      <label>Odds<input name="odds" inputmode="numeric" value="${slip.odds ? esc(ml(slip.odds)) : ''}" placeholder="-110 or +150"></label>
      <label>Stake ($)<input name="stake" inputmode="decimal" required value="${slip.stake ?? ''}" placeholder="10"></label>
      <label>Payout if won ($)<input name="payout" inputmode="decimal" value="${slip.payout ?? ''}" placeholder="optional"></label>
      <label>Result<select name="status">${['pending', 'won', 'lost', 'push'].map((s) => `<option value="${s}" ${s === status ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></label>
      <button class="pri wide" type="submit">Save bet</button>
    </form>
    <div class="ckbtns" style="margin-top:10px"><button data-ckreset>Check another bet</button></div>`;
}

async function runCheck() {
  if (!CK.img || CK.busy) return;
  CK.busy = true; CK.err = ''; CK.res = null;
  let step = 0; drawCheck(step);
  const tick = setInterval(() => { if (step < 2) drawCheck(++step); }, 6000);
  try {
    const r = await fetch('/api/check', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bets-pass': store.get('pass', '') }, body: JSON.stringify({ image: CK.img.split(',')[1], mediaType: CK.type }) });
    const j = await r.json().catch(() => ({ error: 'The check timed out. Try again.' }));
    if (r.status === 401) {
      const pass = prompt('Enter your GIGI Picks passcode');
      clearInterval(tick); CK.busy = false;
      if (pass !== null) { store.set('pass', pass); return runCheck(); }
      CK.err = 'Passcode needed'; return drawCheck();
    }
    if (r.status === 501) CK.err = 'AI Check is built but not switched on yet. It needs an AI key added in Vercel (see the setup steps).';
    else if (!r.ok || !j.grade) CK.err = j.error || 'Something went wrong. Try again.';
    else CK.res = j;
  } catch { CK.err = 'No connection. Try again.'; }
  clearInterval(tick); CK.busy = false;
  if (route().name === 'check') drawCheck();
}

// ---------- BET BUILDER ----------
// Pick legs from today's picks, see the parlay's odds, chance to hit and an A-F grade.
const slipLoad = () => { S.slip = store.get('slip', []).filter((x) => S.games.some((g) => g.id === x.gameId && g.state !== 'post') || !S.games.length); };
const slipSave = () => store.set('slip', S.slip);
function toggleLeg(id) {
  const i = S.slip.findIndex((x) => x.id === id);
  if (i >= 0) S.slip.splice(i, 1);
  else {
    const p = Object.values(S.pickLists).flat().find((x) => x.id === id);
    if (!p) return;
    // one side or total per game (the other side would cancel out)
    S.slip = S.slip.filter((x) => !(x.gameId === p.gameId && x.kind === p.kind && p.kind !== 'prop'));
    S.slip.push(p);
  }
  slipSave();
}

function parlayGrade(legs) {
  if (!legs.length) return null;
  const sameGame = legs.length !== new Set(legs.map((x) => x.gameId)).size;
  let p = legs.reduce((t, x) => t * (x.est / 100), 1);
  const dec = legs.reduce((t, x) => t * decOdds(x.odds), 1);
  const ev = p * dec - 1;
  const worst = legs.reduce((w, x) => ('ABCDF'.indexOf(gradeOf(x.est, x.odds)) > 'ABCDF'.indexOf(w) ? gradeOf(x.est, x.odds) : w), 'A');
  let g = ev >= 0.08 ? 'A' : ev >= 0.02 ? 'B' : ev >= -0.05 ? 'C' : ev >= -0.15 ? 'D' : 'F';
  const order = 'ABCDF';
  if (legs.length >= 4 && order.indexOf(g) < 2) g = order[Math.min(4, order.indexOf(g) + 1)];
  if (legs.length >= 6) g = order[Math.min(4, Math.max(order.indexOf(g), 3))];
  if (order.indexOf(worst) > order.indexOf(g) + 1) g = order[order.indexOf(worst) - 1];
  const notes = [];
  if (legs.length === 1) notes.push('One pick is a straight bet, not a parlay. Add a second leg to build one.');
  if (legs.length >= 4) notes.push(`${legs.length} legs is a lot. Every extra leg makes it much less likely to hit.`);
  const weak = legs.filter((x) => 'DF'.includes(gradeOf(x.est, x.odds)));
  if (weak.length) notes.push(`Weakest leg${weak.length > 1 ? 's' : ''}: ${weak.map((x) => x.pick).join(', ')}. Dropping ${weak.length > 1 ? 'them' : 'it'} would raise the grade.`);
  if (sameGame) notes.push('Two legs from the same game often move together, so the real chance can differ from this estimate.');
  if (!notes.length && legs.length >= 2) notes.push('Every leg grades well on its own. Keep the stake small anyway, parlays swing hard.');
  return { grade: g, chance: p * 100, dec, am: amOdds(dec), ev, notes };
}

// Work out the picks for every game today (and live ones), so bets and the builder can use them.
let picksLoading = null;
function loadTodayPicks({ includeLive = false } = {}) {
  if (picksLoading) return picksLoading;
  picksLoading = (async () => {
    if (!S.games.length) await loadScoreboard();
    const games = S.games.filter((g) => g.league !== 'nhl' && (g.state === 'pre' ? new Date(g.date) - Date.now() < 36 * 3600e3 : includeLive));
    const queue = [...games];
    const work = async () => {
      while (queue.length) {
        const g = queue.shift();
        const [sum, tA, tH] = await Promise.all([loadSum(g.league, g.id, 10 * 60e3), loadTeam(g.league, g.away.id), loadTeam(g.league, g.home.id)]);
        if (g.state === 'pre') await autoProps(g).catch(() => []);
        S.pickLists[g.id] = gamePicks(g, sum, tA?.numbers, tH?.numbers).list;
      }
    };
    await Promise.all([work(), work(), work(), work()]);
  })().finally(() => { picksLoading = null; });
  return picksLoading;
}

async function renderBuilder() {
  const v = $('#view');
  v.innerHTML = `<h1>Bet builder</h1><p class="sub">Tap picks to build a parlay. It grades every pick and the whole parlay from A to F.</p><div id="slipBox"></div><h2>Today's picks</h2><div class="seg" style="margin-bottom:10px">${['all', 'props', ...ALL_LEAGUES.filter((k) => k !== 'nhl')].map((k) => `<button data-bfilter="${k}" aria-pressed="${(S.bFilter || 'all') === k}">${k === 'all' ? 'All' : k === 'props' ? 'Players' : LG[k].label.split(' ')[0]}</button>`).join('')}</div><div id="bPicks"><div class="skel"></div><div class="skel"></div></div>`;
  slipLoad();
  drawSlip();
  await loadTodayPicks();
  if (route().name !== 'builder') return;
  drawBuilderPicks();
}

function drawBuilderPicks() {
  const el = $('#bPicks');
  if (!el) return;
  const f = S.bFilter || 'all';
  const all = Object.values(S.pickLists).flat().filter((p) => !p.bad && (f === 'all' || (f === 'props' ? p.kind === 'prop' : p.league === f)) && S.games.some((g) => g.id === p.gameId && g.state === 'pre'));
  all.sort((a, b) => (b.est - breakEven(b.odds)) - (a.est - breakEven(a.odds)));
  const inSlip = new Set(S.slip.map((x) => x.id));
  el.innerHTML = all.length ? `<div class="blist">${all.map((p) => { const gr = gradeOf(p.est, p.odds); return `<button class="bpick ${inSlip.has(p.id) ? 'on' : ''}" data-addleg="${esc(p.id)}"><span class="grade g${gr}">${gr}</span><span class="bp"><b>${esc(p.pick)}</b><small>${esc(LG[p.league].label)} · ${esc(p.game)} · ${esc(kindLabel[p.kind])}${p.auto ? ' (safe line)' : ''} · ${p.est}% · ${esc(ml(p.odds))}</small></span><span class="plus">${inSlip.has(p.id) ? '✓' : '+'}</span></button>`; }).join('')}</div>` : '<div class="empty">No picks for upcoming games right now. Check back closer to game time.</div>';
}

function drawSlip() {
  const el = $('#slipBox');
  if (!el) return;
  const legs = S.slip;
  const pg = parlayGrade(legs);
  const unit = (() => { const roll = Number(store.get('bankroll', 0)) || 0; const r = RISK[store.get('risk', 'standard')] || RISK.standard; return roll ? (roll * r.pct) / 100 : 0; })();
  const stake = Number(store.get('slipStake', 0)) || (unit ? Math.max(1, Math.round(unit * (legs.length > 1 ? 0.5 : 1) * 100) / 100) : 5);
  if (!legs.length) { el.innerHTML = `<div class="slip empty-slip"><b>Your parlay is empty</b><span>Tap + on a pick below, or let us start one.</span><button class="pri" data-autobuild>⚡ Build one for me</button></div>`; return; }
  el.innerHTML = `<div class="slip">
    <div class="slipgrade"><span class="grade big g${pg.grade}">${pg.grade}</span><div><b>${legs.length === 1 ? 'Straight bet' : `${legs.length}-leg parlay`} · ${esc(ml(pg.am))}</b><small>About ${pg.chance < 1 ? '<1' : Math.round(pg.chance)}% chance to hit (estimate)</small></div></div>
    <div class="legs">${legs.map((x) => { const gr = gradeOf(x.est, x.odds); return `<div class="leg"><span class="grade g${gr}">${gr}</span><div><b>${esc(x.pick)}</b><small>${esc(x.game)} · ${x.est}% · ${esc(ml(x.odds))}</small></div><button class="ghost x" data-addleg="${esc(x.id)}" aria-label="Remove">✕</button></div>`; }).join('')}</div>
    <ul class="tips">${pg.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
    <form id="slipForm" class="slipbet"><label class="appsel">App<select name="app">${['DraftKings', 'FanDuel', 'PrizePicks', 'Other'].map((a) => `<option ${store.get('lastApp', 'DraftKings') === a ? 'selected' : ''}>${a}</option>`).join('')}</select></label><label>Bet ($)<input name="stake" inputmode="decimal" value="${stake}"></label><div class="pays">Pays <b>${usd(stake * pg.dec)}</b>${unit ? `<small>${(stake / unit).toFixed(2).replace(/\.?0+$/, '')} units</small>` : ''}</div><button class="pri" type="submit">Save to My bets</button></form>
    <div class="ckbtns"><button data-shareslip>🔗 Share</button><button data-autobuild>⚡ Rebuild</button><button data-clearslip>Clear</button></div>
    <p class="est">Grades and chances are estimates from ESPN numbers, not sure things.</p></div>`;
}

function autoBuild() {
  const all = Object.values(S.pickLists).flat().filter((p) => !p.bad && S.games.some((g) => g.id === p.gameId && g.state === 'pre') && 'AB'.includes(gradeOf(p.est, p.odds)));
  all.sort((a, b) => (b.est - breakEven(b.odds)) - (a.est - breakEven(a.odds)));
  const used = new Set(); const legs = [];
  for (const p of all) { if (used.has(p.gameId)) continue; used.add(p.gameId); legs.push(p); if (legs.length === 3) break; }
  if (legs.length < 2) { const more = Object.values(S.pickLists).flat().filter((p) => !p.bad && !used.has(p.gameId) && S.games.some((g) => g.id === p.gameId && g.state === 'pre')).sort((a, b) => b.est - a.est); for (const p of more) { if (used.has(p.gameId)) continue; used.add(p.gameId); legs.push(p); if (legs.length === 2) break; } }
  S.slip = legs; slipSave();
}

// ---------- MONEY GUIDE ----------
// Bankroll + unit calculator. Everything stays on this phone.
const RISK = { careful: { pct: 1, label: 'Careful', note: '1% a unit. Best when you are starting out or on a losing run.' }, standard: { pct: 2, label: 'Standard', note: '2% a unit. What most steady bettors use.' }, bold: { pct: 3, label: 'Bold', note: '3% a unit. Bigger swings. Never go above 5%.' } };
const usd = (v) => `$${(Math.round(v * 100) / 100).toFixed(v >= 100 ? 0 : 2).replace(/\.00$/, '')}`;

async function renderGuide() {
  const v = $('#view');
  v.innerHTML = `<button class="back" data-back>‹ My bets</button><h1>Money guide</h1><p class="sub">Set aside money just for betting, then bet the same small slice of it every time. That slice is your unit.</p><div id="guideBody"><div class="skel"></div></div>`;
  if (!S.bets?.length) await Bets.load().catch(() => {});
  if (route().name !== 'guide') return;
  drawGuide();
}

function drawGuide() {
  const el = $('#guideBody');
  if (!el) return;
  const roll = Number(store.get('bankroll', 0)) || 0;
  const risk = RISK[store.get('risk', 'standard')] ? store.get('risk', 'standard') : 'standard';
  const since = store.get('bankrollDate', '');
  const settled = (S.bets || []).filter((b) => b.status !== 'pending' && (!since || String(b.date) >= since));
  const net = settled.reduce((t, b) => t + profit(b), 0);
  const now = Math.max(0, roll + net);
  const unit = (now * RISK[risk].pct) / 100;
  const pendingStake = (S.bets || []).filter((b) => b.status === 'pending').reduce((t, b) => t + (Number(b.stake) || 0), 0);
  const sizes = [
    ['Lean', 0.5, 'A small edge or a long shot. "Close to a coin flip" picks.'],
    ['Normal bet', 1, 'Most bets. A pick you like at a fair price.'],
    ['Strong', 1.5, 'Numbers and news both point the same way.'],
    ['Max', 2, 'Rare. Never more than 2 units on one bet.'],
    ['Parlay or PrizePicks entry', 0.5, 'All picks must hit, so keep these small. 0.25 to 0.5 units.'],
  ];
  el.innerHTML = `
    <form class="sec calc" id="guideForm">
      <label>Your betting money ($)<input name="roll" inputmode="decimal" placeholder="e.g. 200" value="${roll || ''}"></label>
      <div class="seg" style="margin-top:10px">${Object.entries(RISK).map(([k, r]) => `<button type="button" data-risk="${k}" aria-pressed="${risk === k}">${r.label} ${r.pct}%</button>`).join('')}</div>
      <div class="est" style="margin-top:6px">${esc(RISK[risk].note)}</div>
      <button class="pri" type="submit" style="margin-top:10px;width:100%">Save</button>
    </form>
    ${roll ? `
    <div class="unitcard">
      <div class="ul">1 unit</div><div class="uv">${usd(unit)}</div>
      <div class="us">${RISK[risk].pct}% of ${usd(now)}${settled.length ? ` · you started with ${usd(roll)} and are ${net >= 0 ? 'up' : 'down'} ${usd(Math.abs(net))}` : ''}</div>
    </div>
    <h2>How much to bet</h2>
    <div class="sizes">${sizes.map(([n, u, w]) => `<div class="sz"><div><b>${n}</b><small>${w}</small></div><div class="amt">${usd(unit * u)}<small>${u} u</small></div></div>`).join('')}</div>
    <div class="note" style="margin-top:10px">Your unit updates by itself as you win or lose, using the bets in My bets. When you are up, it grows a little. When you are down, it shrinks so you don't dig a deeper hole.</div>
    ${pendingStake > unit * 5 ? `<div class="note warnbox">⚠️ You have ${usd(pendingStake)} riding on open bets. That is more than 5 units at once. Slow down until some of them settle.</div>` : ''}
    ` : '<div class="empty">Type in how much money you have set aside for betting to see your unit.</div>'}
    <h2>The rules</h2>
    <ol class="rules">
      <li><b>Only bet money you can lose.</b> Your betting money is separate from rent, bills and food. Once it's gone, stop.</li>
      <li><b>Bet the same unit every time.</b> Don't bet 5 units because you "feel it". Size goes up only with the numbers, never with emotions.</li>
      <li><b>Never chase.</b> After a loss, the next bet stays the same size. Doubling up to win it back is how bankrolls disappear.</li>
      <li><b>Daily limit: 5 units.</b> No more than 5 units in play at once, and stop for the day if you lose 3 units.</li>
      <li><b>Parlays are treats, not meals.</b> Each extra leg makes it much less likely to hit. Keep them at 0.5 units or less.</li>
      <li><b>Log every bet.</b> Use My bets or AI Check so you see the truth about what's working.</li>
      <li><b>Shop the line.</b> -105 instead of -115 adds up over a season. Check the odds table on each game.</li>
      <li><b>Take breaks.</b> If it stops being fun, step away for a few days.</li>
    </ol>
    <p class="est">Need help? Call or text 1-800-GAMBLER, any time, free.</p>`;
}

// ---------- open one bet ----------
const SPORT_KEY_UI = { NFL: 'nfl', NBA: 'nba', 'College FB': 'cfb', NHL: 'nhl' };
function liveChanceText(b) { const bc = betChance(b); return bc ? `${bc.live ? '🔴 Live' : 'Before kickoff'}: <b>${pctTxt(bc.p)}</b> to hit` : ''; }
function betLegs(b) {
  if (Array.isArray(b.legs) && b.legs.length) return b.legs;
  // older bets: split the description
  const body = String(b.desc).includes(':') && /parlay|pick'em/i.test(b.desc) ? String(b.desc).split(':').slice(1).join(':') : String(b.desc);
  return body.split(';').map((t) => ({ pick: t.trim() })).filter((x) => x.pick);
}
function findLegGame(leg) {
  if (leg.gameId) { const g = S.games.find((x) => x.id === leg.gameId); if (g) return g; }
  const t = String(leg.pick).toLowerCase();
  return S.games.find((g) => [g.home, g.away].some((tm) => [tm.abbr, tm.name].some((n) => n && new RegExp(`\\b${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t)))) || null;
}
// Is this leg winning, losing or done? Works for sides and totals from the live score.
// Chance a leg hits right now, from the score and the time left. Before kickoff it's the pick's estimate.
const SD = { nfl: [13.5, 13], cfb: [16, 16], nba: [12, 18], nhl: [2, 2.2] };
function normCdf(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }
function timeLeft(g) {
  const L = { nfl: [4, 15], cfb: [4, 15], nba: [4, 12], nhl: [3, 20] }[g.league] || [4, 15];
  if (g.state === 'pre') return 1;
  if (g.state === 'post') return 0;
  const [mm, ss] = String(g.clock || '0:00').split(':').map(Number);
  const inPer = (mm || 0) + (ss || 0) / 60;
  const per = g.period || 1;
  if (per > L[0]) return Math.max(0.01, inPer / (L[0] * L[1]));
  return Math.max(0, ((L[0] - per) * L[1] + inPer) / (L[0] * L[1]));
}
function legChance(leg, g) {
  const pre = leg.est ? leg.est / 100 : null;
  if (!g) return pre;
  if (g.state === 'pre') return pre ?? (/^(over|under)\s|[+-]\d/i.test(leg.pick) ? 0.5 : null);
  const a = Number(g.away.score) || 0; const h = Number(g.home.score) || 0;
  const f = timeLeft(g);
  const [sdM, sdT] = SD[g.league] || SD.nfl;
  const tot = /^(over|under)\s+(\d+(\.\d+)?)/i.exec(leg.pick);
  if (tot) {
    const line = parseFloat(tot[2]); const sum = a + h;
    const over = /over/i.test(tot[1]);
    if (f <= 0) return sum === line ? 0.5 : (over ? sum > line : sum < line) ? 1 : 0;
    const full = g.odds?.overUnder || line;
    const mu = sum + full * f;
    const pOver = normCdf((mu - line) / (sdT * Math.sqrt(f)));
    return clamp(over ? pOver : 1 - pOver, 0.01, 0.99);
  }
  const sp = /^(.+?)\s+([+-]\d+(\.\d+)?|ML|moneyline)$/i.exec(String(leg.pick).trim());
  if (sp) {
    const nm = sp[1].toLowerCase();
    const isHome = [g.home.abbr, g.home.name, g.home.full].some((x) => x && x.toLowerCase() === nm);
    const isAway = [g.away.abbr, g.away.name, g.away.full].some((x) => x && x.toLowerCase() === nm);
    if (isHome || isAway) {
      const line = /^[+-]/.test(sp[2]) ? parseFloat(sp[2]) : 0;
      const cur = isHome ? h - a : a - h;
      if (f <= 0) return cur + line === 0 ? 0.5 : cur + line > 0 ? 1 : 0;
      const hs = homeSpread(g, g.odds);
      const exp = hs === null ? -line : isHome ? -hs : hs; // expected full-game margin for this team
      const mu = cur + exp * f + line;
      return clamp(normCdf(mu / (sdM * Math.sqrt(f))), 0.01, 0.99);
    }
  }
  return pre;
}
const pctTxt = (p) => (p === null || p === undefined ? '' : p >= 0.995 ? '100%' : p <= 0.005 ? '0%' : `${Math.round(p * 100)}%`);
// Whole bet: every leg must hit.
function betChance(b) {
  const legs = betLegs(b);
  let p = 1; let live = false; let known = true;
  for (const l of legs) { const g = findLegGame(l); const c = legChance(l, g); if (c === null) { known = false; continue; } if (g && g.state !== 'pre') live = true; p *= c; }
  return known || p < 1 ? { p, live, partial: !known } : null;
}

function legStatus(leg, g) {
  if (!g || g.state === 'pre') return g ? { cls: 'wait', text: `Starts ${fmtDay(g.date)} ${fmtTime(g.date)}` } : null;
  const a = Number(g.away.score) || 0; const h = Number(g.home.score) || 0;
  const done = g.state === 'post';
  const word = (ok, push) => (push ? { cls: 'push', text: done ? 'Push' : 'Tied with the line' } : ok ? { cls: 'win', text: done ? 'Won ✓' : 'Winning right now' } : { cls: 'lose', text: done ? 'Lost ✕' : 'Losing right now' });
  const tot = /^(over|under)\s+(\d+(\.\d+)?)/i.exec(leg.pick);
  if (tot) {
    const line = parseFloat(tot[2]); const sum = a + h; const over = /over/i.test(tot[1]);
    if (done) return word(over ? sum > line : sum < line, sum === line);
    const need = Math.floor(line - sum) + 1; // points still needed to go over
    if (over) return sum > line ? { cls: 'win', text: 'Already over ✓' } : { cls: 'wait', text: `Needs ${need} more point${need === 1 ? '' : 's'}` };
    return sum > line ? { cls: 'lose', text: 'Already over the line ✕' } : { cls: 'wait', text: `${need - 1} point${need - 1 === 1 ? '' : 's'} of room left` };
  }
  const sp = /^(.+?)\s+([+-]\d+(\.\d+)?|ML|moneyline)$/i.exec(String(leg.pick).trim());
  if (sp) {
    const nm = sp[1].toLowerCase();
    const isHome = [g.home.abbr, g.home.name, g.home.full].some((x) => x && x.toLowerCase() === nm);
    const isAway = [g.away.abbr, g.away.name, g.away.full].some((x) => x && x.toLowerCase() === nm);
    if (isHome || isAway) {
      const line = /^[+-]/.test(sp[2]) ? parseFloat(sp[2]) : 0;
      const m = (isHome ? h - a : a - h) + line;
      return word(m > 0, m === 0);
    }
  }
  return { cls: 'wait', text: g.state === 'in' ? 'Game is live' : 'Game over' };
}
// Fill in game, grade and chance for every open bet, so the % shows without opening it.
let fillingAll = false;
async function fillAllOpen() {
  if (fillingAll) return;
  fillingAll = true;
  try {
    for (const b of (S.bets || []).filter((x) => x.status === 'pending')) await fillLegs(b).catch(() => false);
    const r = route().name;
    if (r === 'games') renderGamesBody();
    else if (r === 'bets') for (const el of $$('[data-lc]')) { const b = S.bets.find((x) => x.id === el.dataset.lc); if (b) el.innerHTML = liveChanceText(b); }
  } finally { fillingAll = false; }
}
async function fillLegs(b) {
  const legs = betLegs(b);
  if (legs.every((l) => l.gameId || l.tried || l.kind === 'prop')) return false;
  await loadTodayPicks({ includeLive: true });
  const all = Object.values(S.pickLists).flat();
  const norm = (t) => String(t).toLowerCase().replace(/\s+/g, ' ').trim();
  let changed = false;
  const out = legs.map((l) => {
    if (l.gameId) return l;
    const m = all.find((p) => norm(p.pick) === norm(l.pick));
    if (!m) {
      // line may have moved: match a total by its number, a side by its team
      const tot = /^(over|under)\s+(\d+(\.\d+)?)/i.exec(l.pick);
      const g = tot ? S.games.find((x) => Math.abs((x.odds?.overUnder ?? S.sums[x.id]?.data?.game?.odds?.overUnder ?? -99) - parseFloat(tot[2])) <= 1.5) : findLegGame(l);
      changed = true;
      return g ? { ...l, game: `${g.away.abbr} @ ${g.home.abbr}`, gameId: g.id, league: g.league, kind: tot ? 'total' : 'spread', tried: true } : { ...l, tried: true };
    }
    changed = true;
    return { ...l, game: m.game, gameId: m.gameId, league: m.league, kind: m.kind, est: m.est, odds: m.odds, grade: gradeOf(m.est, m.odds), why: m.why };
  });
  if (!changed) return false;
  const nb = { ...b, legs: out };
  try { await Bets.put([nb]); } catch { Object.assign(b, nb); }
  return true;
}

function openBet(id, again = false) {
  const b = S.bets.find((x) => x.id === id);
  if (!b) return;
  if (!again) fillLegs(b).then((ok) => { if (ok && $('#sheet').open && $('#sheet')._bet === id) openBet(id, true); });
  const legs = betLegs(b);
  const dlg = $('#sheet');
  const keep = $('.sheet', dlg)?.scrollTop || 0;
  const rows = legs.map((l) => {
    const g = findLegGame(l);
    const st = legStatus(l, g);
    const gr = l.grade || (l.est ? gradeOf(l.est, l.odds) : '');
    const score = g && g.state !== 'pre' ? `${g.away.abbr} ${g.away.score ?? 0} - ${g.home.score ?? 0} ${g.home.abbr}${g.state === 'in' ? ` · ${periodName(g)} ${g.clock}` : ' · Final'}` : '';
    return `<div class="obleg ${st?.cls || ''}">
      ${gr ? `<span class="grade g${esc(gr)}">${esc(gr)}</span>` : l.call ? `<span class="call ${esc(l.call)}">${esc(l.call.toUpperCase())}</span>` : (l.tried ? '<span class="grade gwait">–</span>' : '<span class="grade gwait">…</span>')}
      <div><b>${esc(l.pick)}</b><small>${esc([l.game || (g ? `${g.away.abbr} @ ${g.home.abbr}` : ''), l.est ? `${l.est}% estimated` : '', l.odds ? ml(Number(l.odds)) : ''].filter(Boolean).join(' · '))}</small>
      ${score ? `<small class="sc">${esc(score)}</small>` : ''}${l.why ? `<small>${esc(l.why)}</small>` : ''}</div>
      ${st || legChance(l, g) !== null ? `<div class="lrow">${st ? `<span class="lst ${st.cls}">${esc(st.text)}</span>` : ''}${legChance(l, g) !== null && !(g && g.state === 'post') ? `<span class="lpct">${pctTxt(legChance(l, g))} to hit</span>` : ''}${g ? `<button class="ghost golink" data-go="${esc(g.league)}/${esc(g.id)}">Game ›</button>` : ''}</div>` : ''}
    </div>`;
  }).join('');
  const pay = b.payout || (b.odds ? Math.round(b.stake * decOdds(b.odds) * 100) / 100 : null);
  dlg.innerHTML = `<div class="sheet"><div class="grab"><button data-close>Close</button></div>
    <div class="obhead">${b.grade ? `<span class="grade big g${esc(b.grade)}">${esc(b.grade)}</span>` : ''}<div><h3>${legs.length > 1 ? `${legs.length}-leg parlay` : 'Straight bet'}</h3><div class="est">${esc(b.date)} · ${esc(b.app)} · ${b.odds ? esc(ml(Number(b.odds))) + ' · ' : ''}$${esc(b.stake)} to pay ${pay ? usd(pay) : '?'}</div></div><span class="tag ${b.status === 'won' ? 't-ok' : b.status === 'lost' ? 't-out' : ''}">${esc(b.status === 'cashout' ? 'Cashed out' : b.status[0].toUpperCase() + b.status.slice(1))}</span></div>
    ${(() => { const bc = betChance(b); if (!bc || b.status !== 'pending') return ''; const pc = Math.round(bc.p * 100); return `<div class="betodds"><div class="hbtop"><b>${pctTxt(bc.p)}</b><span>${legs.length > 1 ? 'chance the parlay hits' : 'chance this hits'}${bc.live ? ' · live' : ' · before kickoff'}${bc.partial ? ' · props not counted' : ''}</span></div><div class="hbbar"><i style="width:${pc}%;background:${pc >= 60 ? 'var(--win)' : pc >= 35 ? 'var(--warn)' : 'var(--loss)'}"></i></div></div>`; })()}
    <h2 style="margin-top:14px">Your picks <span class="count">${legs.length}</span></h2>
    <div class="oblegs">${rows}</div>
    ${legs.some((l) => l.gameId) ? `<button class="sharebtn" data-sharebet="${esc(b.id)}">🔗 Send this ${legs.length > 1 ? 'parlay' : 'pick'} to a friend</button>` : ''}
    <p class="est" style="margin-top:12px">Winning or losing is worked out from the live score for sides and totals. Player props: check the player's card.</p></div>`;
  dlg._bet = id;
  if (again && keep) $('.sheet', dlg).scrollTop = keep;
  if (!dlg.open) dlg.showModal();
}

// ---------- NEWS ----------
async function renderNews() {
  const v = $('#view');
  v.innerHTML = `<h1>The daily paper</h1><p class="sub">Headlines from around the leagues.</p><div id="newsBody"><div class="news"><div class="skel"></div><div class="skel"></div></div></div>`;
  if (!S.news || Date.now() - S.news.at > 10 * 60e3) {
    try { S.news = { at: Date.now(), list: (await api('/api/news?leagues=nfl,nba,cfb,nhl')).articles }; } catch { S.news = { at: 0, list: [] }; }
  }
  if (route().name !== 'news') return;
  const ours = (S.daily && !S.daily.stale ? S.daily.news || [] : []).map((n) => ({ league: n.league, head: n.head, body: n.body, url: n.url, src: n.src }));
  const list = [...S.news.list, ...ours];
  $('#newsBody').innerHTML = list.length ? `<div class="news">${list.map((n, i) => `
    <a class="story ${i === 0 ? 'lead' : ''}" href="${esc(n.url || '#')}" target="_blank" rel="noopener">
      ${n.img ? `<img src="${esc(n.img)}" alt="" loading="lazy">` : ''}
      <div class="in"><span class="k">${esc(n.league)}${n.date ? ' · ' + esc(fmtDay(n.date)) : ''}${n.src ? ' · ' + esc(n.src) : ''}</span><h3>${esc(n.head)}</h3>${n.body ? `<p>${esc(n.body)}</p>` : ''}</div>
    </a>`).join('')}</div>` : '<div class="empty">No headlines right now.</div>';
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  if (e.target.closest('#hero .livebox') && !e.target.closest('button, a')) {
    S.gameTab = 'plays';
    $$('#gtabs button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.gtab === 'plays'));
    renderGameBody(route());
    $('#gtabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const t = e.target.closest('button, a');
  if (!t) return;
  if (t.id === 'acct') { openAccount(); return; }
  if (t.dataset.wlmode) { showWelcome(t.dataset.wlmode); $('#wlForm input')?.focus(); return; }
  if (t.hasAttribute('data-wlskip')) { hideWelcome(); return; }
  if (t.dataset.wlopen) { e.preventDefault(); if ($('#sheet').open) $('#sheet').close(); showWelcome(t.dataset.wlopen); return; }
  if (t.hasAttribute('data-logout')) { await Auth.go('logout', {}).catch(() => {}); S.user = null; acctBtn(); $('#sheet').close(); toast('Logged out'); await Bets.load(); render(); return; }
  if (t.hasAttribute('data-alerton')) { t.disabled = true; t.textContent = 'Turning on…'; try { await alertsOn(); toast('Alerts are on 🔔'); } catch (err) { toast(err.message); } openAccount(); return; }
  if (t.hasAttribute('data-alertoff')) { await alertsOff(); toast('Alerts are off'); openAccount(); return; }
  if (t.hasAttribute('data-alerttest')) { const r = await fetch('/api/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'test' }) }).then((x) => x.json()).catch(() => ({})); toast(r.sent ? 'Test sent. Check your notifications.' : 'Could not send. Try turning alerts off and on.'); return; }
  if (t.hasAttribute('data-install')) { S.installEvt?.prompt(); S.installEvt = null; return; }
  if (t.hasAttribute('data-homehow')) { openAccount(); return; }
  if (t.hasAttribute('data-homehide')) { store.set('hideHome', true); t.closest('.homebn')?.remove(); return; }
  if (t.hasAttribute('data-shareslip')) { const f = $('#slipForm'); shareParlay(S.slip, { app: f ? new FormData(f).get('app') : '', stake: f ? Number(new FormData(f).get('stake')) : 0 }); return; }
  if (t.dataset.sharebet) { const b = S.bets.find((x) => x.id === t.dataset.sharebet); if (b) shareParlay(betLegs(b), { app: b.app, stake: b.stake }); return; }
  if (t.hasAttribute('data-sharecopy')) { const sh = $('#view')._share; if (sh) { S.slip = sh.legs.map((x) => ({ ...x, game: x.game || '' })); slipSave(); location.hash = '#/builder'; } return; }
  if (t.hasAttribute('data-sharesave')) {
    const sh = $('#view')._share; if (!sh) return;
    const pg = parlayGrade(sh.legs);
    const bet = { id: `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, date: today(), app: sh.app || 'Other', sport: [...new Set(sh.legs.map((x) => LG[x.league]?.label || 'Other'))].length === 1 ? (LG[sh.legs[0].league]?.label || 'Other') : 'Other', desc: sh.legs.length === 1 ? sh.legs[0].pick : `${sh.legs.length}-leg parlay (grade ${pg.grade}): ${sh.legs.map((x) => x.pick).join('; ')}`, odds: pg.am, stake: sh.stake || 0, status: 'pending', payout: sh.stake ? Math.round(sh.stake * pg.dec * 100) / 100 : null, grade: pg.grade, legs: sh.legs.map((x) => ({ pick: x.pick, game: x.game, gameId: x.gameId, league: x.league, kind: x.kind, est: x.est, odds: x.odds, grade: gradeOf(x.est, x.odds) })) };
    await Bets.load();
    try { await Bets.put([bet]); } catch (err) { toast(err.message); return; }
    toast('Saved to My bets ✓'); location.hash = '#/bets'; return;
  }
  if (t.dataset.go) { if ($('#sheet').open) $('#sheet').close(); location.hash = `#/game/${t.dataset.go}`; return; }
  if (t.hasAttribute('data-back')) { if (history.length > 1) history.back(); else location.hash = '#/'; return; }
  if (t.dataset.filter) { S.filter = t.dataset.filter; store.set('filter', S.filter); $$('#chips button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.filter === S.filter)); renderGamesBody(); return; }
  if (t.dataset.gtab) { S.gameTab = t.dataset.gtab; $$('#gtabs button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.gtab === S.gameTab)); renderGameBody(route()); return; }
  if (t.dataset.side) { S.side = t.dataset.side; renderGameBody(route()); return; }
  if (t.dataset.unit) { S.unit = t.dataset.unit; renderGameBody(route()); return; }
  if (t.dataset.player) { const [lg, id] = t.dataset.player.split(':'); if (id) openPlayer(lg, id); return; }
  if (t.hasAttribute('data-close')) { $('#sheet').close(); $('#sheet')._bet = null; return; }
  if (t.dataset.view) { location.hash = t.dataset.view === 'season' ? '#/season' : '#/'; return; }
  if (t.dataset.sleague) { S.sLeague = t.dataset.sleague; store.set('sLeague', S.sLeague); S.sSeason = null; S.sSel = null; renderSeason(); return; }
  if (t.dataset.week) { const [type, week] = t.dataset.week.split(':'); S.sSel = { type, week }; renderSeason(); return; }
  if (t.dataset.day) { S.sSel = { date: t.dataset.day }; renderSeason(); return; }
  if (t.dataset.pseason) { $('#sheet')._season(t.dataset.pseason); return; }
  if (t.dataset.stat) { $('#sheet')._redraw((s) => { s.stat = t.dataset.stat; s.line = null; }); return; }
  if (t.dataset.line) { $('#sheet')._redraw((s) => { s.line = Math.max(0.5, s.line + Number(t.dataset.line)); }); return; }
  if (t.hasAttribute('data-typebet')) { S.typeBet = !S.typeBet; const el = $('#typeBet'); if (el) { el.hidden = !S.typeBet; if (S.typeBet) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } return; }
  if (t.dataset.openbet) { openBet(t.dataset.openbet); return; }
  if (t.dataset.addleg) {
    if (!S.slip.length) S.slip = store.get('slip', []);
    toggleLeg(t.dataset.addleg);
    if (route().name === 'builder') { drawSlip(); drawBuilderPicks(); }
    else { const on = S.slip.some((x) => x.id === t.dataset.addleg); t.classList.toggle('on', on); t.textContent = on ? '✓ In your parlay' : '+ Add to parlay'; $('#gpick')._h = null; }
    return;
  }
  if (t.hasAttribute('data-autobuild')) { autoBuild(); drawSlip(); drawBuilderPicks(); return; }
  if (t.hasAttribute('data-clearslip')) { S.slip = []; slipSave(); drawSlip(); drawBuilderPicks(); return; }
  if (t.dataset.bfilter) { S.bFilter = t.dataset.bfilter; $$('[data-bfilter]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.bfilter === S.bFilter)); drawBuilderPicks(); return; }
  if (t.dataset.risk) { store.set('risk', t.dataset.risk); drawGuide(); return; }
  if (t.dataset.pf) { S.playFilter = t.dataset.pf; renderGameBody(route()); return; }
  if (t.dataset.period) { S.period = t.dataset.period; drawBets(); return; }
  if (t.hasAttribute('data-ckgo')) { runCheck(); return; }
  if (t.hasAttribute('data-ckreset')) { CK.img = null; CK.res = null; CK.err = ''; drawCheck(); return; }
  if (t.dataset.del) { if (confirm('Delete this bet?')) { try { await Bets.del(t.dataset.del); } catch (err) { alert(err.message); } drawBets(); } return; }
  if (t.hasAttribute('data-migrate')) { try { await Bets.put(Bets.local()); store.set('bets', []); } catch (err) { alert(err.message); } drawBets(); }
});
document.addEventListener('change', async (e) => {
  if (e.target.closest('#slipForm')) { store.set('slipStake', Number(e.target.value) || 0); drawSlip(); return; }
  if (e.target.id === 'ckFile') {
    const f = e.target.files?.[0];
    if (!f) return;
    try { CK.img = await shrinkImage(f); CK.type = 'image/jpeg'; CK.res = null; CK.err = ''; } catch (err) { CK.err = err.message; }
    drawCheck();
    if (CK.img) runCheck();
    return;
  }
  if (e.target.id === 'seasonPick') { S.sSeason = Number(e.target.value); S.sSel = null; renderSeason(); return; }
  const s = e.target.closest('[data-status]');
  if (!s) return;
  const b = S.bets.find((x) => x.id === s.dataset.status);
  if (!b) return;
  let payout = b.payout;
  if (s.value === 'cashout') { const v = prompt('How much did you cash out for? ($)', b.payout || ''); if (v === null) { s.value = b.status; return; } payout = Number(v) || 0; }
  try { await Bets.put([{ ...b, status: s.value, payout }]); } catch (err) { alert(err.message); }
  drawBets();
});
document.addEventListener('submit', async (e) => {
  if (e.target.id === 'wlForm') { e.preventDefault(); submitWelcome(e.target); return; }
  if (e.target.id === 'slipForm') {
    e.preventDefault();
    const stake = Number(new FormData(e.target).get('stake')) || 0;
    const pg = parlayGrade(S.slip);
    if (!stake || !pg) return;
    const sports = [...new Set(S.slip.map((x) => LG[x.league].label))];
    const app = String(new FormData(e.target).get('app') || 'Other'); store.set('lastApp', app);
    const legs = S.slip.map((x) => ({ pick: x.pick, game: x.game, gameId: x.gameId, league: x.league, kind: x.kind, est: x.est, odds: x.odds, grade: gradeOf(x.est, x.odds) }));
    const bet = { id: `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, date: today(), app, sport: sports.length === 1 ? sports[0] : 'Other', desc: S.slip.length === 1 ? S.slip[0].pick : `${S.slip.length}-leg parlay (grade ${pg.grade}): ${S.slip.map((x) => x.pick).join('; ')}`, odds: pg.am, stake, status: 'pending', payout: Math.round(stake * pg.dec * 100) / 100, grade: pg.grade, legs };
    await Bets.load();
    try { await Bets.put([bet]); } catch (err) { alert(err.message); return; }
    S.slip = []; slipSave();
    location.hash = '#/bets';
    return;
  }
  if (e.target.id === 'guideForm') {
    e.preventDefault();
    const v = Number(String(new FormData(e.target).get('roll')).replace(/[$,]/g, '')) || 0;
    if (v !== Number(store.get('bankroll', 0))) { store.set('bankroll', v); store.set('bankrollDate', today()); }
    drawGuide();
    return;
  }
  if (e.target.id !== 'betForm' && e.target.id !== 'ckForm') return;
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const bet = { id: `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, date: f.date, app: f.app, sport: f.sport, desc: f.desc.trim(), odds: Number(String(f.odds).replace('+', '')) || 0, stake: Number(f.stake) || 0, status: f.status, payout: f.payout ? Number(f.payout) : null };
  if (!bet.desc || !bet.stake) return;
  if (e.target.id === 'ckForm') { await Bets.load(); if (CK.res?.slip?.legs) bet.legs = CK.res.slip.legs.map((l, i) => { const gl = CK.res.grade?.legs?.find((x) => x.index === i); return { pick: l.text, game: CK.res.facts?.[i]?.game?.matchup || '', gameId: CK.res.facts?.[i]?.game?.gameId || '', league: SPORT_KEY_UI[l.sport] || '', kind: l.market === 'spread' ? 'spread' : l.market === 'game_total' ? 'total' : 'prop', odds: l.odds, call: gl?.call, why: gl?.why }; }); if (CK.res?.grade?.grade) bet.grade = CK.res.grade.grade; }
  try { await Bets.put([bet]); } catch (err) { alert(err.message); return; }
  if (e.target.id === 'ckForm') { location.hash = '#/bets'; return; }
  drawBets();
});
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') $('#sheet').close(); });
$('#sheet').addEventListener('close', () => { $('#sheet')._bet = null; });

// countdown ticker (every second)
setInterval(() => { for (const el of $$('[data-cd]')) el.textContent = countdown(el.dataset.cd); }, 1000);
setInterval(() => { for (const el of $$('[data-ago]')) el.textContent = agoText(el.dataset.ago); }, 30e3);
// "updated Xs ago"
setInterval(() => { if (S.updated && !S.err && !S.games.some((g) => g.state === 'in')) $('#pulseText').textContent = `Updated ${Math.max(1, Math.round((Date.now() - S.updated) / 1000))}s ago`; }, 5000);
// refresh right away when coming back to the app
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { loadScoreboard(); const r = route(); if (r.name === 'game') loadSum(r.league, r.id, 0).then(() => renderGameLive(r)); } });

// ---------- ACCOUNTS ----------
// Sign up / log in. Bets follow the account to any phone. Guests keep bets on this phone.
const Auth = {
  async me() {
    try {
      const r = await fetch('/api/auth', { cache: 'no-store' });
      if (r.status === 501) { S.noDB = true; S.user = null; return null; }
      const j = await r.json(); S.noDB = false; S.user = j.user || null; return S.user;
    } catch { S.user = null; return null; }
  },
  async go(action, data) {
    const r = await fetch('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...data }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong. Try again.');
    return j;
  },
};
function acctBtn() {
  const b = $('#acct');
  if (!b) return;
  b.innerHTML = S.user ? `<span class="av">${esc(initials(S.user.name))}</span>` : '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
  b.setAttribute('aria-label', S.user ? `Account: ${S.user.name}` : 'Log in or sign up');
}
// Move bets saved on this phone into the account, once.
async function moveLocalBets() {
  const local = Bets.local();
  if (!S.user || !local.length || store.get('movedTo', '') === S.user.id) return;
  const r = await fetch('/api/bets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bets: local }) });
  if (r.ok) store.set('movedTo', S.user.id);
}
function welcomeHTML(mode) {
  const noDB = S.noDB;
  return `<div class="wl-card">
    <img class="wl-logo" src="/icon.svg" alt="">
    <h1 class="wl-name">GIGI<b>PICKS</b></h1>
    <p class="wl-tag">Smarter picks, live plays and a tracker for every bet.</p>
    <ul class="wl-points"><li>🎯 Picks graded A to F</li><li>📈 Live chance your parlay hits</li><li>🔔 Alerts when your picks hit</li></ul>
    ${noDB ? `<p class="wl-note">Accounts are almost ready. They turn on as soon as the free database is connected.</p><button class="pri wl-go" data-wlskip>Let's go</button>` : `
    <div class="seg wl-seg"><button data-wlmode="signup" aria-pressed="${mode === 'signup'}">Sign up</button><button data-wlmode="login" aria-pressed="${mode === 'login'}">Log in</button></div>
    <form id="wlForm" class="wl-form" data-mode="${mode}" novalidate>
      ${mode === 'signup' ? '<label>Name<input name="name" autocomplete="given-name" required maxlength="40" placeholder="Your first name"></label>' : ''}
      <label>Email<input name="email" type="email" inputmode="email" autocomplete="email" required placeholder="you@email.com"></label>
      <label>Password<input name="password" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" required minlength="8" placeholder="${mode === 'signup' ? 'At least 8 characters' : 'Your password'}"></label>
      <div class="wl-err" id="wlErr" role="alert"></div>
      <button class="pri" type="submit">${mode === 'signup' ? 'Create my account' : 'Log in'}</button>
    </form>
    <button class="ghost wl-skip" data-wlskip>Just look around first</button>`}
    <p class="wl-fine">Not a sportsbook. You place bets in your own apps; GIGI Picks helps you choose and keeps track. Picks are estimates.</p>
  </div>`;
}
function showWelcome(mode = 'signup') {
  let w = $('#welcome');
  if (!w) { w = document.createElement('div'); w.id = 'welcome'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-label', 'Welcome to GIGI Picks'); document.body.appendChild(w); }
  w.innerHTML = welcomeHTML(mode);
  w.hidden = false;
  document.body.classList.add('wl-open');
  requestAnimationFrame(() => w.classList.add('in'));
}
function hideWelcome() {
  const w = $('#welcome'); if (!w) return;
  store.set('welcomed', true);
  w.classList.remove('in');
  document.body.classList.remove('wl-open');
  setTimeout(() => { w.hidden = true; }, 250);
}
async function submitWelcome(form) {
  const mode = form.dataset.mode;
  const f = Object.fromEntries(new FormData(form));
  const err = $('#wlErr');
  const btn = form.querySelector('button[type=submit]');
  err.textContent = '';
  if (mode === 'signup' && !String(f.name || '').trim()) { err.textContent = 'Add your name.'; return; }
  if (!/^\S+@\S+\.\S+$/.test(f.email || '')) { err.textContent = 'Enter a real email address.'; return; }
  if (String(f.password || '').length < 8) { err.textContent = 'Passwords are at least 8 characters.'; return; }
  btn.disabled = true; btn.textContent = mode === 'signup' ? 'Creating…' : 'Logging in…';
  try {
    const j = await Auth.go(mode, f);
    S.user = j.user;
    await moveLocalBets();
    acctBtn();
    hideWelcome();
    toast(mode === 'signup' ? `Welcome, ${S.user.name}! 🎉` : `Welcome back, ${S.user.name}`);
    await Bets.load();
    render();
  } catch (e2) {
    err.textContent = e2.message;
    btn.disabled = false; btn.textContent = mode === 'signup' ? 'Create my account' : 'Log in';
  }
}

// ---------- ALERTS (Web Push) ----------
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushOK = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function b64ToBytes(s) { const p = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); }
async function swReg() { if (!('serviceWorker' in navigator)) return null; try { return await navigator.serviceWorker.register('/sw.js'); } catch { return null; } }
async function alertsState() {
  if (!pushOK()) return isIOS && !isStandalone() ? 'needs-home' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}
async function alertsOn() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Alerts were not allowed. You can allow them in your phone settings.');
  const reg = await swReg();
  if (!reg) throw new Error('This browser cannot do alerts.');
  await navigator.serviceWorker.ready;
  const { publicKey } = await fetch('/api/push').then((r) => r.json());
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  const r = await fetch('/api/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'subscribe', subscription: sub.toJSON() }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not turn on alerts.');
}
async function alertsOff() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) { await fetch('/api/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'unsubscribe', endpoint: sub.endpoint }) }).catch(() => {}); await sub.unsubscribe(); }
}
// While the site is open during a live game, nudge the alert checker too (it runs at most once a minute).
setInterval(() => { if (S.user && document.visibilityState === 'visible' && S.games.some((g) => g.state === 'in')) fetch('/api/notify').catch(() => {}); }, 90e3);

const homeSteps = () => (isIOS
  ? '<ol class="steps"><li>Tap the <b>Share</b> button <span class="kbd">⬆︎</span> at the bottom of Safari.</li><li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. Open GIGI Picks from your home screen from now on.</li></ol>'
  : S.installEvt ? '<button class="pri" data-install>📲 Add GIGI Picks to my home screen</button>' : '<ol class="steps"><li>Tap the browser menu <span class="kbd">⋮</span>.</li><li>Tap <b>Add to Home screen</b> or <b>Install app</b>.</li></ol>');
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; });

async function openAccount() {
  const dlg = $('#sheet');
  dlg._bet = null;
  const st = await alertsState();
  const alertBox = !S.user ? '<p class="est">Log in to get alerts on your phone.</p>'
    : st === 'needs-home' ? `<p>On iPhone, alerts work once GIGI Picks is on your home screen:</p>${homeSteps()}`
    : st === 'unsupported' ? '<p class="est">This browser can’t show alerts. Try Safari on iPhone or Chrome on Android.</p>'
    : st === 'blocked' ? '<p class="est">Alerts are blocked for this site. Turn them on in your phone’s settings for this browser, then come back.</p>'
    : st === 'on' ? '<div class="alert-on">🔔 Alerts are on for this phone</div><div class="ckbtns"><button data-alerttest>Send a test</button><button data-alertoff>Turn off</button></div>'
    : '<button class="pri" data-alerton>🔔 Turn on alerts</button>';
  dlg.innerHTML = `<div class="sheet"><div class="grab"><button data-close>Close</button></div>
    ${S.user ? `<div class="acct-head"><span class="av big">${esc(initials(S.user.name))}</span><div><h3>${esc(S.user.name)}</h3><div class="est">${esc(S.user.email)}</div></div></div>
      <div class="acct-row">☁️ Your bets are saved to your account, so they show on any phone you log in on.</div>`
    : `<h3>Your account</h3><p class="sub" style="margin-top:6px">Make a free account so your bets follow you and you can get alerts.</p><div class="ckbtns"><button class="pri" data-wlopen="signup">Sign up</button><button data-wlopen="login">Log in</button></div>`}
    <h2>Alerts</h2>
    <p class="est" style="margin-top:-4px">We ping you when a game with your pick starts, when a pick hits or misses, when it’s down to the wire, and when you’re one leg away.</p>
    <div id="alertBox">${alertBox}</div>
    ${S.user ? '<button class="ghost logout" data-logout>Log out</button>' : ''}
  </div>`;
  if (!dlg.open) dlg.showModal();
}

// ---------- SHARE A PARLAY ----------
// The whole parlay rides inside the link, so there is nothing to store.
const b64url = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0)));
function shareCode(legs, meta = {}) {
  return b64url(JSON.stringify({ v: 1, n: meta.name || S.user?.name || '', a: meta.app || '', s: meta.stake || 0, l: legs.map((x) => [x.pick, x.league || '', x.gameId || '', x.est || 0, x.odds || 0, x.kind || '', x.game || '']) }));
}
function readShare(code) {
  try {
    const j = JSON.parse(unb64url(code));
    return { name: String(j.n || '').slice(0, 40), app: String(j.a || '').slice(0, 30), stake: Number(j.s) || 0, legs: (j.l || []).slice(0, 15).map((x, i) => ({ id: `${x[2] || 'x'}:shared:${i}`, pick: String(x[0] || '').slice(0, 120), league: LG[x[1]] ? x[1] : '', gameId: String(x[2] || '').replace(/\D/g, ''), est: Number(x[3]) || 0, odds: Number(x[4]) || -110, kind: String(x[5] || ''), game: String(x[6] || '').slice(0, 40) })) };
  } catch { return null; }
}
async function shareParlay(legs, meta) {
  if (!legs.length) return;
  const url = `${location.origin}/#/share/${shareCode(legs, meta)}`;
  const text = `${meta?.name || S.user?.name || 'Someone'} shared a ${legs.length > 1 ? `${legs.length}-leg parlay` : 'pick'} on GIGI Picks`;
  try {
    if (navigator.share) { await navigator.share({ title: 'GIGI Picks parlay', text, url }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url); toast('Link copied. Paste it to a friend 📋'); }
  catch { prompt('Copy this link', url); }
}
async function renderShare(r) {
  const v = $('#view');
  const sh = readShare(r.code || '');
  if (!sh || !sh.legs.length) { v.innerHTML = '<h1>Shared parlay</h1><div class="empty">This link looks broken. Ask your friend to send it again.</div>'; return; }
  const draw = () => {
    if (route().name !== 'share') return;
    const pg = parlayGrade(sh.legs);
    const fake = { legs: sh.legs, odds: pg.am, stake: sh.stake };
    const bc = betChance(fake);
    v.innerHTML = `<h1>${sh.name ? `${esc(sh.name)}'s parlay` : 'Shared parlay'}</h1>
      <p class="sub">${sh.legs.length > 1 ? `${sh.legs.length} picks` : '1 pick'}${sh.app ? ` · ${esc(sh.app)}` : ''}${sh.stake ? ` · $${esc(sh.stake)} bet` : ''}</p>
      <div class="slip">
        <div class="slipgrade"><span class="grade big g${pg.grade}">${pg.grade}</span><div><b>${sh.legs.length === 1 ? 'Straight bet' : `${sh.legs.length}-leg parlay`} · ${esc(ml(pg.am))}</b><small>${bc ? `${pctTxt(bc.p)} chance to hit${bc.live ? ' · live' : ''}` : 'Chance shows once games load'}</small></div></div>
        ${bc ? `<div class="hbbar"><i style="width:${Math.round(bc.p * 100)}%;background:${bc.p >= 0.6 ? 'var(--win)' : bc.p >= 0.35 ? 'var(--warn)' : 'var(--loss)'}"></i></div>` : ''}
        <div class="legs">${sh.legs.map((x) => { const g = findLegGame(x); const st = legStatus(x, g); const gr = x.est ? gradeOf(x.est, x.odds) : '–'; return `<div class="leg"><span class="grade g${gr}">${gr}</span><div><b>${esc(x.pick)}</b><small>${esc([x.game || (g ? `${g.away.abbr} @ ${g.home.abbr}` : ''), x.est ? `${x.est}%` : '', ml(x.odds)].filter(Boolean).join(' · '))}</small>${st ? `<small class="lst ${st.cls}">${esc(st.text)}</small>` : ''}</div>${g ? `<button class="ghost golink" data-go="${esc(g.league)}/${esc(g.id)}">Game ›</button>` : ''}</div>`; }).join('')}</div>
        <div class="ckbtns"><button class="pri" data-sharecopy>🧱 Open in my Builder</button><button data-sharesave>Save to My bets</button></div>
        <p class="est">Grades and chances are estimates from ESPN numbers.</p>
      </div>
`;
  };
  v._share = sh;
  draw();
  if (!S.games.length) await loadScoreboard().catch(() => {});
  draw();
}

// ---------- WIN CHANCE CHART ----------
// Slide a finger along the line to see the score, clock and play at any moment of the game.
function wpChartHTML(g, line) {
  if (!line || line.length < 2) return '';
  const W = 340; const H = 120; const total = Math.max(g.wpLen || 60, line[line.length - 1].x);
  const X = (x) => (x / total) * W; const Y = (h) => H - (h / 100) * H;
  const d = line.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.h).toFixed(1)}`).join('');
  const [ca, ch] = colors(g);
  const qs = [1, 2, 3].map((q) => `<line x1="${X((total / 4) * q)}" x2="${X((total / 4) * q)}" y1="0" y2="${H}" class="wq"/>`).join('');
  const scores = line.filter((p) => p.sc).map((p) => `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.h).toFixed(1)}" r="2.6" class="wsc"/>`).join('');
  return `<div class="wpcard sec" id="wpCard" data-total="${total}">
    <div class="hd"><h3>Win chance</h3><span class="est">slide along the line</span></div>
    <div class="wpinfo" id="wpInfo"></div>
    <div class="wpwrap"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="wpsvg" id="wpSvg" aria-label="Win chance through the game">
      <defs><clipPath id="wpTop"><rect x="0" y="0" width="${W}" height="${H / 2}"/></clipPath><clipPath id="wpBot"><rect x="0" y="${H / 2}" width="${W}" height="${H / 2}"/></clipPath></defs>
      ${qs}<line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="wmid"/>
      <path d="${d}L${X(line[line.length - 1].x).toFixed(1)},${H / 2}L0,${H / 2}Z" fill="${esc(ch)}" opacity=".28" clip-path="url(#wpTop)"/>
      <path d="${d}L${X(line[line.length - 1].x).toFixed(1)},${H / 2}L0,${H / 2}Z" fill="${esc(ca)}" opacity=".28" clip-path="url(#wpBot)"/>
      <path d="${d}" fill="none" stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
      ${scores}
      <line id="wpCur" x1="0" x2="0" y1="0" y2="${H}" class="wcur"/>
    </svg><span class="wpdot" id="wpDot"></span></div>
    <div class="wpteams"><span style="color:${esc(ch)}">${esc(g.home.abbr)} ↑</span><span style="color:${esc(ca)}">${esc(g.away.abbr)} ↓</span></div>
  </div>`;
}
function wpShow(i) {
  const card = $('#wpCard'); const line = card?._line; const g = card?._g;
  if (!line || !g) return;
  const p = line[clamp(i, 0, line.length - 1)];
  const total = Number(card.dataset.total);
  const fx = p.x / total; const fy = 1 - p.h / 100;
  const cur = $('#wpCur'); const W = 340;
  cur.setAttribute('x1', fx * W); cur.setAttribute('x2', fx * W);
  const dot = $('#wpDot'); dot.style.left = `${fx * 100}%`; dot.style.top = `${fy * 100}%`;
  const fav = p.h >= 50 ? g.home : g.away; const pc = p.h >= 50 ? p.h : 100 - p.h;
  $('#wpInfo').innerHTML = `<div class="wpi1"><b>${esc(fav.abbr)} ${Math.round(pc)}%</b><span>${esc(p.c)}${p.a !== null ? ` · ${esc(g.away.abbr)} ${p.a}-${p.s} ${esc(g.home.abbr)}` : ''}</span></div><div class="wpi2">${p.sc ? '🔥 ' : ''}${esc(p.t)}</div>`;
}
function wpMount(g, line) {
  const box = $('#wpBox');
  if (!box) return;
  const key = `${g.id}:${line?.length || 0}`;
  if (box._k === key) return;
  box._k = key;
  const touching = box._touch;
  box.innerHTML = wpChartHTML(g, line);
  const card = $('#wpCard');
  if (!card) return;
  card._line = line; card._g = g;
  wpShow(line.length - 1);
  const svgWrap = $('.wpwrap', card);
  const at = (clientX) => { const r = svgWrap.getBoundingClientRect(); const x = clamp((clientX - r.left) / r.width, 0, 1) * Number(card.dataset.total); let best = 0; for (let i = 1; i < line.length; i++) if (Math.abs(line[i].x - x) < Math.abs(line[best].x - x)) best = i; return best; };
  svgWrap.addEventListener('pointerdown', (e) => { box._touch = true; svgWrap.setPointerCapture(e.pointerId); wpShow(at(e.clientX)); });
  svgWrap.addEventListener('pointermove', (e) => { if (box._touch || e.pointerType === 'mouse') wpShow(at(e.clientX)); });
  const end = () => { box._touch = false; };
  svgWrap.addEventListener('pointerup', end); svgWrap.addEventListener('pointercancel', end);
  svgWrap.addEventListener('mouseleave', () => wpShow(line.length - 1));
  if (touching) box._touch = true;
}

// ---------- MOVING TO THE NEW ADDRESS ----------
// Bets saved on a phone belong to the web address. The old address sends them over in the link.
const NEW_HOST = 'gigipicks.vercel.app';
function moveLink() {
  const bets = store.get('bets', []);
  const extra = { bankroll: store.get('bankroll', 0), risk: store.get('risk', ''), slip: store.get('slip', []) };
  return `https://${NEW_HOST}/${bets.length || extra.bankroll ? `#/import/${b64url(JSON.stringify({ bets, ...extra }))}` : ''}`;
}
// On the old address: a banner with a button, instead of jumping automatically.
function moveBanner() {
  if (location.hostname !== 'my-gigipicks.vercel.app') return '';
  return `<div class="homebn"><span>📦</span><div><b>GIGI Picks has a new link</b><small>Tap to move your bets to ${NEW_HOST}.</small></div><a class="pri btnlink" href="${esc(moveLink())}">Move</a></div>`;
}
function importBets(code) {
  let j = null;
  try { j = JSON.parse(unb64url(code)); } catch {}
  const have = store.get('bets', []);
  const ids = new Set(have.map((b) => b.id));
  const add = (j?.bets || []).filter((b) => b && b.id && !ids.has(b.id));
  if (add.length) store.set('bets', [...add, ...have]);
  if (j?.bankroll && !store.get('bankroll', 0)) store.set('bankroll', j.bankroll);
  if (j?.risk && !store.get('risk', '')) store.set('risk', j.risk);
  if (j?.slip?.length && !store.get('slip', []).length) store.set('slip', j.slip);
  history.replaceState(null, '', '#/bets');
  render();
  Bets.load().then(() => { if (route().name === 'bets') drawBets(); });
  setTimeout(() => toast(add.length ? `Moved ${add.length} bet${add.length === 1 ? '' : 's'} over ✓` : 'Your bets are already here ✓'), 400);
}

// ---------- LITTLE THINGS ----------
function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600);
}
function homeBanner() {
  if (isStandalone() || store.get('hideHome', false) || !/android|iphone|ipad|ipod/i.test(navigator.userAgent + (isIOS ? 'iphone' : ''))) return '';
  return `<div class="homebn"><span>📲</span><div><b>Add GIGI Picks to your home screen</b><small>Opens like an app${S.user ? ' and can send you alerts' : ''}.</small></div><button data-homehow>How</button><button class="ghost x" data-homehide aria-label="Hide">✕</button></div>`;
}

window.addEventListener('hashchange', render);
(async () => {
  render();
  swReg();
  Bets.load().then(() => { if (route().name === 'games') renderGamesBody(); fillAllOpen(); }).catch((e) => console.warn('open bets strip', e));
  await loadDaily();
  loadScoreboard();
})();
