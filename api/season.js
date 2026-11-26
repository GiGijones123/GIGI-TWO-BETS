// Past games for any season. Football is browsed by week, basketball and hockey by date.
//   /api/season?league=nfl&season=2025&type=2&week=5
//   /api/season?league=nba&season=2025&date=20250315   (season = the year it ends, e.g. 2025 = 2024-25)
import { league, urls, getJSON, tryJSON, handler, normEvent } from '../lib/espn.js';

const etToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/-/g, '');

export function currentSeason(key, d = new Date()) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  if (key === 'nfl' || key === 'cfb') return m >= 8 ? y : y - 1; // season named by its start year
  return m >= 10 ? y + 1 : y; // NBA/NHL seasons named by their end year (2025 = 2024-25)
}

function footballCalendar(j) {
  const cal = j?.leagues?.[0]?.calendar || [];
  const out = [];
  for (const part of cal) {
    const type = String(part.value || '');
    if (type !== '2' && type !== '3') continue; // regular season and playoffs only
    for (const e of part.entries || []) {
      if (/pro bowl/i.test(e.label || '')) continue;
      out.push({ type, week: String(e.value), label: e.label || `Week ${e.value}`, start: e.startDate, end: e.endDate });
    }
  }
  return out;
}

const dateKey = (s) => String(s).slice(0, 10).replace(/-/g, '');

export default handler(async (req) => {
  const [key, L] = league(req);
  const cur = currentSeason(key);
  const season = Number(String(req.query?.season || cur).replace(/\D/g, '')) || cur;
  const isCurrent = season === cur;
  const base = `${urls.SITE}/${L.path}/scoreboard`;
  const extra = key === 'cfb' ? '&groups=80&limit=300' : '&limit=300';
  let j;
  let selected;
  let calendar;

  if (L.sport === 'football') {
    let type = String(req.query?.type || '').replace(/\D/g, '');
    let week = String(req.query?.week || '').replace(/\D/g, '');
    if (!week) {
      if (isCurrent) {
        const now = await getJSON(base);
        type = String(now.season?.type || 2);
        week = String(now.week?.number || 1);
        const anyDone = (now.events || []).some((e) => e.status?.type?.state === 'post');
        if (!anyDone && Number(week) > 1) week = String(Number(week) - 1);
        if (type !== '2' && type !== '3') { type = '2'; week = '1'; }
      } else {
        type = '2';
        week = key === 'cfb' ? '14' : '18';
      }
    }
    type = type || '2';
    j = await getJSON(`${base}?dates=${season}&seasontype=${type}&week=${week}${extra}`);
    calendar = { kind: 'weeks', items: footballCalendar(j) };
    selected = { type, week };
  } else {
    let date = String(req.query?.date || '').replace(/\D/g, '');
    if (!date) {
      // Ask for a date inside the season to learn its calendar, then pick the last day that has been played.
      const probe = isCurrent ? etToday() : `${season}0301`;
      const pj = await getJSON(`${base}?dates=${probe}${extra}`);
      const days = (pj?.leagues?.[0]?.calendar || []).map((x) => dateKey(x.startDate || x));
      const today = etToday();
      const played = days.filter((d) => d < today);
      date = isCurrent ? played[played.length - 1] || today : days[days.length - 1] || probe;
      j = date === probe ? pj : await getJSON(`${base}?dates=${date}${extra}`);
    } else {
      j = await getJSON(`${base}?dates=${date}${extra}`);
    }
    const days = (j?.leagues?.[0]?.calendar || []).map((x) => dateKey(x.startDate || x));
    calendar = { kind: 'dates', items: days };
    selected = { date };
  }

  let games = (j?.events || []).map((ev) => normEvent(ev, key));
  if (key === 'cfb') games = games.filter((g) => g.tv || g.state === 'post').slice(0, 80);
  games.sort((a, b) => new Date(a.date) - new Date(b.date));

  return { league: key, season, current: cur, isCurrent, selected, calendar, games };
}, { sMaxAge: 120, swr: 3600 });
