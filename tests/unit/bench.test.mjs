// The model benchmark's graders and its pick rule (scripts/bench-llm.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, choose, looseJson, HEAVY_BUDGET_MS } from '../../scripts/bench-llm.mjs';

const r = (p50, score = 100, okRate = 1) => ({ p50, score, okRate, max: p50, notes: [] });

test('heavy pick: best plan quality within the latency budget, light pick: fastest fully valid model', () => {
  const pick = choose({
    big: { plan: r(40_000, 100), lists: r(9000), coach: r(7000) },
    mid: { plan: r(18_000, 100), lists: r(5000), coach: r(3000) },
    small: { plan: r(8000, 50), lists: r(1500), coach: r(1200) },
  });
  assert.deepEqual(pick, { heavy: 'mid', light: 'small' });
});

test('if no model plans within budget, the fastest good planner is used; a flaky light model is skipped', () => {
  const pick = choose({
    a: { plan: r(HEAVY_BUDGET_MS + 1, 100), lists: r(2000), coach: r(2000, 100, 2 / 3) },
    b: { plan: r(HEAVY_BUDGET_MS + 9000, 100), lists: r(4000), coach: r(3000) },
  });
  assert.deepEqual(pick, { heavy: 'a', light: 'b' });
});

test('graders catch non-veg food, tool calls instead of answers, and broken JSON', () => {
  assert.match(TASKS.coach.grade({ final: 'Have 150 g chicken instead, 30 g protein.' }).notes.join(), /non-veg/);
  assert.match(TASKS.coach.grade({ tool: 'get_live_plan', args: {} }).notes.join(), /tool/);
  assert.equal(TASKS.coach.grade({ final: 'Use 60 g soya chunks plus 200 g curd.' }).ok, true);
  assert.equal(TASKS.plan.grade({}).ok, false);
  assert.deepEqual(looseJson('<reasoning>x</reasoning>```json\n{"a":1}\n```'), { a: 1 });
  assert.equal(looseJson('nope'), null);
});
