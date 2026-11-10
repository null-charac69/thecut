import { esc } from './lib/format.js';
import { S } from './state.js';
import { $, SUPABASE_KEY, SUPABASE_URL, q, supabase } from './client.js';
import { getAIBasePlan, runAIPlanRequest } from './plan.js';
import { card, gotoTab, render } from './shell.js';
import { fail, toast } from './ui.js';

const BELL_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';

export const bellHTML = () => BELL_SVG + (unreadCount() ? `<b class="badge">${unreadCount()}</b>` : '');

function closeBellMenu() {
  document.getElementById('bellMenu')?.remove();
  document.removeEventListener('click', _bellOutside, true);
  document.removeEventListener('keydown', _bellEsc, true);
  $('#bell')?.setAttribute('aria-expanded', 'false');
}

function _bellOutside(e) {
  if (!e.target.closest('#bellMenu,#bell')) closeBellMenu();
}

function _bellEsc(e) {
  if (e.key === 'Escape') {
    closeBellMenu();
    $('#bell')?.focus();
  }
}

export async function openBellMenu() {
  if (document.getElementById('bellMenu')) {
    closeBellMenu();
    return;
  }
  const b = $('#bell'),
    r = b.getBoundingClientRect(),
    m = document.createElement('div');
  m.id = 'bellMenu';
  m.setAttribute('role', 'dialog');
  m.setAttribute('aria-label', 'Coach notes');
  m.style.cssText = 'top:' + (r.bottom + 8) + 'px;right:8px';
  const list = S.insights.filter((i) => !i.dismissed_at).slice(0, 5);
  m.innerHTML = `<div class="bm-head"><b>Coach notes</b><small>${unreadCount() ? unreadCount() + ' new' : 'all caught up'}</small></div>${list.length ? list.map((i) => `<button class="bm-item ${i.read_at ? '' : 'unread'}" data-bm-open><i class="dot2" aria-hidden="true"></i><span><strong>${esc(i.title)}</strong><em>${esc(i.body)}</em></span></button>`).join('') : '<div class="bm-empty">Nothing yet. Your coach drops notes here as you log.</div>'}<button class="bm-foot" data-bm-open>Open Coach</button>`;
  document.body.appendChild(m);
  b.setAttribute('aria-expanded', 'true');
  m.querySelectorAll('[data-bm-open]').forEach(
    (x) =>
      (x.onclick = async () => {
        closeBellMenu();
        await gotoTab('coach');
      })
  );
  setTimeout(() => {
    document.addEventListener('click', _bellOutside, true);
    document.addEventListener('keydown', _bellEsc, true);
  }, 0);
  await markInsightsRead();
  const bb = $('#bell');
  if (bb) bb.innerHTML = bellHTML();
}

/* ---- coach insights (rows are written by database rules; this just shows them live) ---- */
const unreadCount = () => S.insights.filter((i) => !i.read_at && !i.dismissed_at).length;

export async function loadInsights() {
  if (!S.insightsEnabled || !S.user) return;
  try {
    const since = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('agent_insights')
      .select('*')
      .eq('user_id', S.user.id)
      .gte('insight_date', since)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) throw error;
    S.insights = (data || []).filter((i) => !/^(hydration|recovery)/.test(String(i.kind || '')));
  } catch (e) {
    S.insights = [];
    if (/agent_insights|schema cache|PGRST205|42P01/i.test(String(e?.message || e?.code || '')))
      S.insightsEnabled = false;
    else console.error(e);
  }
}

export function subscribeInsights() {
  unsubscribeInsights();
  if (!S.insightsEnabled) return;
  try {
    S.insightChannel = supabase
      .channel('agent-insights-' + S.user.id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_insights', filter: 'user_id=eq.' + S.user.id },
        onInsightChange
      )
      .subscribe();
  } catch (e) {
    console.error(e);
  }
}

export function unsubscribeInsights() {
  if (S.insightChannel) {
    try {
      supabase.removeChannel(S.insightChannel);
    } catch {}
    S.insightChannel = null;
  }
}

async function onInsightChange(p) {
  await loadInsights();
  const r = p?.new;
  if (r && !r.read_at && !r.dismissed_at && p.eventType !== 'DELETE') toast('Coach: ' + r.title);
  refreshCoachDom();
}

function refreshCoachDom() {
  const el = $('#coach');
  if (el) {
    el.outerHTML = coachPanel(true); // the panel only exists on the Coach tab, where it is always the full version
    wireCoach();
  }
  const bell = $('#bell');
  if (bell) bell.innerHTML = bellHTML();
}

export function coachPanel(full) {
  if (!S.insightsEnabled && !S.coachReview)
    return full
      ? `<section class="card coach" id="coach"><div class="eyebrow">YOUR COACH</div><p class="muted small">The coach feed is not enabled on this environment yet.</p></section>`
      : '';
  const list = S.insights.filter((i) => !i.dismissed_at).slice(0, full ? 8 : 3);
  const rows = list.map(insightRow).join('');
  const empty =
    '<p class="muted small u-mt10">Nothing flagged right now. As you log meals, workouts, water, check-ins and weight, I watch the trends and speak up when something drifts. Days with no logs count as unknown, never as zero.</p>';
  const rv = S.coachReview
    ? `<div class="coach-review"><strong>${esc(S.coachReview.headline || 'Weekly review')}</strong><p>${esc(S.coachReview.summary || '')}</p>${(S.coachReview.suggestions || []).map((x) => `<p>• ${esc(x)}</p>`).join('')}${S.coachReview.should_refine && getAIBasePlan() ? '<p><button class="btn" id="refineFromReview">Draft a plan update from this</button></p>' : ''}</div>`
    : '';
  return `<section class="card coach" id="coach"><div class="ai-plan-head"><div><div class="eyebrow">YOUR COACH · WATCHING YOUR DATA LIVE</div><h2 class="u-m4-0-0">What I noticed</h2></div>${full && getAIBasePlan() ? '<button class="btn primary" id="reviewWeek">Review my week</button>' : ''}</div>${rv}${rows || (rv ? '' : empty)}${full && getAIBasePlan() ? coachChatHtml() : ''}</section>`;
}

async function markInsightsRead() {
  const ids = S.insights.filter((i) => !i.read_at && !i.dismissed_at).map((i) => i.id);
  if (!ids.length) return;
  try {
    await supabase.from('agent_insights').update({ read_at: new Date().toISOString() }).in('id', ids);
    S.insights = S.insights.map((i) => (ids.includes(i.id) ? { ...i, read_at: new Date().toISOString() } : i));
  } catch (e) {
    console.error(e);
  }
}

async function dismissInsight(id) {
  try {
    const { error } = await supabase
      .from('agent_insights')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    S.insights = S.insights.map((i) => (i.id === id ? { ...i, dismissed_at: new Date().toISOString() } : i));
    refreshCoachDom();
  } catch (e) {
    fail(e);
  }
}

async function edgeCall(payload) {
  const {
    data: { session: s },
  } = await supabase.auth.getSession();
  if (!s?.access_token) throw new Error('Session expired. Sign in again.');
  const r = await fetch(SUPABASE_URL + '/functions/v1/the-cut-ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token, apikey: SUPABASE_KEY },
    body: JSON.stringify(payload),
  });
  let d = {};
  try {
    d = await r.json();
  } catch {}
  if (!r.ok) throw new Error(d.error || 'AI request failed.');
  return d;
}

async function reviewWeek(btn) {
  if (S.aiBusy) return;
  try {
    S.aiBusy = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Reviewing your week…';
    }
    const d = await edgeCall({ action: 'review' });
    S.coachReview = d.review || null;
    await loadInsights();
    refreshCoachDom();
  } catch (e) {
    fail(e);
  } finally {
    S.aiBusy = false;
    const b = $('#reviewWeek');
    if (b) {
      b.disabled = false;
      b.textContent = 'Review my week';
    }
  }
}

async function refineFromReview(btn) {
  const base = getAIBasePlan();
  if (!base || !S.coachReview) return;
  const text =
    'WEEKLY REVIEW FROM THE COACH (based on real tracker data; missing days are unknown, not zero):\n' +
    [S.coachReview.headline, S.coachReview.summary, ...(S.coachReview.suggestions || [])].filter(Boolean).join('\n');
  await runAIPlanRequest(
    'refine',
    base.inputs || {},
    { instruction: text, current_plan_id: base.id },
    btn,
    'Drafting…',
    'Draft a plan update from this'
  );
}

function insightRow(i) {
  const d = i.data || {};
  const concern = String(i.kind || '').startsWith('plan_edit') && d.status === 'concern' && !i.dismissed_at;
  const changes =
    concern && (d.changes || []).length
      ? `<ul class="pe-changes">${d.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
      : '';
  const concerns =
    concern && (d.concerns || []).length
      ? `<ul class="pe-changes">${d.concerns.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
      : '';
  const opts = concern
    ? `<div class="pe-actions"><button class="btn primary small" data-pe-accept="${esc(i.id)}">1 · Accept AI refinement</button><button class="btn small" data-pe-keep="${esc(i.id)}">2 · Keep my version</button><button class="btn small" data-pe-discuss="${esc(i.id)}">3 · Discuss with AI</button></div><p class="muted small">1 drafts a refined plan for you to apply. 2 keeps your edit and I update myself to it. 3 opens a chat with me.</p>`
    : '';
  return `<div class="insight ${esc(i.severity)} ${i.read_at ? '' : 'unread'}"><div class="grow"><strong>${esc(i.title)}</strong><p>${esc(i.body)}</p>${changes}${concerns}${opts}</div><button class="btn small" data-dismiss-insight="${esc(i.id)}" aria-label="Dismiss insight">✕</button></div>`;
}

function coachChatHtml() {
  const msgs = S.coachChat
    .map(
      (m) =>
        `<div class="chat-msg ${m.role}"><b>${m.role === 'user' ? 'You' : 'Coach'}</b><p>${esc(m.content)}</p>${m.draft_id ? `<p><button class="btn small primary" data-open-draft="${esc(m.draft_id)}">Review the draft plan</button></p>` : ''}</div>`
    )
    .join('');
  return `<div class="coach-chat" id="coachChat"><div class="eyebrow u-mt14">ASK YOUR COACH</div>${msgs}<form id="coachChatForm" class="chat-form"><input name="msg" placeholder="Ask about your plan, your week, or tell me what you want to change…" maxlength="1500" autocomplete="off" ${S.coachChatBusy ? 'disabled' : ''}/><button class="btn primary small" ${S.coachChatBusy ? 'disabled' : ''}>${S.coachChatBusy ? 'Thinking…' : 'Send'}</button></form></div>`;
}

export function scheduleAssess(delay = 20000) {
  if (!S.insightsEnabled || !S.aiUnlocked) return;
  clearTimeout(S.assessTimer);
  S.assessTimer = setTimeout(runAssess, delay);
  toast('Saved. Your coach will review this change in a few seconds.');
}

export async function runAssess() {
  if (S.assessBusy || !S.user || !S.aiUnlocked || !S.insightsEnabled) return;
  S.assessBusy = true;
  try {
    const d = await edgeCall({ action: 'assess' });
    if (d.status === 'ok' || d.status === 'concern') {
      await loadInsights();
      refreshCoachDom();
    }
  } catch (e) {
    console.error('assess', e);
  } finally {
    S.assessBusy = false;
  }
}

export async function ackState() {
  try {
    await supabase.rpc('agent_ack_state');
  } catch (e) {
    console.error(e);
  }
}

async function keepMyVersion(id) {
  try {
    await q(supabase.rpc('agent_ack_state'));
    await dismissInsight(id);
    toast('Got it. I have updated myself to your version of the plan.');
  } catch (e) {
    fail(e);
  }
}

async function acceptRefinement(id, btn) {
  const ins = S.insights.find((x) => x.id === id);
  const base = getAIBasePlan();
  if (!ins || !base) return;
  await runAIPlanRequest(
    'refine',
    base.inputs || {},
    { instruction: ins.data?.refine_instruction || ins.body, current_plan_id: base.id },
    btn,
    'Drafting…',
    '1 · Accept AI refinement'
  );
  await dismissInsight(id);
}

async function discussEdit(id) {
  const ins = S.insights.find((x) => x.id === id);
  if (!ins) return;
  const text =
    'I edited my plan: ' +
    ((ins.data?.changes || []).join('; ') || 'see my live plan') +
    '. You raised: ' +
    ins.body +
    ' Can we talk it through?';
  await sendChat(text);
}

async function sendChat(text) {
  if (S.coachChatBusy || !text.trim()) return;
  S.coachChat.push({ role: 'user', content: text.trim() });
  S.coachChatBusy = true;
  refreshCoachDom();
  try {
    const d = await edgeCall({
      action: 'chat',
      messages: S.coachChat.map((m) => ({ role: m.role, content: m.content })),
    });
    S.coachChat.push({ role: 'assistant', content: d.reply || '…', draft_id: d.draft_id || null });
    if (d.kept) {
      await loadInsights();
    }
  } catch (e) {
    S.coachChat.push({
      role: 'assistant',
      content: 'I could not answer just now: ' + (e.message || 'try again') + '.',
    });
  } finally {
    S.coachChatBusy = false;
    refreshCoachDom();
    $('#coachChat')?.scrollIntoView({ block: 'nearest' });
  }
}

async function openDraft(id) {
  try {
    S.aiPlanHistory = await q(
      supabase
        .from('ai_plan_versions')
        .select('*')
        .eq('user_id', S.user.id)
        .order('created_at', { ascending: false })
        .limit(10)
    );
    S.aiPlanDraft = S.aiPlanHistory.find((x) => x.id === id) || S.aiPlanDraft;
    await render();
  } catch (e) {
    fail(e);
  }
}

export async function saveTrainingWeek(e) {
  e.preventDefault();
  const raw = new FormData(e.currentTarget).get('week') || '';
  const week = String(raw)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 7)
    .map((l) => {
      const [day, focus = '', mins = '0', ex = ''] = l.split('|').map((x) => x.trim());
      return {
        day: day.slice(0, 30),
        focus: focus.slice(0, 100),
        session_minutes: Math.min(180, Math.max(0, parseInt(mins, 10) || 0)),
        exercises: ex
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
          .slice(0, 10),
      };
    })
    .filter((d) => d.day);
  try {
    await q(supabase.rpc('save_training_week', { p_week: week }));
    S.aiPlanHistory = await q(
      supabase
        .from('ai_plan_versions')
        .select('*')
        .eq('user_id', S.user.id)
        .order('created_at', { ascending: false })
        .limit(10)
    );
    await render();
    scheduleAssess();
  } catch (e) {
    fail(e);
  }
}

export function trainingWeekEditor() {
  const w =
    (getAIBasePlan()?.status === 'active' ? getAIBasePlan() : S.aiPlanHistory.find((x) => x.status === 'active'))?.plan
      ?.training_week || [];
  if (!S.aiPlanHistory.some((x) => x.status === 'active')) return '';
  return `<div class="u-mb14">${card('Edit your training week', `<p class="muted small">One day per line: Day | Focus | minutes | exercise, exercise. Your coach reviews changes and tells you if it agrees.</p><form id="trainingWeekForm"><textarea name="week" rows="6" class="u-w100">${esc(w.map((d) => `${d.day} | ${d.focus} | ${d.session_minutes || 0} | ${(d.exercises || []).join(', ')}`).join('\n'))}</textarea><button class="btn primary small u-mt8">Save training week</button></form>`)}</div>`;
}

export function wireCoach() {
  $('#reviewWeek')?.addEventListener('click', (e) => reviewWeek(e.currentTarget));
  $('#refineFromReview')?.addEventListener('click', (e) => refineFromReview(e.currentTarget));
  document
    .querySelectorAll('[data-dismiss-insight]')
    .forEach((b) => (b.onclick = () => dismissInsight(b.dataset.dismissInsight)));
  document
    .querySelectorAll('[data-pe-accept]')
    .forEach((b) => (b.onclick = () => acceptRefinement(b.dataset.peAccept, b)));
  document.querySelectorAll('[data-pe-keep]').forEach((b) => (b.onclick = () => keepMyVersion(b.dataset.peKeep)));
  document.querySelectorAll('[data-pe-discuss]').forEach((b) => (b.onclick = () => discussEdit(b.dataset.peDiscuss)));
  document.querySelectorAll('[data-open-draft]').forEach((b) => (b.onclick = () => openDraft(b.dataset.openDraft)));
  $('#coachChatForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const i = e.currentTarget.querySelector('input');
    const t = i.value;
    i.value = '';
    sendChat(t);
  });
}
