import { today, esc, fmt, dateFmt } from './lib/format.js';
import { S } from './state.js';
import { q, supabase } from './client.js';
import { scheduleAssess } from './coach.js';
import { planChangeCard } from './plan.js';
import { after, bar3, card, needsPlanCard, pageHead, render } from './shell.js';
import { fail, toast, uiConfirm, uiForm } from './ui.js';

export async function ensureTemplates() {
  let all = await q(
    supabase.from('meal_templates').select('*,meal_template_items(*)').eq('user_id', S.user.id).order('sort_order')
  );
  S.templateHistory = all;
  S.templates = all.filter((t) => t.is_active);
}

export async function ensureDay(d) {
  const rows = await q(
    supabase.from('daily_meals').select('id,meal_template_id').eq('user_id', S.user.id).eq('local_date', d)
  );
  const existing = new Set(rows.map((x) => x.meal_template_id));
  const add = S.templates
    .filter((t) => t.is_active && !existing.has(t.id))
    .map((t) => ({
      user_id: S.user.id,
      local_date: d,
      meal_template_id: t.id,
      meal_name: t.name,
      planned_time: t.planned_time,
      status: 'planned',
    }));
  if (add.length) await q(supabase.from('daily_meals').insert(add));
}

export async function loadDay() {
  await ensureDay(S.date);
  let [meals, entries, prep] = await Promise.all([
    q(supabase.from('daily_meals').select('*').eq('user_id', S.user.id).eq('local_date', S.date).order('planned_time')),
    q(supabase.from('food_entries').select('*').eq('user_id', S.user.id).eq('local_date', S.date).order('consumed_at')),
    q(supabase.from('prep_tasks').select('*').eq('user_id', S.user.id).eq('local_date', S.date).order('sort_order')),
  ]);
  S.day = { meals, entries, prep };
}

function getTemplate(meal) {
  return (
    S.templates.find((t) => t.id === meal.meal_template_id) ||
    S.templateHistory.find((t) => t.id === meal.meal_template_id)
  );
}

function mealPlanTotals() {
  return S.day.meals
    .filter((m) => m.status === 'completed')
    .reduce(
      (a, m) => {
        let t = getTemplate(m);
        let total = t?.meal_template_items?.find((i) => i.food_name_snapshot === '__plan_total__');
        a.k += Number(total?.calories_kcal || 0);
        a.p += Number(total?.protein_g || 0);
        return a;
      },
      { k: 0, p: 0 }
    );
}

export function totals() {
  let x = mealPlanTotals();
  return {
    k: x.k + S.day.entries.reduce((s, e) => s + Number(e.calories_kcal || 0), 0),
    p: x.p + S.day.entries.reduce((s, e) => s + Number(e.protein_g || 0), 0),
    carbs: S.day.entries.reduce((s, e) => s + Number(e.carbs_g || 0), 0),
    fat: S.day.entries.reduce((s, e) => s + Number(e.fat_g || 0), 0),
  };
}

export async function changeDate(d) {
  if (!d || d > today()) return;
  S.date = d;
  await loadDay();
  render();
}

export async function toggleMeal(m) {
  let status = m.status === 'completed' ? 'planned' : 'completed';
  await q(
    supabase
      .from('daily_meals')
      .update({ status, completed_at: status === 'completed' ? new Date().toISOString() : null })
      .eq('id', m.id)
      .eq('user_id', S.user.id)
  );
  await loadDay();
  render();
}

function mealRows() {
  return (
    S.day.meals
      .map((m, i) => {
        let t = getTemplate(m),
          plan = t?.meal_template_items || [],
          tot = plan.find((x) => x.food_name_snapshot === '__plan_total__');
        return `<div class="meal"><div class="meal-index">0${i + 1}</div><div><h3>${esc(m.meal_name)}</h3><div class="meta">${(m.planned_time || '').slice(0, 5)} · ${plan
          .filter((x) => x.food_name_snapshot !== '__plan_total__')
          .map((x) => `${esc(x.food_name_snapshot)} (${esc(x.unit)})`)
          .join(
            ' · '
          )}</div></div><div class="kcal">${fmt(tot?.calories_kcal)} <small>kcal · ${fmt(tot?.protein_g)} g protein</small></div><div class="row meal-action"><button class="check ${m.status === 'completed' ? 'done' : ''}" data-meal="${m.id}" title="Mark complete">${m.status === 'completed' ? '✓' : '○'}</button></div></div>`;
      })
      .join('') || '<div class="empty">No meal templates. Add one in Nutrition.</div>'
  );
}

async function addMealTemplateCore() {
  const saved = await uiForm({
    title: 'Add a meal',
    submit: 'Add meal',
    intro: 'It joins your active plan. Calories and protein are estimates for the whole meal.',
    fields: [
      { name: 'name', label: 'Meal name', required: true, maxlength: 60, placeholder: 'e.g. Post-workout shake' },
      { name: 'time', label: 'Planned time', type: 'time', required: true, value: '12:00' },
      {
        name: 'kcal',
        label: 'Calories (kcal)',
        type: 'number',
        min: 0,
        max: 5000,
        step: 1,
        inputmode: 'numeric',
        value: '300',
      },
      {
        name: 'protein',
        label: 'Protein (g)',
        type: 'number',
        min: 0,
        max: 500,
        step: 0.1,
        inputmode: 'decimal',
        value: '25',
      },
      {
        name: 'parts',
        label: 'Components (optional)',
        type: 'textarea',
        rows: 4,
        placeholder: 'One per line: ingredient | portion\nchicken breast | 150 g raw',
        full: true,
      },
    ],
    validate: (v) => {
      if (!v.name.trim()) return 'Give the meal a name.';
      if (!/^\d{2}:\d{2}$/.test(v.time)) return 'Choose a planned time.';
      return '';
    },
    onSubmit: async (v) => {
      const t = await q(
        supabase
          .from('meal_templates')
          .insert({
            user_id: S.user.id,
            name: v.name.trim(),
            sort_order: S.templates.length,
            planned_time: v.time + ':00',
            is_active: true,
          })
          .select()
          .single()
      );
      const items = v.parts
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x, i) => {
          const [food, unit = '1 serving'] = x.split('|').map((y) => y.trim());
          return {
            user_id: S.user.id,
            meal_template_id: t.id,
            food_name_snapshot: food,
            unit,
            quantity: 1,
            sort_order: i,
          };
        });
      items.push({
        user_id: S.user.id,
        meal_template_id: t.id,
        food_name_snapshot: '__plan_total__',
        unit: 'plan estimate',
        quantity: 1,
        calories_kcal: Number(v.kcal) || 0,
        protein_g: Number(v.protein) || 0,
        sort_order: 99,
      });
      await q(supabase.from('meal_template_items').insert(items));
    },
  });
  if (!saved) return;
  try {
    S.templates = await q(
      supabase
        .from('meal_templates')
        .select('*,meal_template_items(*)')
        .eq('user_id', S.user.id)
        .eq('is_active', true)
        .order('sort_order')
    );
    await ensureDay(S.date);
    toast('Meal added');
    await after();
  } catch (e) {
    fail(e);
  }
}

export async function saveFood(e) {
  e.preventDefault();
  let f = new FormData(e.currentTarget),
    o = { user_id: S.user.id, local_date: S.date, consumed_at: new Date().toISOString() };
  ['food_name_snapshot', 'unit'].forEach((k) => (o[k] = f.get(k)));
  ['quantity', 'calories_kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'].forEach(
    (k) => (o[k] = Number(f.get(k) || 0))
  );
  try {
    let food = await q(
      supabase
        .from('foods')
        .insert({
          user_id: S.user.id,
          name: o.food_name_snapshot,
          serving_label: o.unit,
          calories_kcal: o.calories_kcal,
          protein_g: o.protein_g,
          carbs_g: o.carbs_g,
          fat_g: o.fat_g,
          fiber_g: o.fiber_g,
        })
        .select()
        .single()
    );
    o.food_id = food.id;
    await q(supabase.from('food_entries').insert(o));
    toast('Food entry saved and added to your food library');
    await after();
  } catch (e) {
    fail(e);
  }
}

export async function deleteFood(id) {
  if (!(await uiConfirm('Delete?', 'Delete this food entry?', { confirm: 'Delete', danger: true }))) return;
  await q(supabase.from('food_entries').delete().eq('id', id).eq('user_id', S.user.id));
  await after();
}

export async function addMealTemplate(...a) {
  const r = await addMealTemplateCore(...a);
  try {
    scheduleAssess();
  } catch (e) {}
  return r;
}

/* ---------- Meals ---------- */
export function mealsV3() {
  if (!S.aiActivePlan)
    return pageHead('Diet', 'Meals', 'Your daily meals, from your plan.') + needsPlanCard('logging meals');
  const t = totals(),
    tg = S.aiActivePlan.plan?.targets || {};
  return `${pageHead('Diet · ' + dateFmt(S.date), 'Meals', 'Tick each meal as you eat it. Log anything extra below.')}${planChangeCard()}
 <div class="mpage"><div class="grid g2 m-top">${card('Today vs your plan', bar3('Calories', t.k, tg.calories_kcal, 'kcal') + bar3('Protein', t.p, tg.protein_g, 'g'))}
 ${card('Add something extra', `<form id="foodForm" class="formgrid"><div class="field full"><label>What did you eat?</label><input name="food_name_snapshot" required placeholder="e.g. protein shake"/></div><div class="field"><label>Calories</label><input name="calories_kcal" type="number" min="0" step="0.1" inputmode="decimal" value="" required/></div><div class="field"><label>Protein (g)</label><input name="protein_g" type="number" min="0" step="0.1" inputmode="decimal" value="0"/></div><input type="hidden" name="quantity" value="1"/><input type="hidden" name="unit" value="serving"/><input type="hidden" name="carbs_g" value="0"/><input type="hidden" name="fat_g" value="0"/><input type="hidden" name="fiber_g" value="0"/><button class="btn primary full">Add</button></form>`)}</div>
 <div class="m-meals u-mt16">${card('Your meals', mealRows() + `<div class="row wrap u-mt12"><button class="btn" id="addMealTemplate">+ Add a meal</button></div>`)}</div>
 ${S.day.entries.length ? `<div class="m-extras u-mt16">${card('Extras logged', S.day.entries.map((e) => `<div class="listitem"><div class="grow"><strong>${esc(e.food_name_snapshot)}</strong><small>${fmt(e.calories_kcal)} kcal · ${fmt(e.protein_g)} g protein</small></div><button class="btn sm danger" data-delfood="${e.id}">Delete</button></div>`).join(''))}</div>` : ''}</div>`;
}
