import { readFileSync } from 'node:fs';
import { makeDb, NOW, aiPlanResponse, planHash } from './fixtures.mjs';

const FAKE = readFileSync(new URL('./fake-supabase.js', import.meta.url), 'utf8');
export const AI_URL = '**/functions/v1/the-cut-ai';

/**
 * Open the app with a fake backend.
 * @param page Playwright page
 * @param opts { signedIn, withPlan, ai: (body)=>object|[status,object] }
 */
export async function openApp(page, { signedIn = true, withPlan = true, ai, path = '/' } = {}) {
  const db = makeDb({ signedIn, withPlan });
  const violations = [], errors = [], aiCalls = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.route('https://esm.sh/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: FAKE }));
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info', 'access-control-allow-methods': 'POST, OPTIONS' };
  await page.route(AI_URL, async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const body = JSON.parse(r.request().postData() || '{}'); aiCalls.push(body);
    let out = ai ? ai(body) : undefined;
    if (out === undefined) out = body.action === 'lists' ? await page.evaluate(serverLists, { body, planHash: planHash.toString() }) : defaultAi(body);
    const [status, json] = Array.isArray(out) ? out : [200, out];
    await r.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(json) });
  });
  await page.addInitScript((d) => { window.__FAKE = d; window.__cspViolations = []; document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push(e.violatedDirective + ' ' + (e.blockedURI || '') + ' ' + (e.sample || ''))); }, db);
  await page.clock.setFixedTime(new Date(NOW));
  await page.goto(path);
  return { db, errors, aiCalls, csp: () => page.evaluate(() => window.__cspViolations), calls: () => page.evaluate(() => window.__FAKE.calls), fake: () => page.evaluate(() => window.__FAKE), violations };
}

// Browser-side stand-in for the edge function's `lists` action: same decision rules, lists built from the live meals.
function serverLists({ body, planHash }) {
  const db = window.__FAKE, T = db.tables, u = db.session.user.id;
  const ph = new Function('return ' + planHash)();
  const tpl = T.meal_templates.filter((t) => t.user_id === u && t.is_active).sort((a, b) => a.sort_order - b.sort_order);
  const meals = tpl.map((t) => ({ name: t.name, items: T.meal_template_items.filter((i) => i.meal_template_id === t.id && i.food_name_snapshot !== '__plan_total__').sort((a, b) => a.sort_order - b.sort_order).map((i) => ({ name: i.food_name_snapshot })) }));
  const active = T.ai_plan_versions.find((v) => v.user_id === u && v.status === 'active');
  if (!active || !meals.length) return { status: 'no_plan' };
  const hash = ph(meals);
  const gen = (T.list_generations || []).find((g) => g.user_id === u && g.week_start === body.week_start);
  if (!body.force && gen && gen.plan_hash === hash) return { status: 'current' };
  const addD = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const names = [...new Set(meals.flatMap((m) => m.items.map((i) => i.name)))];
  const groceries = names.map((name, i) => ({ name, quantity: '1 pack', category: ['PROTEIN', 'pantry', 'Dairy'][i % 3] }));
  const prep = []; for (let d = body.today; d <= addD(body.week_start, 6); d = addD(d, 1)) prep.push({ date: d, tasks: ['Prep ' + names[0] + ' for ' + d] });
  window.__listsCalls = (window.__listsCalls || 0) + 1;
  db.runRpc('replace_generated_lists', { p_week_start: body.week_start, p_from: body.today, p_plan_hash: hash, p_plan_version_id: active.id, p_groceries: groceries, p_prep: prep });
  return { status: 'generated', mode: gen ? 'rest_of_week' : 'new_week', groceries_added: groceries.length, groceries_removed: 0, prep_added: prep.length, prep_removed: 0 };
}

export function defaultAi(body) {
  switch (body.action) {
    case 'generate': case 'refine': return aiPlanResponse();
    case 'review': return { review: { headline: 'Good week', summary: 'Consistent logging.', suggestions: ['Add a protein snack'], should_refine: false } };
    case 'assess': return { status: 'ok' };
    case 'chat': return { reply: 'Happy to help. What would you like to change?' };
    case 'workout_review': return { review: { headline: 'Strong session', analysis: 'Every set landed. Nothing needs to change.', issues: [], change_notes: [] }, changed: false, model: 'fixture' };
    default: return [400, { error: 'unknown action' }];
  }
}

export const tabBtn = (page, name) => page.locator(`.nav button[data-tab="${name}"]`);
export async function go(page, tab) { await tabBtn(page, tab).click(); await waitReady(page); }
export async function waitReady(page) { await page.locator('#pagebody').waitFor(); await page.locator('#pagebody .loader').waitFor({ state: 'detached' }); }
