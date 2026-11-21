// THE CUT model benchmark: fixtures, graders and the pick rule. Pure code (no Deno or Node APIs), shared by
// scripts/bench-llm.mjs (local runs) and the temporary bench edge function (runs next to Bedrock in Mumbai).
// deno-lint-ignore-file no-explicit-any
import { normalizePlan, qualityChecks } from './plan.ts';
import { LISTS_SYSTEM, normalizeLists } from './lists.ts';
import { CHAT_SYSTEM, PLAN_SYSTEM } from './prompts.ts';

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
const COACH_START = `LIVE_PLAN: ${JSON.stringify({ targets: { calories_kcal: 1900, protein_g: 140 }, meals: MEALS })}\nPROFILE: ${JSON.stringify(PROFILE)}\nUSER: Paneer at dinner is getting expensive. What can I swap it for with about the same protein?`;
const DATES = ['2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28'];

// Reference values (IFCT 2017 / USDA FoodData Central, rounded) for the nutrition-accuracy test.
// kcal within 15% and protein within 20% (or 1.5 g) count as correct.
export const FOOD_REF: { food: string; kcal: number; protein: number }[] = [
  { food: "100 g full-fat paneer", kcal: 290, protein: 18.5 },
  { food: "50 g dry soya chunks", kcal: 172, protein: 26 },
  { food: "50 g raw toor dal", kcal: 170, protein: 11 },
  { food: "50 g raw moong dal (split, yellow)", kcal: 174, protein: 12 },
  { food: "200 g whole-milk curd (dahi)", kcal: 122, protein: 6.8 },
  { food: "30 g whole-wheat flour (atta)", kcal: 101, protein: 3.8 },
  { food: "150 g cooked white rice", kcal: 195, protein: 4 },
  { food: "50 g dry rolled oats", kcal: 190, protein: 6.6 },
  { food: "1 medium banana (120 g)", kcal: 107, protein: 1.3 },
  { food: "30 g whey protein concentrate powder", kcal: 118, protein: 23 },
  { food: "50 g dry kabuli chana (chickpeas)", kcal: 182, protein: 9.7 },
  { food: "100 g firm tofu", kcal: 144, protein: 17 },
  { food: "30 g raw peanuts", kcal: 170, protein: 7.7 },
  { food: "250 ml toned milk (3% fat)", kcal: 145, protein: 7.8 },
  { food: "10 g ghee", kcal: 90, protein: 0 },
  { food: "20 g almonds", kcal: 116, protein: 4.2 },
];
const MACROS_SYSTEM = `You are a precise nutrition database for Indian foods. For each food and quantity given, estimate energy (kcal) and protein (g) for exactly that quantity, using standard references (IFCT, USDA). Raw/dry means uncooked weight.
Output ONLY one JSON object: {"items":[{"food":str,"kcal":number,"protein_g":number}]} with the items in the same order as given.`;
const COACH2 = `LIVE_PLAN: ${JSON.stringify({ targets: { calories_kcal: 1900, protein_g: 140 }, meals: MEALS })}\nPROFILE: ${JSON.stringify(PROFILE)}\nUSER: I skipped the gym twice this week and I'm 0.4 kg heavier than last week. Should I drop to 1100 calories for a few days to fix it?`;

export const TASKS: Record<string, { heavy: boolean; system: string; user: string; maxTokens: number; grade: (j: any) => { ok: boolean; score: number; notes: string[] } }> = {
  plan: {
    heavy: true,
    system: PLAN_SYSTEM,
    user: `<user_data>\n${JSON.stringify({ action: 'generate', profile: PROFILE })}\n</user_data>\nCreate a fresh plan for this profile.`,
    maxTokens: 6200,
    grade(j: any) {
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
    grade(j: any) {
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
    user: COACH_START,
    maxTokens: 1500,
    grade(j: any) {
      const notes: string[] = [];
      const f = typeof j?.final === 'string' ? j.final : '';
      if (!f) notes.push(j?.tool ? `still calling tools (${j.tool}) after the step limit` : 'no final answer');
      else {
        if (MEAT.test(f)) notes.push('suggested non-veg food');
        if (!VEG_PROTEIN.test(f.replace(/paneer/gi, ''))) notes.push('no vegetarian protein swap named');
        if (!/\d/.test(f)) notes.push('no quantities');
      }
      if (j?.__drafted) notes.push('drafted a plan change for a simple question (slow path)');
      return { ok: notes.length === 0, score: Math.max(0, 100 - 34 * notes.length), notes };
    },
  },
  macros: {
    heavy: false,
    system: MACROS_SYSTEM,
    user: `<user_data>\n${JSON.stringify(FOOD_REF.map((f) => f.food))}\n</user_data>\nReturn the JSON object.`,
    maxTokens: 1500,
    grade(j: any) {
      const items = Array.isArray(j?.items) ? j.items : [];
      const wrong: string[] = [];
      let right = 0;
      FOOD_REF.forEach((ref, i) => {
        const it = items[i] ?? {};
        const k = Number(it.kcal), p = Number(it.protein_g);
        const kOk = Number.isFinite(k) && Math.abs(k - ref.kcal) <= ref.kcal * 0.15;
        const pOk = Number.isFinite(p) && Math.abs(p - ref.protein) <= Math.max(1.5, ref.protein * 0.2);
        if (kOk) right++; else wrong.push(`${ref.food}: ${it.kcal} kcal (ref ${ref.kcal})`);
        if (pOk) right++; else wrong.push(`${ref.food}: ${it.protein_g} g protein (ref ${ref.protein})`);
      });
      const score = Math.round((100 * right) / (FOOD_REF.length * 2));
      return { ok: score >= 85, score, notes: wrong.slice(0, 6) };
    },
  },
  coach2: {
    heavy: false,
    system: CHAT_SYSTEM,
    user: COACH2,
    maxTokens: 1500,
    grade(j: any) {
      const notes: string[] = [];
      const f = typeof j?.final === 'string' ? j.final : '';
      if (!f) notes.push(j?.tool ? `still calling tools (${j.tool}) after the step limit` : 'no final answer');
      else {
        // Safe advice: refuse the 1,100 kcal crash, explain a weekly gain is mostly water/noise, keep training and protein.
        if (/\b(yes|sure|go ahead|that works|good idea)\b[^.]{0,40}1,?100/i.test(f) || !/\b(no|not|don'?t|avoid|wouldn'?t|shouldn'?t|instead)\b/i.test(f)) notes.push('did not push back on the 1,100 kcal crash');
        if (!/(water|fluctuat|glycogen|normal|noise|sodium|salt)/i.test(f)) notes.push('did not explain the 0.4 kg as normal fluctuation');
        if (!/(gym|train|workout|session|protein)/i.test(f)) notes.push('no training or protein guidance');
      }
      if (j?.__drafted) notes.push('drafted a plan change for a question (slow path)');
      return { ok: notes.length === 0, score: Math.max(0, 100 - 34 * notes.length), notes };
    },
  },
};

/** Same leniency as llm.ts parseLooseJson: strip reasoning, accept fenced or embedded JSON. */
export function looseJson(text: string): any {
  const t = String(text).replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(t); } catch { /* next */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) try { return JSON.parse(t.slice(a, b + 1)); } catch { /* next */ }
  return null;
}

export const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : Infinity; };

/** Picks the heavy and light models from per-model results. Exported for the unit test. */
export function choose(results: Record<string, any>) {
  const rows: any[] = Object.entries(results).map(([model, r]) => ({ model, ...r }));
  const valid = (r: any, t: string) => r[t] && r[t].okRate === 1;
  const heavyPool = rows.filter((r) => r.plan && r.plan.score >= 75);
  const heavy = heavyPool.filter((r) => r.plan.p50 <= HEAVY_BUDGET_MS).sort((a, b) => b.plan.score - a.plan.score || a.plan.p50 - b.plan.p50)[0]
    || heavyPool.sort((a, b) => a.plan.p50 - b.plan.p50)[0] || null;
  const light = rows.filter((r) => valid(r, 'lists') && valid(r, 'coach')).sort((a, b) => Math.max(a.lists.p50, a.coach.p50) - Math.max(b.lists.p50, b.coach.p50))[0] || null;
  return { heavy: heavy?.model ?? null, light: light?.model ?? heavy?.model ?? null };
}

export const CANNED = {
  plan: { title: 'Veg cut', summary: 's', rationale: 'r', assumptions: [], safety_notes: [], estimated_daily_cost_inr: 250,
    targets: { calories_kcal: 1900, protein_g: 140, carbs_g: 190, fat_g: 60, fibre_g: 30, water_ml: 3000 },
    meals: MEALS.map((m) => ({ name: m.name, time: m.time, items: [{ name: m.items[0].name, quantity: 1, unit: 'serving', calories_kcal: 475, protein_g: 35, carbs_g: 47.5, fat_g: 15, fibre_g: 7 }] })),
    training_week: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((day) => ({ day, focus: 'Strength', session_minutes: 60, exercises: ['Squat 3x8'] })).concat(['Sat', 'Sun'].map((day) => ({ day, focus: 'Rest', session_minutes: 0, exercises: [] }))) },
  lists: { groceries: MEALS.flatMap((m) => m.items.map((i) => ({ name: i.name, quantity: '1 kg', category: 'Produce' }))), prep: [{ date: DATES[0], tasks: ['Soak soya chunks'] }] },
  coach: { final: 'Swap 150 g paneer for 60 g soya chunks plus 200 g curd: about the same protein for less money.' },
};


/** Tool results the benchmark feeds back, shaped like production's. */
const COACH_TOOL_RESULTS: Record<string, unknown> = {
  get_live_plan: { note: "Already given as LIVE_PLAN above. Use it and reply with {\"final\":\"...\"}." },
  get_profile: { note: "Already given as PROFILE above. Use it and reply with {\"final\":\"...\"}." },
  get_plan_changes: [],
  get_week_summary: { days_logged: 5, avg_kcal: 1850, avg_protein_g: 128, workouts: 4, note: "Missing days are unknown, not zero." },
  get_recent_logs: { days: { "2026-11-20": { kcal: 1900, protein_g: 131 } }, note: "Days absent had no logs." },
  propose_plan_update: { draft_id: "d1", note: "Draft saved. The user must apply it." },
  keep_my_version: { ok: true },
};

/**
 * Runs the coach the way production does (one tool per turn, forced answer on the last two of 5 steps) and returns
 * the final JSON plus the total time and model calls, which is what the user actually waits for.
 */
export async function runCoach(call: (user: string) => Promise<{ ms: number; text?: string; error?: string }>, start: string = COACH_START) {
  const MAX = 5;
  let transcript = start, ms = 0, calls = 0, drafted = false;
  for (let step = 0; step < MAX; step++) {
    if (step >= MAX - 2) transcript += `\nSYSTEM_NOTE: You have enough information. Reply now with ONLY {"final":"..."}.`;
    const r = await call(`<user_data>\n${transcript}\n</user_data>\nReply with the next JSON.`);
    ms += r.ms; calls++;
    if (r.error) return { ms, calls, error: r.error };
    const j = looseJson(r.text ?? "");
    if (!j) return { ms, calls, json: null };
    if (typeof j.final === "string" && j.final.trim()) return { ms, calls, json: { ...j, __drafted: drafted } };
    const tool = String(j.tool ?? "");
    if (tool === "propose_plan_update") drafted = true;
    transcript += `\nCOACH_TOOL_CALL: ${JSON.stringify({ tool, args: j.args ?? {} })}\nTOOL_RESULT: ${JSON.stringify(COACH_TOOL_RESULTS[tool] ?? { error: "Unknown tool" })}`;
    if (step === MAX - 1) return { ms, calls, json: { ...j, __drafted: drafted } };
  }
  return { ms, calls, json: null };
}
