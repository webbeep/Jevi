import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HISTORY_CAP,
  HISTORY_MAX_CHARS,
  capHistory,
  mergeHistory,
  parseAuthReturn,
  routeGate,
} from '../src/auth/logic.ts';

test('parseAuthReturn reads auth=ok and new_user and strips them', () => {
  const parsed = parseAuthReturn('?q=hello&auth=ok&new_user=1');
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.isNew, true);
  assert.equal(parsed.errorCode, null);
  assert.equal(parsed.changed, true);
  assert.equal(parsed.search, 'q=hello');
});

test('access_denied on auth=error is a cancel and the question stays', () => {
  const parsed = parseAuthReturn('?auth=error&error=access_denied&q=hi');
  assert.equal(parsed.status, 'cancelled');
  assert.equal(parsed.errorCode, 'access_denied');
  assert.equal(parsed.isNew, false);
  assert.equal(new URLSearchParams(parsed.search).get('q'), 'hi');
  assert.equal(new URLSearchParams(parsed.search).has('auth'), false);
  assert.equal(new URLSearchParams(parsed.search).has('error'), false);
});

test('other auth errors stay errors and a bare page is left alone', () => {
  const failed = parseAuthReturn('auth=error&error=server');
  assert.equal(failed.status, 'error');
  assert.equal(failed.errorCode, 'server');
  assert.equal(failed.search, '');

  const plain = parseAuthReturn('?q=keep&error=not-auth');
  assert.equal(plain.status, null);
  assert.equal(plain.changed, false);
  assert.equal(plain.search, 'q=keep&error=not-auth');
});

test('routeGate sends device to the sheet and signed or ip inline', () => {
  assert.equal(routeGate('device'), 'sheet');
  assert.equal(routeGate(''), 'sheet');
  assert.equal(routeGate('signed'), 'signed');
  assert.equal(routeGate('ip'), 'ip');
  assert.equal(routeGate('other'), 'signed');
});

test('capHistory clips to 200 chars and caps at 50 unique questions', () => {
  const long = `${'a'.repeat(HISTORY_MAX_CHARS + 40)}`;
  const capped = capHistory([`  ${long}  `, long, 'Second']);
  assert.equal(capped.length, 2);
  assert.equal(capped[0].length, HISTORY_MAX_CHARS);
  assert.equal(capped[1], 'Second');

  const many = Array.from({ length: 60 }, (_, i) => `q${i}`);
  const fifty = capHistory(many);
  assert.equal(fifty.length, HISTORY_CAP);
  assert.equal(fifty[0], 'q0');
  assert.equal(fifty[49], 'q49');
  assert.equal(capHistory(['Same', 'same', '  ', 'Other'])[0], 'Same');
});

test('mergeHistory keeps device timestamps, adds server-only rows, and caps', () => {
  const now = 10_000;
  const merged = mergeHistory(
    [
      { q: 'Device newest', t: 100 },
      { q: 'shared', t: 50 },
    ],
    ['Server newest', 'SHARED', `  ${'z'.repeat(250)}`],
    now,
  );
  assert.deepEqual(merged.map((row) => row.q), [
    'Server newest',
    'z'.repeat(HISTORY_MAX_CHARS),
    'Device newest',
    'shared',
  ]);
  assert.equal(merged[0].t, now);
  assert.equal(merged[2].t, 100);
  assert.equal(merged[3].t, 50);

  const overflow = mergeHistory(
    Array.from({ length: 40 }, (_, i) => ({ q: `d${i}`, t: i })),
    Array.from({ length: 40 }, (_, i) => `s${i}`),
    now,
  );
  assert.equal(overflow.length, HISTORY_CAP);
  assert.equal(overflow[0].q, 's0');
});
