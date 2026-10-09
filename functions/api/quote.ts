import { fetchSeries } from '../../server/liveQuote';
import { isTickerRange, TICKER_SYMBOL } from '../../shared/ticker';
import { Env, json } from '../../server/util';

/** One chart range for a ticker card (keyless feeds). Short edge cache: today's line moves, older ranges barely do. */
export const onRequestGet: PagesFunction<Env> = async ({ request }) => {
  const params = new URL(request.url).searchParams;
  const symbol = params.get('symbol') ?? '';
  const range = params.get('range');
  if (!TICKER_SYMBOL.test(symbol) || !isTickerRange(range)) return json({ error: 'bad symbol or range' }, 400);
  const found = await fetchSeries(symbol.toUpperCase(), range);
  if (!found) return json({ error: 'no data' }, 502, { 'cache-control': 'no-store' });
  const maxAge = range === '1D' ? 30 : range === '1W' ? 120 : 600;
  return json(found, 200, { 'cache-control': `public, max-age=${maxAge}` });
};
