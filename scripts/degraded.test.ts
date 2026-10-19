import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchDegraded, thinSearch } from '../server/degraded.ts';

const row = (domain: string, engines?: string[]) => ({ title: domain, url: `https://${domain}/page`, domain, snippet: '', engines });

test('a search padded with Wikipedia articles around one or two web pages is thin, not degraded', () => {
  const thin = { results: [row('mta.info', ['serper']), ...['a', 'b', 'c', 'd', 'e'].map(() => row('en.wikipedia.org', ['wikipedia']))] };
  assert.equal(thinSearch(thin as never), true);
  assert.equal(searchDegraded({ ...thin, engines: [] } as never), undefined);
  // A Wikipedia page the web engine ranked is a web result.
  const web = { results: [row('mta.info', ['serper']), row('cbsnews.com', ['serper']), row('en.wikipedia.org', ['serper']), row('abc7ny.com', ['serper'])] };
  assert.equal(thinSearch(web as never), false);
});
