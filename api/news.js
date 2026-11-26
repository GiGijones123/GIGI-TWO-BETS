// Headlines from ESPN for each league.
import { LEAGUES, urls, tryJSON, handler } from '../lib/espn.js';

export default handler(async (req) => {
  const want = String(req.query?.leagues || 'nfl,nba').split(',').filter((k) => LEAGUES[k]);
  const lists = await Promise.all(want.map((k) => tryJSON(`${urls.SITE}/${LEAGUES[k].path}/news?limit=15`).then((j) => ({ k, j }))));
  const articles = [];
  for (const { k, j } of lists) for (const a of j?.articles || []) {
    articles.push({
      league: LEAGUES[k].label,
      head: a.headline || a.title || '',
      body: a.description || '',
      date: a.published || a.lastModified || '',
      img: a.images?.[0]?.url || '',
      url: a.links?.web?.href || a.links?.mobile?.href || '',
    });
  }
  articles.sort((a, b) => new Date(b.date) - new Date(a.date));
  return { articles: articles.slice(0, 40) };
}, { sMaxAge: 600, swr: 1800 });
