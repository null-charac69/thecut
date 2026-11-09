// Browser smoke tests. Read-only: they never create data and never confirm account deletion.
// Env: E2E_EMAIL / E2E_PASSWORD = a throwaway user with NO plan (so tabs are locked).
import { test, expect } from '@playwright/test';

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

async function signIn(page, pw = password) {
  await page.goto('/');
  await page.locator('input[name=email]').fill(email);
  await page.locator('input[name=password]').fill(pw);
  await page.locator('#authForm button[type=submit]').click();
}

test('static assets: manifest, icons, stylesheet and script are served', async ({ request }) => {
  const m = await request.get('/manifest.webmanifest');
  expect(m.status()).toBe(200);
  const manifest = await m.json();
  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) expect((await request.get(icon.src)).status()).toBe(200);
  expect((await request.get('/styles.css')).status()).toBe(200);
  expect((await request.get('/app.js')).status()).toBe(200);
});

test('security headers are present', async ({ request }) => {
  const r = await request.get('/');
  const h = r.headers();
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['strict-transport-security']).toBeTruthy();
  const csp = h['content-security-policy'];
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp.match(/script-src[^;]*/)[0]).not.toContain("'unsafe-inline'");
});

test('sign-in page loads with no console errors', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await expect(page.locator('#authForm')).toBeVisible();
  await expect(page.getByText('Own the process.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('wrong password shows a modal dialog, not a footnote', async ({ page }) => {
  test.skip(!email, 'E2E_EMAIL not set');
  await signIn(page, 'definitely-wrong-password');
  const dlg = page.getByRole('alertdialog');
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText('Wrong email or password');
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
});

test('new user without a plan: only Plan is unlocked', async ({ page }) => {
  test.skip(!email || !password, 'E2E credentials not set');
  await signIn(page);
  await expect(page.locator('.nav button[data-tab]')).toHaveCount(6);
  await expect(page.locator('#pagebody h1')).toContainText('AI Planner');
  for (const tab of ['meals', 'workout', 'weight', 'coach', 'prep']) {
    await expect(page.locator(`.nav button[data-tab=${tab}]`)).toHaveAttribute('aria-disabled', 'true');
  }
  await page.locator('.nav button[data-tab=meals]').click();
  await expect(page.locator('#pagebody h1')).toContainText('AI Planner'); // still redirected to Plan
});

test('account page, delete dialog guard, and sign out', async ({ page }) => {
  test.skip(!email || !password, 'E2E credentials not set');
  await signIn(page);
  await page.locator('#acctBtn').click();
  await expect(page.locator('#acctMenu')).toBeVisible();
  await page.locator('#acctMenu button', { hasText: 'Account & settings' }).click();
  await expect(page.locator('#pagebody h1')).toContainText('Account');
  await expect(page.getByText(email, { exact: false }).first()).toBeVisible();

  await page.locator('#acctDelete').click();
  const go = page.locator('#delGo');
  await expect(go).toBeDisabled();
  await page.locator('#delConfirm').fill('delete');
  await expect(go).toBeDisabled(); // case-sensitive
  await page.locator('#delConfirm').fill('DELETE');
  await expect(go).toBeEnabled();
  await page.locator('#delCancel').click(); // never confirm in tests
  await expect(page.locator('#delModal')).toHaveCount(0);

  await page.locator('#acctBtn').click();
  await page.locator('#acctMenu button', { hasText: 'Sign out' }).click();
  await expect(page.locator('#authForm')).toBeVisible();
});
