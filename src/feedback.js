import { fmt, esc } from './lib/format.js';
import { diffWeek } from './lib/workout.js';
import { friendlyError } from './lib/errors.js';
import { S } from './state.js';
import { $, q, supabase } from './client.js';
import { callAIPlanner, loadActivePlan, loadPlanHistory, setAIProgress } from './plan.js';
import { card, render } from './shell.js';
import { fail, toast } from './ui.js';

/* ---------- Post-workout feedback -> AI session review -> plan adjustment ---------- */
const FB_KEY = () => 'cut_wkfb_' + (S.user?.id || 'x');

const FB_RATINGS = [
  ['too_easy', 'Too easy'],
  ['just_right', 'Just right'],
  ['too_hard', 'Too hard'],
];

const FB_ISSUES = [
  ['joint_pain', 'Joint pain'],
  ['muscle_pain', 'Muscle pain'],
  ['form_breakdown', 'Form broke down'],
  ['couldnt_hit_reps', 'Couldn’t hit reps'],
  ['felt_weak_tired', 'Felt weak or tired'],
  ['equipment_unavailable', 'Equipment taken'],
  ['ran_out_of_time', 'Ran out of time'],
  ['boring_or_dislike', 'Don’t like it'],
];

function fbSave() {
  try {
    S.fb ? localStorage.setItem(FB_KEY(), JSON.stringify(S.fb)) : localStorage.removeItem(FB_KEY());
  } catch {}
}

export function fbSnapshot(sid) {
  return {
    uid: S.user.id,
    sid,
    title: S.wk.title,
    date: S.wk.date,
    planDay: S.wk.planDay || '',
    effort: S.wk.effort,
    notes: S.wk.notes || '',
    mins: Math.max(1, Math.round((Date.now() - S.wk.startedAt) / 60000)),
    at: Date.now(),
    i: 0,
    saved: false,
    exs: S.wk.exs
      .map((e) => ({
        name: e.name,
        planned: e.planned || '',
        sets: e.sets.filter((s) => s.done).map((s) => ({ kg: Number(s.kg) || 0, reps: Number(s.reps) || 0 })),
        rating: '',
        issues: [],
        note: '',
      }))
      .filter((e) => e.sets.length),
  };
}

export function fbStart(snap) {
  S.fb = snap;
  fbSave();
  fbOpen();
}

export function fbResume() {
  if (!S.fb) {
    try {
      const d = JSON.parse(localStorage.getItem(FB_KEY()) || 'null');
      if (d && d.uid === S.user.id && d.exs?.length && Date.now() - d.at < 24 * 3600e3) S.fb = d;
    } catch {}
  }
  if (S.fb && S.fb.uid !== S.user.id) {
    S.fb = null;
  }
  if (S.fb) fbOpen();
}

function fbOpen() {
  if (!S.fb || document.getElementById('fbModal')) return;
  const m = document.createElement('div');
  m.className = 'modal-bg';
  m.id = 'fbModal';
  m.innerHTML = '<div class="modal fb" role="dialog" aria-modal="true" aria-label="Workout feedback"></div>';
  document.body.appendChild(m);
  fbRender();
}

function fbSetsText(sets) {
  return sets.map((s) => `${fmt(s.kg)}×${s.reps}`).join(' · ');
}

function fbRender() {
  const box = document.querySelector('#fbModal .modal');
  if (!box || !S.fb) return;
  const e = S.fb.exs[S.fb.i],
    n = S.fb.exs.length,
    last = S.fb.i === n - 1;
  box.innerHTML = `<div class="eyebrow">HOW DID IT GO? · ${S.fb.i + 1} OF ${n}</div><h2>${esc(e.name)}</h2><p class="muted small">${esc(fbSetsText(e.sets))}</p>
 <label class="muted small">HOW DID THIS FEEL?</label><div class="fb-chips" id="fbRate">${FB_RATINGS.map(([k, l]) => `<button type="button" class="chip ${e.rating === k ? 'on' : ''}" data-fbrate="${k}" aria-pressed="${e.rating === k}">${l}</button>`).join('')}</div>
 <label class="muted small">ANY ISSUES?</label><div class="fb-chips" id="fbIssues">${FB_ISSUES.map(([k, l]) => `<button type="button" class="chip ${e.issues.includes(k) ? 'on' : ''}" data-fbissue="${k}" aria-pressed="${e.issues.includes(k)}">${l}</button>`).join('')}</div>
 <textarea id="fbNote" rows="2" maxlength="300" placeholder="Anything else? e.g. left shoulder pinched on the way down (optional)">${esc(e.note)}</textarea>
 <div class="row u-mt12"><button class="btn ghost" id="fbBack" ${S.fb.i ? '' : 'disabled'}>Back</button><button class="btn primary grow" id="fbNext">${last ? 'Analyze my session' : 'Next exercise'}</button></div>
 <button class="btn ghost fb-skip" id="fbSkip">Skip the rest and analyze</button>`;
  box.querySelectorAll('[data-fbrate]').forEach(
    (b) =>
      (b.onclick = () => {
        e.rating = e.rating === b.dataset.fbrate ? '' : b.dataset.fbrate;
        fbSave();
        fbRender();
      })
  );
  box.querySelectorAll('[data-fbissue]').forEach(
    (b) =>
      (b.onclick = () => {
        const k = b.dataset.fbissue;
        e.issues = e.issues.includes(k) ? e.issues.filter((x) => x !== k) : [...e.issues, k];
        fbSave();
        fbRender();
      })
  );
  $('#fbNote').oninput = (ev) => {
    e.note = ev.target.value;
    fbSave();
  };
  $('#fbBack').onclick = () => {
    if (S.fb.i > 0) {
      S.fb.i--;
      fbSave();
      fbRender();
    }
  };
  $('#fbNext').onclick = () => {
    if (last) fbRun();
    else {
      S.fb.i++;
      fbSave();
      fbRender();
    }
  };
  $('#fbSkip').onclick = fbRun;
}

function fbClose() {
  document.getElementById('fbModal')?.remove();
  S.fb = null;
  fbSave();
}

async function fbRun() {
  const f = S.fb;
  if (!f) return;
  if (S.aiBusy) {
    toast('Another AI request is running. Try again in a moment.');
    return;
  }
  const box = document.querySelector('#fbModal .modal');
  if (box)
    box.innerHTML =
      '<div class="eyebrow">COACH REVIEW</div><h2>Analyzing your session…</h2><p class="muted small">Reading your sets and feedback, then adjusting your plan if it needs it.</p><div class="u-my18"><span class="loader"></span></div>';
  try {
    S.aiBusy = true;
    setAIProgress('workout');
    const withFb = f.exs.filter((e) => e.rating || e.issues.length || e.note.trim());
    if (withFb.length && !f.saved) {
      try {
        await q(
          supabase.from('workout_feedback').insert(
            withFb.map((e) => ({
              user_id: S.user.id,
              workout_session_id: f.sid,
              exercise_name: e.name.slice(0, 60),
              rating: e.rating || null,
              issues: e.issues,
              note: e.note.trim() || null,
            }))
          )
        );
        f.saved = true;
        fbSave();
      } catch (err) {
        console.error(err);
      }
    }
    const res = await callAIPlanner('workout_review', undefined, {
      session: {
        id: f.sid,
        title: f.title,
        date: f.date,
        duration_min: f.mins,
        effort: f.effort,
        notes: f.notes,
        plan_day: f.planDay,
        exercises: f.exs.map((e) => ({ name: e.name, planned: e.planned, sets: e.sets })),
      },
      feedback: withFb.map((e) => ({ exercise: e.name, rating: e.rating, issues: e.issues, note: e.note.trim() })),
    });
    const review = await applyWorkoutReview(f, res);
    S.fb = null;
    fbSave();
    S.wkHist = null;
    fbShowResult(review);
  } catch (err) {
    fail(err);
    fbShowError(err);
  } finally {
    S.aiBusy = false;
    setAIProgress(null);
  }
}

async function applyWorkoutReview(f, res) {
  const prev = S.aiActivePlan?.plan?.training_week || [],
    r = res.review || {};
  let lines = [];
  if (res.changed && Array.isArray(res.training_week)) {
    await q(supabase.rpc('save_training_week', { p_week: res.training_week }));
    try {
      await supabase.rpc('agent_ack_state');
    } catch (e) {
      console.error(e);
    }
    await loadActivePlan();
    await loadPlanHistory();
    lines = diffWeek(prev, res.training_week);
  }
  const changed = lines.length > 0;
  const row = {
    user_id: S.user.id,
    workout_session_id: f.sid,
    headline: r.headline || 'Session review',
    analysis: r.analysis || '',
    issues: r.issues || [],
    change_notes: r.change_notes || [],
    prev_week: changed ? prev : null,
    new_week: changed ? res.training_week : null,
    model: res.model || null,
  };
  let saved = null;
  try {
    saved = await q(supabase.from('workout_reviews').insert(row).select('*').single());
  } catch (e) {
    console.error(e);
  }
  S.wkReview = saved || { ...row, id: null, undone_at: null, created_at: new Date().toISOString() };
  return S.wkReview;
}

function wkReviewBody(r) {
  const lines = r.new_week ? diffWeek(r.prev_week, r.new_week) : [],
    notes = r.change_notes || [],
    issues = r.issues || [];
  return `<p class="fb-analysis">${esc(r.analysis)}</p>
 ${issues.length ? `<div class="fb-box"><b>What I noticed</b><ul>${issues.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
 ${lines.length ? `<div class="fb-box"><b>${r.undone_at ? 'Plan change (undone)' : 'Your training week was updated'}</b><ul class="chg">${lines.map((l) => `<li><b>${esc(l.label)}</b><span>${esc(l.detail)}</span></li>`).join('')}</ul>${notes.length ? `<p class="muted small u-m8-0-0">${notes.map(esc).join(' · ')}</p>` : ''}</div>` : `<div class="fb-box"><b>No plan changes needed</b><p class="muted small u-m4-0-0">Keep running next week’s sessions as planned.</p></div>`}`;
}

function wkReviewUndoable(r) {
  return !!(
    r &&
    r.id &&
    r.new_week &&
    r.prev_week &&
    !r.undone_at &&
    JSON.stringify(S.aiActivePlan?.plan?.training_week || []) === JSON.stringify(r.new_week)
  );
}

function fbShowResult(r) {
  const box = document.querySelector('#fbModal .modal');
  if (!box) {
    toast(r.headline || 'Session reviewed');
    return;
  }
  box.classList.add('fb-result');
  box.innerHTML = `<div class="eyebrow">COACH REVIEW</div><h2>${esc(r.headline)}</h2>${wkReviewBody(r)}<div class="row u-mt14">${wkReviewUndoable(r) ? '<button class="btn ghost" id="fbUndo">Undo change</button>' : ''}<button class="btn primary grow" id="fbDone">Done</button></div>`;
  $('#fbDone').onclick = async () => {
    fbClose();
    await render();
  };
  $('#fbUndo')?.addEventListener('click', async (ev) => {
    await undoWorkoutReview(r.id, ev.currentTarget, true);
  });
}

function fbShowError(err) {
  const box = document.querySelector('#fbModal .modal');
  if (!box) return;
  box.innerHTML = `<div class="eyebrow">COACH REVIEW</div><h2>Couldn’t analyze that</h2><p class="muted">${esc(friendlyError(err).body.replace(/<[^>]+>/g, '') || err?.message || 'Something went wrong.')} Your workout is saved. Your feedback is kept, so you can retry.</p><div class="row u-mt14"><button class="btn ghost" id="fbClose">Close</button><button class="btn primary grow" id="fbRetry">Try again</button></div>`;
  $('#fbClose').onclick = async () => {
    fbClose();
    await render();
  };
  $('#fbRetry').onclick = fbRun;
}

export async function undoWorkoutReview(id, btn, fromModal) {
  const r = S.wkReview && S.wkReview.id === id ? S.wkReview : null;
  if (!r || !wkReviewUndoable(r)) return;
  if (btn) btn.disabled = true;
  try {
    await q(supabase.rpc('save_training_week', { p_week: r.prev_week }));
    try {
      await supabase.rpc('agent_ack_state');
    } catch (e) {
      console.error(e);
    }
    await q(
      supabase
        .from('workout_reviews')
        .update({ undone_at: new Date().toISOString() })
        .eq('id', r.id)
        .eq('user_id', S.user.id)
    );
    r.undone_at = new Date().toISOString();
    await loadActivePlan();
    await loadPlanHistory();
    toast('Training week restored.');
    if (fromModal) {
      fbShowResult(r);
    } else await render();
  } catch (e) {
    fail(e);
    if (btn) btn.disabled = false;
  }
}

export function wkReviewCard() {
  const r = S.wkReview;
  if (!r || Date.now() - new Date(r.created_at).getTime() > 3 * 86400e3) return '';
  return `<div class="u-mt16">${card('Coach review of your last session', `<h3 class="u-mt0">${esc(r.headline)}</h3>${wkReviewBody(r)}${wkReviewUndoable(r) ? `<button class="btn" data-wkundo="${esc(r.id)}">Undo this change</button>` : ''}`)}</div>`;
}
