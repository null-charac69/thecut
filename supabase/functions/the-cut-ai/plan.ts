// Server-side normalisation + safety validation of AI-generated plans.
// The model proposes; this code decides what is allowed to reach the database.

export const PROMPT_VERSION = "the-cut-plan-v2";

const num = (v: unknown, d = 0): number => {
  const x = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(x) ? x : d;
};
const r1 = (x: number) => Math.round(x * 10) / 10;
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strArr = (v: unknown, maxItems: number, max = 300) =>
  Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, maxItems) : [];

const CATEGORIES = new Set(["PROTEIN", "DAIRY", "PANTRY", "PRODUCE"]);
const MIN_DAILY_KCAL = 1200;
const MAX_DAILY_KCAL = 6000;

export interface PlanResult {
  plan: Record<string, unknown> | null;
  problems: string[];
}

// deno-lint-ignore no-explicit-any
export function normalizePlan(raw: any): PlanResult {
  const problems: string[] = [];
  if (!raw || typeof raw !== "object") return { plan: null, problems: ["Response was not a JSON object."] };

  const mealsIn = Array.isArray(raw.meals) ? raw.meals : [];
  if (mealsIn.length < 2 || mealsIn.length > 6) {
    problems.push(`meals must contain 2 to 6 meals (got ${mealsIn.length}).`);
  }

  // deno-lint-ignore no-explicit-any
  const meals = mealsIn.slice(0, 6).map((m: any, i: number) => {
    // deno-lint-ignore no-explicit-any
    const items = (Array.isArray(m?.items) ? m.items : []).slice(0, 8).map((x: any) => {
      const p = Math.max(0, num(x?.protein_g));
      const c = Math.max(0, num(x?.carbs_g));
      const f = Math.max(0, num(x?.fat_g));
      let kcal = Math.max(0, num(x?.calories_kcal));
      const derived = 4 * p + 4 * c + 9 * f;
      // Fix model arithmetic: if stated calories disagree with macros by >20%, trust the macros.
      if (derived > 0 && Math.abs(kcal - derived) / derived > 0.2) kcal = derived;
      return {
        name: str(x?.name, 100) || "Food item",
        quantity: r1(Math.max(0, num(x?.quantity, 1))),
        unit: str(x?.unit, 30) || "serving",
        calories_kcal: Math.round(kcal),
        protein_g: r1(p),
        carbs_g: r1(c),
        fat_g: r1(f),
        fibre_g: r1(Math.max(0, num(x?.fibre_g))),
        preparation: str(x?.preparation, 200),
      };
    });
    if (!items.length) problems.push(`meal ${i + 1} has no items.`);
    // deno-lint-ignore no-explicit-any
    const sum = (k: string) => items.reduce((a: number, x: any) => a + num(x[k]), 0);
    const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(str(m?.time, 5)) ? str(m?.time, 5) : "12:00";
    return {
      name: str(m?.name, 60) || `Meal ${i + 1}`,
      time,
      items,
      totals: {
        calories_kcal: Math.round(sum("calories_kcal")),
        protein_g: r1(sum("protein_g")),
        carbs_g: r1(sum("carbs_g")),
        fat_g: r1(sum("fat_g")),
        fibre_g: r1(sum("fibre_g")),
      },
    };
  });

  // deno-lint-ignore no-explicit-any
  const total = (k: string) => meals.reduce((a: number, m: any) => a + num(m.totals[k]), 0);
  const sumKcal = Math.round(total("calories_kcal"));
  if (sumKcal < MIN_DAILY_KCAL) problems.push(`meal calories total ${sumKcal} kcal, below the ${MIN_DAILY_KCAL} kcal safety floor.`);
  if (sumKcal > MAX_DAILY_KCAL) problems.push(`meal calories total ${sumKcal} kcal, implausibly high.`);

  const t = raw.targets ?? {};
  const assumptions = strArr(raw.assumptions, 10);
  const targetKcal = Math.round(num(t.calories_kcal, sumKcal));
  const aligned = sumKcal > 0 && Math.abs(targetKcal - sumKcal) / sumKcal <= 0.07;
  if (!aligned && sumKcal > 0) assumptions.push("Daily targets were aligned to the sum of the planned meals.");
  const targets = {
    calories_kcal: aligned ? targetKcal : sumKcal,
    protein_g: r1(aligned ? num(t.protein_g, total("protein_g")) : total("protein_g")),
    carbs_g: r1(aligned ? num(t.carbs_g, total("carbs_g")) : total("carbs_g")),
    fat_g: r1(aligned ? num(t.fat_g, total("fat_g")) : total("fat_g")),
    fibre_g: r1(aligned ? num(t.fibre_g, total("fibre_g")) : total("fibre_g")),
    water_ml: Math.round(Math.min(6000, Math.max(1500, num(t.water_ml, 2500)))),
  };

  // deno-lint-ignore no-explicit-any
  const grocery = (Array.isArray(raw.grocery_list) ? raw.grocery_list : []).slice(0, 40).map((g: any) => {
    const cat = str(g?.category, 20).toUpperCase();
    return { name: str(g?.name, 100), quantity: str(g?.quantity, 80), category: CATEGORIES.has(cat) ? cat : "PRODUCE" };
    // deno-lint-ignore no-explicit-any
  }).filter((g: any) => g.name);

  // deno-lint-ignore no-explicit-any
  const training = (Array.isArray(raw.training_week) ? raw.training_week : []).slice(0, 7).map((d: any) => ({
    day: str(d?.day, 30),
    focus: str(d?.focus, 100),
    session_minutes: Math.round(Math.min(180, Math.max(0, num(d?.session_minutes)))),
    exercises: strArr(d?.exercises, 10, 120),
    // deno-lint-ignore no-explicit-any
  })).filter((d: any) => d.day);

  const title = str(raw.title, 120);
  if (!title) problems.push("title is missing.");

  if (problems.length) return { plan: null, problems };
  return {
    plan: {
      title,
      summary: str(raw.summary, 1200),
      rationale: str(raw.rationale, 2500),
      assumptions,
      safety_notes: strArr(raw.safety_notes, 10),
      estimated_daily_cost_inr: Math.round(Math.min(100000, Math.max(0, num(raw.estimated_daily_cost_inr)))),
      targets,
      meals,
      grocery_list: grocery,
      prep_tasks: strArr(raw.prep_tasks, 12, 240),
      training_week: training,
    },
    problems: [],
  };
}

// Mirrors the client-side checks. Never trust the browser.
// deno-lint-ignore no-explicit-any
export function validateProfile(p: any): string | null {
  if (!p || typeof p !== "object") return "Profile is missing.";
  if (p.adult_confirmed !== true || !(num(p.age_years, 0) >= 18)) return "This planner is for adults aged 18 and above.";
  const h = num(p.height_cm, 0), w = num(p.weight_kg, 0);
  if (h < 120 || h > 230 || w < 30 || w > 350) return "Enter a valid height (120–230 cm) and weight (30–350 kg).";
  const d = num(p.training_days_per_week, 0);
  if (!Number.isInteger(d) || d < 0 || d > 7) return "Training days must be a whole number from 0 to 7.";
  return null;
}

// Keeps free text bounded so a profile can't smuggle a huge prompt.
// deno-lint-ignore no-explicit-any
export function cleanProfile(p: any) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p ?? {})) {
    if (typeof v === "string") out[k] = v.slice(0, 500);
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
  }
  return out;
}

// Soft quality checks on an otherwise valid plan. They drive one corrective retry; they never hard-fail a plan.
const NON_TRAINING = /rest|recover|mobility|stretch|walk|light cardio|off\b/i;
// deno-lint-ignore no-explicit-any
export function qualityChecks(plan: any, profile: any, refKcal?: number | null): string[] {
  const out: string[] = [];
  if (!plan) return out;
  const kg = num(profile?.weight_kg, 0);
  const protein = num(plan.targets?.protein_g, 0);
  if (kg > 0 && protein > 0) {
    const perKg = profile?.goal === "fat_loss" ? 1.2 : 0.8;
    const floor = Math.round(kg * perKg);
    if (protein < floor) out.push(`protein target ${protein} g is below the ${perKg} g/kg minimum (${floor} g for ${kg} kg). Raise protein in the meals and targets.`);
  }
  const days = num(profile?.training_days_per_week, -1);
  if (days >= 0 && Array.isArray(plan.training_week)) {
    // deno-lint-ignore no-explicit-any
    const n = plan.training_week.filter((d: any) => num(d.session_minutes) > 0 && !NON_TRAINING.test(String(d.focus ?? ""))).length;
    if (days > 0 && n !== days) out.push(`training_week has ${n} training sessions but the user asked for ${days} training days per week. Use exactly ${days}; other days must be rest or light recovery.`);
    if (days === 0 && n > 0) out.push("the user asked for no training days; training_week must contain only rest or light recovery.");
  }
  const kcal = num(plan.targets?.calories_kcal, 0);
  // A baseline below the safety floor is not a sane anchor, so the drift check is skipped for it.
  if (refKcal && refKcal >= MIN_DAILY_KCAL && kcal && Math.abs(kcal - refKcal) / refKcal > 0.2) {
    out.push(`daily calories ${kcal} kcal drift more than 20% from the user's accepted plan (${Math.round(refKcal)} kcal). Stay within 20% of it unless the instruction clearly requires a bigger change, and never go below ${MIN_DAILY_KCAL} kcal.`);
  }
  return out;
}
