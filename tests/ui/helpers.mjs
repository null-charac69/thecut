import { readFileSync } from 'node:fs';
import { makeDb, NOW, aiPlanResponse } from './fixtures.mjs';

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
    const out = ai ? ai(body) : defaultAi(body);
    const [status, json] = Array.isArray(out) ? out : [200, out];
    await r.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(json) });
  });
  await page.addInitScript((d) => { window.__FAKE = d; window.__cspViolations = []; document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push(e.violatedDirective + ' ' + (e.blockedURI || '') + ' ' + (e.sample || ''))); }, db);
  await page.clock.setFixedTime(new Date(NOW));
  await page.goto(path);
  return { db, errors, aiCalls, csp: () => page.evaluate(() => window.__cspViolations), calls: () => page.evaluate(() => window.__FAKE.calls), fake: () => page.evaluate(() => window.__FAKE), violations };
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
