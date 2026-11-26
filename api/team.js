// One team: starting lineup (from ESPN's depth chart), full roster with photos,
// and season numbers used for the matchup scales.
import { league, urls, tryJSON, handler, headshot, num } from '../lib/espn.js';

// Slots drawn on the field, in the order the formation rows use them.
const NFL_OFF = ['lt', 'lg', 'c', 'rg', 'rt', 'te', 'wr', 'wr2', 'wr3', 'rb', 'qb', 'fb'];
const NFL_DEF = ['lde', 'ldt', 'nt', 'rdt', 'rde', 'wlb', 'lilb', 'mlb', 'rilb', 'slb', 'lolb', 'rolb', 'lcb', 'nb', 'rcb', 'ss', 'fs'];
const NBA_POS = ['pg', 'sg', 'sf', 'pf', 'c'];

function rosterList(j) {
  const out = [];
  const add = (a) => a?.id && out.push({
    id: String(a.id), name: a.displayName || a.fullName || '', short: a.shortName || '', jersey: a.jersey || '',
    pos: a.position?.abbreviation || '', posName: a.position?.displayName || '', headshot: a.headshot?.href || '',
    age: a.age, height: a.displayHeight || '', weight: a.displayWeight || '', exp: a.experience?.years,
    college: a.college?.name || a.college?.shortName || '', status: a.injuries?.[0]?.status || '',
  });
  for (const g of j?.athletes || []) {
    if (Array.isArray(g.items)) g.items.forEach(add); else add(g);
  }
  return out;
}

function fromDepth(j, byId, L) {
  const charts = j?.depthchart || j?.items || [];
  const groups = [];
  for (const ch of charts) {
    const pos = ch.positions || {};
    const keys = Object.keys(pos);
    if (!keys.length) continue;
    const slots = keys.map((k) => {
      const p = pos[k];
      const first = (p.athletes || [])[0] || {};
      const id = String(first.id || first.athlete?.id || (first.$ref || first.athlete?.$ref || '').match(/athletes\/(\d+)/)?.[1] || '');
      const r = byId[id] || {};
      return {
        slot: k,
        label: (p.position?.abbreviation || k).toUpperCase(),
        id,
        name: r.name || first.displayName || first.fullName || '',
        jersey: r.jersey || first.jersey || '',
        headshot: r.headshot || first.headshot?.href || headshot(L, id),
        backups: (p.athletes || []).slice(1, 3).map((b) => byId[String(b.id || (b.$ref || '').match(/athletes\/(\d+)/)?.[1])]?.name || b.displayName || '').filter(Boolean),
      };
    }).filter((s) => s.id || s.name);
    groups.push({ name: ch.name || '', slots });
  }
  return groups;
}

function pickNFL(groups) {
  const isST = (n) => /special|kick|punt/i.test(n);
  const isDef = (g) => /def|4-3|3-4|nickel|dime|base/i.test(g.name) || g.slots.some((s) => /cb|lb|^s$|ss|fs|de|dt|nt/.test(s.slot));
  const off = groups.find((g) => !isST(g.name) && !isDef(g));
  const def = groups.find((g) => !isST(g.name) && isDef(g));
  const order = (g, list) => g ? [...g.slots].sort((a, b) => (list.indexOf(a.slot) + 99) % 99 - (list.indexOf(b.slot) + 99) % 99) : [];
  return { offense: order(off, NFL_OFF), defense: order(def, NFL_DEF), formation: { offense: off?.name || '', defense: def?.name || '' } };
}

// Fallback when ESPN has no depth chart: build a plausible lineup from the roster.
function guessNFL(roster) {
  const take = (pos, n, label) => roster.filter((p) => pos.includes(p.pos) && !/out|ir|injured/i.test(p.status)).slice(0, n).map((p, i) => ({ slot: label + (i || ''), label: label.toUpperCase(), ...p }));
  return {
    offense: [...take(['OT', 'T'], 2, 'ot'), ...take(['G', 'OG'], 2, 'g'), ...take(['C'], 1, 'c'), ...take(['TE'], 1, 'te'), ...take(['WR'], 3, 'wr'), ...take(['RB'], 1, 'rb'), ...take(['QB'], 1, 'qb')],
    defense: [...take(['DE', 'EDGE'], 2, 'de'), ...take(['DT', 'NT'], 2, 'dt'), ...take(['LB', 'ILB', 'OLB', 'MLB'], 3, 'lb'), ...take(['CB'], 2, 'cb'), ...take(['S', 'FS', 'SS'], 2, 's')],
    guessed: true,
  };
}

function findStat(obj, name) {
  // walk any ESPN stats tree and return the first stat with this name
  const stack = [obj];
  while (stack.length) {
    const o = stack.pop();
    if (!o || typeof o !== 'object') continue;
    if (o.name === name && (o.value !== undefined || o.displayValue !== undefined)) return { value: num(o.value ?? o.displayValue), perGame: num(o.perGameValue), rank: o.rank || null, rankText: o.rankDisplayValue || '' };
    for (const v of Object.values(o)) if (v && typeof v === 'object') stack.push(v);
  }
  return null;
}

function standingsEntries(j) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    for (const e of n.standings?.entries || []) out.push(e);
    for (const c of n.children || []) walk(c);
  };
  walk(j);
  return out;
}

async function teamNumbers(key, L, id) {
  const [stand, stats] = await Promise.all([
    tryJSON(`${urls.SITE_V2}/${L.path}/standings`),
    tryJSON(`${urls.SITE}/${L.path}/teams/${id}/statistics`),
  ]);
  const rows = standingsEntries(stand).map((e) => {
    const get = (n) => num(e.stats?.find((s) => s.name === n || s.type === n)?.value);
    const gp = (get('wins') || 0) + (get('losses') || 0) + (get('ties') || 0) + (get('otLosses') || 0);
    const pf = get('avgPointsFor') ?? (gp ? get('pointsFor') / gp : null);
    const pa = get('avgPointsAgainst') ?? (gp ? get('pointsAgainst') / gp : null);
    return { id: String(e.team?.id), pf, pa, streak: e.stats?.find((s) => s.name === 'streak')?.displayValue || '' };
  }).filter((r) => r.pf !== null);
  const rank = (field, asc) => {
    const sorted = [...rows].sort((a, b) => (asc ? a[field] - b[field] : b[field] - a[field]));
    const i = sorted.findIndex((r) => r.id === String(id));
    return i < 0 ? null : i + 1;
  };
  const me = rows.find((r) => r.id === String(id)) || {};
  const out = { ppg: me.pf ?? null, oppg: me.pa ?? null, ppgRank: rank('pf', false), oppgRank: rank('pa', true), teams: rows.length || null, streak: me.streak || '' };
  if (L.sport === 'football') {
    const pa = findStat(stats, 'passingAttempts');
    const ra = findStat(stats, 'rushingAttempts');
    out.passAtt = pa?.value ?? null;
    out.rushAtt = ra?.value ?? null;
    out.passYpg = findStat(stats, 'netPassingYardsPerGame')?.value ?? findStat(stats, 'passingYardsPerGame')?.value ?? null;
    out.rushYpg = findStat(stats, 'rushingYardsPerGame')?.value ?? null;
    out.ypp = findStat(stats, 'yardsPerGame')?.value ?? findStat(stats, 'totalYardsPerGame')?.value ?? null;
    out.sacks = findStat(stats, 'sacks')?.value ?? null;
    out.turnoverDiff = findStat(stats, 'turnOverDifferential')?.value ?? findStat(stats, 'turnoverDifferential')?.value ?? null;
  } else if (L.sport === 'basketball') {
    out.fgPct = findStat(stats, 'fieldGoalPct')?.value ?? null;
    out.threePct = findStat(stats, 'threePointFieldGoalPct')?.value ?? findStat(stats, 'threePointPct')?.value ?? null;
    out.threeAtt = findStat(stats, 'avgThreePointFieldGoalsAttempted')?.value ?? null;
    out.fgAtt = findStat(stats, 'avgFieldGoalsAttempted')?.value ?? null;
    out.reb = findStat(stats, 'avgRebounds')?.value ?? null;
    out.ast = findStat(stats, 'avgAssists')?.value ?? null;
  }
  return out;
}

export default handler(async (req) => {
  const [key, L] = league(req);
  const id = String(req.query?.id || '').replace(/\D/g, '');
  if (!id) throw Object.assign(new Error('Missing team id'), { status: 400 });
  const [rosterJ, depthJ, numbers] = await Promise.all([
    tryJSON(`${urls.SITE}/${L.path}/teams/${id}/roster`),
    tryJSON(`${urls.SITE}/${L.path}/teams/${id}/depthcharts`),
    teamNumbers(key, L, id),
  ]);
  const roster = rosterList(rosterJ).map((p) => ({ ...p, headshot: p.headshot || headshot(L, p.id) }));
  const byId = Object.fromEntries(roster.map((p) => [p.id, p]));
  const groups = fromDepth(depthJ, byId, L);
  let lineup;
  if (L.sport === 'football') {
    lineup = groups.length ? pickNFL(groups) : guessNFL(roster);
  } else if (L.sport === 'basketball') {
    const g = groups[0];
    const five = g ? NBA_POS.map((k) => g.slots.find((s) => s.slot === k)).filter(Boolean) : [];
    lineup = five.length >= 5 ? { starters: five } : { starters: roster.filter((p) => !/out/i.test(p.status)).slice(0, 5).map((p) => ({ slot: p.pos.toLowerCase(), label: p.pos, ...p })), guessed: true };
  } else {
    lineup = { starters: roster.slice(0, 6).map((p) => ({ slot: p.pos, label: p.pos, ...p })), guessed: true };
  }
  return { id, league: key, lineup, roster, numbers };
}, { sMaxAge: 900, swr: 3600 });
