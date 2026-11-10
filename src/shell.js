import { esc, today, shift, fmt } from './lib/format.js';
import { S } from './state.js';
import { accountV3, wireAccount } from './account.js';
import { renderAuthV2 } from './auth.js';
import { $, pwc, q, supabase } from './client.js';
import {
  bellHTML,
  coachPanel,
  loadInsights,
  openBellMenu,
  runAssess,
  saveTrainingWeek,
  subscribeInsights,
  wireCoach,
} from './coach.js';
import { fbResume, undoWorkoutReview } from './feedback.js';
import {
  addMealTemplate,
  changeDate,
  deleteFood,
  ensureDay,
  ensureTemplates,
  loadDay,
  mealsV3,
  saveFood,
  toggleMeal,
} from './meals.js';
import {
  aiPlannerPage,
  applyAIPlan,
  generateAIPlan,
  generateFreshAIPlan,
  loadActivePlan,
  loadModule,
  loadPlanHistory,
  refineAIPlan,
  rfSave,
  updateAIEditPreview,
} from './plan.js';
import { addGroceryV2, addPrep, deleteRow, loadGroceries, prepV3, updateGrocery, updatePrep } from './prep.js';
import { fail, toast } from './ui.js';
import { loadWeight, saveWeightV3, weightV3 } from './weight.js';
import { loadWkHistory, wireWk, wkBegin, workoutV3 } from './workout.js';

export async function bootstrap() {
  S.user = S.session.user;
  if (!S.user) {
    renderAuthV2();
    return;
  }
  $('#root').innerHTML =
    '<div class="authwrap"><div class="authcard"><span class="loader"></span> Loading your workspace…</div></div>';
  try {
    let [pr, st] = await Promise.all([
      q(supabase.from('profiles').select('*').eq('id', S.user.id).maybeSingle()),
      q(supabase.from('user_settings').select('*').eq('user_id', S.user.id).maybeSingle()),
    ]);
    if (!pr)
      await q(
        supabase.from('profiles').upsert({
          id: S.user.id,
          display_name: S.user.user_metadata?.name || S.user.email?.split('@')[0] || 'Member',
          timezone: 'Asia/Kolkata',
        })
      );
    if (!st)
      await q(
        supabase.from('user_settings').upsert({
          user_id: S.user.id,
          calorie_target: 1566,
          protein_target_g: 139,
          carbs_target_g: 105.3,
          fat_target_g: 64.4,
          water_target_ml: 2500,
        })
      );
    S.settings = st || {
      calorie_target: 1566,
      protein_target_g: 139,
      carbs_target_g: 105.3,
      fat_target_g: 64.4,
      water_target_ml: 2500,
    };
    if (st && (st.carbs_target_g == null || st.fat_target_g == null)) {
      S.settings = { ...st, carbs_target_g: st.carbs_target_g ?? 105.3, fat_target_g: st.fat_target_g ?? 64.4 };
      await q(
        supabase.from('user_settings').upsert({
          user_id: S.user.id,
          carbs_target_g: S.settings.carbs_target_g,
          fat_target_g: S.settings.fat_target_g,
        })
      );
    }
    await ensureTemplates();
    await ensureDay(S.date);
    await loadDay();
    await initV2(pr);
    render();
  } catch (e) {
    fail(e);
    $('#root').innerHTML =
      '<div class="authwrap"><div class="authcard"><h2>Could not load your workspace</h2><p class="muted">' +
      esc(e.message) +
      '</p><button class="btn primary" id="retryBtn">Retry</button></div></div>';
    $('#retryBtn').onclick = () => location.reload();
  }
}

const NAV_ITEMS = [
  ['ai', '✦', 'Plan', 'Plan'],
  ['meals', '◉', 'Meals', 'Meals'],
  ['workout', '↗', 'Workout', 'Workout'],
  ['weight', '▤', 'Weight', 'Weight'],
  ['coach', '◈', 'Coach', 'Coach'],
  ['prep', '▣', 'Prep & Grocery', 'Prep'],
];

const LEGACY_TABS = {
  overview: 'ai',
  nutrition: 'meals',
  habits: 'meals',
  training: 'workout',
  progress: 'weight',
  planning: 'prep',
  analytics: 'ai',
  settings: 'ai',
};

function navBtn([id, ico, label, short], mobile) {
  const locked = !S.aiUnlocked && id !== 'ai',
    cls = (S.tab === id ? 'active' : '') + (locked ? ' locked' : '') + (id === 'ai' ? ' ai-first' : '');
  return mobile
    ? `<button data-tab="${id}" class="${cls}" ${locked ? 'aria-disabled="true"' : ''}><span>${locked ? '🔒' : ico}</span>${short}</button>`
    : `<button class="${cls}" data-tab="${id}" ${locked ? 'aria-disabled="true" title="Generate your first AI plan to unlock"' : ''}><span class="ico">${ico}</span>${label}${locked ? '<span class="lock">🔒</span>' : ''}</button>`;
}

function nav() {
  return `<aside class="sidebar"><div class="brand"><div class="mark"></div><div><b>THE CUT<span>.</span></b><small>YOUR WORKSPACE</small></div></div><div class="nav-label">YOUR WORKSPACE</div><nav class="nav">${NAV_ITEMS.map((x) => navBtn(x)).join('')}</nav><div class="side-spacer"></div><div class="sidebar-note"><strong>THE DAILY RULE</strong>Make the next good choice. Then repeat.</div><div class="side-status"><i class="dot"></i>Cloud sync enabled</div></aside>`;
}

function header() {
  return `<header class="topbar${DATE_TABS.includes(S.tab) ? '' : ' nodate'}"><div class="crumb">THE CUT / <b>${(NAV_ITEMS.find((x) => x[0] === S.tab) || [0, 0, S.tab])[2].toUpperCase()}</b></div><div class="top-actions"><button class="pill" id="prev">←</button><input type="date" id="date" value="${S.date}" max="${today()}" class="u-topdate"/><button class="pill" id="next" ${S.date >= today() ? 'disabled' : ''}>→</button><button class="pill" id="bell" title="Coach insights" aria-label="Coach insights">${bellHTML()}</button><span class="pill">${esc(S.user.email)}</span><button class="userpill" id="acctBtn" title="Account" aria-label="Account menu" aria-haspopup="menu" aria-expanded="false">${esc((S.user.user_metadata?.name || S.user.email || 'U').slice(0, 1).toUpperCase())}</button></div></header>`;
}

export function pageHead(k, title, sub, extra = '') {
  return `<div class="pagehead"><div><div class="eyebrow">${k}</div><h1>${title}<em>.</em></h1><p class="subtitle">${sub}</p></div>${extra}</div>`;
}

export function foldCard(title, body) {
  return `<details class="card fold"><summary>${title}<span class="muted small">Edit</span></summary>${body}</details>`;
}

export function card(title, body, extra = '') {
  return `<section class="card"><div class="section-title"><h2>${title}</h2>${extra}</div>${body}</section>`;
}

export function metric(label, value, unit, foot) {
  return `<div class="card metric"><div class="label">${label}</div><strong>${value} <span class="muted u-fs13">${unit}</span></strong><small>${foot}</small></div>`;
}

export async function render() {
  S.tab = LEGACY_TABS[S.tab] || S.tab;
  if (!S.aiUnlocked && S.tab !== 'ai' && S.tab !== 'account') S.tab = 'ai';
  let root = $('#root');
  root.innerHTML = `<div class="app">${nav()}<main class="main">${header()}<div class="page" id="pagebody"><span class="loader"></span> Loading…</div></main></div><div class="mobilebar">${NAV_ITEMS.map((x) => navBtn(x, true)).join('')}</div>`;
  const mobileBar = root.querySelector('.mobilebar');
  const activeNav = mobileBar?.querySelector('.active');
  if (mobileBar && activeNav && window.innerWidth <= 860)
    mobileBar.scrollLeft = Math.max(0, activeNav.offsetLeft - (mobileBar.clientWidth - activeNav.offsetWidth) / 2);
  try {
    await loadActivePlan();
    if (S.tab === 'ai' || S.tab === 'account') await loadModule();
    if (S.tab === 'weight') await loadWeight();
    if (S.tab === 'prep') await loadGroceries();
    if (S.tab === 'workout' || S.tab === 'coach') {
      await loadPlanHistory();
      if (S.tab === 'workout' && S.aiActivePlan && !S.wkHist) {
        try {
          await loadWkHistory();
        } catch (e) {
          console.error(e);
          S.wkHist = {};
        }
      }
    }
    await loadInsights();
    $('#pagebody').innerHTML = {
      ai: aiPlannerPage,
      meals: mealsV3,
      workout: workoutV3,
      weight: weightV3,
      account: accountV3,
      coach: () =>
        S.aiActivePlan ? coachPanel(true) : pageHead('COACH', 'Coach', 'Your plan coach.') + needsPlanCard('coaching'),
      prep: prepV3,
    }[S.tab]();
    wire();
    wireV2();
    wireV3();
    if (S.tab === 'workout' && S.wk) wireWk();
    if (S.tab === 'workout') fbResume();
  } catch (e) {
    fail(e);
    $('#pagebody').innerHTML = `<div class="notice warn">${esc(e.message)}</div>`;
  }
}

function wire() {
  document.querySelectorAll('[data-tab]').forEach(
    (b) =>
      (b.onclick = async () => {
        await gotoTab(b.dataset.tab);
      })
  );
  document.querySelectorAll('[data-goto]').forEach(
    (b) =>
      (b.onclick = async () => {
        await gotoTab(b.dataset.goto);
      })
  );
  $('#prev').onclick = () => changeDate(shift(S.date, -1));
  $('#next').onclick = () => changeDate(shift(S.date, 1));
  $('#date').onchange = (e) => changeDate(e.target.value);
  document
    .querySelectorAll('[data-meal]')
    .forEach((b) => (b.onclick = () => toggleMeal(S.day.meals.find((x) => x.id === b.dataset.meal)).catch(fail)));
  $('#addMealTemplate')?.addEventListener('click', addMealTemplate);
  $('#foodForm')?.addEventListener('submit', saveFood);
  $('#groceryForm')?.addEventListener('submit', addGroceryV2);
  $('#prepForm')?.addEventListener('submit', addPrep);
  document.querySelectorAll('[data-delfood]').forEach((b) => (b.onclick = () => deleteFood(b.dataset.delfood)));
  document
    .querySelectorAll('[data-grocery]')
    .forEach((b) => (b.onchange = () => updateGrocery(b.dataset.grocery, b.checked)));
  document
    .querySelectorAll('[data-delgrocery]')
    .forEach((b) => (b.onclick = () => deleteRow('grocery_items', b.dataset.delgrocery, 'planning')));
  document.querySelectorAll('[data-prep]').forEach((b) => (b.onchange = () => updatePrep(b.dataset.prep, b.checked)));
  document
    .querySelectorAll('[data-delprep]')
    .forEach((b) => (b.onclick = () => deleteRow('prep_tasks', b.dataset.delprep, 'planning')));
  document
    .querySelectorAll('[data-delworkout]')
    .forEach((b) => (b.onclick = () => deleteRow('workout_sessions', b.dataset.delworkout, 'training')));
  $('#aiIntakeForm')?.addEventListener('submit', generateAIPlan);
  $('#aiIntakeForm')?.addEventListener('input', updateAIEditPreview);
  $('#aiIntakeForm')?.addEventListener('change', updateAIEditPreview);
  document.querySelectorAll('[data-ai-generate-new]').forEach((b) => (b.onclick = () => generateFreshAIPlan(b)));
  $('#aiRefineForm')?.addEventListener('submit', refineAIPlan);
  $('#aiRefineForm textarea')?.addEventListener('input', (e) => {
    S.rf.text = e.target.value;
    S.rfInterrupted = false;
    $('#aiRefineForm .rf-note')?.classList.add('hidden');
    rfSave();
  });
  document.querySelectorAll('[data-ai-apply]').forEach((b) => (b.onclick = () => applyAIPlan(b.dataset.aiApply)));
  document
    .querySelectorAll('[data-ai-restore]')
    .forEach((b) => (b.onclick = () => applyAIPlan(b.dataset.aiRestore, { quiet: true })));
  document.querySelectorAll('[data-dismiss-change]').forEach(
    (b) =>
      (b.onclick = () => {
        S.lastPlanChange = null;
        render();
      })
  );
}

export async function after() {
  await loadDay();
  await render();
}

/* ===== THE CUT: AI-first gating, coach/insights, tour ===== */
export async function gotoTab(t) {
  if (!S.aiUnlocked && t !== 'ai' && t !== 'account') {
    toast('Generate your first AI plan to unlock the rest of the app.');
    return;
  }
  S.tab = t;
  await render();
}

async function initV2(pr) {
  S.tab = 'ai';
  try {
    const { count, error } = await supabase
      .from('ai_plan_versions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', S.user.id);
    if (error) throw error;
    S.aiUnlocked = (count || 0) > 0;
  } catch (e) {
    console.error(e);
    S.aiUnlocked = true;
  } // fail open: a transient error must never lock a user out
  try {
    await loadActivePlan();
  } catch (e) {
    console.error(e);
  }
  subscribeInsights();
  if (S.aiUnlocked) setTimeout(runAssess, 4000);
}

/* ---- first-login tour (9 steps; works while sections are still locked) ---- */
function wireV2() {
  wireCoach();
  $('#trainingWeekForm')?.addEventListener('submit', saveTrainingWeek);
  $('#bell')?.addEventListener('click', openBellMenu);
}

/* ================= v3: minimal workspace — Plan · Meals · Workout · Weight · Coach · Prep & Grocery ================= */
const DATE_TABS = ['meals', 'prep'];

export const needsPlanCard = (what) =>
  `<div class="card empty-plan"><div class="eyebrow">NEXT STEP</div><h2>Apply your plan to start ${what}</h2><p class="muted">Your targets, meals and sessions come from your plan. Open it, review it, then press Apply.</p><button class="btn primary" data-tab="ai">Open my plan</button></div>`;

export const bar3 = (label, val, target, unit) => {
  const pct = Math.min(100, (Number(val) / Math.max(1, Number(target))) * 100);
  return `<div class="mbar"><div class="row between"><span>${label}</span><b>${fmt(val)} <small>/ ${fmt(target)} ${unit}</small></b></div><div class="progress"><i class="${pwc(pct)}"></i></div></div>`;
};

/* ---------- wiring for the v3 pages ---------- */
export function wireV3() {
  wireAccount();
  document.querySelectorAll('[data-wkstart]').forEach((b) => (b.onclick = () => wkBegin(b.dataset.wkstart)));
  document.querySelectorAll('[data-wkundo]').forEach((b) => (b.onclick = () => undoWorkoutReview(b.dataset.wkundo, b)));
  document.querySelectorAll('[data-prepview]').forEach(
    (b) =>
      (b.onclick = () => {
        S.prepView = b.dataset.prepview;
        render();
      })
  );
  document
    .querySelectorAll('[data-delweight]')
    .forEach((b) => (b.onclick = () => deleteRow('body_measurements', b.dataset.delweight, 'weight')));
  $('#weightForm')?.addEventListener('submit', saveWeightV3);
}
