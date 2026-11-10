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
  await expect
    .poll(async () => (await rows(app, 'daily_meals')).filter((m) => m.status === 'completed').length)
    .toBe(2);
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
  await expect
    .poll(async () => (await rows(app, 'body_measurements')).some((r) => Number(r.weight_kg) === 80.2))
    .toBe(true);
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

test('plan: delete my plan and start fresh asks first, then clears the plan and locks the tabs', async ({ page }) => {
  const app = await openApp(page);
  await expect(page.locator('.plan-now', { hasText: 'Active plan' }).locator('h2')).toHaveText('Lean cut, 2,100 kcal');
  // Cancelling changes nothing.
  await page.getByRole('button', { name: 'Delete plan & start fresh' }).click();
  await expect(page.locator('#uiConfirm')).toContainText('logged meals, workouts, weights and photos are kept');
  await page.locator('#uiConfirm [data-act="0"]').click();
  expect((await rows(app, 'ai_plan_versions')).length).toBeGreaterThan(0);
  // Confirming wipes the plan and its lists, keeps what the user logged.
  const loggedBefore = (await rows(app, 'workout_sessions')).length;
  await page.getByRole('button', { name: 'Delete plan & start fresh' }).click();
  await page.locator('#uiConfirm [data-act="1"]').click();
  await expect(page.getByText('Plan deleted. Fill in your details to start fresh.')).toBeVisible();
  await expect(page.locator('.plan-now')).toHaveCount(0);
  expect(await rows(app, 'ai_plan_versions')).toEqual([]);
  expect((await rows(app, 'meal_templates')).filter((t) => t.is_active)).toEqual([]);
  expect((await rows(app, 'grocery_items')).filter((x) => x.source_version_id && !x.is_purchased)).toEqual([]);
  expect((await rows(app, 'workout_sessions')).length).toBe(loggedBefore);
  await expect(page.locator('button[data-tab="meals"][aria-disabled="true"]').first()).toBeVisible();
  await expect(page.locator('#aiIntakeForm')).toBeVisible();
  expect(app.errors).toEqual([]);
});

test('plan: restoring an older plan from account history works', async ({ page }) => {
  const app = await openApp(page);
  await page.locator('#acctBtn').click();
  await page.locator('#acctMenu [data-am="account"]').click();
  await expect(page.getByText('Plan history')).toBeVisible();
  await page.locator('[data-ai-restore]').first().click();
  await expect
    .poll(async () => (await rows(app, 'ai_plan_versions')).find((v) => v.status === 'active').title)
    .toBe('Maintenance, 2,500 kcal');
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

test('meals: "+ Add a meal" opens a form (no native prompt), validates, and saves', async ({ page }) => {
  const app = await openApp(page);
  page.on('dialog', (d) => {
    throw new Error('native dialog used: ' + d.message());
  });
  await go(page, 'meals');
  await page.locator('#addMealTemplate').click();
  const dlg = page.getByRole('dialog', { name: 'Add a meal' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByLabel('Meal name')).toBeFocused();
  await dlg.getByRole('button', { name: 'Add meal' }).click();
  await expect(dlg.getByRole('alert')).toHaveText('Give the meal a name.');
  await dlg.getByLabel('Meal name').fill('Post-workout shake');
  await dlg.getByLabel('Planned time').fill('19:15');
  await dlg.getByLabel('Calories (kcal)').fill('280');
  await dlg.getByLabel('Protein (g)').fill('32');
  await dlg.getByLabel('Components (optional)').fill('whey | 1 scoop\nmilk | 250 ml');
  await dlg.getByRole('button', { name: 'Add meal' }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page.getByText('Post-workout shake')).toBeVisible();
  const items = (await rows(app, 'meal_template_items')).filter(
    (i) => ['whey', 'milk', '__plan_total__'].includes(i.food_name_snapshot) && i.calories_kcal !== 105
  );
  expect(items.map((i) => i.food_name_snapshot)).toEqual(expect.arrayContaining(['whey', 'milk']));
  expect(app.errors).toEqual([]);
});

test('meals: Add a meal can be cancelled with Escape and keeps input when saving fails', async ({ page }) => {
  const app = await openApp(page);
  await go(page, 'meals');
  await page.locator('#addMealTemplate').click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => {
    window.__FAKE.failOn = (t, op) => t === 'meal_templates' && op === 'insert';
  });
  await page.locator('#addMealTemplate').click();
  await page.getByLabel('Meal name').fill('Late snack');
  await page.getByRole('button', { name: 'Add meal' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Meal name')).toHaveValue('Late snack');
});

test('CSP: no violations across menus, modals, coach and account (style-src has no unsafe-inline)', async ({
  page,
}) => {
  const app = await openApp(page);
  await page.locator('#bell').click();
  await page.keyboard.press('Escape');
  await page.locator('#acctBtn').click();
  await page.keyboard.press('Escape');
  await go(page, 'meals');
  await page.locator('#addMealTemplate').click();
  await page.keyboard.press('Escape');
  await go(page, 'coach');
  await page.locator('#acctBtn').click();
  await page.locator('#acctMenu [data-am="account"]').click();
  await page.locator('#acctDelete').click();
  await page.locator('#delCancel').click();
  expect(await app.csp()).toEqual([]);
  expect(app.errors).toEqual([]);
});

test('CSP: no violations in the workout runner', async ({ page }) => {
  const app = await openApp(page);
  await go(page, 'workout');
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.locator('#wkClock, #wkTitle').first().waitFor();
  await page.waitForTimeout(300);
  expect(await app.csp()).toEqual([]);
  expect(app.errors).toEqual([]);
});

test('CSP guard actually reports an inline style (so the clean runs above mean something)', async ({ page }) => {
  const app = await openApp(page);
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<i style="color:red">x</i>'));
  await expect.poll(() => app.csp()).not.toEqual([]);
});

test('plan: a new user generates a plan from the intake form and lands on it', async ({ page }) => {
  const app = await openApp(page, { withPlan: false });
  await expect(page.locator('#aiIntakeForm')).toBeVisible();
  await expect(page.locator('.nav button[data-tab="meals"]')).toBeVisible();
  const f = page.locator('#aiIntakeForm');
  await f.locator('[name=age_years]').fill('28');
  await f.locator('[name=height_cm]').fill('176');
  await f.locator('[name=weight_kg]').fill('82');
  await f.locator('[name=training_days_per_week]').fill('4');
  for (const n of ['goal', 'training_location', 'dietary_pattern', 'meals_per_day'])
    await f.locator(`select[name=${n}]`).selectOption({ index: 1 });
  await f.locator('[name=adult_confirmed]').check();
  await page.locator('#aiProfileAction').click();
  await expect
    .poll(async () => (await rows(app, 'ai_plan_versions')).filter((v) => v.status === 'active').length)
    .toBe(1);
  expect(app.aiCalls.some((c) => c.action === 'generate')).toBe(true);
  await expect(page.getByText('Plan updated')).toBeVisible();
  await expect(page.getByText('Refined plan, 2,000 kcal')).toBeVisible();
  expect(app.errors).toEqual([]);
});

test('plan: refine with a message applies the refined plan', async ({ page }) => {
  const app = await openApp(page);
  await page.locator('#aiRefineForm textarea').fill('swap paneer for tofu');
  await page.locator('#aiRefineForm button[type=submit]').click();
  await expect(page.getByText('Refined plan, 2,000 kcal')).toBeVisible();
  expect(app.aiCalls.find((c) => c.action === 'refine').instruction).toContain('tofu');
  // The refined plan swapped paneer for tofu: the lists are rebuilt from it when Prep opens.
  await go(page, 'prep');
  await expect(page.getByText('Building your lists from your plan…')).toHaveCount(0);
  await expect(page.locator('[data-grocery]').first()).toBeVisible();
  const g = (await rows(app, 'grocery_items')).map((x) => x.name);
  expect(g).toContain('Tofu');
  expect(g).not.toContain('Paneer');
});

test('coach: chat reply appears', async ({ page }) => {
  const app = await openApp(page);
  await go(page, 'coach');
  await page.locator('#coachChatForm input, #coachChatForm textarea').first().fill('Why is protein low?');
  await page.locator('#coachChatForm button[type=submit], #coachChatForm .btn').first().click();
  await expect(page.getByText('Happy to help. What would you like to change?')).toBeVisible();
  expect(app.errors).toEqual([]);
});

test('workout: log a set, finish, and the session is saved with its sets', async ({ page }) => {
  const app = await openApp(page);
  await go(page, 'workout');
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.locator('[data-wk="0:0:kg"]').fill('57.5');
  await page.locator('[data-wk="0:0:reps"]').fill('10');
  await page.locator('[data-wktick="0:0"]').click();
  await expect(page.getByText('1/12 sets')).toBeVisible();
  await page.locator('#wkFinish').click();
  await page.locator('[data-rpe="8"]').click();
  await page.locator('#wkSaveBtn').click();
  await expect.poll(async () => (await rows(app, 'workout_sessions')).length).toBe(3);
  const sets = await rows(app, 'workout_sets');
  expect(sets.some((s) => Number(s.weight_kg) === 57.5 && Number(s.reps) === 10)).toBe(true);
  const saved = (await rows(app, 'workout_sessions')).find((s) => s.perceived_effort === 8 && s.title === 'Pull');
  expect(saved).toBeTruthy();
  expect(app.errors).toEqual([]);
});

test('workout: finishing with no ticked sets is refused', async ({ page }) => {
  await openApp(page);
  await go(page, 'workout');
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.locator('#wkFinish').click();
  await expect(page.getByText('Tick off at least one set before finishing.')).toBeVisible();
});

// ---------- Prep & grocery: AI-built lists that follow the plan ----------
const cats = (page) =>
  page.locator('#pagebody h3.cat').evaluateAll((els) => els.map((e) => e.firstChild.textContent.trim()));
const lists = (app) => app.aiCalls.filter((c) => c.action === 'lists');

test('prep: category headers are in sentence case and grouped from the data', async ({ page }) => {
  const app = await openApp(page);
  await go(page, 'prep');
  await expect(page.locator('[data-grocery]').first()).toBeVisible();
  const heads = await cats(page);
  expect(heads).toEqual(['Protein', 'Dairy', 'Pantry', 'Fresh fruit']); // 'PROTEIN' and 'Protein' rows share one group
  expect(heads.every((h) => h === h.charAt(0).toUpperCase() + h.slice(1).toLowerCase())).toBe(true);
  expect(app.errors).toEqual([]);
});

test("prep: nothing is rebuilt when the plan has not changed since this week's lists were built", async ({ page }) => {
  const app = await openApp(page);
  await go(page, 'prep');
  await expect(page.locator('[data-grocery]').first()).toBeVisible();
  await expect.poll(() => lists(app).length).toBe(1); // asked once; the server answers "current"
  const g = (await rows(app, 'grocery_items')).map((x) => x.name).sort();
  expect(g).toEqual(['Bananas', 'Chicken breast', 'Greek yogurt', 'Oats', 'Whole eggs']);
  await page.locator('[data-prepview="prep"]').click();
  await page.locator('[data-prepview="grocery"]').click();
  expect(lists(app).length).toBe(1); // switching views does not ask again
});

test('prep: going vegetarian mid-week replaces chicken in the groceries and prep, and keeps what was ticked or is history', async ({
  page,
}) => {
  const app = await openApp(page);
  await expect(page.getByText('Lean bulk, 2,800 kcal')).toBeVisible();
  await page.getByRole('button', { name: 'Apply to my workspace' }).click();
  await page.locator('#uiConfirm [data-act="1"]').click();
  await expect(page.locator('.plan-now h2')).toHaveText('Lean bulk, 2,800 kcal');
  await go(page, 'prep');
  await expect.poll(async () => (await rows(app, 'grocery_items')).some((g) => g.name === 'Soya chunks')).toBe(true);
  await expect(page.locator('[data-grocery]').first()).toBeVisible();
  const g = (await rows(app, 'grocery_items')).map((x) => x.name);
  expect(g).not.toContain('Chicken breast'); // unticked AI item of the old plan is gone
  expect(g).toContain('Whole eggs'); // already bought: stays, now the user's own item
  expect(g).toEqual(expect.arrayContaining(['Besan chilla', 'Soya chunks', 'Paneer']));
  const prep = await rows(app, 'prep_tasks');
  expect(prep.filter((t) => t.local_date === '2026-11-10').map((t) => t.task)).not.toContain(
    'Portion chicken for 3 days'
  );
  expect(prep.filter((t) => t.local_date === '2026-11-10').map((t) => t.task)).toContain('Boil 6 eggs'); // ticked
  expect(prep.find((t) => t.task === 'Marinate chicken')).toBeTruthy(); // yesterday is history
  // prep exists for today and the rest of the week (Tue to Sat), not before
  const dates = [...new Set(prep.filter((t) => t.source_version_id).map((t) => t.local_date))].sort();
  expect(dates).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']);
  expect(lists(app).length).toBe(1);
  expect(app.errors).toEqual([]);
});

test('prep: Regenerate asks the AI again and a failure shows a message with Try again, without looping', async ({
  page,
}) => {
  let fail = true;
  const app = await openApp(page, {
    ai: (b) =>
      b.action === 'lists' && b.force && fail
        ? [502, { error: 'The AI service is busy. Try again in a minute.' }]
        : undefined,
  });
  await go(page, 'prep');
  await expect(page.locator('[data-grocery]').first()).toBeVisible();
  await page.getByRole('button', { name: 'Regenerate' }).click();
  await expect(page.getByText('The AI service is busy. Try again in a minute.')).toBeVisible();
  await page.locator('[data-prepview="prep"]').click();
  await page.locator('[data-prepview="grocery"]').click();
  expect(lists(app).length).toBe(2); // the initial check plus the forced one; no automatic retry
  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('The AI service is busy. Try again in a minute.')).toHaveCount(0);
  expect(lists(app).filter((c) => c.force).length).toBe(2);
  expect(lists(app).every((c) => c.week_start === '2026-11-08' && c.today === '2026-11-10')).toBe(true); // Sunday week
});

test('prep: an item added by hand goes under Other', async ({ page }) => {
  await openApp(page);
  await go(page, 'prep');
  await page.locator('#groceryForm input[name=name]').fill('Lemons');
  await page.locator('#groceryForm .btn.primary').click();
  await expect(page.getByText('Lemons')).toBeVisible();
  expect(await cats(page)).toContain('Other');
});
