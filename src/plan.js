import { esc, fmt, weekStart } from './lib/format.js';
import { diffPlans } from './lib/plandiff.js';
import { S } from './state.js';
import { $, SUPABASE_KEY, SUPABASE_URL, q, supabase } from './client.js';
import { ackState } from './coach.js';
import { ensureDay, ensureTemplates, loadDay } from './meals.js';
import { markListsStale } from './prep.js';
import { card, foldCard, pageHead, render } from './shell.js';
import { fail, toast, toastUndo, uiConfirm } from './ui.js';

const RF_KEY = () => 'cut_refine_' + (S.user?.id || 'x');

export function rfSave() {
  try {
    S.rf.text || S.rf.pending
      ? localStorage.setItem(RF_KEY(), JSON.stringify(S.rf))
      : localStorage.removeItem(RF_KEY());
  } catch {}
}

function rfEnsure() {
  if (!S.user || S.rfUid === S.user.id) return;
  S.rfUid = S.user.id;
  try {
    const d = JSON.parse(localStorage.getItem(RF_KEY()) || 'null');
    if (d && typeof d === 'object') S.rf = { text: String(d.text || '').slice(0, 4000), pending: d.pending || null };
  } catch {}
  // A pending marker found on a fresh page load means the request died with the old page.
  if (S.rf.pending && !S.aiBusy) {
    S.rfInterrupted = true;
    S.rf.pending = null;
    rfSave();
  }
}

function rfBusy() {
  return !!S.rf.pending && S.aiBusy;
}

function rfPaint() {
  const f = $('#aiRefineForm');
  if (!f) return;
  const b = f.querySelector('button[type=submit]'),
    t = f.querySelector('textarea'),
    busy = rfBusy();
  b.disabled = busy;
  b.classList.toggle('busy', busy);
  b.textContent = busy ? 'Thinking…' : 'Refine & apply';
  t.readOnly = busy;
  if (!busy && t.value !== S.rf.text) t.value = S.rf.text;
  f.querySelector('.rf-note')?.classList.toggle('hidden', !S.rfInterrupted);
}

function aiPlanStatusCard() {
  const draft = S.aiPlanHistory.find((x) => x.status === 'draft'),
    act = S.aiActivePlan,
    prev = S.aiPlanHistory.find((x) => x.status !== 'active' && x.status !== 'draft');
  const tg = (x) => {
    const t = x.plan?.targets || {};
    return fmt(t.calories_kcal) + ' kcal · ' + fmt(t.protein_g) + ' g protein';
  };
  let h = '';
  if (draft)
    h += `<section class="card plan-now"><div class="eyebrow">Draft waiting</div><h2>${esc(draft.title)}</h2><p class="muted small">${tg(draft)}</p><button class="btn primary" data-ai-apply="${draft.id}">Apply to my workspace</button></section>`;
  if (act)
    h += `<section class="card plan-now"><div class="eyebrow">Active plan</div><h2>${esc(act.title)}</h2><p class="muted small">${tg(act)}</p><div class="row wrap"><button class="btn" data-goto="meals">See meals</button>${prev ? `<button class="btn ghost" data-ai-restore="${prev.id}">Undo last change</button>` : ''}</div></section>`;
  return h;
}

export function aiPlannerPage() {
  const r = S.aiPlanDraft || S.aiPlanHistory.find((x) => x.status === 'active') || S.aiPlanHistory[0] || null,
    p = r?.inputs || {},
    v = (k, d = '') => esc(p[k] ?? d),
    opts = (k, a) => {
      const selected = p[k] === null || p[k] === undefined || p[k] === '' ? '' : String(p[k]);
      return (
        (selected === '' ? '<option value="" selected disabled>Choose…</option>' : '') +
        a.map(([x, y]) => `<option value="${x}" ${selected === String(x) ? 'selected' : ''}>${y}</option>`).join('')
      );
    };
  return `${pageHead('Personalized planning · AI assistant', 'AI Planner', 'Tell the AI about you. Your plan lands in Meals, Workout and Prep.')}
 <div class="notice u-mb13">Estimates only, not medical nutrition therapy. Every new plan applies straight away. You can undo it.</div>
 ${aiPlanStatusCard()}
 <div class="ai-page"><div class="grid g2 ai-forms">${(r ? foldCard : card)(
   'Your details',
   `<form id="aiIntakeForm" class="ai-intake-grid">
 <div class="ai-section-title ai-wide">01 · Body profile and goal</div><div class="field"><label>Age (18+)</label><input name="age_years" type="number" min="18" max="100" required value="${v('age_years')}" placeholder="Years"/></div><div class="field"><label>Sex for energy estimate</label><select name="sex">${opts(
   'sex',
   [
     ['prefer_not_to_say', 'Prefer not to say'],
     ['male', 'Male'],
     ['female', 'Female'],
   ]
 )}</select></div>
 <div class="field"><label>Height (cm)</label><input name="height_cm" type="number" min="120" max="230" step="0.1" required value="${v('height_cm')}" placeholder="cm"/></div><div class="field"><label>Weight (kg)</label><input name="weight_kg" type="number" min="30" max="350" step="0.1" required value="${v('weight_kg')}" placeholder="kg"/></div>
 <div class="field"><label>Target weight (kg)</label><input name="target_weight_kg" type="number" min="30" max="350" step="0.1" value="${v('target_weight_kg')}" placeholder="Optional"/></div><div class="field"><label>Goal</label><select name="goal" required>${opts(
   'goal',
   [
     ['fat_loss', 'Fat loss'],
     ['muscle_gain', 'Muscle gain'],
     ['recomposition', 'Body recomposition'],
     ['maintain', 'Maintain weight'],
     ['general_fitness', 'General fitness'],
   ]
 )}</select></div>
 <div class="field"><label>Activity level</label><select name="activity_level">${opts('activity_level', [
   ['sedentary', 'Mostly seated'],
   ['light', 'Light'],
   ['moderate', 'Moderate'],
   ['high', 'High'],
 ])}</select></div><div class="field"><label>Training experience</label><select name="training_experience">${opts(
   'training_experience',
   [
     ['beginner', 'Beginner'],
     ['intermediate', 'Intermediate'],
     ['advanced', 'Advanced'],
   ]
 )}</select></div>
 <div class="ai-section-title ai-wide">02 · Training schedule</div><div class="field"><label>Training days / week</label><input name="training_days_per_week" type="number" min="0" max="7" required value="${v('training_days_per_week')}" step="1" placeholder="0–7"/></div><div class="field"><label>Training access</label><select name="training_location" required>${opts(
   'training_location',
   [
     ['gym', 'Gym'],
     ['home', 'Home'],
     ['mixed', 'Both'],
     ['none', 'No current training'],
   ]
 )}</select></div>
 <div class="ai-section-title ai-wide">03 · Food and routine</div><div class="field"><label>Diet</label><select name="dietary_pattern" required>${opts(
   'dietary_pattern',
   [
     ['omnivore', 'Omnivore'],
     ['eggetarian', 'Eggetarian'],
     ['vegetarian', 'Vegetarian'],
     ['vegan', 'Vegan'],
   ]
 )}</select></div><div class="field"><label>Meals per day</label><select name="meals_per_day" required>${opts(
   'meals_per_day',
   [
     ['2', '2'],
     ['3', '3'],
     ['4', '4'],
     ['5', '5'],
     ['6', '6'],
   ]
 )}</select></div>
 <div class="field"><label>Daily budget (₹)</label><input name="food_budget_inr" type="number" min="0" max="100000" value="${v('food_budget_inr')}" placeholder="Optional"/></div><div class="field"><label>Cooking time (min / day)</label><input name="cooking_minutes" type="number" min="0" max="180" value="${v('cooking_minutes')}" placeholder="Optional"/></div>
 <div class="field"><label>Location / food market</label><input name="location" value="${v('location')}" placeholder="City, country"/></div><div class="field"><label>Timeline (weeks)</label><input name="goal_timeline_weeks" type="number" min="1" max="104" value="${v('goal_timeline_weeks')}" placeholder="Optional"/></div>
 <div class="ai-section-title ai-wide">04 · Constraints and preferences</div><div class="field ai-wide"><label>Allergies / foods to avoid</label><input name="allergies" value="${v('allergies')}" placeholder="Ingredients to exclude"/></div><div class="field ai-wide"><label>Foods you like</label><input name="food_preferences" value="${v('food_preferences')}" placeholder="Chicken, eggs, dal, rice, curd..."/></div>
 <div class="field ai-wide"><label>Preferred cuisines</label><input name="preferred_cuisines" value="${v('preferred_cuisines')}" placeholder="Indian home food, North Indian..."/></div><div class="field ai-wide"><label>Other constraints</label><textarea name="additional_notes" rows="3" placeholder="Work shifts, meal timing, equipment, disliked foods...">${v('additional_notes')}</textarea></div>
 <label class="row ai-wide u-fs12m"><input type="checkbox" name="adult_confirmed" required ${p.adult_confirmed ? 'checked' : ''}/> I am 18 or older and understand this is general wellness information, not medical advice.</label>
 <div class="ai-wide"><button class="btn primary" id="aiProfileAction" type="submit">${r ? 'Analyze edits & refine plan' : 'Generate my AI plan'}</button> ${r ? '<button class="btn" type="button" data-ai-generate-new>Generate a fresh plan</button>' : ''} <span class="ai-muted">Your profile stays editable. When you submit changes, the AI compares them with the previous plan, explains the implications and creates a reviewable draft.</span></div><div class="ai-wide ai-muted" id="aiEditPreview" aria-live="polite"></div></form>`
 )}
 ${r ? (rfEnsure(), card('Refine plan', `<form id="aiRefineForm"><div class="notice warn rf-note ${S.rfInterrupted ? '' : 'hidden'} u-mb10" role="status">Your last refine didn’t finish because the page was closed or reloaded. Your text is back below. Tap Refine &amp; apply to send it again.</div><div class="field"><textarea name="instruction" rows="2" required aria-label="What should change?" placeholder="e.g. swap paneer for tofu, shorter prep" ${rfBusy() ? 'readonly' : ''}>${esc(S.rf.text)}</textarea></div><button class="btn primary${rfBusy() ? ' busy' : ''}" type="submit" ${rfBusy() ? 'disabled' : ''}>${rfBusy() ? 'Thinking…' : 'Refine &amp; apply'}</button></form>`)) : ''}</div></div>`;
}

export async function callAIPlanner(action, profile, extra = {}) {
  const {
    data: { session: s },
  } = await supabase.auth.getSession();
  if (!s?.access_token) throw new Error('Session expired. Sign in again.');
  const r = await fetch(SUPABASE_URL + '/functions/v1/the-cut-ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token, apikey: SUPABASE_KEY },
    body: JSON.stringify({ action, profile, ...extra }),
  });
  let d = {};
  try {
    d = await r.json();
  } catch {}
  if (!r.ok) throw new Error(d.error || 'AI request failed.');
  return d;
}

function readAIProfile(form) {
  const f = new FormData(form),
    raw = (k) => {
      const x = f.get(k);
      return x === null || x === '' ? null : x;
    },
    num = (k) => (raw(k) === null ? null : Number(raw(k)));
  return {
    adult_confirmed: f.get('adult_confirmed') === 'on',
    age_years: num('age_years'),
    sex: raw('sex'),
    height_cm: num('height_cm'),
    weight_kg: num('weight_kg'),
    target_weight_kg: num('target_weight_kg'),
    goal: raw('goal'),
    activity_level: raw('activity_level'),
    training_experience: raw('training_experience'),
    training_days_per_week: num('training_days_per_week'),
    training_location: raw('training_location'),
    dietary_pattern: raw('dietary_pattern'),
    meals_per_day: num('meals_per_day'),
    food_budget_inr: num('food_budget_inr'),
    cooking_minutes: num('cooking_minutes'),
    location: raw('location'),
    goal_timeline_weeks: num('goal_timeline_weeks'),
    allergies: raw('allergies') || '',
    food_preferences: raw('food_preferences') || '',
    preferred_cuisines: raw('preferred_cuisines') || '',
    additional_notes: raw('additional_notes') || '',
  };
}

function collectAIProfile(form) {
  const p = readAIProfile(form);
  if (!p.adult_confirmed || p.age_years === null || p.age_years < 18)
    throw new Error('This planner is for adults aged 18 and above. Enter your age and confirm the checkbox.');
  if (
    p.height_cm === null ||
    p.height_cm < 120 ||
    p.height_cm > 230 ||
    p.weight_kg === null ||
    p.weight_kg < 30 ||
    p.weight_kg > 350
  )
    throw new Error('Enter a valid height (120–230 cm) and current weight (30–350 kg).');
  if (!p.goal || !p.dietary_pattern || !p.training_location || p.meals_per_day === null)
    throw new Error('Choose a goal, dietary pattern, training access and meals per day.');
  if (!Number.isInteger(p.training_days_per_week) || p.training_days_per_week < 0 || p.training_days_per_week > 7)
    throw new Error('Enter training days as a whole number from 0 to 7.');
  if (p.food_budget_inr !== null && (p.food_budget_inr < 0 || p.food_budget_inr > 100000))
    throw new Error('Check your daily food budget.');
  if (p.cooking_minutes !== null && (p.cooking_minutes < 0 || p.cooking_minutes > 180))
    throw new Error('Check your daily cooking time.');
  return p;
}

const AI_PROFILE_LABELS = {
  age_years: 'Age',
  sex: 'Sex for energy estimate',
  height_cm: 'Height',
  weight_kg: 'Current weight',
  target_weight_kg: 'Target weight',
  goal: 'Goal',
  activity_level: 'Activity level',
  training_experience: 'Training experience',
  training_days_per_week: 'Training days per week',
  training_location: 'Training access',
  dietary_pattern: 'Diet',
  meals_per_day: 'Meals per day',
  food_budget_inr: 'Daily food budget',
  cooking_minutes: 'Cooking time per day',
  location: 'Location / food market',
  goal_timeline_weeks: 'Goal timeline',
  allergies: 'Allergies / foods to avoid',
  food_preferences: 'Foods liked',
  preferred_cuisines: 'Preferred cuisines',
  additional_notes: 'Other constraints',
};

export function getAIBasePlan() {
  return (
    S.aiPlanHistory.find((x) => x.id === S.aiPlanDraft?.id) ||
    S.aiPlanHistory.find((x) => x.status === 'active') ||
    S.aiPlanHistory[0] ||
    null
  );
}

function describeAIProfileChanges(before = {}, after = {}) {
  return Object.keys(AI_PROFILE_LABELS)
    .filter((k) => String(before[k] ?? '') !== String(after[k] ?? ''))
    .map((k) => ({ key: k, label: AI_PROFILE_LABELS[k], from: before[k] ?? null, to: after[k] ?? null }));
}

function aiProfileValue(value, key) {
  if (value === null || value === undefined || value === '') return 'Not set';
  const unit =
    {
      height_cm: ' cm',
      weight_kg: ' kg',
      target_weight_kg: ' kg',
      food_budget_inr: ' ₹/day',
      cooking_minutes: ' min/day',
      goal_timeline_weeks: ' weeks',
      training_days_per_week: ' days/week',
      age_years: ' years',
    }[key] || '';
  return String(value) + unit;
}

function buildAIEditInstruction(base, profile, changes, extraText = '') {
  const diff = changes.length
    ? changes
        .map((x) => '- ' + x.label + ': ' + aiProfileValue(x.from, x.key) + ' → ' + aiProfileValue(x.to, x.key))
        .join('\n')
    : 'No profile fields changed.';
  return [
    'Act as a context-aware nutrition and training planning agent, not a one-shot form generator.',
    'The saved plan is the baseline. The UPDATED PROFILE supplied with this request is the source of truth for the revised plan.',
    'PROFILE EDITS FROM THE USER:\n' + diff,
    extraText ? 'USER MESSAGE:\n' + extraText : '',
    'Analyze the practical impact of these edits. Explain relevant effects on energy needs, calorie and macro targets, meal count and portions, food cost, prep effort, training volume, recovery and adherence. Identify conflicts or unsafe/unsustainable requests instead of blindly agreeing.',
    'Use the plan summary and rationale to provide concise, specific insights: what changed, why the revised plan differs, important trade-offs, and the most useful next action. Update assumptions and safety notes when relevant. Keep all recommendations consistent with the updated profile and the supplied structured output schema.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function saveAIDraft(result, profile) {
  const r = await q(
    supabase
      .from('ai_plan_versions')
      .insert({
        user_id: S.user.id,
        title: result.plan.title,
        status: 'draft',
        inputs: profile,
        plan: result.plan,
        model: result.model,
        prompt_version: result.prompt_version,
      })
      .select()
      .single()
  );
  S.aiPlanHistory = [r, ...S.aiPlanHistory.filter((x) => x.id !== r.id)];
  S.aiPlanDraft = r;
  if (!(await applyAIPlan(r.id, { auto: true }))) await render();
}

export function updateAIEditPreview() {
  const el = $('#aiEditPreview'),
    form = $('#aiIntakeForm');
  if (!el || !form) return;
  const base = getAIBasePlan();
  if (!base) {
    el.textContent =
      'Your first plan starts with a blank profile. Complete the fields above; nothing is assumed or copied from unrelated tracker settings.';
    return;
  }
  const changes = describeAIProfileChanges(base.inputs || {}, readAIProfile(form));
  el.textContent = changes.length
    ? changes.length +
      ' unsent profile edit(s): ' +
      changes.map((x) => x.label).join(' · ') +
      '. Submit to let the AI assess their impact and create a revised draft.'
    : 'No unsent profile edits. Use the AI message box to ask a question or request a change.';
}

export function setAIProgress(action) {
  clearInterval(S.aiProgTimer);
  S.aiProgTimer = null;
  let el = document.getElementById('aiProg');
  if (!action) {
    el?.remove();
    return;
  }
  const msgs =
    action === 'workout'
      ? [
          'Reading your sets…',
          'Comparing with your history…',
          'Weighing your feedback…',
          'Adjusting your training week…',
          'Almost there…',
        ]
      : action === 'refine'
        ? [
            'Reading your plan…',
            'Rebalancing macros…',
            'Swapping foods…',
            'Checking portions and prep…',
            'Almost there…',
          ]
        : ['Calculating your targets…', 'Designing your meals…', 'Building your training week…', 'Almost there…'];
  if (!el) {
    el = document.createElement('div');
    el.id = 'aiProg';
    el.setAttribute('role', 'status');
    el.innerHTML =
      '<span class="aiprog-orb" aria-hidden="true"></span><span class="aiprog-txt"></span><i class="aiprog-bar" aria-hidden="true"></i>';
    document.body.appendChild(el);
  }
  let i = 0;
  const t = el.querySelector('.aiprog-txt');
  t.textContent = msgs[0];
  S.aiProgTimer = setInterval(() => {
    i = Math.min(i + 1, msgs.length - 1);
    t.textContent = msgs[i];
  }, 3500);
}

export function planChangeCard() {
  const c = S.lastPlanChange;
  if (!c) return '';
  return `<section class="card plan-change"><div class="row between"><div class="eyebrow">${c.restored ? 'Plan restored' : 'Plan updated · What changed'}</div><button class="btn sm ghost" data-dismiss-change aria-label="Dismiss">✕</button></div><h2>${esc(c.title)}</h2>${c.summary && !c.restored ? `<p class="muted small clamp3">${esc(c.summary)}</p>` : ''}<ul class="chg">${c.lines.map((l) => `<li><b>${esc(l.label)}</b><span>${esc(l.detail)}</span></li>`).join('')}</ul>${c.prevId ? `<button class="btn" data-ai-restore="${esc(c.prevId)}">Undo this change</button>` : ''}</section>`;
}

export async function runAIPlanRequest(action, profile, extra, button, workingLabel, idleLabel, onResult) {
  if (S.aiBusy) return false;
  let ok = false;
  try {
    S.aiBusy = true;
    setAIProgress(action === 'refine' ? 'refine' : 'generate');
    if (button) {
      button.disabled = true;
      button.classList.add('busy');
      button.textContent = workingLabel;
    }
    const result = await callAIPlanner(action, profile, extra);
    if (onResult) onResult();
    await saveAIDraft(result, profile);
    ok = true;
  } catch (e) {
    fail(e);
  } finally {
    S.aiBusy = false;
    setAIProgress(null);
    if (button && button.isConnected) {
      button.disabled = false;
      button.classList.remove('busy');
      button.textContent = idleLabel;
    }
    rfPaint();
  }
  return ok;
}

export async function generateAIPlan(e) {
  e.preventDefault();
  if (S.aiBusy) return;
  const form = e.currentTarget,
    button = form.querySelector('#aiProfileAction');
  try {
    const profile = collectAIProfile(form),
      base = getAIBasePlan();
    if (base) {
      const changes = describeAIProfileChanges(base.inputs || {}, profile);
      if (!changes.length)
        throw new Error('No profile fields have changed. Edit a field or use the AI message box to ask a question.');
      const instruction = buildAIEditInstruction(base, profile, changes);
      await runAIPlanRequest(
        'refine',
        profile,
        { instruction, current_plan_id: base.id },
        button,
        'Analyzing edits…',
        'Analyze edits & refine plan'
      );
    } else await runAIPlanRequest('generate', profile, {}, button, 'Generating…', 'Generate my AI plan');
  } catch (e) {
    fail(e);
  }
}

export async function generateFreshAIPlan(button) {
  try {
    const form = $('#aiIntakeForm'),
      profile = collectAIProfile(form);
    await runAIPlanRequest('generate', profile, {}, button, 'Generating fresh plan…', 'Generate a fresh plan');
  } catch (e) {
    fail(e);
  }
}

export async function refineAIPlan(e) {
  e.preventDefault();
  if (S.aiBusy) return;
  const form = e.currentTarget,
    button = form.querySelector('button[type=submit]'),
    base = getAIBasePlan(),
    message = String(new FormData(form).get('instruction') || '').trim();
  if (!base) return;
  try {
    const profile = collectAIProfile($('#aiIntakeForm')),
      changes = describeAIProfileChanges(base.inputs || {}, profile);
    const instruction = buildAIEditInstruction(base, profile, changes, message);
    S.rf.text = message;
    S.rf.pending = { at: Date.now(), planId: base.id };
    S.rfInterrupted = false;
    rfSave();
    try {
      await runAIPlanRequest(
        'refine',
        profile,
        { instruction, current_plan_id: base.id },
        button,
        'Thinking…',
        'Refine & apply',
        () => {
          S.rf.text = '';
          S.rf.pending = null;
          rfSave();
        }
      );
    } finally {
      if (S.rf.pending) {
        S.rf.pending = null;
        rfSave();
      }
      rfPaint();
    }
  } catch (e) {
    fail(e);
  }
}

async function applyAIPlanCore(id, opts = {}) {
  const record = S.aiPlanHistory.find((x) => x.id === id);
  if (!record || record.status === 'active') return false;
  const prevId = S.aiActivePlan?.id || null,
    prevPlan = S.aiActivePlan?.plan || null;
  if (
    !opts.auto &&
    !opts.quiet &&
    !(await uiConfirm(
      'Apply this plan?',
      'Active meal templates will be archived and targets updated. Your grocery list and prep are rebuilt from the new plan. Completed and historical meal logs are kept.',
      { confirm: 'Apply plan' }
    ))
  )
    return;
  try {
    const result = await q(
      supabase.rpc('apply_ai_plan_version', { p_version_id: id, p_local_date: S.date, p_week_start: weekStart(S.date) })
    );
    await ensureTemplates();
    await ensureDay(S.date);
    await loadDay();
    S.aiPlanHistory = await q(
      supabase
        .from('ai_plan_versions')
        .select('*')
        .eq('user_id', S.user.id)
        .order('created_at', { ascending: false })
        .limit(10)
    );
    S.aiPlanDraft = S.aiPlanHistory.find((x) => x.id === id) || null;
    S.settings = {
      ...S.settings,
      calorie_target: record.plan.targets.calories_kcal,
      protein_target_g: record.plan.targets.protein_g,
      carbs_target_g: record.plan.targets.carbs_g,
      fat_target_g: record.plan.targets.fat_g,
      fiber_target_g: record.plan.targets.fibre_g,
      water_target_ml: record.plan.targets.water_ml,
    };
    await loadActivePlan();
    S.aiUnlocked = true;
    S.lastPlanChange = {
      title: record.title,
      summary: record.plan?.summary || '',
      lines: diffPlans(prevPlan, record.plan),
      prevId: opts.quiet ? null : prevId,
      restored: !!opts.quiet,
    };
    if (opts.quiet) {
      await render();
      toast('Restored that plan.');
    } else if (opts.auto) {
      const onPlan = S.tab === 'ai';
      if (onPlan) S.tab = 'meals';
      await render();
      toastUndo(
        onPlan ? 'Plan applied. Here is what changed.' : 'Your plan was updated. Check Meals for what changed.',
        prevId ? () => applyAIPlan(prevId, { quiet: true }) : null
      );
    } else {
      toast('AI plan applied. ' + (result?.meal_templates_created || 0) + ' meal templates are now active.');
      await render();
    }
    return true;
  } catch (e) {
    fail(e);
    toast('Plan was not applied. No partial database changes were committed.');
    return false;
  }
}

export async function loadModule() {
  if (S.tab === 'account') await loadPlanHistory();
  if (S.tab === 'ai') {
    S.aiPlanHistory = await q(
      supabase
        .from('ai_plan_versions')
        .select('*')
        .eq('user_id', S.user.id)
        .order('created_at', { ascending: false })
        .limit(10)
    );
    if (!S.aiPlanDraft || !S.aiPlanHistory.some((x) => x.id === S.aiPlanDraft.id))
      S.aiPlanDraft =
        S.aiPlanHistory.find((x) => x.status === 'draft') ||
        S.aiPlanHistory.find((x) => x.status === 'active') ||
        S.aiPlanHistory[0] ||
        null;
  }
}

/* every plan edit that reaches the database is reviewed by the coach after a short debounce, and applying a plan acknowledges the coach state */
export async function applyAIPlan(...a) {
  markListsStale();
  const r = await applyAIPlanCore(...a);
  try {
    ackState();
  } catch (e) {}
  return r;
}

export async function loadActivePlan() {
  const r = await q(
    supabase
      .from('ai_plan_versions')
      .select('*')
      .eq('user_id', S.user.id)
      .eq('status', 'active')
      .order('applied_at', { ascending: false, nullsFirst: false })
      .limit(1)
  );
  S.aiActivePlan = r[0] || null;
}

export async function loadPlanHistory() {
  S.aiPlanHistory = await q(
    supabase
      .from('ai_plan_versions')
      .select('*')
      .eq('user_id', S.user.id)
      .order('created_at', { ascending: false })
      .limit(10)
  );
}
