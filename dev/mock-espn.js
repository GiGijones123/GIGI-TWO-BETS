// Fake ESPN responses for testing the site offline (npm run mock).
// Shapes follow ESPN's public JSON; the numbers are made up.

const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const T = {
  CHI: { id: '3', abbreviation: 'CHI', displayName: 'Chicago Bears', shortDisplayName: 'Bears', color: '0b1c3a', alternateColor: 'e64100', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/chi.png' },
  DET: { id: '8', abbreviation: 'DET', displayName: 'Detroit Lions', shortDisplayName: 'Lions', color: '0076b6', alternateColor: 'bbbbbb', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/det.png' },
  PHI: { id: '21', abbreviation: 'PHI', displayName: 'Philadelphia Eagles', shortDisplayName: 'Eagles', color: '06424d', alternateColor: '000000', logo: '' },
  DAL: { id: '6', abbreviation: 'DAL', displayName: 'Dallas Cowboys', shortDisplayName: 'Cowboys', color: '002a5c', alternateColor: 'b0b7bc', logo: '' },
  KC: { id: '12', abbreviation: 'KC', displayName: 'Kansas City Chiefs', shortDisplayName: 'Chiefs', color: 'e31837', alternateColor: 'ffb612', logo: '' },
  BUF: { id: '2', abbreviation: 'BUF', displayName: 'Buffalo Bills', shortDisplayName: 'Bills', color: '00338d', alternateColor: 'd50a0a', logo: '' },
  LAL: { id: '13', abbreviation: 'LAL', displayName: 'Los Angeles Lakers', shortDisplayName: 'Lakers', color: '552583', alternateColor: 'fdb927', logo: '' },
  SA: { id: '24', abbreviation: 'SA', displayName: 'San Antonio Spurs', shortDisplayName: 'Spurs', color: 'c4ced4', alternateColor: '000000', logo: '' },
};
const comp = (a, h, rec) => [
  { homeAway: 'home', team: T[h], score: rec?.h ?? '0', records: [{ type: 'total', summary: '8-2' }] },
  { homeAway: 'away', team: T[a], score: rec?.a ?? '0', records: [{ type: 'total', summary: '8-2' }] },
];
const status = (state, extra = {}) => ({ clock: 0, displayClock: extra.clock || '0:00', period: extra.period || 0, type: { state, completed: state === 'post', shortDetail: extra.detail || (state === 'pre' ? '1:00 PM' : 'Final'), detail: extra.detail || '' } });
const oddsFor = (details, ou, hml, aml) => [{ provider: { name: 'ESPN BET' }, details, overUnder: ou, spread: -2.5, homeTeamOdds: { moneyLine: hml }, awayTeamOdds: { moneyLine: aml } }];

let tick = 0;
function liveEvent() {
  tick++;
  const plays = ['Jared Goff pass short right to Amon-Ra St. Brown for 12 yards', 'Jahmyr Gibbs right end for 7 yards', 'Caleb Williams sacked by DJ Wonnum for -6 yards', 'Jared Goff pass deep left to Jameson Williams for 34 yards, TOUCHDOWN'];
  return {
    id: '401772001', date: iso(now - 90 * 60e3), shortName: 'CHI @ DET',
    competitions: [{ competitors: comp('CHI', 'DET', { a: '17', h: String(20 + (tick % 3)) }), status: status('in', { period: 3, clock: `${8 - (tick % 8)}:2${tick % 10}`, detail: '3rd Quarter' }),
      situation: { lastPlay: { text: plays[tick % plays.length], probability: { homeWinPercentage: 0.63 } }, downDistanceText: '2nd & 4 at CHI 38', possession: '8', isRedZone: false },
      odds: oddsFor('CHI -2.5', 55.5, 106, -124), broadcasts: [{ names: ['CBS'] }], venue: { fullName: 'Ford Field' } }],
  };
}
function sbNFL() {
  return { events: [
    liveEvent(),
    { id: '401772002', date: iso(now + 2 * 3600e3 + 125e3), shortName: 'PHI @ DAL', competitions: [{ competitors: comp('PHI', 'DAL'), status: status('pre', { detail: 'Thu, November 26th at 4:30 PM EST' }), odds: oddsFor('DAL -8.5', 47.5, -480, 370), broadcasts: [{ names: ['FOX'] }], venue: { fullName: 'AT&T Stadium' } }] },
    { id: '401772003', date: iso(now + 6 * 3600e3), shortName: 'KC @ BUF', competitions: [{ competitors: comp('KC', 'BUF'), status: status('pre'), odds: oddsFor('BUF -3', 46.5, -149, 126), broadcasts: [{ names: ['NBC'] }], venue: { fullName: 'Highmark Stadium' } }] },
  ] };
}
function sbNBA() {
  return { events: [{ id: '401810001', date: iso(now + 30 * 3600e3), shortName: 'LAL @ SA', competitions: [{ competitors: comp('LAL', 'SA'), status: status('pre'), odds: [{ provider: { name: 'ESPN BET' }, details: 'SA -6.5', overUnder: 225.5, homeTeamOdds: { moneyLine: -200 }, awayTeamOdds: { moneyLine: 170 } }], broadcasts: [{ names: ['Prime Video'] }], venue: { fullName: 'Frost Bank Center' } }] }] };
}

const PEOPLE = {
  3: [['4431611', 'Caleb Williams', 'QB', '18'], ['4360438', "D'Andre Swift", 'RB', '4'], ['4431299', 'Rome Odunze', 'WR', '15'], ['4685278', 'Luther Burden III', 'WR', '10'], ['2976316', 'Kalif Raymond', 'WR', '14'], ['4723086', 'Colston Loveland', 'TE', '84'], ['1', 'Theo Benedet', 'OT', '79'], ['2', 'Joe Thuney', 'G', '62'], ['3', 'Garrett Bradbury', 'C', '67'], ['4', 'Jonah Jackson', 'G', '73'], ['5', 'Darnell Wright', 'OT', '58'], ['11', 'Montez Sweat', 'DE', '98'], ['12', 'Grady Jarrett', 'DT', '50'], ['13', 'Jeffery Simmons', 'DT', '99'], ['14', 'Austin Booker', 'DE', '94'], ['15', 'T.J. Edwards', 'LB', '53'], ['16', 'Devin Bush', 'LB', '12'], ['17', 'Kyler Gordon', 'CB', '6'], ['18', 'Jaylon Johnson', 'CB', '1'], ['19', 'Dillon Thieneman', 'S', '31'], ['20', 'Cam Lewis', 'S', '21']],
  8: [['3046779', 'Jared Goff', 'QB', '16'], ['4429795', 'Jahmyr Gibbs', 'RB', '0'], ['4374302', 'Amon-Ra St. Brown', 'WR', '14'], ['4426388', 'Jameson Williams', 'WR', '1'], ['5', 'Isaac TeSlaa', 'WR', '18'], ['4430027', 'Sam LaPorta', 'TE', '87'], ['31', 'Penei Sewell', 'OT', '58'], ['32', 'Christian Mahogany', 'G', '73'], ['33', 'Juice Scruggs', 'C', '70'], ['34', 'Tate Ratledge', 'G', '69'], ['35', 'Blake Miller', 'OT', '76'], ['41', 'Derrick Moore', 'DE', '8'], ['42', 'Tyleik Williams', 'DT', '91'], ['43', 'Alim McNeill', 'DT', '54'], ['44', 'DJ Wonnum', 'DE', '98'], ['45', 'Derrick Barnes', 'LB', '55'], ['46', 'Malcolm Rodriguez', 'LB', '44'], ['47', 'D.J. Reed', 'CB', '4'], ['48', 'Rock Ya-Sin', 'CB', '23'], ['49', 'Brian Branch', 'S', '32'], ['50', 'Kerby Joseph', 'S', '31']],
};
const ath = ([id, displayName, pos, jersey]) => ({ id, displayName, jersey, position: { abbreviation: pos, displayName: pos }, displayHeight: `6' 2"`, displayWeight: '215 lbs', age: 27, experience: { years: 4 }, headshot: { href: `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png` } });

function roster(id) {
  const list = (PEOPLE[id] || PEOPLE[8]).map(ath);
  return { athletes: [{ position: 'offense', items: list.slice(0, 11) }, { position: 'defense', items: list.slice(11) }] };
}
function depth(id) {
  const list = PEOPLE[id];
  if (!list) return null; // simulate a team with no depth chart
  const by = (i) => ({ athletes: [{ id: list[i][0], displayName: list[i][1] }, { id: '999', displayName: 'Backup Guy' }] });
  const pos = (k, i, ab) => [k, { position: { abbreviation: ab }, ...by(i) }];
  return { depthchart: [
    { name: '3WR 1TE', positions: Object.fromEntries([pos('qb', 0, 'QB'), pos('rb', 1, 'RB'), pos('wr', 2, 'WR'), pos('wr2', 3, 'WR'), pos('wr3', 4, 'WR'), pos('te', 5, 'TE'), pos('lt', 6, 'LT'), pos('lg', 7, 'LG'), pos('c', 8, 'C'), pos('rg', 9, 'RG'), pos('rt', 10, 'RT')]) },
    { name: 'Base 4-3 D', positions: Object.fromEntries([pos('lde', 11, 'LDE'), pos('ldt', 12, 'LDT'), pos('rdt', 13, 'RDT'), pos('rde', 14, 'RDE'), pos('wlb', 15, 'WLB'), pos('mlb', 16, 'MLB'), pos('lcb', 17, 'LCB'), pos('rcb', 18, 'RCB'), pos('ss', 19, 'SS'), pos('fs', 20, 'FS')]) },
    { name: 'Special Teams', positions: { pk: { position: { abbreviation: 'PK' }, athletes: [{ id: '77', displayName: 'Kicker Guy' }] } } },
  ] };
}
function standings() {
  const rows = [['3', 25.4, 19.7, 8, 2], ['8', 28.9, 22.0, 8, 2], ['21', 16.7, 24.1, 3, 7], ['6', 30.6, 25.0, 5, 6], ['12', 27.3, 16.3, 8, 2], ['2', 26.0, 18.0, 9, 1], ['13', 117, 112, 15, 3], ['24', 119, 110, 15, 4]];
  return { children: [{ standings: { entries: rows.map(([id, pf, pa, w, l]) => ({ team: { id }, stats: [{ name: 'wins', value: w }, { name: 'losses', value: l }, { name: 'avgPointsFor', value: pf }, { name: 'avgPointsAgainst', value: pa }, { name: 'streak', displayValue: 'W3' }] })) } }] };
}
const teamStats = (id) => ({ results: { stats: { categories: [
  { name: 'passing', stats: [{ name: 'passingAttempts', value: id === '8' ? 334 : 335 }, { name: 'netPassingYardsPerGame', value: id === '8' ? 273.4 : 249.1 }] },
  { name: 'rushing', stats: [{ name: 'rushingAttempts', value: id === '8' ? 293 : 336 }, { name: 'rushingYardsPerGame', value: id === '8' ? 132.2 : 142.4 }] },
  { name: 'general', stats: [{ name: 'fieldGoalPct', value: 47.1 }, { name: 'threePointFieldGoalPct', value: 36.2 }, { name: 'avgThreePointFieldGoalsAttempted', value: 38 }, { name: 'avgFieldGoalsAttempted', value: 89 }, { name: 'avgRebounds', value: 44.1 }] },
] } } });

function summary(id) {
  const isLive = id === '401772001';
  const ev = isLive ? liveEvent() : id === '401810001' ? sbNBA().events[0] : sbNFL().events.find((e) => e.id === id) || sbNFL().events[1];
  const c = ev.competitions[0];
  const [home, away] = c.competitors;
  const play = (i, text, extra = {}) => ({ id: String(1000 + i), text, period: { number: 3 }, clock: { displayValue: `${10 - (i % 10)}:${String(i * 7 % 60).padStart(2, '0')}` }, type: { text: extra.type || 'Rush' }, scoringPlay: !!extra.score, awayScore: 17, homeScore: 20, ...extra });
  return {
    header: { id: ev.id, competitions: [{ date: ev.date, competitors: c.competitors, status: c.status }] },
    pickcenter: [...c.odds, { provider: { name: 'DraftKings' }, details: c.odds[0].details, overUnder: c.odds[0].overUnder + 1, homeTeamOdds: { moneyLine: -130 }, awayTeamOdds: { moneyLine: 110 } }],
    predictor: { homeTeam: { gameProjection: '58.4' }, awayTeam: { gameProjection: '41.6' } },
    injuries: [
      { team: { id: away.team.id }, injuries: [{ athlete: { id: '17', displayName: 'Kyler Gordon', position: { abbreviation: 'CB' } }, status: 'Out', details: { type: 'Shoulder' } }, { athlete: { id: '22', displayName: 'Cole Kmet', position: { abbreviation: 'TE' } }, status: 'Out', details: { type: 'Knee' } }] },
      { team: { id: home.team.id }, injuries: [{ athlete: { id: '44', displayName: 'DJ Wonnum', position: { abbreviation: 'DE' } }, status: 'Questionable', details: { type: 'Back' } }, { athlete: { id: '51', displayName: 'Aidan Hutchinson', position: { abbreviation: 'DE' } }, status: 'Out', details: { type: 'Leg' } }] },
    ],
    lastFiveGames: [{ team: { id: away.team.id }, events: ['W', 'W', 'W', 'L', 'W'].map((r) => ({ gameResult: r, score: '24-17', opponent: { abbreviation: 'NO' }, atVs: 'vs' })) }, { team: { id: home.team.id }, events: ['W', 'L', 'W', 'W', 'L'].map((r) => ({ gameResult: r, score: '27-20', opponent: { abbreviation: 'TB' }, atVs: '@' })) }],
    leaders: [{ team: { id: home.team.id }, leaders: [{ displayName: 'Passing', leaders: [{ athlete: { id: '3046779', displayName: 'Jared Goff' }, displayValue: '201 YDS' }] }, { displayName: 'Receiving', leaders: [{ athlete: { id: '4374302', displayName: 'Amon-Ra St. Brown' }, displayValue: '88 YDS' }] }] }],
    drives: isLive ? { previous: [{ team: { id: '3' }, plays: [play(1, 'Caleb Williams pass short left to Luther Burden III for 9 yards', { type: 'Pass Reception' }), play(2, 'Kyler Gordon was injured during the play. His return is Questionable.', { type: 'Injury' })] }, { team: { id: '8' }, plays: [play(3, 'Jahmyr Gibbs 12 yard rush. TOUCHDOWN', { score: true, type: 'Rushing Touchdown' }), play(4, 'Jake Bates extra point is GOOD', { score: true, type: 'Extra Point' })] }], current: { team: { id: '8' }, plays: [play(5, liveEvent().competitions[0].situation.lastPlay.text, { type: 'Pass Reception' })] } } : undefined,
    boxscore: isLive ? {
      teams: [{ team: { id: '3', abbreviation: 'CHI' }, statistics: [{ name: 'totalYards', label: 'Total Yards', displayValue: '288' }, { name: 'turnovers', label: 'Turnovers', displayValue: '1' }] }, { team: { id: '8', abbreviation: 'DET' }, statistics: [{ name: 'totalYards', label: 'Total Yards', displayValue: '341' }, { name: 'turnovers', label: 'Turnovers', displayValue: '0' }] }],
      players: [{ team: { id: '8' }, statistics: [
        { name: 'passing', keys: ['completions/passingAttempts', 'passingYards', 'passingTouchdowns'], athletes: [{ athlete: { id: '3046779', displayName: 'Jared Goff' }, stats: ['16/22', '201', '2'] }] },
        { name: 'receiving', keys: ['receptions', 'receivingYards'], athletes: [{ athlete: { id: '4374302', displayName: 'Amon-Ra St. Brown' }, stats: ['7', '88'] }] },
      ] }],
    } : { teams: [], players: [] },
    winprobability: isLive ? [{ homeWinPercentage: 0.61 }, { homeWinPercentage: 0.64 }] : undefined,
  };
}

function athlete(id) {
  return { athlete: { id, displayName: id === '3046779' ? 'Jared Goff' : 'Amon-Ra St. Brown', jersey: id === '3046779' ? '16' : '14', position: { abbreviation: id === '3046779' ? 'QB' : 'WR', displayName: id === '3046779' ? 'Quarterback' : 'Wide Receiver' }, team: { abbreviation: 'DET', displayName: 'Detroit Lions' }, age: 32, displayHeight: `6' 4"`, displayWeight: '217 lbs', college: { name: 'California' }, displayExperience: '10th Season', displayDraft: '2016: Rd 1, Pk 1 (LAR)', birthPlace: { city: 'Novato', state: 'CA' } } };
}
function overview() {
  return { statistics: { labels: ['CMP', 'ATT', 'YDS', 'TD', 'INT', 'RTG'], splits: [{ displayName: 'Regular Season', stats: ['225', '332', '2,716', '20', '4', '107.7'] }] } };
}
function gamelog(id) {
  const names = ['completions', 'passingAttempts', 'passingYards', 'passingTouchdowns', 'interceptions', 'rushingAttempts', 'rushingYards', 'receptions', 'receivingYards'];
  const opps = ['TB', 'NE', 'MIA', 'MIN', 'GB', 'CAR', 'KC', 'SEA', 'BAL', 'LAR'];
  const vals = [279, 303, 170, 176, 303, 412, 225, 260, 301, 230];
  const events = {};
  const evs = opps.map((o, i) => {
    const eid = `40177${i}`;
    events[eid] = { gameDate: iso(now - (i + 1) * 7 * 864e5), opponent: { abbreviation: o }, atVs: i % 2 ? '@' : 'vs', gameResult: i % 3 ? 'W' : 'L', score: '27-20' };
    return { eventId: eid, stats: ['20', '30', String(vals[i]), '2', '0', '2', '5', String(5 + (i % 4)), String(60 + i * 7)] };
  });
  return { filters: [{ name: 'season', options: [{ value: '2026', displayValue: '2026' }, { value: '2025', displayValue: '2025' }, { value: '2024', displayValue: '2024' }] }], names, labels: names.map((n) => n.slice(0, 4).toUpperCase()), events, seasonTypes: [{ displayName: '2026 Regular Season', categories: [{ events: evs }] }] };
}
function news() {
  return { articles: [1, 2, 3].map((i) => ({ headline: `Mock headline number ${i}`, description: 'Something happened in the league today and it matters for your bets.', published: iso(now - i * 3600e3), images: [{ url: '' }], links: { web: { href: 'https://www.espn.com' } } })) };
}

export function mockFetch(url) {
  const u = new URL(url);
  const p = u.pathname;
  let body = null;
  if (p.endsWith('/football/nfl/scoreboard')) {
    body = sbNFL();
    body.season = { type: 2, year: 2026 }; body.week = { number: 12 };
    body.leagues = [{ calendar: [{ label: 'Preseason', value: '1', entries: [] }, { label: 'Regular Season', value: '2', entries: Array.from({ length: 18 }, (_, i) => ({ label: `Week ${i + 1}`, value: String(i + 1), startDate: '', endDate: '' })) }, { label: 'Postseason', value: '3', entries: [{ label: 'Wild Card', value: '1' }, { label: 'Pro Bowl', value: '4' }, { label: 'Super Bowl', value: '5' }] }] }];
    if (u.searchParams.get('week')) body.events = body.events.map((e) => ({ ...e, competitions: [{ ...e.competitions[0], status: { type: { state: 'post', completed: true, shortDetail: 'Final' }, period: 4 } }] }));
  }
  else if (p.endsWith('/basketball/nba/scoreboard')) { body = u.searchParams.get('dates')?.endsWith('27') ? sbNBA() : { events: sbNBA().events.map((e) => ({ ...e, competitions: [{ ...e.competitions[0], status: { type: { state: 'post', shortDetail: 'Final' } } }] })) }; body.leagues = [{ calendar: ['2025-10-21T07:00Z', '2025-10-22T07:00Z', '2026-11-25T07:00Z', '2026-11-26T07:00Z', '2026-11-27T07:00Z'] }]; }
  else if (p.endsWith('/scoreboard')) body = { events: [] };
  else if (p.endsWith('/summary')) body = summary(u.searchParams.get('event'));
  else if (/teams\/\d+\/roster$/.test(p)) body = roster(p.match(/teams\/(\d+)/)[1]);
  else if (/teams\/\d+\/depthcharts$/.test(p)) body = depth(p.match(/teams\/(\d+)/)[1]);
  else if (/teams\/\d+\/statistics$/.test(p)) body = teamStats(p.match(/teams\/(\d+)/)[1]);
  else if (p.endsWith('/standings')) body = standings();
  else if (p.endsWith('/news')) body = news();
  else if (/athletes\/\d+\/overview$/.test(p)) body = overview();
  else if (/athletes\/\d+\/gamelog$/.test(p)) body = gamelog(p.match(/athletes\/(\d+)/)[1]);
  else if (/athletes\/\d+$/.test(p)) body = athlete(p.match(/athletes\/(\d+)/)[1]);
  return Promise.resolve(new Response(body ? JSON.stringify(body) : '{}', { status: body ? 200 : 404, headers: { 'content-type': 'application/json' } }));
}
