// Deterministic fixture data for the mocked-backend UI tests.
// "Now" is Tuesday 2026-11-10 11:30 IST, so the planned session today is the Tue entry of the training week.
export const NOW = '2026-11-10T06:00:00.000Z';
export const TODAY = '2026-11-10';
export const WEEK = '2026-11-09';
export const EMAIL = 'tester@example.com';
export const PASSWORD = 'correct-horse-battery';
const U = '11111111-1111-4111-8111-111111111111';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const item = (name, quantity, unit, k, p, c = 0, f = 0) => ({ name, quantity, unit, calories_kcal: k, protein_g: p, carbs_g: c, fat_g: f, fibre_g: 1 });
const meal = (name, time, items) => ({
  name, time, items,
  totals: { calories_kcal: items.reduce((a, i) => a + i.calories_kcal, 0), protein_g: items.reduce((a, i) => a + i.protein_g, 0), carbs_g: items.reduce((a, i) => a + i.carbs_g, 0), fat_g: items.reduce((a, i) => a + i.fat_g, 0), fibre_g: 4 },
});
export const trainingWeek = [
  { day: 'Mon', focus: 'Push', session_minutes: 55, exercises: ['Bench Press 3x8 @ 62.5 kg', 'Overhead Press 3x10', 'Incline Dumbbell Press 3x10', 'Triceps Pushdown 3x12'] },
  { day: 'Tue', focus: 'Pull', session_minutes: 55, exercises: ['Lat Pulldown 3x10', 'Barbell Row 3x8', 'Seated Cable Row 3x10', 'Dumbbell Curl 3x12'] },
  { day: 'Wed', focus: 'Rest', session_minutes: 0, exercises: [] },
  { day: 'Thu', focus: 'Legs', session_minutes: 60, exercises: ['Back Squat 4x6', 'Romanian Deadlift 3x8', 'Leg Press 3x12', 'Calf Raise 4x15'] },
  { day: 'Fri', focus: 'Upper', session_minutes: 50, exercises: ['Incline Bench Press 3x8', 'Pull-up 3x6', 'Lateral Raise 3x15'] },
  { day: 'Sat', focus: 'Mobility', session_minutes: 20, exercises: ['Hip Flexor Stretch', 'Thoracic Rotation'] },
  { day: 'Sun', focus: 'Rest', session_minutes: 0, exercises: [] },
];
export const planA = {
  title: 'Lean cut, 2,100 kcal', summary: 'A high-protein cut built around eggs, chicken and dahi, with a push/pull/legs split.', rationale: 'Deficit of about 450 kcal from maintenance.',
  assumptions: ['Maintenance is about 2,550 kcal'], safety_notes: ['General wellness information, not medical advice.'],
  targets: { calories_kcal: 2100, protein_g: 165, carbs_g: 190, fat_g: 62, fibre_g: 30, water_ml: 3000 },
  meals: [
    meal('Breakfast', '08:00', [item('Whole eggs', 3, 'eggs', 215, 19, 1, 15), item('Oats', 50, 'g', 190, 7, 33, 3)]),
    meal('Lunch', '13:00', [item('Chicken breast', 180, 'g raw', 300, 56, 0, 6), item('White rice', 60, 'g dry', 210, 4, 46, 0)]),
    meal('Snack', '17:30', [item('Greek yogurt', 200, 'g', 160, 20, 8, 5), item('Banana', 1, 'medium', 105, 1, 27, 0)]),
    meal('Dinner', '20:30', [item('Paneer', 120, 'g', 320, 22, 4, 24), item('Roti', 2, 'pieces', 240, 8, 44, 4)]),
  ],
  grocery_list: [{ name: 'Eggs', quantity: '30', category: 'PROTEIN' }, { name: 'Chicken breast', quantity: '1.5 kg', category: 'PROTEIN' }, { name: 'Greek yogurt', quantity: '1.4 kg', category: 'DAIRY' }, { name: 'Oats', quantity: '350 g', category: 'PANTRY' }, { name: 'Bananas', quantity: '7', category: 'PRODUCE' }],
  prep_tasks: ['Boil 6 eggs', 'Portion chicken for 3 days'], training_week: trainingWeek, estimated_daily_cost_inr: 380,
};
export const planOld = { ...planA, title: 'Maintenance, 2,500 kcal', targets: { ...planA.targets, calories_kcal: 2500, protein_g: 150 }, grocery_list: [{ name: 'Eggs', quantity: '30', category: 'PROTEIN' }, { name: 'Tofu', quantity: '600 g', category: 'PROTEIN' }], prep_tasks: ['Press tofu'] };
const planDraft = { ...planA, title: 'Lean bulk, 2,800 kcal', targets: { ...planA.targets, calories_kcal: 2800, protein_g: 170 } };
const intake = { adult_confirmed: true, age_years: 26, sex: 'male', height_cm: 176, weight_kg: 82, target_weight_kg: 76, goal: 'fat_loss', activity_level: 'moderate', training_experience: 'intermediate', training_days_per_week: 5, training_location: 'gym', dietary_pattern: 'eggetarian', meals_per_day: 4, food_budget_inr: 400, cooking_minutes: 45, location: 'Pune, India', goal_timeline_weeks: 16, allergies: '', food_preferences: 'eggs, chicken, dahi', preferred_cuisines: 'Indian home food', additional_notes: '' };

export function makeDb({ signedIn = true, withPlan = true } = {}) {
  const user = { id: U, email: EMAIL, created_at: '2026-10-01T10:00:00Z', user_metadata: { name: 'Tester' } };
  const session = { access_token: 'tok', user };
  const T = {};
  T.profiles = [{ id: U, display_name: 'Tester', timezone: 'Asia/Kolkata' }];
  T.user_settings = [{ user_id: U, calorie_target: withPlan ? 2100 : 1566, protein_target_g: withPlan ? 165 : 139, carbs_target_g: 190, fat_target_g: 62, fiber_target_g: 30, water_target_ml: 3000 }];
  T.ai_plan_versions = withPlan ? [
    { id: id(1), user_id: U, title: planA.title, status: 'active', inputs: intake, plan: planA, model: 'fixture', prompt_version: 'the-cut-plan-v2', created_at: '2026-11-09T08:00:00Z', applied_at: '2026-11-09T08:01:00Z' },
    { id: id(2), user_id: U, title: planOld.title, status: 'superseded', inputs: intake, plan: planOld, model: 'fixture', prompt_version: 'the-cut-plan-v2', created_at: '2026-11-05T08:00:00Z', applied_at: '2026-11-05T08:01:00Z' },
    { id: id(3), user_id: U, title: planDraft.title, status: 'draft', inputs: intake, plan: planDraft, model: 'fixture', prompt_version: 'the-cut-plan-v2', created_at: '2026-11-10T05:00:00Z', applied_at: null },
  ] : [];
  T.meal_templates = []; T.meal_template_items = []; T.daily_meals = [];
  if (withPlan) {
    planA.meals.forEach((m, i) => {
      const t = { id: id(100 + i), user_id: U, name: m.name, sort_order: i, planned_time: m.time + ':00', is_active: true };
      T.meal_templates.push(t);
      m.items.forEach((it, j) => T.meal_template_items.push({ id: id(200 + i * 10 + j), user_id: U, meal_template_id: t.id, food_name_snapshot: it.name, unit: `${it.quantity} ${it.unit}`, quantity: 1, sort_order: j, calories_kcal: it.calories_kcal, protein_g: it.protein_g }));
      T.meal_template_items.push({ id: id(300 + i), user_id: U, meal_template_id: t.id, food_name_snapshot: '__plan_total__', unit: 'AI plan total', quantity: 1, sort_order: 999, calories_kcal: m.totals.calories_kcal, protein_g: m.totals.protein_g });
      T.daily_meals.push({ id: id(400 + i), user_id: U, local_date: TODAY, meal_template_id: t.id, meal_name: m.name, planned_time: m.time + ':00', status: i < 1 ? 'completed' : 'planned' });
    });
  }
  T.food_entries = withPlan ? [{ id: id(500), user_id: U, local_date: TODAY, consumed_at: '2026-11-10T04:00:00Z', food_name_snapshot: 'Protein shake', quantity: 1, unit: 'serving', calories_kcal: 150, protein_g: 25 }] : [];
  T.daily_targets = [];
  T.body_measurements = withPlan ? [82.4, 82.1, 81.9, 81.8, 81.2, 81.0, 80.8, 80.5].map((w, i) => ({ id: id(600 + i), user_id: U, measured_on: `2026-10-${String(20 + i).padStart(2, '0')}`, weight_kg: w })) : [];
  const sess = (n, date, title, mins, rpe, exs) => {
    T.workout_sessions.push({ id: id(700 + n), user_id: U, local_date: date, title, workout_type: 'strength', duration_minutes: mins, perceived_effort: rpe, created_at: date + 'T09:00:00Z' });
    exs.forEach(([name, sets], i) => { const eid = id(720 + n * 10 + i); T.workout_exercises.push({ id: eid, user_id: U, workout_session_id: id(700 + n), exercise_name: name, sort_order: i, created_at: date + 'T09:0' + i + ':00Z' }); sets.forEach(([kg, reps], k) => T.workout_sets.push({ id: id(800 + n * 100 + i * 10 + k), user_id: U, workout_exercise_id: eid, set_number: k + 1, reps, weight_kg: kg })); });
  };
  T.workout_sessions = []; T.workout_exercises = []; T.workout_sets = [];
  if (withPlan) {
    sess(1, '2026-11-08', 'Push', 52, 8, [['Bench Press', [[60, 8], [60, 8], [60, 7]]], ['Overhead Press', [[40, 10], [40, 9], [40, 8]]]]);
    sess(2, '2026-11-03', 'Pull', 58, 7, [['Lat Pulldown', [[55, 10], [55, 10], [55, 9]]], ['Barbell Row', [[50, 8], [50, 8], [50, 8]]]]);
  }
  T.workout_feedback = [];
  T.workout_reviews = withPlan ? [{ id: id(900), user_id: U, workout_session_id: id(701), headline: 'Solid push day', analysis: 'You hit every planned set. Bench is moving well, so the load goes up slightly next week.', issues: ['Overhead press reps dropped on the last set'], change_notes: ['Bench target raised'], prev_week: null, new_week: null, model: 'fixture', undone_at: null, created_at: '2026-11-09T12:00:00Z' }] : [];
  T.grocery_items = withPlan ? planA.grocery_list.map((g, i) => ({ id: id(1000 + i), user_id: U, week_start: WEEK, name: g.name, quantity: g.quantity, category: g.category, sort_order: i, is_purchased: i < 2, source_version_id: id(1) })) : [];
  T.prep_tasks = withPlan ? planA.prep_tasks.map((t, i) => ({ id: id(1100 + i), user_id: U, local_date: TODAY, task: t, sort_order: i, is_completed: i === 0, source_version_id: id(1) })) : [];
  T.agent_insights = withPlan ? [
    { id: id(1200), user_id: U, kind: 'protein', severity: 'watch', title: 'Protein is running low', body: 'Protein averages 128 g on logged days vs your 165 g target (78%).', data: {}, insight_date: TODAY, created_at: '2026-11-10T03:00:00Z', read_at: null, dismissed_at: null },
    { id: id(1201), user_id: U, kind: 'training', severity: 'good', title: 'Training is on plan', body: '4 sessions logged vs 4 planned this week.', data: {}, insight_date: TODAY, created_at: '2026-11-10T02:00:00Z', read_at: '2026-11-10T02:30:00Z', dismissed_at: null },
  ] : [];
  for (const k of ['agent_baseline', 'foods', 'water_logs', 'daily_checkins', 'daily_activity', 'push_subscriptions', 'reminders', 'progress_photos', 'push_notification_deliveries']) T[k] = [];
  return { tables: T, session: signedIn ? session : null, sessions: { [EMAIL]: session }, accounts: { [EMAIL]: PASSWORD }, calls: [] };
}

export const aiPlanResponse = (title = 'Refined plan, 2,000 kcal') => ({ plan: { ...planA, title, summary: 'Refined as requested.', targets: { ...planA.targets, calories_kcal: 2000 }, grocery_list: [{ name: 'Eggs', quantity: '30', category: 'PROTEIN' }, { name: 'Soya chunks', quantity: '500 g', category: 'PROTEIN' }], prep_tasks: ['Soak soya chunks'] }, model: 'fixture', prompt_version: 'the-cut-plan-v2' });
