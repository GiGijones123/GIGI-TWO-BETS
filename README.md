# GIGI Picks

Live scores, play by play, lineups, odds and estimated picks for the NFL, NBA, college football and the NHL.

- Scores, game clocks, the latest play and in-game injuries refresh on their own (about every 8 to 10 seconds while a game is live).
- Tap a game for the matchup (odds from several books, estimated pick and why, who is better on offense and defense, run or pass style, who is missing), the starting lineup drawn as player cards, and every play.
- Tap a player for a photo, bio, season numbers, and a prop tracker: last 5 and last 10 games against the line with hit or miss, plus a live "today" check.
- My bets: log bets and see if you are up or down by week, month or year.

Picks and percentages are estimates, not sure things.

## How it works

- `public/` is the website (plain HTML, CSS and JavaScript, no build step).
- `api/` holds small serverless functions that read ESPN's free public data and trim it down. Vercel caches each answer for a few seconds so many viewers share one ESPN call.
- `public/data/daily.json` holds optional hand-picked notes, picks and prop lines for the day. The site uses them for two days after their date and otherwise falls back to its own estimates.
- `api/bets.js` stores the bet log in a free Upstash Redis database when one is connected in Vercel. Without it, bets are saved on the device. Set `BETS_PASSCODE` in Vercel to require a passcode for adding or changing bets.

## Put it online (free)

1. Sign in at https://vercel.com/signup with GitHub (Hobby plan, free).
2. Open https://vercel.com/new, pick this repository, and press **Deploy**.
3. Optional: in the project, open **Storage**, create an **Upstash for Redis** database on the free plan, connect it to the project, then redeploy. The bet log then syncs across devices.

## Test locally

```
npm run mock   # made-up data, works offline, http://localhost:3000
npm run dev    # real ESPN data
```

## AI Check

The AI Check tab reads a photo of a bet slip, looks up ESPN numbers for each pick and grades it
(keep, change or drop). It needs `ANTHROPIC_API_KEY` in Vercel. It uses `claude-haiku-5-5` (well under
1 cent a check); set `CHECK_MODEL=claude-opus-5-5` for the top model. If `BETS_PASSCODE` is set, the
same passcode protects AI Check so strangers can't spend your credit. `npm run mock` fakes the AI so it
can be tried for free.
