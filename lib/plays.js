// Turns ESPN play text into short cards: who made the play (with photo), what they did,
// who made the tackle / sack / interception, and each player's running total after that play.
//
// Football play text looks like:
//   "(Shotgun) C.Williams pass deep right to L.Burden to DET 25 for 25 yards (R.McCreary)."
//   "D.Swift up the middle to CHI 35 for 6 yards (T.Williams; B.Branch)."
//   "J.Goff sacked at DET 30 for -7 yards (M.Sweat)."
// Totals are counted from the plays themselves, so they match the moment of each play.

const NAME = "[A-Z][A-Za-z]{0,2}\\.(?:[A-Z][a-z]+\\. )?[A-Z][A-Za-z'’-]+(?: (?:Jr|Sr|II|III|IV)\\.?)?";
const SUFFIX = /\s+(jr\.?|sr\.?|ii|iii|iv|v)$/i;

function makeIndex(box, headshot) {
  // per team: list of {id, name, full, headshot}
  const byTeam = {};
  for (const p of Object.values(box)) {
    (byTeam[p.teamId] ||= []).push({ id: p.id, name: p.name, headshot: p.headshot || headshot(p.id), full: p.name.toLowerCase().replace(SUFFIX, '') });
  }
  const cache = new Map();
  return (abbr, preferTeam, otherTeam) => {
    if (!abbr) return null;
    const k = `${abbr}|${preferTeam}`;
    if (cache.has(k)) return cache.get(k);
    const [pre, ...rest] = abbr.replace(SUFFIX, '').split('.');
    const last = rest.join('.').trim().toLowerCase();
    const test = (p) => p.full.endsWith(' ' + last) && p.full.startsWith(pre.toLowerCase());
    let hit = null;
    for (const t of [preferTeam, otherTeam]) {
      const m = (byTeam[t] || []).filter(test);
      if (m.length) { hit = { ...m[0], teamId: t }; break; }
    }
    if (!hit) {
      // fall back to last name only, when unique
      for (const t of [preferTeam, otherTeam]) {
        const m = (byTeam[t] || []).filter((p) => p.full.endsWith(' ' + last));
        if (m.length === 1) { hit = { ...m[0], teamId: t }; break; }
      }
    }
    const out = hit || { id: '', name: abbr, headshot: '', teamId: preferTeam };
    cache.set(k, out);
    return out;
  };
}

const yardsOf = (s) => (s === undefined ? 0 : /no gain/i.test(s) ? 0 : parseInt(s, 10) || 0);
const namesIn = (s = '') => s.match(new RegExp(NAME, 'g')) || [];

function totalsText(t, role) {
  if (!t) return '';
  const td = (n) => (n ? `, ${n} TD` : '');
  switch (role) {
    case 'pass': return `${t.cmp || 0}/${t.att || 0}, ${t.passYds || 0} yds${td(t.passTD)}${t.int ? `, ${t.int} INT` : ''}`;
    case 'rush': return `${t.car || 0} car, ${t.rushYds || 0} yds${td(t.rushTD)}`;
    case 'rec': return `${t.rec || 0} rec, ${t.recYds || 0} yds${td(t.recTD)}`;
    case 'ret': return `${t.ret || 0} ret, ${t.retYds || 0} yds`;
    case 'tkl': return `${t.tkl || 0} tkl${t.sacks ? `, ${t.sacks} sk` : ''}${t.ints ? `, ${t.ints} INT` : ''}`;
    case 'sack': return `${t.sacks || 0} sk, ${t.tkl || 0} tkl`;
    case 'int': return `${t.ints || 0} INT, ${t.tkl || 0} tkl`;
    case 'pts': return `${t.pts || 0} pts${t.ast ? `, ${t.ast} ast` : ''}${t.reb ? `, ${t.reb} reb` : ''}`;
    default: return '';
  }
}

function football(plays, find, teams, abbrMap) {
  const tot = {};
  const T = (who) => (tot[who.id || who.name] ||= {});
  const otherOf = (tid) => (tid === teams[0] ? teams[1] : teams[0]);
  for (const p of plays) {
    const raw = p.text.split(/\s\*\*\s/)[0];
    const text = raw.replace(/^(\((?:Shotgun|No Huddle|No Huddle, Shotgun|Punt formation|Field Goal formation)\)\s*)+/i, '').trim();
    const off = p.teamId;
    const def = otherOf(off);
    const voided = /no play|nullified|reversed/i.test(raw);
    const td = /TOUCHDOWN/.test(raw);
    const main = [];
    const defs = [];
    const add = (arr, who, role, line) => { if (who) arr.push({ who, role, line }); };
    const tacklersIn = (s) => {
      const m = s.match(/\(([^()]*)\)\s*\.?\s*(?:$|FUMBLES|Penalty|PENALTY|\.)/);
      return m ? namesIn(m[1]) : [];
    };
    let m;
    if ((m = text.match(new RegExp(`^(${NAME}) pass (?:[a-z ]+ )?(?:to|intended for) (${NAME})?.*?INTERCEPTED by (${NAME})(?:.*? for (-?\\d+|no gain) yards?)?`)))) {
      const qb = find(m[1], off, def); const rec = m[2] ? find(m[2], off, def) : null; const pick = find(m[3], def, off);
      if (!voided) { T(qb).att = (T(qb).att || 0) + 1; T(qb).int = (T(qb).int || 0) + 1; T(pick).ints = (T(pick).ints || 0) + 1; }
      add(main, qb, 'pass', 'Threw an interception');
      add(defs, pick, 'int', `Interception${m[4] && yardsOf(m[4]) ? `, ${yardsOf(m[4])}-yd return` : ''}`);
      if (rec) p.target = rec.name;
    } else if ((m = text.match(new RegExp(`^(${NAME}) pass incomplete(?:[a-z ]*?(?:to|intended for) (${NAME}))?`)))) {
      const qb = find(m[1], off, def);
      if (!voided) T(qb).att = (T(qb).att || 0) + 1;
      add(main, qb, 'pass', `Incomplete${m[2] ? ` to ${find(m[2], off, def).name}` : ''}`);
      const br = text.match(new RegExp(`\\((?:PD by |defended by )?(${NAME})\\)`));
      if (br) add(defs, find(br[1], def, off), 'tkl', 'Broke it up');
    } else if ((m = text.match(new RegExp(`^(${NAME}) pass (?:[a-z ]+ )?to (${NAME}).*? for (-?\\d+ yards?|no gain)`)))) {
      const qb = find(m[1], off, def); const rec = find(m[2], off, def); const y = yardsOf(m[3]);
      if (!voided) {
        Object.assign(T(qb), { cmp: (T(qb).cmp || 0) + 1, att: (T(qb).att || 0) + 1, passYds: (T(qb).passYds || 0) + y, passTD: (T(qb).passTD || 0) + (td ? 1 : 0) });
        Object.assign(T(rec), { rec: (T(rec).rec || 0) + 1, recYds: (T(rec).recYds || 0) + y, recTD: (T(rec).recTD || 0) + (td ? 1 : 0) });
      }
      add(main, rec, 'rec', td ? `${y}-yd TD catch` : `${y}-yd catch`);
      add(main, qb, 'pass', `Threw it${td ? ' for the TD' : ''}`);
      for (const n of tacklersIn(text)) { const d = find(n, def, off); if (!voided) T(d).tkl = (T(d).tkl || 0) + 1; add(defs, d, 'tkl', 'Tackle'); }
    } else if ((m = text.match(new RegExp(`^(${NAME}) sacked.*? for (-?\\d+ yards?|no gain)`)))) {
      const qb = find(m[1], off, def); const y = yardsOf(m[2]);
      add(main, qb, '', `Sacked, ${y} yds`);
      const sk = tacklersIn(text);
      for (const n of sk) { const d = find(n, def, off); if (!voided) T(d).sacks = +((T(d).sacks || 0) + 1 / sk.length).toFixed(1); add(defs, d, 'sack', sk.length > 1 ? 'Half sack' : 'Sack'); }
    } else if ((m = text.match(new RegExp(`(?:kicks|punts) (\\d+) yards?.*?\\. (${NAME})(?: to .*?)? for (-?\\d+ yards?|no gain)`)))) {
      const rt = find(m[2], def, off); const y = yardsOf(m[3]);
      if (!voided) Object.assign(T(rt), { ret: (T(rt).ret || 0) + 1, retYds: (T(rt).retYds || 0) + y });
      add(main, rt, 'ret', `${y}-yd return${td ? ', TOUCHDOWN' : ''}`);
      for (const n of tacklersIn(text)) { const d = find(n, off, def); if (!voided) T(d).tkl = (T(d).tkl || 0) + 1; add(defs, d, 'tkl', 'Tackle'); }
    } else if ((m = text.match(new RegExp(`^(${NAME}) (\\d+) yard field goal is (GOOD|No Good)`, 'i')))) {
      add(main, find(m[1], off, def), '', `${m[2]}-yd field goal ${/good/i.test(m[3]) && !/no/i.test(m[3]) ? 'is good' : 'missed'}`);
    } else if ((m = text.match(new RegExp(`^(${NAME}) (?:up the middle|left|right|scrambles|kneels|[a-z]+ (?:end|tackle|guard)|\\d+ yard rush|rush).*? for (-?\\d+ yards?|no gain)`)))) {
      const r = find(m[1], off, def); const y = yardsOf(m[2]);
      if (!voided) Object.assign(T(r), { car: (T(r).car || 0) + 1, rushYds: (T(r).rushYds || 0) + y, rushTD: (T(r).rushTD || 0) + (td ? 1 : 0) });
      add(main, r, 'rush', td ? `${y}-yd TD run` : `${y}-yd run`);
      for (const n of tacklersIn(text)) { const d = find(n, def, off); if (!voided) T(d).tkl = (T(d).tkl || 0) + 1; add(defs, d, 'tkl', 'Tackle'); }
    }
    // in-game injury notes
    const inj = [...p.text.matchAll(new RegExp(`([A-Z]{2,3})-(${NAME}) (was injured|has returned)`, 'g'))];
    p.injured = inj.map((x) => {
      const tid = abbrMap[x[1]] || def;
      const who = find(x[2], tid, otherOf(tid));
      return { id: who.id, name: who.name, headshot: who.headshot, team: x[1], returned: /returned/.test(x[3]) };
    });
    if (!main.length && !defs.length) continue;
    p.who = main.map((x) => ({ id: x.who.id, name: x.who.name, headshot: x.who.headshot, line: x.line, total: voided ? '' : totalsText(T(x.who), x.role) }));
    p.defense = defs.map((x) => ({ id: x.who.id, name: x.who.name, headshot: x.who.headshot, line: x.line, total: voided ? '' : totalsText(T(x.who), x.role) }));
    if (voided) p.voided = true;
  }
}

function basketball(plays, byId) {
  const tot = {};
  for (const p of plays) {
    const ids = p.participants || [];
    if (!ids.length) continue;
    const main = byId[ids[0]];
    if (!main) continue;
    const t = (tot[main.id] ||= {});
    if (p.scoring && p.scoreValue) t.pts = (t.pts || 0) + p.scoreValue;
    if (/rebound/i.test(p.text)) t.reb = (t.reb || 0) + 1;
    p.who = [{ id: main.id, name: main.name, headshot: main.headshot, line: p.type || '', total: totalsText(t, 'pts') }];
    const helper = ids[1] && byId[ids[1]];
    if (helper) {
      const h = (tot[helper.id] ||= {});
      const assist = /assist/i.test(p.text);
      const role = assist ? 'Assist' : /block/i.test(p.text) ? 'Block' : /steal/i.test(p.text) ? 'Steal' : /foul/i.test(p.text) ? 'Fouled' : '';
      if (assist) h.ast = (h.ast || 0) + 1;
      if (role) p.defense = [{ id: helper.id, name: helper.name, headshot: helper.headshot, line: role, total: totalsText(h, 'pts') }];
    }
  }
}

// plays: oldest first. Adds p.who, p.defense, p.injured.
export function enrichPlays(plays, box, teams, abbrMap, sport, headshot) {
  try {
    if (sport === 'football') football(plays, makeIndex(box, headshot), teams, abbrMap);
    else if (sport === 'basketball') {
      const byId = Object.fromEntries(Object.values(box).map((p) => [p.id, { ...p, headshot: p.headshot || headshot(p.id) }]));
      basketball(plays, byId);
    }
  } catch {
    // a parsing surprise should never break the game page
  }
  return plays;
}
