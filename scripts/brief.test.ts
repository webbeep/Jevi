import assert from 'node:assert/strict';
import { test } from 'node:test';

test('the brief names up to two searches for a key fact no result states', async () => {
  const { readBrief, remapBrief } = await import('../server/brief.ts');
  const brief = readBrief({ goal: 'Steps to renew a US passport by mail', use: [1], gaps: ['US passport renewal fee by mail', 'passport renewal fee', 'x', 'third gap query here'] }, 3);
  assert.deepEqual(brief?.gaps, ['US passport renewal fee by mail', 'passport renewal fee']);
  const rows = [{ title: 'a', url: 'https://a.example/1', domain: 'a.example', engines: [] }];
  assert.deepEqual(remapBrief(brief!, rows as never, rows as never).gaps, brief?.gaps);
  assert.equal(readBrief({ goal: 'g', use: [1], gaps: [] }, 2)?.gaps, undefined);
});
