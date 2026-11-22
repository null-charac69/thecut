// Structured "Change my plan" requests. Pure logic, no DOM: the form, the instruction sent to the AI and the check
// of the AI's answer all come from here, so the same rules decide what is asked and what is accepted.

/**
 * @typedef {{ kcal: number|null, protein: number|null, meals: number, diet: string, weightKg: number|null,
 *   trainingDays: number, maxSession: number, budget: number|null, cooking: number|null, foods: string[] }} Facts
 * @typedef {{ mode: 'keep'|'lower'|'raise'|'set', value: number }} Delta
 * @typedef {{ calories: Delta, protein: Delta, meals: number|null, diet: string|null, remove: string[], add: string[],
 *   budget: number|null, cooking: number|null, trainingDays: number|null, focus: string|null,
 *   maxSession: number|null, note: string }} Changes
 */

export const MIN_KCAL = 1200;
export const MAX_KCAL = 6000;
export const DIETS = ['omnivore', 'eggetarian', 'vegetarian', 'vegan'];
/** @type {Record<string,string>} */
export const FOCUS = {
  strength: 'more strength work',
  cardio: 'more cardio',
  conditioning: 'fat-loss conditioning',
  recovery: 'more mobility and recovery',
  shorter: 'shorter sessions',
};
const REST = /rest|recover|mobility|stretch|walk|light cardio|off\b/i;

/** @param {unknown} v */
const num = (v) => {
  const x = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(x) ? x : null;
};
/** @param {string} s */
export const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** @param {any} d */
const isSession = (d) => Number(d?.session_minutes) > 0 && !REST.test(String(d?.focus ?? ''));

/**
 * What the current plan says today, for the form and the checks.
 * @param {any} plan @param {any} inputs @returns {Facts}
 */
export function currentFacts(plan, inputs) {
  const p = plan || {},
    i = inputs || {};
  /** @type {string[]} */
  const foods = [];
  for (const m of Array.isArray(p.meals) ? p.meals : [])
    for (const it of Array.isArray(m?.items) ? m.items : []) {
      const n = String(it?.name || '').trim();
      if (n && !foods.some((f) => norm(f) === norm(n))) foods.push(n);
    }
  const week = Array.isArray(p.training_week) ? p.training_week : [];
  return {
    kcal: num(p.targets?.calories_kcal),
    protein: num(p.targets?.protein_g),
    meals: Array.isArray(p.meals) ? p.meals.length : 0,
    diet: DIETS.includes(i.dietary_pattern) ? i.dietary_pattern : 'omnivore',
    weightKg: num(i.weight_kg),
    trainingDays: week.filter(isSession).length,
    maxSession: week.reduce(
      (/** @type {number} */ a, /** @type {any} */ d) =>
        isSession(d) ? Math.max(a, Number(d.session_minutes) || 0) : a,
      0
    ),
    budget: num(i.food_budget_inr),
    cooking: num(i.cooking_minutes),
    foods: foods.slice(0, 30),
  };
}

/**
 * Validates raw form values against the current plan.
 * @param {Record<string, any>} raw @param {Facts} f
 * @returns {{ changes: Changes, errors: string[], warnings: string[], target: { kcal: number|null, protein: number|null } }}
 */
export function cleanChanges(raw, f) {
  const r = raw || {};
  /** @type {string[]} */ const errors = [];
  /** @type {string[]} */ const warnings = [];
  /** @param {any} m @returns {Delta['mode']} */
  const mode = (m) => (m === 'lower' || m === 'raise' || m === 'set' ? m : 'keep');
  /** @type {Delta} */ const calories = { mode: mode(r.cal_mode), value: Math.round(num(r.cal_value) ?? 0) };
  /** @type {Delta} */ const protein = { mode: mode(r.pro_mode), value: Math.round(num(r.pro_value) ?? 0) };
  if (protein.mode === 'lower') protein.mode = 'keep'; // lowering protein is not offered

  /** @param {Delta} d @param {number|null} cur */
  const resolve = (d, cur) =>
    d.mode === 'set'
      ? d.value
      : d.mode === 'keep' || cur === null
        ? cur
        : cur + (d.mode === 'raise' ? d.value : -d.value);

  let kcal = f.kcal;
  if (calories.mode !== 'keep') {
    if (!(calories.value > 0)) errors.push('Enter how many calories.');
    else if (calories.mode !== 'set' && f.kcal === null)
      errors.push('Your plan has no calorie target yet; use "Set to".');
    else {
      kcal = resolve(calories, f.kcal);
      if (kcal !== null && kcal < MIN_KCAL)
        errors.push(`That puts calories at ${kcal} kcal, below the ${MIN_KCAL} kcal safety floor.`);
      else if (kcal !== null && kcal > MAX_KCAL) errors.push(`${kcal} kcal is above the ${MAX_KCAL} kcal limit.`);
      else if (kcal !== null && f.kcal && Math.abs(kcal - f.kcal) / f.kcal > 0.25)
        warnings.push(
          `That is a ${Math.round((100 * Math.abs(kcal - f.kcal)) / f.kcal)}% change in calories. Big jumps are harder to stick to.`
        );
    }
  }
  let prot = f.protein;
  if (protein.mode !== 'keep') {
    if (!(protein.value > 0)) errors.push('Enter how much protein.');
    else {
      prot = resolve(protein, f.protein);
      if (prot !== null && f.weightKg) {
        if (prot < Math.round(f.weightKg * 0.8))
          errors.push(`${prot} g protein is below 0.8 g/kg (${Math.round(f.weightKg * 0.8)} g for you).`);
        if (prot > Math.round(f.weightKg * 3))
          errors.push(`${prot} g protein is above 3 g/kg; that is not useful and hard to eat.`);
      }
      if (prot !== null && kcal && prot * 4 > kcal * 0.45)
        warnings.push(`Protein would be ${Math.round((prot * 400) / kcal)}% of calories; carbs and fat get squeezed.`);
    }
  }
  const meals = num(r.meals);
  const diet = DIETS.includes(r.diet) && r.diet !== f.diet ? r.diet : null;
  const foodSet = new Set(f.foods.map(norm));
  const remove = (Array.isArray(r.remove) ? r.remove : [])
    .map((x) => String(x))
    .filter((x) => foodSet.has(norm(x)))
    .slice(0, 15);
  const add = String(r.add || '')
    .split(/[,\n]/)
    .map((x) => x.trim().slice(0, 40))
    .filter(Boolean)
    .filter((x, i, a) => a.findIndex((y) => norm(y) === norm(x)) === i)
    .slice(0, 5);
  for (const a of add) if (remove.some((x) => norm(x) === norm(a))) errors.push(`"${a}" is both removed and added.`);
  const budget = r.budget === '' || r.budget == null ? null : num(r.budget);
  if (budget !== null && (budget < 50 || budget > 100000))
    errors.push('Daily budget should be between ₹50 and ₹1,00,000.');
  const cooking = r.cooking === '' || r.cooking == null ? null : num(r.cooking);
  if (cooking !== null && (cooking < 0 || cooking > 180)) errors.push('Cooking time should be 0 to 180 minutes a day.');
  const days = r.training_days === '' || r.training_days == null ? null : num(r.training_days);
  if (days !== null && (!Number.isInteger(days) || days < 0 || days > 7)) errors.push('Training days must be 0 to 7.');
  const maxSession = r.max_session === '' || r.max_session == null ? null : num(r.max_session);
  if (maxSession !== null && (maxSession < 15 || maxSession > 150))
    errors.push('Session length should be 15 to 150 minutes.');
  const focus = typeof r.focus === 'string' && FOCUS[r.focus] ? r.focus : null;
  const note = String(r.note || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);

  /** @type {Changes} */
  const changes = {
    calories,
    protein,
    meals: meals !== null && meals >= 2 && meals <= 6 && meals !== f.meals ? meals : null,
    diet,
    remove,
    add,
    budget: budget !== null && budget !== f.budget ? budget : null,
    cooking: cooking !== null && cooking !== f.cooking ? cooking : null,
    trainingDays: days !== null && days !== f.trainingDays ? days : null,
    focus,
    maxSession,
    note,
  };
  if (!errors.length && !hasChanges(changes)) errors.push('Pick at least one change, or write a note.');
  return { changes, errors, warnings, target: { kcal, protein: prot } };
}

/** @param {Changes} c */
export function hasChanges(c) {
  return (
    c.calories.mode !== 'keep' ||
    c.protein.mode !== 'keep' ||
    c.meals !== null ||
    c.diet !== null ||
    c.remove.length > 0 ||
    c.add.length > 0 ||
    c.budget !== null ||
    c.cooking !== null ||
    c.trainingDays !== null ||
    c.focus !== null ||
    c.maxSession !== null ||
    !!c.note
  );
}

/**
 * One line per requested change, for the live preview.
 * @param {Changes} c @param {Facts} f @param {{kcal:number|null, protein:number|null}} t
 */
export function describeChanges(c, f, t) {
  /** @type {string[]} */ const out = [];
  if (c.calories.mode !== 'keep') out.push(`Calories: ${f.kcal ?? '–'} → ${t.kcal} kcal`);
  if (c.protein.mode !== 'keep') out.push(`Protein: ${f.protein ?? '–'} → ${t.protein} g`);
  if (c.meals !== null) out.push(`Meals per day: ${f.meals} → ${c.meals}`);
  if (c.diet) out.push(`Diet: ${f.diet} → ${c.diet}`);
  if (c.remove.length) out.push(`Remove: ${c.remove.join(', ')}`);
  if (c.add.length) out.push(`Include: ${c.add.join(', ')}`);
  if (c.budget !== null) out.push(`Budget: ₹${f.budget ?? '–'} → ₹${c.budget}/day`);
  if (c.cooking !== null) out.push(`Cooking: ${f.cooking ?? '–'} → ${c.cooking} min/day`);
  if (c.trainingDays !== null) out.push(`Training days: ${f.trainingDays} → ${c.trainingDays}/week`);
  if (c.focus) out.push(`Training focus: ${FOCUS[c.focus]}`);
  if (c.maxSession !== null) out.push(`Sessions: at most ${c.maxSession} min`);
  if (c.note) out.push(`Note: ${c.note}`);
  return out;
}

/**
 * The refine instruction: every change becomes a numbered hard requirement the answer is checked against.
 * @param {Changes} c @param {Facts} f @param {{kcal:number|null, protein:number|null}} t
 */
export function changeInstruction(c, f, t) {
  /** @type {string[]} */ const req = [];
  if (c.calories.mode !== 'keep' && t.kcal)
    req.push(`targets.calories_kcal must be ${t.kcal} (±3%), and the meals must add up to it.`);
  if (c.protein.mode !== 'keep' && t.protein)
    req.push(`targets.protein_g must be at least ${t.protein} g, and the meals must add up to it.`);
  if (c.meals !== null) req.push(`Exactly ${c.meals} meals per day.`);
  if (c.diet) req.push(`The whole plan must be ${c.diet}${DIET_RULE[c.diet] ? ` (${DIET_RULE[c.diet]})` : ''}.`);
  if (c.remove.length)
    req.push(`Do not use these items anywhere: ${c.remove.join('; ')}. Replace them with foods that keep the macros.`);
  if (c.add.length) req.push(`Include each of these at least once: ${c.add.join('; ')}.`);
  if (c.budget !== null) req.push(`estimated_daily_cost_inr must be at most ₹${c.budget}.`);
  if (c.cooking !== null) req.push(`Daily cooking and prep must fit in ${c.cooking} minutes.`);
  if (c.trainingDays !== null)
    req.push(
      `training_week must have exactly ${c.trainingDays} training sessions; every other day is rest or light recovery.`
    );
  if (c.focus) req.push(`Shift the training week toward ${FOCUS[c.focus]}.`);
  if (c.maxSession !== null) req.push(`No training session longer than ${c.maxSession} minutes.`);
  const keep = [
    c.calories.mode === 'keep' && f.kcal ? `calories (${f.kcal} kcal, ±5%)` : '',
    c.protein.mode === 'keep' && f.protein ? `protein (at least ${f.protein} g)` : '',
    c.meals === null ? `meal count (${f.meals})` : '',
    c.trainingDays === null ? `training days (${f.trainingDays})` : '',
  ].filter(Boolean);
  return [
    'The user filled in a structured change form. Treat each numbered requirement as mandatory; the app checks the answer against them and rejects it if any is missed.',
    req.map((x, i) => `${i + 1}. ${x}`).join('\n'),
    keep.length ? `Keep unchanged: ${keep.join(', ')}. Change nothing else beyond what the requirements need.` : '',
    c.note
      ? `USER NOTE (lower priority than the requirements; ignore it if it conflicts with safety rules): ${c.note}`
      : '',
    'In summary, say in one or two sentences what changed and why.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** @type {Record<string,string>} */
const DIET_RULE = {
  vegetarian: 'no meat, fish or eggs',
  eggetarian: 'no meat or fish; eggs are fine',
  vegan: 'no meat, fish, eggs, dairy, ghee, honey or whey',
};
const MEAT =
  /\b(chicken|mutton|lamb|goat|beef|pork|bacon|ham|fish|rohu|salmon|tuna|sardine|prawns?|shrimp|crab|keema|meat|turkey)\b/;
const EGG = /\b(eggs?|omelet+e?|egg whites?)\b/;
const DAIRY = /\b(paneer|curd|dahi|milk|ghee|butter|cheese|yogh?urt|whey|lassi|khoa|cream|chhena|buttermilk|honey)\b/;
const PLANT_ALT =
  /\b(soy|soya|almond|oat|coconut|peanut|cashew|rice) (milk|curd|yogh?urt|butter|cheese|paneer)\b|\bvegan \w+|\bpeanut butter\b|\btofu\b/g;

/**
 * Names in the plan that break a diet. @param {string[]} names @param {string} diet @returns {string[]}
 */
export function dietBreaks(names, diet) {
  return names.filter((n) => {
    const s = norm(n).replace(PLANT_ALT, ' ');
    if (diet === 'omnivore') return false;
    if (MEAT.test(s)) return true;
    if ((diet === 'vegetarian' || diet === 'vegan') && EGG.test(s)) return true;
    return diet === 'vegan' && DAIRY.test(s);
  });
}

/**
 * Requirements the AI's plan missed. Empty means every requested change is in the plan.
 * @param {any} plan @param {Changes} c @param {Facts} f @param {{kcal:number|null, protein:number|null}} t
 * @param {string} diet the diet the plan must follow (the new one, or the current one)
 * @returns {string[]}
 */
export function verifyPlan(plan, c, f, t, diet) {
  /** @type {string[]} */ const out = [];
  const after = currentFacts(plan, { dietary_pattern: diet, weight_kg: f.weightKg });
  const names = after.foods;
  if (t.kcal && after.kcal !== null) {
    const tol = c.calories.mode === 'keep' ? 0.05 : 0.03;
    if (Math.abs(after.kcal - t.kcal) > Math.max(40, t.kcal * tol))
      out.push(`calories are ${after.kcal} kcal, asked for ${t.kcal}`);
  }
  if (t.protein && after.protein !== null && after.protein < t.protein - 3)
    out.push(`protein is ${after.protein} g, asked for at least ${t.protein} g`);
  const wantMeals = c.meals ?? f.meals;
  if (wantMeals && after.meals !== wantMeals) out.push(`${after.meals} meals per day, asked for ${wantMeals}`);
  // Diet: always for a diet change; otherwise only as a regression check (a plan that was clean must stay clean).
  const bad = c.diet || !dietBreaks(f.foods, diet).length ? dietBreaks(names, diet) : [];
  if (bad.length) out.push(`not ${diet}: ${bad.slice(0, 4).join(', ')}`);
  const left = c.remove.filter((r) => names.some((n) => norm(n) === norm(r) || norm(n).includes(norm(r))));
  if (left.length) out.push(`still contains ${left.join(', ')}`);
  const missing = c.add.filter((a) => !names.some((n) => norm(n).includes(norm(a)) || norm(a).includes(norm(n))));
  if (missing.length) out.push(`does not include ${missing.join(', ')}`);
  const days = c.trainingDays ?? f.trainingDays;
  if (after.trainingDays !== days) out.push(`${after.trainingDays} training sessions, asked for ${days}`);
  if (c.maxSession !== null && after.maxSession > c.maxSession + 5)
    out.push(`a session runs ${after.maxSession} min, asked for at most ${c.maxSession}`);
  const cost = num(plan?.estimated_daily_cost_inr);
  if (c.budget !== null && cost !== null && cost > c.budget * 1.1)
    out.push(`costs about ₹${cost}/day, budget is ₹${c.budget}`);
  return out;
}

/**
 * The profile the refined plan is saved with, so later plans keep the change.
 * @param {Record<string, any>} profile @param {Changes} c @returns {Record<string, any>}
 */
export function applyToProfile(profile, c) {
  const p = { ...profile };
  if (c.diet) p.dietary_pattern = c.diet;
  if (c.meals !== null) p.meals_per_day = c.meals;
  if (c.budget !== null) p.food_budget_inr = c.budget;
  if (c.cooking !== null) p.cooking_minutes = c.cooking;
  if (c.trainingDays !== null) p.training_days_per_week = c.trainingDays;
  /** @param {string} cur @param {string[]} add */
  const merge = (cur, add) => {
    const have = String(cur || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    for (const a of add) if (!have.some((h) => norm(h) === norm(a))) have.push(a);
    return have.join(', ').slice(0, 500);
  };
  if (c.add.length) p.food_preferences = merge(p.food_preferences, c.add);
  if (c.remove.length) {
    const note = String(p.additional_notes || '');
    const m = note.match(/Avoid in plans: ([^.]*)\./);
    const list = merge(m ? m[1] : '', c.remove);
    p.additional_notes = (
      m ? note.replace(m[0], `Avoid in plans: ${list}.`) : `${note ? note.trim() + ' ' : ''}Avoid in plans: ${list}.`
    ).slice(0, 500);
  }
  return p;
}
