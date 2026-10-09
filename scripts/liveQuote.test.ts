import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { quoteAsk } from '../shared/quoteAsk.ts';
import { cacheTier } from '../shared/cacheTtl.ts';
import { formatPrice, isQuoteRow, quoteRow, type LiveQuote } from '../server/liveQuote.ts';

const symbolOf = (q: string) => {
  const ask = quoteAsk(q);
  return ask && ('symbol' in ask ? ask.symbol : `lookup:${ask.lookup}`);
};

describe('quoteAsk', () => {
  test('crypto pairs and coin price asks', () => {
    assert.equal(symbolOf('Btc Usd'), 'BTC-USD');
    assert.equal(symbolOf('btc/usd'), 'BTC-USD');
    assert.equal(symbolOf('BTCUSD'), 'BTC-USD');
    assert.equal(symbolOf('eth to eur'), 'ETH-EUR');
    assert.equal(symbolOf('sol usdt'), 'SOL-USD');
    assert.equal(symbolOf('bitcoin price'), 'BTC-USD');
    assert.equal(symbolOf('price of ethereum today'), 'ETH-USD');
    assert.equal(symbolOf('why is bitcoin dropping'), 'BTC-USD');
    assert.equal(symbolOf('is btc up'), 'BTC-USD');
    assert.equal(symbolOf('btc'), 'BTC-USD');
  });

  test('stocks, fx, commodities and indices', () => {
    assert.equal(symbolOf('$NVDA'), 'NVDA');
    assert.equal(symbolOf('why $rdw dropping'), 'RDW');
    assert.equal(symbolOf('AMD stock'), 'AMD');
    assert.equal(symbolOf('tesla stock price'), 'lookup:tesla');
    assert.equal(symbolOf('why is nvidia stock dropping'), 'lookup:nvidia');
    assert.equal(symbolOf('usd to jpy'), 'USDJPY=X');
    assert.equal(symbolOf('EUR/USD'), 'EURUSD=X');
    assert.equal(symbolOf('gold price today'), 'GC=F');
    assert.equal(symbolOf('oil prices'), 'CL=F');
    assert.equal(symbolOf('s&p 500 today'), '^GSPC');
    assert.equal(symbolOf('dow jones today'), '^DJI');
    assert.equal(symbolOf('dow chemical stock price'), 'lookup:dow chemical');
  });

  test('not a price ask', () => {
    for (const q of [
      'what is bitcoin',
      'how to set up a bitcoin wallet',
      'bitcoin halving explained',
      'best stocks to buy',
      'stock market news',
      'what is a stock split',
      'olive oil price',
      'click the link below',
      'who is Ed Chu',
      'Jaylen Brown injuries',
    ]) assert.equal(quoteAsk(q), undefined, q);
  });

  test('price asks are cached as live', () => {
    assert.equal(cacheTier('Btc Usd'), 'live');
    assert.equal(cacheTier('tesla stock price'), 'live');
    assert.equal(cacheTier('what is bitcoin'), 'long');
  });
});

describe('quoteRow', () => {
  const quote: LiveQuote = {
    symbol: 'BTC-USD',
    name: 'Bitcoin',
    kind: 'crypto',
    currency: 'USD',
    price: 82290.94,
    changePct: 0.708,
    dayHigh: 83259.63,
    dayLow: 81602.41,
    yearHigh: 122509.66,
    yearLow: 57747.77,
    closes: [
      { day: '2026-10-05', close: 85786.59 },
      { day: '2026-10-06', close: 83275.93 },
      { day: '2026-10-07', close: 82300.18 },
    ],
    at: new Date('2026-10-09T20:01:00Z'),
    source: 'yahoo',
  };

  test('every number the card may show is in the row', () => {
    const row = quoteRow(quote);
    assert.ok(isQuoteRow(row));
    assert.match(row.title, /Bitcoin \(BTC\)/);
    assert.match(row.snippet, /82,290\.94 USD/);
    assert.match(row.snippet, /\+0\.71%/);
    assert.match(row.snippet, /2026-10-09 20:01 UTC/);
    assert.match(row.snippet, /81,602\.41–83,259\.63/);
    assert.match(row.content!, /2026-10-06 83,275\.93/);
    assert.equal(row.url, 'https://finance.yahoo.com/quote/BTC-USD');
  });

  test('small prices keep their digits', () => {
    assert.equal(formatPrice(0.1234567), '0.1235');
    assert.equal(formatPrice(0.00001234), '0.00001234');
  });
});
