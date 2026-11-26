// One game: odds from several books, injuries, recent plays, live box score.
import { league, urls, getJSON, handler, normSummary } from '../lib/espn.js';

export default handler(async (req) => {
  const [key, L] = league(req);
  const id = String(req.query?.id || '').replace(/\D/g, '');
  if (!id) throw Object.assign(new Error('Missing game id'), { status: 400 });
  const sum = await getJSON(`${urls.SITE}/${L.path}/summary?event=${id}`);
  return normSummary(sum, key);
}, { sMaxAge: 8, swr: 20 });
