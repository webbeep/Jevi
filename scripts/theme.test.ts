import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseThemeChoice, resolvedDark } from '../src/theme.ts';

test('an unset theme follows the system', () => {
  assert.equal(parseThemeChoice(null), 'system');
  assert.equal(parseThemeChoice(''), 'system');
  assert.equal(parseThemeChoice('auto'), 'system');
  assert.equal(resolvedDark('system', true), true);
  assert.equal(resolvedDark('system', false), false);
});

test('a stored light or dark choice wins over the system', () => {
  assert.equal(parseThemeChoice('light'), 'light');
  assert.equal(parseThemeChoice('dark'), 'dark');
  assert.equal(resolvedDark('light', true), false);
  assert.equal(resolvedDark('dark', false), true);
});
