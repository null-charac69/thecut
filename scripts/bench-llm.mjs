// Benchmarks Bedrock models (Mumbai by default) on THE CUT's real jobs, with the production prompts and validators.
// Run: AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... MODELS=id1,id2 node --experimental-strip-types scripts/bench-llm.mjs
// Optional: AWS_REGION (default ap-south-1), RUNS (default 3), DRY=1 (no network, canned answers; tests the harness).
// Writes nothing; prints a table and a recommendation (heavy = plan generate/refine, light = coach chat, lists, edit checks).
import { AwsClient } from 'aws4fetch';
import { normalizePlan, qualityChecks } from '../supabase/functions/the-cut-ai/plan.ts';
import { LISTS_SYSTEM, normalizeLists } from '../supabase/functions/the-cut-ai/lists.ts';
import { CHAT_SYSTEM, PLAN_SYSTEM } from '../supabase/functions/the-cut-ai/prompts.ts';

const REGION = process.env.AWS_REGION || 'ap-south-1';
const RUNS = Number(process.env.RUNS || 3);
const DRY = process.env.DRY === '1';
const MODELS = (process.env.MODELS || '').split(',').map((m) => m.trim()).filter(Boolean);
export const HEAVY_BUDGET_MS = 25_000; // plan generate/refine
export const LIGHT_BUDGET_MS = 6_000; // one coach reply, a list build, an edit check

const PROFILE = {
  adult_confirmed: true, age_years: 26, sex: 'male', height_cm: 175, weight_kg: 82, target_weight_kg: 74,
  goal: 'fat_loss', activity_level: 'moderate', training_experience: 'intermediate', training_days_per_week: 5,
  training_location: 'gym', dietary_pattern: 'vegetarian', meals_per_day: 4, food_budget_inr: 300, cooking_minutes: 40,
  location: 'Pune, India', goal_timeline_weeks: 16, allergies: '', food_preferences: 'paneer, dal, curd',
  preferred_cuisines: 'North Indian', additional_notes: '',
};
const MEALS = [
  { name: 'Breakfast', time: '08:00', items: [{ name: 'Oats', amount: '60 g' }, { name: 'Low-fat paneer', amount: '100 g' }, { name: 'Banana', amount: '1' }] },
  { name: 'Lunch', time: '13:30', items: [{ name: 'Brown rice', amount: '60 g' }, { name: 'Moong dal', amount: '50 g' }, { name: 'Mixed vegetables', amount: '200 g' }] },
  { name: 'Snack', time: '17:00', items: [{ name: 'Soya chunks', amount: '50 g' }, { name: 'Curd', amount: '200 g' }] },
  { name: 'Dinner', time: '20:00', items: [{ name: 'Whole-wheat roti', amount: '2' }, { name: 'Palak paneer', amount: '150 g' }, { name: 'Cucumber salad', amount: '150 g' }] },
];
const MEAT = /\b(chicken|mutton|lamb|beef|pork|fish|rohu|salmon|tuna|prawn|shrimp|egg|eggs)\b/i;
const VEG_PROTEIN = /(paneer|tofu|soy|soya|dal|chana|rajma|curd|dahi|yogurt|whey|milk|moong|besan|sprouts)/i;
const DATES = ['2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28'];

export const TASKS = {
  plan: {
    heavy: true,
    system: PLAN_SYSTEM,
    user: `<user_data>\n${JSON.stringify({ action: 'generate', profile: PROFILE })}\n</user_data>\nCreate a fresh plan for this profile.`,
    maxTokens: 4500,
    grade(j) {
      const r = normalizePlan(j);
      if (!r.plan) return { ok: false, score: 0, notes: r.problems.slice(0, 2) };
      const notes = qualityChecks(r.plan, PROFILE, null);
      const text = JSON.stringify(r.plan.meals);
      if (MEAT.test(text)) notes.push('non-veg food in a vegetarian plan');
      if (r.plan.meals.length !== PROFILE.meals_per_day) notes.push(`${r.plan.meals.length} meals, asked ${PROFILE.meals_per_day}`);
      if (!String(r.plan.rationale || '').trim()) notes.push('no rationale');
      return { ok: notes.length === 0, score: Math.max(0, 100 - 25 * notes.length), notes };
    },
  },
  lists: {
    heavy: false,
    system: LISTS_SYSTEM,
    user: `<user_data>\n${JSON.stringify({ person: PROFILE, meals_per_day: MEALS, grocery_days: DATES.map((date) => ({ date })), prep_dates: DATES.map((date) => ({ date })), already_have: [] })}\n</user_data>\nWrite the grocery list for grocery_days and the prep tasks for prep_dates.`,
    maxTokens: 3500,
    grade(j) {
      const r = normalizeLists(j, DATES);
      const notes = [...r.problems];
      const names = r.groceries.map((g) => g.name).join(' ');
      if (MEAT.test(names)) notes.push('non-veg grocery');
      const wanted = MEALS.flatMap((m) => m.items.map((i) => i.name.split(' ').pop().toLowerCase()));
      const missing = wanted.filter((w) => !names.toLowerCase().includes(w.replace(/s$/, '')));
      if (missing.length > 3) notes.push(`${missing.length} meal foods missing from groceries`);
      if (!r.prep.some((d) => d.tasks.length)) notes.push('no prep tasks');
      return { ok: notes.length === 0, score: Math.max(0, 100 - 25 * notes.length), notes };
    },
  },
  coach: {
    heavy: false,
    system: CHAT_SYSTEM,
    user: `<user_data>\nLIVE_PLAN: ${JSON.stringify({ targets: { calories_kcal: 1900, protein_g: 140 }, meals: MEALS })}\nPROFILE: ${JSON.stringify(PROFILE)}\nUSER: Paneer at dinner is getting expensive. What can I swap it for with about the same protein?\n</user_data>\nReply with the next JSON.`,
    maxTokens: 1500,
    grade(j) {
      const notes = [];
      const f = typeof j?.final === 'string' ? j.final : '';
      if (!f) notes.push(j?.tool ? `called a tool (${j.tool}) instead of answering` : 'no final answer');
      else {
        if (MEAT.test(f)) notes.push('suggested non-veg food');
        if (!VEG_PROTEIN.test(f.replace(/paneer/gi, ''))) notes.push('no vegetarian protein swap named');
        if (!/\d/.test(f)) notes.push('no quantities');
      }
      return { ok: notes.length === 0, score: Math.max(0, 100 - 34 * notes.length), notes };
    },
  },
};

/** Same leniency as llm.ts parseLooseJson: strip reasoning, accept fenced or embedded JSON. */
export function looseJson(text) {
  const t = String(text).replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(t); } catch { /* next */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) try { return JSON.parse(t.slice(a, b + 1)); } catch { /* next */ }
  return null;
}

const aws = DRY ? null : new AwsClient({ accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY, region: REGION, service: 'bedrock' });

async function call(model, task) {
  const t0 = Date.now();
  if (DRY) return { ms: 5, json: CANNED[task] };
  const res = await aws.fetch(`https://bedrock-runtime.${REGION}.amazonaws.com/openai/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: TASKS[task].system }, { role: 'user', content: TASKS[task].user }], temperature: 0.3, max_tokens: Math.max(TASKS[task].maxTokens, 8000), reasoning_effort: 'low' }),
    signal: AbortSignal.timeout(120_000),
  });
  const ms = Date.now() - t0;
  if (!res.ok) return { ms, error: `${res.status} ${(await res.text()).slice(0, 140)}` };
  const d = await res.json();
  return { ms, json: looseJson(d?.choices?.[0]?.message?.content ?? ''), tokens: d?.usage?.completion_tokens };
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : Infinity; };

/** Picks the heavy and light models from per-model results. Exported for the unit test. */
export function choose(results) {
  const rows = Object.entries(results).map(([model, r]) => ({ model, ...r }));
  const valid = (r, t) => r[t] && r[t].okRate === 1;
  const heavyPool = rows.filter((r) => r.plan && r.plan.score >= 75);
  const heavy = heavyPool.filter((r) => r.plan.p50 <= HEAVY_BUDGET_MS).sort((a, b) => b.plan.score - a.plan.score || a.plan.p50 - b.plan.p50)[0]
    || heavyPool.sort((a, b) => a.plan.p50 - b.plan.p50)[0] || null;
  const light = rows.filter((r) => valid(r, 'lists') && valid(r, 'coach')).sort((a, b) => Math.max(a.lists.p50, a.coach.p50) - Math.max(b.lists.p50, b.coach.p50))[0] || null;
  return { heavy: heavy?.model ?? null, light: light?.model ?? heavy?.model ?? null };
}

const CANNED = {
  plan: { title: 'Veg cut', summary: 's', rationale: 'r', assumptions: [], safety_notes: [], estimated_daily_cost_inr: 250,
    targets: { calories_kcal: 1900, protein_g: 140, carbs_g: 190, fat_g: 60, fibre_g: 30, water_ml: 3000 },
    meals: MEALS.map((m) => ({ name: m.name, time: m.time, items: [{ name: m.items[0].name, quantity: 1, unit: 'serving', calories_kcal: 475, protein_g: 35, carbs_g: 47.5, fat_g: 15, fibre_g: 7 }] })),
    training_week: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((day) => ({ day, focus: 'Strength', session_minutes: 60, exercises: ['Squat 3x8'] })).concat(['Sat', 'Sun'].map((day) => ({ day, focus: 'Rest', session_minutes: 0, exercises: [] }))) },
  lists: { groceries: MEALS.flatMap((m) => m.items.map((i) => ({ name: i.name, quantity: '1 kg', category: 'Produce' }))), prep: [{ date: DATES[0], tasks: ['Soak soya chunks'] }] },
  coach: { final: 'Swap 150 g paneer for 60 g soya chunks plus 200 g curd: about the same protein for less money.' },
};

async function main() {
  if (!MODELS.length) { console.error('Set MODELS=<bedrock model id>,<...>'); process.exit(2); }
  const results = {};
  for (const model of MODELS) {
    results[model] = {};
    for (const task of Object.keys(TASKS)) {
      const runs = [];
      for (let i = 0; i < RUNS; i++) {
        const r = await call(model, task);
        const g = r.error ? { ok: false, score: 0, notes: [r.error] } : r.json ? TASKS[task].grade(r.json) : { ok: false, score: 0, notes: ['not valid JSON'] };
        runs.push({ ms: r.ms, ...g });
      }
      const okRuns = runs.filter((x) => x.ok);
      results[model][task] = {
        p50: median(runs.map((x) => x.ms)), max: Math.max(...runs.map((x) => x.ms)),
        okRate: okRuns.length / runs.length, score: Math.round(runs.reduce((a, x) => a + x.score, 0) / runs.length),
        notes: [...new Set(runs.flatMap((x) => x.notes))].slice(0, 3),
      };
      const t = results[model][task];
      console.log(`${model.padEnd(42)} ${task.padEnd(6)} p50 ${(t.p50 / 1000).toFixed(1)}s max ${(t.max / 1000).toFixed(1)}s ok ${Math.round(t.okRate * 100)}% score ${t.score} ${t.notes.join('; ')}`);
    }
  }
  const pick = choose(results);
  console.log(`\nRecommended: LLM_MODEL=${pick.heavy}  LLM_MODEL_FAST=${pick.light}  (region ${REGION})`);
  console.log(JSON.stringify({ region: REGION, runs: RUNS, results, pick }));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
