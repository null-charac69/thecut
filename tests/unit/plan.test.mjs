// Tests the edge function's server-side safety validation (plan.ts) under Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlan, validateProfile, cleanProfile, qualityChecks } from '../../supabase/functions/the-cut-ai/plan.ts';

const item = (name, kcal, p, c, f) => ({ name, quantity: 1, unit: 'serving', calories_kcal: kcal, protein_g: p, carbs_g: c, fat_g: f });
const goodRaw = () => ({
  title: 'Lean plan', summary: 's', rationale: 'r',
  targets: { calories_kcal: 1900, protein_g: 140, carbs_g: 200, fat_g: 55, fibre_g: 30, water_ml: 3000 },
  meals: [
    { name: 'Breakfast', time: '08:00', items: [item('Eggs', 400, 30, 20, 20)] },
    { name: 'Lunch', time: '13:00', items: [item('Rice+chicken', 700, 45, 80, 18)] },
    { name: 'Dinner', time: '20:00', items: [item('Paneer+roti', 800, 45, 70, 35)] },
  ],
  grocery_list: [{ name: 'Eggs', quantity: '12', category: 'protein' }, { name: 'Odd', quantity: '1', category: 'weird' }],
  prep_tasks: ['Cook rice'],
  training_week: [{ day: 'Mon', focus: 'Push', session_minutes: 60, exercises: ['Bench 3x8'] }],
});

test('validateProfile enforces adult, ranges and training days', () => {
  const ok = { adult_confirmed: true, age_years: 30, height_cm: 175, weight_kg: 80, training_days_per_week: 4 };
  assert.equal(validateProfile(ok), null);
  assert.ok(validateProfile({ ...ok, adult_confirmed: false }));
  assert.ok(validateProfile({ ...ok, age_years: 17 }));
  assert.ok(validateProfile({ ...ok, height_cm: 100 }));
  assert.ok(validateProfile({ ...ok, weight_kg: 400 }));
  assert.ok(validateProfile({ ...ok, training_days_per_week: 8 }));
  assert.ok(validateProfile({ ...ok, training_days_per_week: 2.5 }));
  assert.ok(validateProfile(null));
});

test('cleanProfile truncates long strings and drops objects', () => {
  const out = cleanProfile({ a: 'x'.repeat(900), b: { nested: 1 }, c: 5, d: true });
  assert.equal(out.a.length, 500);
  assert.equal('b' in out, false);
  assert.equal(out.c, 5);
});

test('normalizePlan accepts a valid plan and normalises categories', () => {
  const r = normalizePlan(goodRaw());
  assert.deepEqual(r.problems, []);
  assert.equal(r.plan.meals.length, 3);
  assert.equal(r.plan.grocery_list[0].category, 'PROTEIN');
  assert.equal(r.plan.grocery_list[1].category, 'PRODUCE');
});

test('normalizePlan rejects plans below the 1200 kcal floor', () => {
  const raw = goodRaw();
  raw.meals = raw.meals.map((m) => ({ ...m, items: [item('Tiny', 100, 5, 10, 2)] }));
  const r = normalizePlan(raw);
  assert.equal(r.plan, null);
  assert.ok(r.problems.some((p) => /safety floor/.test(p)));
});

test('normalizePlan rejects too few meals and missing title', () => {
  const raw = goodRaw();
  raw.meals = raw.meals.slice(0, 1);
  delete raw.title;
  const r = normalizePlan(raw);
  assert.equal(r.plan, null);
  assert.ok(r.problems.some((p) => /2 to 6 meals/.test(p)));
  assert.ok(r.problems.some((p) => /title/.test(p)));
});

test('normalizePlan trusts macros over stated calories when they disagree by >20%', () => {
  const raw = goodRaw();
  raw.meals[0].items = [item('Liar', 100, 30, 20, 20)]; // macros imply 380
  const r = normalizePlan(raw);
  assert.equal(r.plan.meals[0].items[0].calories_kcal, 4 * 30 + 4 * 20 + 9 * 20);
});

test('normalizePlan rejects non-objects', () => {
  assert.equal(normalizePlan(null).plan, null);
  assert.equal(normalizePlan('x').plan, null);
});

test('qualityChecks flags low protein, wrong training days and calorie drift', () => {
  const plan = normalizePlan(goodRaw()).plan;
  const profile = { goal: 'fat_loss', weight_kg: 120, training_days_per_week: 3 };
  const issues = qualityChecks(plan, profile, 1400);
  assert.ok(issues.some((i) => /protein target/.test(i)));
  assert.ok(issues.some((i) => /training sessions/.test(i)));
  assert.ok(issues.some((i) => /drift more than 20%/.test(i)));
  // A baseline under the 1200 kcal floor is not a valid anchor, so drift is not checked against it.
  assert.ok(!qualityChecks(plan, profile, 1000).some((i) => /drift/.test(i)));
  assert.deepEqual(qualityChecks(plan, { goal: 'maintain', weight_kg: 80, training_days_per_week: 1 }, 1900), []);
});
