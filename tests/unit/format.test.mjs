import test from 'node:test';
import assert from 'node:assert/strict';
import { esc, today, shift, dateFmt, weekStart, fmt } from '../../src/lib/format.js';

test('esc escapes HTML special characters and tolerates null', () => {
  assert.equal(esc('<img src=x onerror="a">&\''), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(0), '0');
});

test('shift moves dates across month and year boundaries', () => {
  assert.equal(shift('2026-11-10', 1), '2026-11-11');
  assert.equal(shift('2026-11-30', 1), '2026-12-01');
  assert.equal(shift('2026-12-31', 1), '2027-01-01');
  assert.equal(shift('2026-03-01', -1), '2026-02-28');
});

test('weekStart returns the Sunday that starts the week', () => {
  assert.equal(weekStart('2026-11-10'), '2026-11-08'); // Tuesday
  assert.equal(weekStart('2026-11-09'), '2026-11-08'); // Monday
  assert.equal(weekStart('2026-11-08'), '2026-11-08'); // Sunday starts a new week
  assert.equal(weekStart('2026-11-14'), '2026-11-08'); // Saturday ends it
  assert.equal(weekStart('2026-11-15'), '2026-11-15'); // next Sunday
});

test('fmt uses Indian grouping with at most one decimal', () => {
  assert.equal(fmt(1234.56), '1,234.6');
  assert.equal(fmt(150000), '1,50,000');
  assert.equal(fmt(null), '0');
  assert.equal(fmt(undefined), '0');
});

test('dateFmt formats a date string in en-IN', () => {
  assert.equal(dateFmt('2026-11-10', { day: 'numeric', month: 'short' }), '10 Nov');
});

test('today returns an ISO date', () => {
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
});
