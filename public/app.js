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
    return { top: { pick: cur.pick, est: cur.est, odds: cur.odds, book: cur.book, why: cur.why, curated: true }, alt: picks, reasons, hurt };
  }
  // After an injury, lead with the side pick so it is clear how the injury moved it.
  if (cur && hurt.length) { const sp = picks.find((x) => x.kind === 'spread'); if (sp) return { top: sp, alt: picks.filter((x) => x !== sp), reasons, hurt }; }
  return { top: picks[0] || null, alt: picks.slice(1), reasons, hurt };
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
  if (a === 'season') return { name: 'season' };
  return { name: 'games' };
}
function setTab(name) {
  $$('#tabbar a').forEach((a) => { if (a.dataset.tab !== name) a.removeAttribute('aria-current'); else a.setAttribute('aria-current', 'page'); });
}
let gameTimer = null;
function render() {
  const r = route();
  clearTimeout(gameTimer);
  setTab(r.name === 'game' || r.name === 'season' ? 'games' : r.name);
  if (r.name === 'games') renderGames();
  else if (r.name === 'game') renderGame(r);
  else if (r.name === 'season') renderSeason();
  else if (r.name === 'bets') renderBets();
  else if (r.name === 'check') renderCheck();
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
  v.innerHTML = `
    ${viewSwitch('today')}
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
  const e = estimate(g, sum, tA?.numbers, tH?.numbers);
  const base = estimate(g, sum, tA?.numbers, tH?.numbers, { ignoreHurt: true });
  const changed = e.top && base.top && base.top.pick !== e.top.pick;
  const hurtIds = new Set((e.hurt || []).map((x) => x.name));
  const outNames = new Set(Object.values(sum?.injuries || {}).flat().filter((i) => /out|ir|doubt|susp/i.test(i.status)).map((i) => i.name));
  const props = (S.daily?.props || []).filter((x) => x.game === gameKey(g));
  if (!e.top && !props.length) { swapIn(box, '', 'none'); return; }
  const label = g.state === 'pre' ? 'Picks for this game' : g.state === 'in' ? 'Picks · updated live' : 'Pre-game picks';
  const html = `<div class="sec pickcard">
    <div class="hd"><h3>${label}</h3>${e.top ? `<span class="tag t-pick">${e.top.est}% estimated</span>` : ''}</div>
    ${e.top ? `<div class="pop-in"><div class="p">${esc(e.top.pick)}</div>
      ${changed ? `<div class="chg">🔄 Changed after an injury · was ${esc(base.top.pick)}</div>` : ''}
      ${e.top.why ? `<p style="margin:6px 0 0">${esc(e.top.why)}</p>` : ''}
      ${e.reasons.filter((x) => x.startsWith('🚑')).map((x) => `<p class="hurtnote">${esc(x)}</p>`).join('')}
      ${e.reasons.some((x) => !x.startsWith('🚑')) ? `<details class="whyd"><summary>Why this pick</summary><ul class="why">${e.reasons.filter((x) => !x.startsWith('🚑')).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
      ${e.alt.length ? `<div class="odds">${e.alt.map((p) => `<span><b>Also</b>${esc(p.pick)} · ${p.est}%</span>`).join('')}</div>` : ''}</div>` : ''}
    ${props.length ? `<div class="props">${props.map((x) => { const bad = hurtIds.has(x.player) || outNames.has(x.player); return `<div class="prop ${bad ? 'bad' : ''}"><div><b>${esc(x.player)}</b> ${esc(x.lean)} ${esc(x.line)} ${esc(String(x.stat).toLowerCase())}</div><div class="est">${bad ? '⚠️ Hurt or ruled out, skip this one' : `${x.est}% estimated · ${esc(x.why)}`}</div></div>`; }).join('')}</div>` : ''}
    <div class="est">Estimates from ESPN's win model, season scoring, the line and injuries. Not a sure thing.</div></div>`;
  swapIn(box, html, `${e.top?.pick}|${(e.hurt || []).length}`);
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
  const top = `<div class="vs">${side(g.away)}<div class="mid">${mid}</div>${side(g.home)}</div>${wp}`;
  const playHTML = `<div class="k">${live ? 'Latest play' : 'Final play'} <span>${lastPlay ? esc(`${lastPlay.periodLabel || ''} ${lastPlay.clock}`) : ''}</span></div><div class="pop-in">${lastPlay ? actorsHTML(lastPlay, { compact: true }) : esc(g.lastPlay || 'Waiting for the first play')}</div>`;
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
  if (!plays.length) { body._plays = null; body.innerHTML = `<div class="empty">${g.state === 'pre' ? `Plays show up here once the game starts. Kickoff ${esc(fmtDay(g.date))} at ${esc(fmtTime(g.date))}.` : 'No plays yet.'}</div>`; return; }
  if (body._plays !== g.id || !$('#fAll', body)) {
    body.innerHTML = `
      <div class="sec" id="sInj" hidden><h3>🚑 Injuries during the game</h3><div class="feed" id="fInj"></div></div>
      <div class="sec" id="sScore" hidden><h3>Scoring plays</h3><div class="feed" id="fScore"></div></div>
      <div class="sec"><div class="hd"><h3>Every play</h3><span class="est">newest first · new plays slide in live</span></div><div class="feed" id="fAll"></div></div>`;
    body._plays = g.id;
  }
  const inj = sum.liveInjuries || [];
  const scoring = plays.filter((p) => p.scoring).slice(0, 12);
  $('#sInj', body).hidden = !inj.length;
  $('#sScore', body).hidden = !scoring.length;
  syncFeed($('#fInj', body), inj, g);
  syncFeed($('#fScore', body), scoring, g);
  syncFeed($('#fAll', body), plays, g);
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
  const av = `<div class="fav">${photo ? pface(photo, 'ph') : `<span class="ph">${tm?.logo ? `<img src="${esc(tm.logo)}" alt="" style="object-fit:contain;padding:8px">` : ''}<i>${esc(p.team || '')}</i></span>`}${tm ? `<span class="tb" style="background:${esc(tm.color)}">${esc(tm.abbr)}</span>` : p.team ? `<span class="tb">${esc(p.team)}</span>` : ''}</div>`;
  const head = m ? m.line : p.type || 'Play';
  const sub = [];
  if (m) sub.push(`<div class="fl1"><b>${esc(m.name)}</b>${m.total ? ` · ${esc(m.total)}` : ''}</div>`);
  for (const x of rest) sub.push(`<div class="fl2">${esc(x.name)}${x.total ? ` · ${esc(x.total)}` : ''} <span class="fr">${esc(x.line)}</span></div>`);
  for (const x of def) sub.push(`<div class="fl2"><span class="fr">${esc(x.line)}:</span> ${esc(x.name)}${x.total ? ` · ${esc(x.total)}` : ''}</div>`);
  if (!m && !p.injured?.length) sub.push(`<div class="fl2">${esc(p.text)}</div>`);
  for (const x of p.injured || []) sub.push(`<div class="fl2 ${x.returned ? 'back' : 'hurt'}">${x.returned ? '✅' : '🚑'} ${esc(x.name)} ${x.returned ? 'back in the game' : 'hurt on the play'}</div>`);
  return `<div class="play feedp ${cls}">${av}<div class="pbody"><div class="fmeta"><span>${meta}${p.wall ? ` · <span data-ago="${esc(p.wall)}">${agoText(p.wall)}</span>` : ''}</span>${swing}</div><div class="fhead">${esc(head)}${p.voided ? ' <span class="est">no play</span>' : ''}</div>${sub.join('')}</div></div>`;
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
  if (t.dataset.go) { location.hash = `#/game/${t.dataset.go}`; return; }
  if (t.hasAttribute('data-back')) { if (history.length > 1) history.back(); else location.hash = '#/'; return; }
  if (t.dataset.filter) { S.filter = t.dataset.filter; store.set('filter', S.filter); $$('#chips button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.filter === S.filter)); renderGamesBody(); return; }
  if (t.dataset.gtab) { S.gameTab = t.dataset.gtab; $$('#gtabs button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.gtab === S.gameTab)); renderGameBody(route()); return; }
  if (t.dataset.side) { S.side = t.dataset.side; renderGameBody(route()); return; }
  if (t.dataset.unit) { S.unit = t.dataset.unit; renderGameBody(route()); return; }
  if (t.dataset.player) { const [lg, id] = t.dataset.player.split(':'); if (id) openPlayer(lg, id); return; }
  if (t.hasAttribute('data-close')) { $('#sheet').close(); return; }
  if (t.dataset.view) { location.hash = t.dataset.view === 'season' ? '#/season' : '#/'; return; }
  if (t.dataset.sleague) { S.sLeague = t.dataset.sleague; store.set('sLeague', S.sLeague); S.sSeason = null; S.sSel = null; renderSeason(); return; }
  if (t.dataset.week) { const [type, week] = t.dataset.week.split(':'); S.sSel = { type, week }; renderSeason(); return; }
  if (t.dataset.day) { S.sSel = { date: t.dataset.day }; renderSeason(); return; }
  if (t.dataset.pseason) { $('#sheet')._season(t.dataset.pseason); return; }
  if (t.dataset.stat) { $('#sheet')._redraw((s) => { s.stat = t.dataset.stat; s.line = null; }); return; }
  if (t.dataset.line) { $('#sheet')._redraw((s) => { s.line = Math.max(0.5, s.line + Number(t.dataset.line)); }); return; }
  if (t.dataset.period) { S.period = t.dataset.period; drawBets(); return; }
  if (t.hasAttribute('data-ckgo')) { runCheck(); return; }
  if (t.hasAttribute('data-ckreset')) { CK.img = null; CK.res = null; CK.err = ''; drawCheck(); return; }
  if (t.dataset.del) { if (confirm('Delete this bet?')) { try { await Bets.del(t.dataset.del); } catch (err) { alert(err.message); } drawBets(); } return; }
  if (t.hasAttribute('data-migrate')) { try { await Bets.put(Bets.local()); store.set('bets', []); } catch (err) { alert(err.message); } drawBets(); }
});
document.addEventListener('change', async (e) => {
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
  if (e.target.id !== 'betForm' && e.target.id !== 'ckForm') return;
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const bet = { id: `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, date: f.date, app: f.app, sport: f.sport, desc: f.desc.trim(), odds: Number(String(f.odds).replace('+', '')) || 0, stake: Number(f.stake) || 0, status: f.status, payout: f.payout ? Number(f.payout) : null };
  if (!bet.desc || !bet.stake) return;
  if (e.target.id === 'ckForm') { await Bets.load(); }
  try { await Bets.put([bet]); } catch (err) { alert(err.message); return; }
  if (e.target.id === 'ckForm') { location.hash = '#/bets'; return; }
  drawBets();
});
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') $('#sheet').close(); });

// countdown ticker (every second)
setInterval(() => { for (const el of $$('[data-cd]')) el.textContent = countdown(el.dataset.cd); }, 1000);
setInterval(() => { for (const el of $$('[data-ago]')) el.textContent = agoText(el.dataset.ago); }, 30e3);
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
