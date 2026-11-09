import test from 'node:test';
import assert from 'node:assert/strict';

Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
const { friendlyError } = await import('../../src/lib/errors.js');

const kind = (m, extra = {}) => friendlyError({ message: m, ...extra }).kind;

test('maps auth and network errors to friendly kinds', () => {
  assert.equal(kind('Invalid login credentials'), 'creds');
  assert.equal(kind('email rate limit exceeded'), 'rate');
  assert.equal(kind('User already registered'), 'exists');
  assert.equal(kind('Password should be at least 6 characters'), 'weak');
  assert.equal(kind('Failed to fetch'), 'net');
  assert.equal(kind('JWT expired'), 'session');
  assert.equal(kind('Signups not allowed for this instance'), 'other');
  assert.equal(kind('boom'), 'other');
});

test('uses error codes as well as messages', () => {
  assert.equal(kind('x', { code: 'invalid_credentials' }), 'creds');
  assert.equal(kind('x', { code: 'over_email_send_rate_limit' }), 'rate');
});

test('escapes raw messages shown in the dialog body', () => {
  const r = friendlyError({ message: '<script>alert(1)</script>' });
  assert.ok(!r.body.includes('<script>'));
});

test('every result has a title and body', () => {
  for (const m of ['Invalid login credentials', 'weird', '']) {
    const r = friendlyError(new Error(m));
    assert.ok(r.title && r.body !== undefined);
  }
});
