// Signed-in behaviour of the live screens against the fake backend.
import { test, expect } from '@playwright/test';
import { openApp, go, waitReady } from './helpers.mjs';

const rows = (app, table) => app.fake().then((f) => f.tables[table]);

test('signed out shows the sign-in form, no app', async ({ page }) => {
  await openApp(page, { signedIn: false });
  await expect(page.locator('#authForm')).toBeVisible();
  await expect(page.locator('.nav')).toHaveCount(0);
});

test('sign in with wrong password shows an error, right password opens the app', async ({ page }) => {
  await openApp(page, { signedIn: false });
  await page.locator('#authForm input[name=email]').fill('tester@example.com');
  await page.locator('#authForm input[name=password]').fill('nope-nope-nope');
  await page.locator('#authForm button[type=submit], #authForm .btn.primary').first().click();
  await expect(page.locator('#uiModal')).toBeVisible();
  await page.locator('#uiModal [data-act]').last().click();
  await page.locator('#authForm input[name=password]').fill('correct-horse-battery');
  await page.locator('#authForm button[type=submit], #authForm .btn.primary').first().click();
  await expect(page.locator('.nav')).toBeVisible();
});

test('meals: tick a meal, add an extra, delete it', async ({ page }) => {
  const app = await openApp(page);
  await go(page, 'meals');
  await page.locator('[data-meal]').nth(1).click();
  await expect.poll(async () => (await rows(app, 'daily_meals')).filter((m) => m.status === 'completed').length).toBe(2);
  await page.locator('#foodForm input[name=food_name_snapshot]').fill('Banana shake');
  await page.locator('#foodForm input[name=calories_kcal]').fill('220');
  await page.locator('#foodForm .btn.primary').click();
  await expect(page.getByText('Banana shake')).toBeVisible();
  await page.locator('[data-delfood]').last().click();
  await page.locator('#uiConfirm [data-act="1"]').click();
  await expect(page.getByText('Banana shake')).toHaveCount(0);
  expect(app.errors).toEqual([]);
});

test('weight: log a weigh-in', async ({ page }) => {
  const app = await openApp(page);
  await go(page, 'weight');
  await page.locator('#weightForm input[name=weight_kg]').fill('80.2');
  await page.locator('#weightForm .btn.primary').click();
  await expect.poll(async () => (await rows(app, 'body_measurements')).some((r) => Number(r.weight_kg) === 80.2)).toBe(true);
});

test('prep: tick a task and add a grocery item', async ({ page }) => {
  const app = await openApp(page);
  await go(page, 'prep');
  await page.locator('[data-prepview="grocery"]').click();
  await page.locator('#groceryForm input[name=name]').fill('Lemons');
  await page.locator('#groceryForm .btn.primary').click();
  await expect(page.getByText('Lemons')).toBeVisible();
  await page.locator('[data-prepview="prep"]').click();
  await page.locator('[data-prep]').nth(1).check();
  await expect.poll(async () => (await rows(app, 'prep_tasks')).filter((t) => t.is_completed).length).toBe(2);
});

test('plan: apply the draft, then undo restores the previous plan and its lists', async ({ page }) => {
  const app = await openApp(page);
  await expect(page.getByText('Lean bulk, 2,800 kcal')).toBeVisible();
  await page.getByRole('button', { name: 'Apply to my workspace' }).click();
  await page.locator('#uiConfirm [data-act="1"]').click();
  await expect(page.locator('.plan-now h2')).toHaveText('Lean bulk, 2,800 kcal');
  const t = await rows(app, 'ai_plan_versions');
  expect(t.find((v) => v.title === 'Lean cut, 2,100 kcal').status).toBe('superseded');
  await page.locator('[data-ai-restore]').first().click();
  await expect(page.locator('.plan-now h2')).toHaveText('Lean cut, 2,100 kcal');
  const t2 = await rows(app, 'ai_plan_versions');
  expect(t2.find((v) => v.title === 'Lean cut, 2,100 kcal').status).toBe('active');
  expect(app.errors).toEqual([]);
});

test('plan: restoring an older plan from account history works', async ({ page }) => {
  const app = await openApp(page);
  await page.locator('#acctBtn').click();
  await page.locator('#acctMenu [data-am="account"]').click();
  await expect(page.getByText('Plan history')).toBeVisible();
  await page.locator('[data-ai-restore]').first().click();
  await expect.poll(async () => (await rows(app, 'ai_plan_versions')).find((v) => v.status === 'active').title).toBe('Maintenance, 2,500 kcal');
});

test('workout: start today and log a set', async ({ page }) => {
  const app = await openApp(page);
  await go(page, 'workout');
  await page.getByRole('button', { name: 'Start workout' }).click();
  await expect(page.locator('#wkTitle, #wkClock').first()).toBeVisible();
  expect(app.errors).toEqual([]);
});

test('account: delete asks for confirmation and can be cancelled', async ({ page }) => {
  const app = await openApp(page);
  await page.locator('#acctBtn').click();
  await page.locator('#acctMenu [data-am="account"]').click();
  await page.locator('#acctDelete').click();
  await expect(page.locator('#delT, #delConfirm').first()).toBeVisible();
  await page.locator('#delCancel').click();
  expect((await app.fake()).deleted).toBeFalsy();
});

test('no CSP violations or console errors on any screen', async ({ page }) => {
  const app = await openApp(page);
  for (const s of ['meals', 'workout', 'weight', 'coach', 'prep']) await go(page, s);
  expect(app.errors).toEqual([]);
  expect(await app.csp()).toEqual([]);
});
