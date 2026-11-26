// AI Check: read a photo of a bet slip, look up the real numbers on ESPN,
// then grade each pick (keep, change or drop) with reasons.
//
// Needs ANTHROPIC_API_KEY in Vercel's environment variables. Each check makes two
// Claude calls (read the slip, then grade it). Optional: CHECK_MODEL to pick a
// different Claude model, BETS_PASSCODE to stop strangers from using your credit.
import Anthropic from '@anthropic-ai/sdk';
import { LEAGUES, urls, tryJSON, normSummary } from '../lib/espn.js';
import { bio as playerBio, gamelog } from './player.js';
import { one as leagueGames } from './scoreboard.js';

export const config = { maxDuration: 60 };

// Gianni picked the low-cost model (well under 1 cent a check). Set CHECK_MODEL=claude-opus-5-5 for the top model.
const MODEL = process.env.CHECK_MODEL || 'claude-haiku-5-5';
const SPORTS = ['NFL', 'NBA', 'College FB', 'NHL', 'Other'];
const SPORT_KEY = { NFL: 'nfl', NBA: 'nba', 'College FB': 'cfb', NHL: 'nhl' };
const MARKETS = ['spread', 'moneyline', 'game_total', 'team_total', 'passing_yards', 'passing_tds', 'completions', 'pass_attempts', 'interceptions', 'rushing_yards', 'rush_attempts', 'receiving_yards', 'receptions', 'rush_rec_yards', 'anytime_td', 'points', 'rebounds', 'assists', 'threes', 'pts_reb_ast', 'pts_reb', 'pts_ast', 'reb_ast', 'steals', 'blocks', 'goals', 'hockey_assists', 'hockey_points', 'shots_on_goal', 'saves', 'other'];

// How each prop market adds up from ESPN game-log columns.
const STAT_OF = {
  passing_yards: ['passingYards'], passing_tds: ['passingTouchdowns'], completions: ['completions'], pass_attempts: ['passingAttempts'], interceptions: ['interceptions'],
  rushing_yards: ['rushingYards'], rush_attempts: ['rushingAttempts'], receiving_yards: ['receivingYards'], receptions: ['receptions'], rush_rec_yards: ['rushingYards', 'receivingYards'],
  anytime_td: ['rushingTouchdowns', 'receivingTouchdowns'],
  points: ['points'], rebounds: ['rebounds'], assists: ['assists'], threes: ['threePointFieldGoalsMade'], steals: ['steals'], blocks: ['blocks'],
  pts_reb_ast: ['points', 'rebounds', 'assists'], pts_reb: ['points', 'rebounds'], pts_ast: ['points', 'assists'], reb_ast: ['rebounds', 'assists'],
  goals: ['goals'], hockey_assists: ['assists'], hockey_points: ['goals', 'assists'], shots_on_goal: ['shotsTotal', 'shots'], saves: ['saves'],
};

const nul = (t) => ({ type: [t, 'null'] });
const SLIP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['readable', 'problem', 'app', 'betType', 'stake', 'payout', 'odds', 'placed', 'legs'],
  properties: {
    readable: { type: 'boolean' },
    problem: { type: 'string' },
    app: { type: 'string', enum: ['DraftKings', 'PrizePicks', 'FanDuel', 'Other'] },
    betType: { type: 'string', enum: ['single', 'parlay', 'same_game_parlay', 'pickem', 'other'] },
    stake: nul('number'),
    payout: nul('number'),
    odds: nul('number'),
    placed: { type: 'string' },
    legs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'sport', 'player', 'team', 'opponent', 'market', 'line', 'side', 'odds', 'status'],
        properties: {
          text: { type: 'string' },
          sport: { type: 'string', enum: SPORTS },
          player: { type: 'string' },
          team: { type: 'string' },
          opponent: { type: 'string' },
          market: { type: 'string', enum: MARKETS },
          line: nul('number'),
          side: { type: 'string', enum: ['over', 'under', 'team', 'yes', 'other'] },
          odds: nul('number'),
          status: { type: 'string', enum: ['open', 'won', 'lost', 'push', 'unknown'] },
        },
      },
    },
  },
};

const GRADE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['grade', 'verdict', 'headline', 'summary', 'legs', 'tips'],
  properties: {
    grade: { type: 'string', enum: ['A', 'B', 'C', 'D', 'F'] },
    verdict: { type: 'string', enum: ['good', 'okay', 'risky', 'bad'] },
    headline: { type: 'string' },
    summary: { type: 'string' },
    legs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'call', 'why', 'change'],
        properties: {
          index: { type: 'integer' },
          call: { type: 'string', enum: ['keep', 'change', 'drop'] },
          why: { type: 'string' },
          change: { type: 'string' },
        },
      },
    },
    tips: { type: 'array', items: { type: 'string' } },
  },
};

const READ_PROMPT = `This is a screenshot or photo of a sports bet (a sportsbook bet slip, a PrizePicks entry, or similar). Read it exactly.
- One entry in legs per pick. For a single bet there is one leg.
- text: the pick as a short plain line, like "Amon-Ra St. Brown over 80.5 receiving yards" or "Lions -3.5".
- player: full player name if it is a player prop, else "". team: the team picked or the player's team, as shown. opponent: the other team if shown, else "".
- PrizePicks "More" = over and "Less" = under. Use betType "pickem" for PrizePicks style entries.
- line: the number on the pick (spread, total or prop line). For moneyline use null.
- odds: American odds like -110 or 150 (no plus sign). stake: amount wagered in dollars. payout: total payout or "to win" plus stake if shown.
- placed: the date the bet was placed or the game date as YYYY-MM-DD if visible, else "".
- status: won/lost/push if the slip shows a result, open if it is still pending.
- If the image is not a bet or you cannot read it, set readable false and say why in problem. Otherwise problem is "".
Never guess numbers that are not in the image; use null.`;

function sideWord(leg) { return leg.side === 'under' ? 'under' : 'over'; }

// ---------- ESPN facts for each leg ----------
async function findPlayer(name, key) {
  if (!name) return null;
  const j = await tryJSON(`https://site.web.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(name)}&type=player&limit=10`, { timeout: 5000 });
  const items = (j?.items || j?.results?.flatMap?.((r) => r.contents || []) || []).filter(Boolean);
  const want = LEAGUES[key]?.path.split('/')[1];
  const lgOf = (it) => String(it.league || it.defaultLeagueSlug || it.uid || it.link?.web || it.links?.web?.href || '').toLowerCase();
  const idOf = (it) => String(it.id || it.uid?.match(/a:(\d+)/)?.[1] || '').replace(/\D/g, '');
  const hit = items.find((it) => idOf(it) && (lgOf(it).includes(want) || lgOf(it).includes(`l:${{ nfl: 28, nba: 46, 'college-football': 23, nhl: 90 }[want]}`))) || items.find((it) => idOf(it) && (it.type === 'player' || it.type === 'athlete'));
  return hit ? idOf(hit) : null;
}

function hitRate(games, cols, line, side, n) {
  const list = games.filter((g) => cols.some((c) => g.stats[c] !== null && g.stats[c] !== undefined)).slice(0, n);
  if (!list.length) return null;
  const vals = list.map((g) => cols.reduce((s, c) => s + (Number(g.stats[c]) || 0), 0));
  const hits = vals.filter((v) => (side === 'under' ? v < line : v > line)).length;
  return { games: list.length, hits, avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10, values: vals };
}

const gamesCache = new Map();
async function gamesFor(key) {
  if (!gamesCache.has(key)) gamesCache.set(key, leagueGames(key).catch(() => []));
  return gamesCache.get(key);
}
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim();
function teamMatch(t, q) {
  const n = norm(q);
  if (!n) return false;
  return [t.abbr, t.name, t.full].some((x) => { const v = norm(x); return v && (v === n || v.includes(n) || n.includes(v)); });
}

async function gameFacts(key, team, opponent) {
  const games = await gamesFor(key);
  const g = games.find((x) => (teamMatch(x.home, team) || teamMatch(x.away, team)) && (!opponent || teamMatch(x.home, opponent) || teamMatch(x.away, opponent))) || games.find((x) => teamMatch(x.home, team) || teamMatch(x.away, team));
  if (!g) return null;
  const sumJ = await tryJSON(`${urls.SITE}/${LEAGUES[key].path}/summary?event=${g.id}`, { timeout: 6000 });
  let sum = null;
  try { sum = sumJ ? normSummary(sumJ, key) : null; } catch { sum = null; }
  const inj = (id) => (sum?.injuries?.[id] || []).filter((i) => !/probable/i.test(i.status)).slice(0, 8).map((i) => `${i.name} (${i.pos}) ${i.status}${i.detail ? ', ' + i.detail : ''}`);
  return {
    gameId: g.id,
    matchup: `${g.away.full || g.away.name} at ${g.home.full || g.home.name}`,
    start: g.date,
    state: g.state === 'in' ? `live, ${g.detail}, ${g.away.abbr} ${g.away.score ?? 0} - ${g.home.abbr} ${g.home.score ?? 0}` : g.state === 'post' ? `final, ${g.away.abbr} ${g.away.score} - ${g.home.abbr} ${g.home.score}` : 'not started',
    records: `${g.away.abbr} ${g.away.record || '?'}, ${g.home.abbr} ${g.home.record || '?'}`,
    odds: (sum?.game?.odds || g.odds) ? { line: (sum?.game?.odds || g.odds).details, total: (sum?.game?.odds || g.odds).overUnder, awayML: (sum?.game?.odds || g.odds).awayML, homeML: (sum?.game?.odds || g.odds).homeML } : null,
    espnWinChance: sum?.predictor ? { [g.home.abbr]: sum.predictor.home, [g.away.abbr]: sum.predictor.away } : g.homeWinPct !== null && g.homeWinPct !== undefined ? { [g.home.abbr]: Math.round(g.homeWinPct) } : null,
    injuries: sum ? { [g.away.abbr]: inj(g.away.id), [g.home.abbr]: inj(g.home.id) } : null,
  };
}

async function legFacts(leg) {
  const key = SPORT_KEY[leg.sport];
  if (!key) return { note: 'Sport not covered by this site, no ESPN numbers.' };
  const out = {};
  const tasks = [];
  if (leg.player) {
    tasks.push((async () => {
      const id = await findPlayer(leg.player, key);
      if (!id) { out.player = { note: `Could not find ${leg.player} on ESPN.` }; return; }
      const base = `${urls.WEB}/${LEAGUES[key].path}/athletes/${id}`;
      const [a, gl] = await Promise.all([tryJSON(base, { timeout: 6000 }), tryJSON(`${base}/gamelog`, { timeout: 6000 })]);
      const b = playerBio(a, LEAGUES[key], id);
      const log = gamelog(gl);
      const cols = STAT_OF[leg.market];
      const p = { id, league: key, name: b.name || leg.player, team: b.team, pos: b.pos, headshot: b.headshot, injury: b.injury || 'none listed' };
      if (cols && leg.line !== null) {
        const side = sideWord(leg);
        p.stat = leg.market;
        p.last5 = hitRate(log.games, cols, leg.line, side, 5);
        p.last10 = hitRate(log.games, cols, leg.line, side, 10);
        p.season = hitRate(log.games, cols, leg.line, side, 100);
        p.recent = log.games.slice(0, 5).map((g) => ({ date: String(g.date).slice(0, 10), opp: `${g.atVs} ${g.opp}`.trim(), value: cols.reduce((s, c) => s + (Number(g.stats[c]) || 0), 0), result: g.result }));
      } else if (leg.market === 'anytime_td') {
        p.stat = 'anytime_td';
        p.last10 = hitRate(log.games, STAT_OF.anytime_td, 0.5, 'over', 10);
      }
      out.player = p;
      if (!leg.team && b.team) leg.team = b.team;
    })());
  }
  await Promise.all(tasks);
  const team = leg.team || out.player?.team;
  if (team) out.game = await gameFacts(key, team, leg.opponent);
  return out;
}

// ---------- Claude ----------
async function ask(client, content, schema, effort) {
  const params = {
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort, format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content }],
  };
  let r;
  if (/haiku/.test(MODEL)) r = await client.messages.create(params); // Haiku has no server-side fallback
  else try {
    // If the main model declines, the API retries on a fallback model in the same call.
    r = await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  } catch (e) {
    if (e?.status === 400 && /fallback/i.test(e.message || '')) r = await client.messages.create(params);
    else throw e;
  }
  if (r.stop_reason === 'refusal') throw Object.assign(new Error('The AI would not check this picture. Try a clearer screenshot of just the bet slip.'), { status: 422 });
  if (r.stop_reason === 'max_tokens') throw Object.assign(new Error('The AI ran out of room. Try a slip with fewer picks.'), { status: 422 });
  const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('The AI answer came back garbled. Try again.'), { status: 502 }); }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json({ ready: !!process.env.ANTHROPIC_API_KEY, needsPass: !!process.env.BETS_PASSCODE });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(501).json({ error: 'AI Check is not switched on yet. Add ANTHROPIC_API_KEY in Vercel to turn it on.', setup: true });
  if (process.env.BETS_PASSCODE && req.headers['x-bets-pass'] !== process.env.BETS_PASSCODE) return res.status(401).json({ error: 'Passcode needed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body && req.on) body = await new Promise((ok) => { let s = ''; req.on('data', (c) => { s += c; }); req.on('end', () => { try { ok(JSON.parse(s)); } catch { ok(null); } }); });
  const image = String(body?.image || '').replace(/^data:[^,]+,/, '');
  const mediaType = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(body?.mediaType) ? body.mediaType : 'image/jpeg';
  if (!image || image.length < 100) return res.status(400).json({ error: 'Add a picture of your bet first' });
  if (image.length > 4_000_000) return res.status(413).json({ error: 'That picture is too big. Try a screenshot instead.' });

  try {
    const client = new Anthropic({ timeout: 55_000, maxRetries: 1 });
    // 1) read the slip
    const slip = await ask(client, [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: image } }, { type: 'text', text: READ_PROMPT }], SLIP_SCHEMA, 'low');
    if (!slip.readable || !slip.legs?.length) return res.status(200).json({ slip, grade: null, facts: [], error: slip.problem || 'Could not find a bet in that picture.' });

    // 2) real numbers from ESPN
    const facts = await Promise.all(slip.legs.slice(0, 12).map((l) => legFacts(l).catch(() => ({ note: 'ESPN lookup failed' }))));

    // 3) grade it
    const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const gradePrompt = `Today is ${today} (US Eastern). You are a sharp, honest sports betting analyst helping a casual bettor.
Here is the bet they placed, read from their slip:
${JSON.stringify(slip, null, 1)}

Live facts from ESPN for each leg (same order as legs; last5/last10/season = how often the player beat this exact line and their average; values = the stat in each game):
${JSON.stringify(facts, null, 1)}

Grade the bet. For each leg give call keep, change or drop:
- keep: the numbers support it.
- change: the idea is fine but a different line, side or bet type is smarter (say exactly what, like "take the over at 72.5 instead" or "make it a single, not a parlay leg").
- drop: the numbers or the news are against it (injury, bad matchup, rarely clears the line).
why: one or two short sentences that cite the actual numbers (hit rate, average, injuries, spread, ESPN win chance). change: the specific swap, or "" when the call is keep.
grade and verdict are for the whole bet, considering how many legs must all hit and the payout. headline: a 3 to 7 word take. summary: 2 short sentences. tips: up to 3 short, practical tips.
Be plain and friendly, no jargon without explaining it. If ESPN facts are missing for a leg, say the grade is based on the slip alone. These are estimates, never promise a win. If a leg is already settled on the slip, say so.`;
    const grade = await ask(client, gradePrompt, GRADE_SCHEMA, 'medium');
    return res.status(200).json({ slip, facts, grade, model: MODEL });
  } catch (e) {
    const status = e.status === 401 ? 500 : e.status || 500;
    const msg = e.status === 401 ? 'The AI key in Vercel is not valid. Check ANTHROPIC_API_KEY.' : e.status === 429 ? 'Too many checks at once. Wait a minute and try again.' : /credit|billing/i.test(e.message || '') ? 'Your Anthropic account is out of credit. Add credit at console.anthropic.com.' : e.message || 'AI Check failed';
    return res.status(status).json({ error: msg });
  }
}
