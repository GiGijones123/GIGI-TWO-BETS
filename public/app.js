// Bets Daily v2 — live site. Plain JavaScript, no build step.
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
  lastSeen: {}, flash: new Set(),
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

function estimate(g, sum, nA, nH) {
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
  if (margin !== null && hs !== null) {
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
  if (cur) {
    return { top: { pick: cur.pick, est: cur.est, odds: cur.odds, book: cur.book, why: cur.why, curated: true }, alt: picks, reasons };
  }
  return { top: picks[0] || null, alt: picks.slice(1), reasons };
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
  return { name: 'games' };
}
function setTab(name) {
  $$('#tabbar a').forEach((a) => { if (a.dataset.tab !== name) a.removeAttribute('aria-current'); else a.setAttribute('aria-current', 'page'); });
}
let gameTimer = null;
function render() {
  const r = route();
  clearTimeout(gameTimer);
  setTab(r.name === 'game' ? 'games' : r.name);
  if (r.name === 'games') renderGames();
  else if (r.name === 'game') renderGame(r);
  else if (r.name === 'bets') renderBets();
  else renderNews();
}
function onData() {
  const r = route();
  if (r.name === 'games') { renderGamesBody(); warmSummaries(); }
  else if (r.name === 'game') renderGameLive(r);
}

// ---------- GAMES ----------
function renderGames() {
  const v = $('#view');
  const today = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  v.innerHTML = `
    <h1>Game day</h1>
    <p class="sub">${esc(today)}. Scores, clocks and plays update on their own.</p>
    <div id="tickerWrap"></div>
    <div id="picksWrap"></div>
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

function renderGamesBody() {
  if (!$('#lists')) return;
  const shown = S.games.filter((g) => S.filter === 'all' || g.league === S.filter);
  const live = shown.filter((g) => g.state === 'in');

  // live ticker: latest play + latest injury from each live game
  const items = [];
  for (const g of live) {
    const inj = S.sums[g.id]?.data?.liveInjuries?.[0];
    if (inj) items.push({ g, text: inj.text, inj: true, when: `${inj.periodLabel || periodName(g)} ${inj.clock}` });
    if (g.lastPlay) items.push({ g, text: g.lastPlay, when: `${periodName(g)} ${g.clock}` });
  }
  setHTML($('#tickerWrap'), items.length ? `<h2>Live feed <span class="count">${live.length} live</span></h2><div class="ticker">${items.map((t) => `
    <button class="tick ${t.inj ? 'inj' : ''} ${S.flash.has(t.inj ? 'inj' + t.g.id : t.g.id) ? 'flash' : ''}" data-go="${t.g.league}/${t.g.id}">
      <span class="h"><span>${t.inj ? '🚑 Injury' : '🔴 Last play'} · ${esc(t.g.away.abbr)} ${t.g.away.score ?? ''} – ${esc(t.g.home.abbr)} ${t.g.home.score ?? ''}</span><span>${esc(t.when)}</span></span>
      <p>${esc(t.text)}</p>
    </button>`).join('')}</div>` : '');

  // top picks: the strongest estimates among games not yet started
  const ps = [];
  for (const g of shown.filter((x) => x.state === 'pre')) {
    const sum = S.sums[g.id]?.data;
    const e = estimate(g, sum);
    if (e.top && (e.top.curated || e.top.est >= 54)) ps.push({ g, e });
  }
  ps.sort((a, b) => b.e.top.est - a.e.top.est);
  setHTML($('#picksWrap'), ps.length ? `<h2>Top picks <span class="count">estimates</span></h2><div class="strip">${ps.slice(0, 6).map(({ g, e }) => `
    <button class="hp" data-go="${g.league}/${g.id}">
      <span class="k">${esc(LG[g.league].label)} · ${esc(g.away.abbr)} @ ${esc(g.home.abbr)} · ${esc(fmtDay(g.date))}</span>
      <span class="p">${esc(e.top.pick)}</span>
      <span class="w">${e.top.est}% estimated${e.top.curated ? ' · hand-picked' : ''}</span>
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
    ${live && g.lastPlay ? `<div class="lp ${S.flash.has(g.id) ? 'flash' : ''}"><b>Last play</b>${esc(g.lastPlay)}</div>` : ''}
    ${inj ? `<div class="lp inj"><b style="color:var(--loss)">Injury</b>${esc(inj.text)}</div>` : ''}
    ${o ? `<div class="odds">${o.details ? `<span><b>Spread</b>${esc(o.details)}</span>` : ''}${o.overUnder ? `<span><b>O/U</b>${o.overUnder}</span>` : ''}${o.awayML ? `<span><b>ML</b>${esc(g.away.abbr)} ${ml(o.awayML)} · ${esc(g.home.abbr)} ${ml(o.homeML)}</span>` : ''}</div>` : ''}
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
    <div class="stick"><div class="seg" id="gtabs">${['matchup', 'lineups', 'plays'].map((t) => `<button data-gtab="${t}" aria-pressed="${S.gameTab === t}">${t === 'matchup' ? 'Matchup' : t === 'lineups' ? 'Lineups' : 'Play by play'}</button>`).join('')}</div></div>
    <div id="gbody"><div class="skel"></div></div>`;
  window.scrollTo(0, 0);
  const sum = await loadSum(r.league, r.id, 8e3);
  if (route().id !== r.id) return;
  if (!sum && !findGame(r)) { $('#gbody').innerHTML = '<div class="empty">Could not load this game. Pull down to refresh or try again in a minute.</div>'; return; }
  renderGameLive(r);
  renderGameBody(r);
  pollGame(r);
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
  const box = live || post ? `<div class="livebox">
      <div class="lb ${S.flash.has(g.id) ? 'flash' : ''}"><div class="k">${live ? 'Latest play' : 'Final play'} <span>${lastPlay ? esc(`${lastPlay.periodLabel || ''} ${lastPlay.clock}`) : ''}</span></div>${esc(lastPlay?.text || g.lastPlay || 'Waiting for the first play')}</div>
      <div class="lb inj ${S.flash.has('inj' + g.id) ? 'flash' : ''}"><div class="k">Latest injury <span>${inj ? esc(`${inj.periodLabel || ''} ${inj.clock}`) : ''}</span></div>${esc(inj?.text || 'No in-game injuries reported so far.')}</div>
    </div>` : '';
  el.innerHTML = `<div class="hero" style="--ca:${esc(g.away.color)};--ch:${esc(g.home.color)}">
    <div class="vs">${side(g.away)}<div class="mid">${mid}</div>${side(g.home)}</div>${wp}${box}</div>`;
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
  const inj = (t) => {
    const list = sum?.injuries?.[t.id] || [];
    if (!list.length) return `<div class="est">No injuries listed.</div>`;
    return `<div class="inj">${list.slice(0, 12).map((i) => `<div class="ip">${i.headshot ? `<img src="${esc(i.headshot)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<span class="ph"></span>'}<div><div class="nm">${esc(i.name)} <span class="est">${esc(i.pos)}</span></div><div class="dt">${esc(i.detail || '')}</div></div><span class="tag ${/out|ir|doubt|susp/i.test(i.status) ? 't-out' : /quest|day/i.test(i.status) ? 't-q' : 't-ok'}">${esc(i.status)}</span></div>`).join('')}</div>`;
  };
  const form = (t) => {
    const l = sum?.lastFive?.[t.id] || [];
    return l.length ? `<div class="form" title="Last 5">${l.map((x) => `<i class="${esc(x.result)}" title="${esc(x.atVs)} ${esc(x.opp)} ${esc(x.score)}">${esc(x.result)}</i>`).join('')}</div>` : '';
  };

  body.innerHTML = `
    ${e.top ? `<div class="sec pickcard"><div class="hd"><h3>${g.state === 'pre' ? 'Our pick' : 'Pre-game pick'}</h3><span class="tag t-pick">${e.top.est}% estimated</span></div>
      <div class="p">${esc(e.top.pick)}</div>
      ${e.top.why ? `<p style="margin:0">${esc(e.top.why)}</p>` : ''}
      <ul class="why">${e.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      ${e.alt.length ? `<div class="odds">${e.alt.map((p) => `<span><b>Also</b>${esc(p.pick)} · ${p.est}%</span>`).join('')}</div>` : ''}
      <div class="est">An estimate from ESPN's win model, season scoring and the line. Not a sure thing.</div></div>` : ''}
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
    <div class="sec"><h3>Who's missing</h3><div class="grid2"><div><div class="tn" style="font-size:18px;margin-bottom:6px">${esc(g.away.name)}</div>${inj(g.away)}</div><div><div class="tn" style="font-size:18px;margin-bottom:6px">${esc(g.home.name)}</div>${inj(g.home)}</div></div></div>
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
  if (!plays.length) { body.innerHTML = `<div class="empty">${g.state === 'pre' ? `Plays show up here once the game starts. Kickoff ${esc(fmtDay(g.date))} at ${esc(fmtTime(g.date))}.` : 'No plays yet.'}</div>`; return; }
  const scoring = plays.filter((p) => p.scoring);
  body.innerHTML = `
    ${sum.liveInjuries?.length ? `<div class="sec"><h3>🚑 Injuries during the game</h3><div class="feed">${sum.liveInjuries.map((p) => playRow(p)).join('')}</div></div>` : ''}
    ${scoring.length ? `<div class="sec"><h3>Scoring plays</h3><div class="feed">${scoring.slice(0, 12).map((p) => playRow(p)).join('')}</div></div>` : ''}
    <div class="sec"><div class="hd"><h3>Every play</h3><span class="est">newest first · updates every few seconds</span></div><div class="feed">${plays.map((p) => playRow(p)).join('')}</div></div>`;
}
const playRow = (p) => `<div class="play ${p.injury ? 'inj' : p.scoring ? 'score' : ''}"><div class="t"><b>${esc(p.clock)}</b>${esc(p.periodLabel || (p.period ? 'Q' + p.period : ''))}</div><div>${p.type || p.team ? `<div class="ty">${esc(p.team)}${p.team && p.type ? ' · ' : ''}${esc(p.type)}</div>` : ''}${esc(p.text)}${p.scoring && p.away !== null ? ` <b>(${p.away}-${p.home})</b>` : ''}</div></div>`;

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
  dlg.innerHTML = `<div class="sheet"><div class="grab"><button data-close>Close</button></div><div class="skel" style="height:300px"></div></div>`;
  if (!dlg.open) dlg.showModal();
  let p = S.players[`${league}:${id}`];
  if (!p) {
    try { p = await api(`/api/player?league=${league}&id=${id}`); S.players[`${league}:${id}`] = p; }
    catch { dlg.querySelector('.skel').outerHTML = '<div class="empty">Could not load this player right now.</div>'; return; }
  }
  const stats = propStats(league, p.bio.pos).filter((k) => p.log.games.some((x) => x.stats[k] !== null && x.stats[k] !== undefined));
  const curated = S.daily?.props?.find((x) => x.player === p.bio.name);
  const cStat = curated ? CURATED_STAT[curated.stat] : null;
  const state = { stat: cStat && stats.includes(cStat) ? cStat : stats[0], line: null };
  const draw = () => drawPlayer(dlg, league, p, stats, state, curated);
  dlg._redraw = (fn) => { fn(state); draw(); };
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
  if (g && todayVal !== undefined && todayVal !== null) {
    const done = g.state === 'post';
    const hit = todayVal > line;
    today = `<div class="today ${done ? (hit ? 'hit' : 'miss') : ''}"><div><div style="font-size:12px;font-weight:800;text-transform:uppercase">${done ? 'Today, final' : `Today, live · ${esc(periodName(g))} ${esc(g.clock)}`}</div>${done ? (hit ? 'Hit the line ✅' : 'Missed the line ❌') : hit ? 'Already over the line ✅' : `Needs ${(line - todayVal + 0.5).toFixed(1).replace(/\.0$/, '')} more`}</div><b>${todayVal}</b></div>`;
  } else if (g && g.state === 'pre') {
    today = `<div class="today"><div><div style="font-size:12px;font-weight:800;text-transform:uppercase">Today</div>Kickoff ${esc(fmtTime(g.date))}. We will track this line live.</div><b>${line}</b></div>`;
  }

  // reasons
  const why = [];
  if (isCurated && curated.why) why.push(curated.why);
  const why2 = S.daily?.players?.[b.name]?.why;
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
    ${stats.length ? `
    <h3 style="margin-top:6px">Prop tracker</h3>
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
    ` : ''}
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
  v.innerHTML = `<h1>My bets</h1><p class="sub">Log every bet to see if you are up or down.</p><div id="betsBody"><div class="skel"></div></div>`;
  await Bets.load();
  if (route().name !== 'bets') return;
  drawBets();
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
    <div class="seg" style="margin-bottom:12px">${['week', 'month', 'year', 'all'].map((p) => `<button data-period="${p}" aria-pressed="${S.period === p}">${p === 'all' ? 'All time' : 'This ' + p}</button>`).join('')}</div>
    <div class="zone">
      <div class="verd ${zone}"><div class="zl">${zone === 'up' ? "You're up" : zone === 'down' ? "You're down" : 'Even'}</div><div class="bn">${money(net)}</div>
        <div class="kpis"><div>Record<b>${w}-${l}${pu ? '-' + pu : ''}</b></div><div>Win rate<b>${w + l ? Math.round((w / (w + l)) * 100) : 0}%</b></div><div>Return<b>${staked ? Math.round((net / staked) * 100) : 0}%</b></div><div>Pending<b>${pending.length}</b></div></div></div>
      <div class="chart"><div class="est">Bars: profit or loss per ${S.period === 'year' || S.period === 'all' ? 'month' : 'day'}. Line: running total.</div>${svg}</div>
    </div>
    <h2>Add a bet</h2>
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
    <div class="note">${S.betsMode === 'cloud' ? '☁️ Saved to your free database, so you see the same bets on any device.' : '📱 Saved on this device only. Connect the free database (see the setup guide) to see bets on every device.'}</div>
    ${S.betsMode === 'cloud' && localCount ? `<button style="margin-top:8px" data-migrate>Move ${localCount} bets from this phone to the cloud</button>` : ''}
    <h2>Your bets <span class="count">${S.bets.length}</span></h2>
    <div style="display:grid;gap:8px">${S.bets.length ? S.bets.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map((b) => `
      <div class="betrow"><div><div class="ds">${esc(b.desc)}</div><div class="mt">${esc(b.date)} · ${esc(b.app)} · ${esc(b.sport)} · ${b.odds ? esc(ml(Number(b.odds))) + ' · ' : ''}$${esc(b.stake)}</div>
        <div style="display:flex;gap:6px;margin-top:6px"><select data-status="${esc(b.id)}" aria-label="Result">${['pending', 'won', 'lost', 'push', 'cashout'].map((s) => `<option value="${s}" ${b.status === s ? 'selected' : ''}>${s === 'cashout' ? 'Cashed out' : s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select><button class="ghost" style="min-height:36px;padding:4px 8px" data-del="${esc(b.id)}">Delete</button></div></div>
        <div class="pl ${profit(b) > 0 ? 'pos' : profit(b) < 0 ? 'neg' : ''}">${b.status === 'pending' ? '<span class="tag">Pending</span>' : money(profit(b))}</div></div>`).join('') : '<div class="empty">No bets yet. Add your first one above.</div>'}</div>`;
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
  const t = e.target.closest('button, a');
  if (!t) return;
  if (t.dataset.go) { location.hash = `#/game/${t.dataset.go}`; return; }
  if (t.hasAttribute('data-back')) { if (history.length > 1) history.back(); else location.hash = '#/'; return; }
  if (t.dataset.filter) { S.filter = t.dataset.filter; store.set('filter', S.filter); $$('#chips button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.filter === S.filter)); renderGamesBody(); return; }
  if (t.dataset.gtab) { S.gameTab = t.dataset.gtab; $$('#gtabs button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.gtab === S.gameTab)); renderGameBody(route()); return; }
  if (t.dataset.side) { S.side = t.dataset.side; renderGameBody(route()); return; }
  if (t.dataset.unit) { S.unit = t.dataset.unit; renderGameBody(route()); return; }
  if (t.dataset.player) { const [lg, id] = t.dataset.player.split(':'); if (id) openPlayer(lg, id); return; }
  if (t.hasAttribute('data-close')) { $('#sheet').close(); return; }
  if (t.dataset.stat) { $('#sheet')._redraw((s) => { s.stat = t.dataset.stat; s.line = null; }); return; }
  if (t.dataset.line) { $('#sheet')._redraw((s) => { s.line = Math.max(0.5, s.line + Number(t.dataset.line)); }); return; }
  if (t.dataset.period) { S.period = t.dataset.period; drawBets(); return; }
  if (t.dataset.del) { if (confirm('Delete this bet?')) { try { await Bets.del(t.dataset.del); } catch (err) { alert(err.message); } drawBets(); } return; }
  if (t.hasAttribute('data-migrate')) { try { await Bets.put(Bets.local()); store.set('bets', []); } catch (err) { alert(err.message); } drawBets(); }
});
document.addEventListener('change', async (e) => {
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
  if (e.target.id !== 'betForm') return;
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const bet = { id: `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, date: f.date, app: f.app, sport: f.sport, desc: f.desc.trim(), odds: Number(String(f.odds).replace('+', '')) || 0, stake: Number(f.stake) || 0, status: f.status, payout: f.payout ? Number(f.payout) : null };
  if (!bet.desc || !bet.stake) return;
  try { await Bets.put([bet]); } catch (err) { alert(err.message); return; }
  drawBets();
});
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') $('#sheet').close(); });

// countdown ticker (every second)
setInterval(() => { for (const el of $$('[data-cd]')) el.textContent = countdown(el.dataset.cd); }, 1000);
// "updated Xs ago"
setInterval(() => { if (S.updated && !S.err && !S.games.some((g) => g.state === 'in')) $('#pulseText').textContent = `Updated ${Math.max(1, Math.round((Date.now() - S.updated) / 1000))}s ago`; }, 5000);
// refresh right away when coming back to the app
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { loadScoreboard(); const r = route(); if (r.name === 'game') loadSum(r.league, r.id, 0).then(() => renderGameLive(r)); } });

window.addEventListener('hashchange', render);
(async () => {
  render();
  await loadDaily();
  loadScoreboard();
})();
