import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyToProfile,
  changeInstruction,
  cleanChanges,
  currentFacts,
  describeChanges,
  dietBreaks,
  verifyPlan,
} from '../../src/lib/planchanges.js';

const meal = (name, items) => ({ name, items: items.map((n) => ({ name: n })) });
const week = (n, mins = 60) =>
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => ({
    day,
    focus: i < n ? 'Strength' : 'Rest',
    session_minutes: i < n ? mins : 0,
  }));
const plan = (o = {}) => ({
  targets: { calories_kcal: 2100, protein_g: 150 },
  meals: [meal('B', ['Oats', 'Whole eggs']), meal('L', ['Chicken breast', 'Rice']), meal('D', ['Paneer tikka (low-fat)', 'Roti'])],
  training_week: week(4),
  estimated_daily_cost_inr: 300,
  ...o,
});
const inputs = { dietary_pattern: 'omnivore', weight_kg: 80, food_budget_inr: 350, cooking_minutes: 40 };
const F = currentFacts(plan(), inputs);
const base = { cal_mode: 'keep', pro_mode: 'keep' };

test('currentFacts reads targets, meals, foods and training from the live plan', () => {
  assert.equal(F.kcal, 2100);
  assert.equal(F.meals, 3);
  assert.equal(F.trainingDays, 4);
  assert.equal(F.maxSession, 60);
  assert.deepEqual(F.foods, ['Oats', 'Whole eggs', 'Chicken breast', 'Rice', 'Paneer tikka (low-fat)', 'Roti']);
});

test('cleanChanges resolves relative and exact targets and blocks unsafe ones', () => {
  let r = cleanChanges({ ...base, cal_mode: 'lower', cal_value: '200' }, F);
  assert.deepEqual(r.errors, []);
  assert.equal(r.target.kcal, 1900);
  r = cleanChanges({ ...base, cal_mode: 'set', cal_value: '1100' }, F);
  assert.match(r.errors.join(), /below the 1200 kcal safety floor/);
  r = cleanChanges({ ...base, pro_mode: 'set', pro_value: '50' }, F);
  assert.match(r.errors.join(), /below 0.8 g\/kg \(64 g/);
  r = cleanChanges({ ...base, cal_mode: 'lower', cal_value: '700' }, F);
  assert.match(r.warnings.join(), /33% change/);
  assert.match(cleanChanges(base, F).errors.join(), /Pick at least one change/);
});

test('cleanChanges ignores foods that are not in the plan and values equal to the current ones', () => {
  const r = cleanChanges({ ...base, remove: ['Rice', 'Pizza'], meals: '3', budget: '350', add: 'Tofu, tofu, Soya chunks' }, F);
  assert.deepEqual(r.changes.remove, ['Rice']);
  assert.equal(r.changes.meals, null);
  assert.equal(r.changes.budget, null);
  assert.deepEqual(r.changes.add, ['Tofu', 'Soya chunks']);
  assert.match(cleanChanges({ ...base, remove: ['Rice'], add: 'rice' }, F).errors.join(), /both removed and added/);
});

test('the instruction numbers every requirement and says what to keep', () => {
  const r = cleanChanges({ ...base, cal_mode: 'raise', cal_value: '150', diet: 'vegetarian', remove: ['Rice'] }, F);
  const s = changeInstruction(r.changes, F, r.target);
  assert.match(s, /1\. targets\.calories_kcal must be 2250/);
  assert.match(s, /vegetarian \(no meat, fish or eggs\)/);
  assert.match(s, /Do not use these items anywhere: Rice/);
  assert.match(s, /Keep unchanged: protein \(at least 150 g\), meal count \(3\), training days \(4\)/);
  assert.deepEqual(describeChanges(r.changes, F, r.target).slice(0, 2), ['Calories: 2100 → 2250 kcal', 'Diet: omnivore → vegetarian']);
});

test('dietBreaks knows plant alternatives from the real thing', () => {
  assert.deepEqual(dietBreaks(['Soy milk', 'Tofu bhurji', 'Peanut butter', 'Paneer'], 'vegan'), ['Paneer']);
  assert.deepEqual(dietBreaks(['Egg bhurji', 'Paneer bhurji', 'Fish curry'], 'vegetarian'), ['Egg bhurji', 'Fish curry']);
  assert.deepEqual(dietBreaks(['Whole eggs', 'Chicken breast'], 'eggetarian'), ['Chicken breast']);
});

test('verifyPlan accepts a plan that meets every requirement and lists each miss otherwise', () => {
  const r = cleanChanges({ ...base, cal_mode: 'lower', cal_value: '200', diet: 'vegetarian', remove: ['Rice'], add: 'Tofu', training_days: '5', max_session: '45' }, F);
  const good = plan({
    targets: { calories_kcal: 1910, protein_g: 152 },
    meals: [meal('B', ['Oats', 'Curd']), meal('L', ['Tofu curry', 'Quinoa']), meal('D', ['Paneer tikka (low-fat)', 'Roti'])],
    training_week: week(5, 45),
  });
  assert.deepEqual(verifyPlan(good, r.changes, F, r.target, 'vegetarian'), []);
  const bad = plan({ training_week: week(4, 75) });
  assert.deepEqual(verifyPlan(bad, r.changes, F, r.target, 'vegetarian'), [
    'calories are 2100 kcal, asked for 1900',
    'not vegetarian: Whole eggs, Chicken breast',
    'still contains Rice',
    'does not include Tofu',
    '4 training sessions, asked for 5',
    'a session runs 75 min, asked for at most 45',
  ]);
});

test('unchanged targets are protected too (±5% calories, protein floor, meal count)', () => {
  const r = cleanChanges({ ...base, add: 'Tofu' }, F);
  const drifted = plan({ targets: { calories_kcal: 2400, protein_g: 120 }, meals: [meal('B', ['Tofu']), meal('L', ['Rice'])] });
  const v = verifyPlan(drifted, r.changes, F, r.target, 'omnivore');
  assert.ok(v.includes('calories are 2400 kcal, asked for 2100'));
  assert.ok(v.includes('protein is 120 g, asked for at least 150 g'));
  assert.ok(v.includes('2 meals per day, asked for 3'));
});

test('applyToProfile keeps the change for future plans', () => {
  const r = cleanChanges({ ...base, diet: 'vegan', remove: ['Rice'], add: 'Tofu', budget: '250' }, F);
  const p = applyToProfile({ ...inputs, food_preferences: 'dal', additional_notes: 'Night shifts.' }, r.changes);
  assert.equal(p.dietary_pattern, 'vegan');
  assert.equal(p.food_budget_inr, 250);
  assert.equal(p.food_preferences, 'dal, Tofu');
  assert.equal(p.additional_notes, 'Night shifts. Avoid in plans: Rice.');
  const p2 = applyToProfile(p, cleanChanges({ ...base, remove: ['Roti'] }, F).changes);
  assert.equal(p2.additional_notes, 'Night shifts. Avoid in plans: Rice, Roti.');
});
