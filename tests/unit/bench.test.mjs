// The model benchmark's graders and its pick rule (scripts/bench-llm.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, choose, looseJson, HEAVY_BUDGET_MS } from '../../supabase/functions/the-cut-ai/bench.ts';

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

test('coach loop: answers after a tool call, counts calls and time, and flags a needless plan draft', async () => {
  const { runCoach, TASKS } = await import('../../supabase/functions/the-cut-ai/bench.ts');
  const replies = ['{"tool":"get_live_plan","args":{}}', '{"final":"Use 60 g soya chunks and 200 g curd."}'];
  const r = await runCoach(async () => ({ ms: 100, text: replies.shift() }));
  assert.equal(r.calls, 2);
  assert.equal(r.ms, 200);
  assert.equal(TASKS.coach.grade(r.json).ok, true);
  const d = ['{"tool":"propose_plan_update","args":{"instruction":"swap"}}', '{"final":"Drafted: 60 g soya chunks."}'];
  const r2 = await runCoach(async () => ({ ms: 1, text: d.shift() }));
  assert.match(TASKS.coach.grade(r2.json).notes.join(), /drafted a plan change/);
});
