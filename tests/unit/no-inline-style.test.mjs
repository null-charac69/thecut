// The CSP has no 'unsafe-inline' for styles, so markup must never carry style="..." attributes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const files = ['src/index.html', 'src/app.js', ...readdirSync('src/lib').filter((f) => f.endsWith('.js')).map((f) => 'src/lib/' + f)];

test('no inline style attributes in app markup', () => {
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    assert.ok(!/\sstyle\s*=/.test(text), `${f} contains an inline style= attribute`);
    assert.ok(!/setAttribute\(\s*['"]style['"]/.test(text), `${f} sets a style attribute`);
  }
});

test('CSP style-src does not allow unsafe-inline', () => {
  const cfg = readFileSync('src/vercel.json', 'utf8');
  const style = cfg.match(/style-src[^;"]*/)[0];
  assert.ok(!style.includes('unsafe-inline'), style);
});
