// Records what every live screen looks like (text + screenshots) so refactors can be diffed against it.
// Run with UI_SNAP_DIR=/some/dir to write; without it the test only checks that each screen renders.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { openApp, go, waitReady } from './helpers.mjs';

const DIR = process.env.UI_SNAP_DIR;
const SCREENS = ['ai', 'meals', 'workout', 'weight', 'coach', 'prep'];

for (const [label, size] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  test(`snapshot all screens (${label})`, async ({ page }) => {
    await page.setViewportSize(size);
    const app = await openApp(page);
    await waitReady(page);
    if (DIR) mkdirSync(DIR, { recursive: true });
    const snap = async (name) => {
      await page.waitForTimeout(150);
      if (!DIR) return;
      await page.screenshot({ path: `${DIR}/${label}-${name}.png`, fullPage: true });
      writeFileSync(`${DIR}/${label}-${name}.txt`, await page.locator('#root').innerText());
    };
    await snap('ai');
    for (const s of SCREENS.slice(1)) {
      if (label === 'mobile') await page.locator(`.mobilebar button[data-tab="${s}"]`).click(); else await go(page, s);
      await waitReady(page);
      await snap(s);
    }
    await page.locator('#acctBtn').click();
    await page.locator('#acctMenu [data-am="account"]').click();
    await waitReady(page);
    await snap('account');
    expect(app.errors).toEqual([]);
  });
}
