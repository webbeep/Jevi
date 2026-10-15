import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openverse } from '../server/images.ts';

test('Openverse pictures keep only licenses that allow a resized commercial copy, with a clean credit', async () => {
  const orig = globalThis.fetch;
  let asked = '';
  globalThis.fetch = async (input: RequestInfo | URL) => {
    asked = String(input);
    return Response.json({
      results: [
        { url: 'https://live.staticflickr.com/a.jpg', foreign_landing_url: 'https://www.flickr.com/a', title: 'Gala apples', creator: 'Ann Lee', license: 'by-sa', license_version: '2.0', provider: 'flickr' },
        { url: 'https://live.staticflickr.com/b.jpg', foreign_landing_url: 'https://www.flickr.com/b', title: 'Fuji apples', creator: 'Bo Kim', license: 'by-nd', license_version: '2.0', provider: 'flickr' },
        { url: 'https://live.staticflickr.com/c.jpg', foreign_landing_url: 'https://www.flickr.com/c', title: 'Apple orchard', creator: 'Cy (cy@example.com)', license: 'cc0', provider: 'flickr' },
        { url: 'https://live.staticflickr.com/d.jpg', title: 'Unlabeled' },
      ],
    });
  };
  try {
    const out = await openverse('apple varieties', 8);
    assert.match(asked, /license=by,by-sa,cc0,pdm/);
    assert.deepEqual(out.map((img) => img.title), ['Gala apples', 'Apple orchard']);
    assert.equal(out[0]?.credit, 'Ann Lee · CC BY-SA 2.0 · flickr');
    assert.doesNotMatch(out[1]?.credit ?? '', /@/);
  } finally {
    globalThis.fetch = orig;
  }
});
