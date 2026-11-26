// Server copy of how a pick is doing, used for phone alerts. Same rules as the site.
// Returns { st: 'pre' | 'live' | 'hit' | 'miss' | 'push', close: bool } or null for picks we can't judge (player props).
export function legState(leg, g) {
  if (!g) return null;
  if (g.state === 'pre') return { st: 'pre' };
  const a = Number(g.away.score) || 0; const h = Number(g.home.score) || 0;
  const done = g.state === 'post';
  const last = { nfl: 4, cfb: 4, nba: 4, nhl: 3 }[g.league] || 4;
  const late = done || g.period >= last;
  const tot = /^(over|under)\s+(\d+(\.\d+)?)/i.exec(String(leg.pick || '').trim());
  if (tot) {
    const line = parseFloat(tot[2]); const sum = a + h; const over = /over/i.test(tot[1]);
    if (sum > line) return { st: over ? 'hit' : 'miss' };
    if (done) return { st: sum === line ? 'push' : over ? 'miss' : 'hit' };
    return { st: 'live', close: late && line - sum <= (g.league === 'nba' ? 8 : 7) };
  }
  const sp = /^(.+?)\s+([+-]\d+(\.\d+)?|ML|moneyline)$/i.exec(String(leg.pick || '').trim());
  if (sp) {
    const nm = sp[1].toLowerCase();
    const isHome = [g.home.abbr, g.home.name, g.home.full].some((x) => x && x.toLowerCase() === nm);
    const isAway = [g.away.abbr, g.away.name, g.away.full].some((x) => x && x.toLowerCase() === nm);
    if (!isHome && !isAway) return null;
    const line = /^[+-]/.test(sp[2]) ? parseFloat(sp[2]) : 0;
    const m = (isHome ? h - a : a - h) + line;
    if (done) return { st: m > 0 ? 'hit' : m < 0 ? 'miss' : 'push' };
    return { st: 'live', close: late && Math.abs(m) <= (g.league === 'nba' ? 4 : 3) };
  }
  return null;
}
