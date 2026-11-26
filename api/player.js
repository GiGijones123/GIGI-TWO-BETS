// One player: bio, photo, season numbers and a game-by-game log.
import { league, urls, tryJSON, handler, headshot, num } from '../lib/espn.js';

export function bio(j, L, id) {
  const a = j?.athlete || j || {};
  return {
    id,
    name: a.displayName || a.fullName || '',
    short: a.shortName || '',
    jersey: a.jersey || '',
    pos: a.position?.abbreviation || '',
    posName: a.position?.displayName || '',
    team: a.team?.abbreviation || a.team?.displayName || '',
    teamName: a.team?.displayName || '',
    teamLogo: a.team?.logos?.[0]?.href || a.team?.logo || '',
    headshot: a.headshot?.href || headshot(L, id),
    age: a.age || null,
    height: a.displayHeight || '',
    weight: a.displayWeight || '',
    college: a.college?.name || '',
    exp: a.displayExperience || (a.experience?.years !== undefined ? `${a.experience.years} yrs` : ''),
    draft: a.displayDraft || (a.draft ? `${a.draft.year} Rd ${a.draft.round}, Pick ${a.draft.selection}` : ''),
    birthPlace: [a.birthPlace?.city, a.birthPlace?.state || a.birthPlace?.country].filter(Boolean).join(', '),
    status: a.status?.name || '',
    injury: a.injuries?.[0] ? `${a.injuries[0].status}${a.injuries[0].details?.type ? ' · ' + a.injuries[0].details.type : ''}` : '',
  };
}

export function gamelog(j) {
  if (!j) return { names: [], labels: [], games: [] };
  const names = j.names || [];
  const labels = j.labels || [];
  const evs = j.events || {};
  const games = [];
  const seen = new Set();
  for (const st of j.seasonTypes || []) {
    for (const cat of st.categories || []) {
      for (const e of cat.events || []) {
        if (seen.has(e.eventId)) continue;
        seen.add(e.eventId);
        const meta = evs[e.eventId] || {};
        const stats = {};
        names.forEach((n, i) => {
          const raw = e.stats?.[i];
          if (n.includes('-') && typeof raw === 'string' && raw.includes('-')) {
            const [a, b] = n.split('-');
            const [x, y] = raw.split('-');
            stats[a] = num(x);
            stats[b] = num(y);
          } else stats[n] = num(raw);
        });
        if (stats.totalRebounds !== undefined && stats.rebounds === undefined) stats.rebounds = stats.totalRebounds;
        games.push({
          id: String(e.eventId),
          date: meta.gameDate || '',
          opp: meta.opponent?.abbreviation || '',
          oppLogo: meta.opponent?.logo || '',
          atVs: meta.atVs || '',
          result: meta.gameResult || '',
          score: meta.score || '',
          season: st.displayName || '',
          stats,
        });
      }
    }
  }
  games.sort((a, b) => new Date(b.date) - new Date(a.date));
  return { names, labels, displayNames: j.displayNames || [], games };
}

function seasonStats(ov) {
  const s = ov?.statistics;
  if (!s) return null;
  const split = (s.splits || []).find((x) => /regular|season/i.test(x.displayName)) || s.splits?.[0];
  if (!split) return null;
  return { label: split.displayName || 'Season', items: (s.labels || []).map((l, i) => [l, split.stats?.[i]]).filter((x) => x[1] !== undefined).slice(0, 10) };
}

export default handler(async (req) => {
  const [key, L] = league(req);
  const id = String(req.query?.id || '').replace(/\D/g, '');
  if (!id) throw Object.assign(new Error('Missing player id'), { status: 400 });
  const season = String(req.query?.season || '').replace(/\D/g, '').slice(0, 4);
  const base = `${urls.WEB}/${L.path}/athletes/${id}`;
  const [a, ov, gl] = await Promise.all([tryJSON(base), tryJSON(`${base}/overview`), tryJSON(`${base}/gamelog${season ? `?season=${season}` : ''}`)]);
  if (!a && !ov && !gl) throw Object.assign(new Error('ESPN has no data for this player right now'), { status: 502 });
  return { league: key, bio: bio(a, L, id), season: seasonStats(ov), log: gamelog(gl), seasons: (gl?.filters || []).find((f) => f.name === 'season')?.options?.map((o) => ({ value: String(o.value), label: o.displayValue })) || [] };
}, { sMaxAge: 600, swr: 3600 });
