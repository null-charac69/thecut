import { e1rm, parsePlanExercise, planTargetKg, volOf } from './lib/workout.js';
import { today, esc, dateFmt, fmt } from './lib/format.js';
import { S } from './state.js';
import { $, pwc, q, supabase } from './client.js';
import { trainingWeekEditor } from './coach.js';
import { fbSnapshot, fbStart, wkReviewCard } from './feedback.js';
import { card, needsPlanCard, pageHead, render, wireV3 } from './shell.js';
import { fail, toast, uiConfirm } from './ui.js';

/* ---------- Workout logger ---------- */
const WK_KEY = () => 'cut_wk_' + (S.user?.id || 'x');

export async function loadWkHistory() {
  const rows = await q(
    supabase
      .from('workout_exercises')
      .select('exercise_name,created_at,workout_sets(set_number,reps,weight_kg)')
      .eq('user_id', S.user.id)
      .order('created_at', { ascending: false })
      .limit(300)
  );
  const map = {};
  rows.forEach((r) => {
    const k = r.exercise_name.trim().toLowerCase(),
      sets = (r.workout_sets || []).slice().sort((a, b) => a.set_number - b.set_number),
      m = (map[k] ??= { last: null, best1: 0, name: r.exercise_name });
    if (!m.last && sets.length) m.last = sets;
    sets.forEach((s) => {
      m.best1 = Math.max(m.best1, e1rm(Number(s.weight_kg) || 0, Number(s.reps) || 0));
    });
  });
  S.wkHist = map;
  S.wkSessions = await q(
    supabase
      .from('workout_sessions')
      .select(
        'id,title,local_date,duration_minutes,perceived_effort,workout_exercises(exercise_name,sort_order,workout_sets(set_number,reps,weight_kg))'
      )
      .eq('user_id', S.user.id)
      .order('local_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(8)
  );
  try {
    S.wkReview =
      (
        await q(
          supabase
            .from('workout_reviews')
            .select('*')
            .eq('user_id', S.user.id)
            .order('created_at', { ascending: false })
            .limit(1)
        )
      )[0] || null;
  } catch (e) {
    console.error(e);
    S.wkReview = null;
  }
}

function wkMakeEx(name, n = 3, reps = 10, target = null, planned = '') {
  const h = S.wkHist?.[name.trim().toLowerCase()],
    prev = h?.last || [],
    last = prev[prev.length - 1];
  // The plan is authoritative: its reps and any AI load target win over last time's numbers.
  return {
    name,
    pr: false,
    planned,
    target,
    sets: Array.from({ length: n }, (_, i) => ({
      kg: target ?? (prev[i] || last)?.weight_kg ?? '',
      reps: planned ? reps : ((prev[i] || last)?.reps ?? reps),
      done: false,
      pr: false,
    })),
  };
}

const wkSave = () => {
  try {
    S.wk ? localStorage.setItem(WK_KEY(), JSON.stringify(S.wk)) : localStorage.removeItem(WK_KEY());
  } catch {}
};

function wkLoadDraft() {
  if (S.wk) return;
  try {
    const d = JSON.parse(localStorage.getItem(WK_KEY()) || 'null');
    if (d && d.exs && Date.now() - d.startedAt < 18 * 3600e3) S.wk = d;
  } catch {}
}

function planSessions() {
  return (S.aiActivePlan?.plan?.training_week || [])
    .map((d, i) => ({ i, ...d }))
    .filter(
      (d) =>
        Number(d.session_minutes) > 0 &&
        !/rest|recover|mobility|stretch|walk|light cardio|off\b/i.test(String(d.focus || ''))
    );
}

function todaySession() {
  const names = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
    dow = names[new Date(today() + 'T12:00:00').getDay()];
  return planSessions().find((d) => String(d.day).toLowerCase().startsWith(dow)) || null;
}

export async function wkBegin(idx) {
  if (!S.wkHist) {
    try {
      await loadWkHistory();
    } catch (e) {
      console.error(e);
      S.wkHist = {};
    }
  }
  let title = 'Workout',
    exs = [],
    planDay = '';
  if (idx !== 'empty') {
    const d = (S.aiActivePlan?.plan?.training_week || [])[Number(idx)];
    if (d) {
      title = d.focus || d.day || 'Workout';
      planDay = String(d.day || '');
      exs = (d.exercises || [])
        .map((raw) => ({ raw: String(raw), ...parsePlanExercise(raw) }))
        .map((x) => wkMakeEx(x.name, x.sets, x.reps, planTargetKg(x.raw), x.raw));
    }
  }
  S.wk = { title, startedAt: Date.now(), date: today(), exs, effort: null, notes: '', best: {}, planDay };
  S.wkRest = null;
  wkSave();
  renderWk();
}

function renderWk(keepScroll) {
  const y = window.scrollY;
  $('#pagebody').innerHTML = workoutV3();
  wireWk();
  wireV3();
  if (keepScroll) window.scrollTo(0, y);
}

function fmtClock(s) {
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function wkTickFn() {
  const c = $('#wkClock');
  if (!c || !S.wk) {
    clearInterval(S.wkTick);
    S.wkTick = null;
    return;
  }
  c.textContent = fmtClock(Math.floor((Date.now() - S.wk.startedAt) / 1000));
  const r = $('#wkRestBar');
  if (!r) return;
  if (S.wkRest && S.wkRest > Date.now()) {
    const left = Math.ceil((S.wkRest - Date.now()) / 1000);
    r.classList.remove('hidden');
    $('#wkRestT').textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
  } else {
    if (S.wkRest) {
      S.wkRest = null;
      if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
      toast('Rest is over. Next set.');
    }
    r.classList.add('hidden');
  }
}

function wkToggle(xi, si) {
  const e = S.wk.exs[xi],
    s = e.sets[si];
  s.done = !s.done;
  if (s.done) {
    const kg = Number(s.kg) || 0,
      rp = Number(s.reps) || 0,
      h = S.wkHist?.[e.name.trim().toLowerCase()],
      v = e1rm(kg, rp),
      prev = Math.max(h?.best1 || 0, S.wk.best[e.name] || 0);
    s.kg = s.kg === '' ? '' : kg;
    s.reps = rp;
    if (h?.best1 && v > prev + 0.01) {
      s.pr = true;
      toast('New PR on ' + e.name);
    }
    S.wk.best[e.name] = Math.max(S.wk.best[e.name] || 0, v);
    S.wkRest = Date.now() + S.wkRestDefault * 1000;
    if (navigator.vibrate) navigator.vibrate(15);
  } else {
    s.pr = false;
    S.wkRest = null;
  }
  e.pr = e.sets.some((x) => x.pr);
  wkSave();
  renderWk(true);
}

export function workoutV3() {
  if (!S.aiActivePlan) return pageHead('Training', 'Workout', 'Log every set, live.') + needsPlanCard('training');
  wkLoadDraft();
  return S.wk ? wkLive() : wkStartView();
}

function wkStartView() {
  const ts = todaySession(),
    all = planSessions();
  const hist = S.wkSessions
    .map((s) => {
      const exs = (s.workout_exercises || []).slice().sort((a, b) => a.sort_order - b.sort_order);
      const vol = exs.reduce(
        (a, e) =>
          a + (e.workout_sets || []).reduce((b, x) => b + (Number(x.weight_kg) || 0) * (Number(x.reps) || 0), 0),
        0
      );
      return `<details class="wk-hist"><summary><span><strong>${esc(s.title)}</strong><small>${dateFmt(s.local_date, { day: 'numeric', month: 'short' })} · ${s.duration_minutes || 0} min · ${fmt(vol)} kg${s.perceived_effort ? ' · RPE ' + s.perceived_effort : ''}</small></span><button class="btn sm ghost" data-delworkout="${s.id}" aria-label="Delete session">✕</button></summary>${exs
        .map(
          (e) =>
            `<div class="wk-hx"><b>${esc(e.exercise_name)}</b><span>${(e.workout_sets || [])
              .slice()
              .sort((a, b) => a.set_number - b.set_number)
              .map((x) => `${fmt(x.weight_kg)}×${x.reps}`)
              .join(' · ')}</span></div>`
        )
        .join('')}</details>`;
    })
    .join('');
  return `${pageHead('Training', 'Workout', 'Open a session, log each set as you do it.')}
 ${card(
   ts ? 'Today · ' + esc(ts.day) : 'No session planned today',
   ts
     ? `<h2 class="wk-hero">${esc(ts.focus)}</h2><p class="muted small">${Number(ts.session_minutes) || 0} min · ${(ts.exercises || []).length} exercises</p><div class="wk-chips">${(
         ts.exercises || []
       )
         .slice(0, 6)
         .map((x) => `<span>${esc(parsePlanExercise(x).name)}</span>`)
         .join('')}</div><button class="btn primary wk-go" data-wkstart="${ts.i}">Start workout</button>`
     : `<p class="muted">Rest day by your plan. You can still start a session if you want one.</p><button class="btn primary wk-go" data-wkstart="empty">Start an empty workout</button>`
 )}
 ${wkReviewCard()}
 ${
   all.length > (ts ? 1 : 0)
     ? `<div class="u-mt16">${card(
         'Other sessions in your plan',
         all
           .filter((d) => !ts || d.i !== ts.i)
           .map(
             (d) =>
               `<div class="listitem"><div class="grow"><strong>${esc(d.day)} · ${esc(d.focus)}</strong><small>${Number(d.session_minutes) || 0} min · ${(d.exercises || []).length} exercises</small></div><button class="btn sm" data-wkstart="${d.i}">Start</button></div>`
           )
           .join('') +
           `<div class="row u-mt10"><button class="btn sm ghost" data-wkstart="empty">+ Empty workout</button></div>`
       )}</div>`
     : ts
       ? `<div class="row u-mt12"><button class="btn sm ghost" data-wkstart="empty">+ Empty workout instead</button></div>`
       : ''
 }
 <div class="u-mt16">${card('Recent sessions', hist || '<div class="empty">Your finished sessions show up here with every set.</div>')}</div>
 <details class="wk-edit u-mt16"><summary>Edit your weekly training plan</summary>${trainingWeekEditor()}</details>`;
}

function wkLive() {
  const done = S.wk.exs.reduce((a, e) => a + e.sets.filter((s) => s.done).length, 0),
    total = S.wk.exs.reduce((a, e) => a + e.sets.length, 0),
    names = [
      ...new Set([
        ...(S.aiActivePlan?.plan?.training_week || []).flatMap((d) =>
          (d.exercises || []).map((x) => parsePlanExercise(x).name)
        ),
        ...Object.values(S.wkHist || {}).map((h) => h.name),
      ]),
    ];
  return `<div class="wk">
 <div class="wk-top"><div class="grow"><input class="wk-title" id="wkTitle" value="${esc(S.wk.title)}" aria-label="Workout name" maxlength="60"/><div class="wk-meta"><span id="wkClock">00:00</span><span>${done}/${total} sets</span><span>${fmt(volOf(S.wk.exs))} kg</span></div></div><div class="row"><button class="btn ghost" id="wkDiscard">Discard</button><button class="btn primary" id="wkFinish">Finish</button></div></div>
 <div class="progress"><i class="${pwc(total ? (done / total) * 100 : 0)}"></i></div>
 <div class="wk-restpick"><span class="muted small">Rest timer</span>${[60, 90, 120, 180].map((s) => `<button class="chip ${S.wkRestDefault === s ? 'on' : ''}" data-wkrest="${s}">${s / 60 >= 1 && s % 60 === 0 ? s / 60 + ' min' : s + ' s'}</button>`).join('')}</div>
 ${S.wk.exs
   .map((e, xi) => {
     const h = S.wkHist?.[e.name.trim().toLowerCase()],
       prev = h?.last
         ? h.last.map((x) => `${fmt(x.weight_kg)}×${x.reps}`).join('  ·  ')
         : 'First time — no history yet';
     return `<section class="card wk-ex"><div class="row between"><h3>${esc(e.name)}${e.pr ? ' <span class="pr">PR</span>' : ''}</h3><button class="btn sm ghost" data-wkdelex="${xi}" aria-label="Remove ${esc(e.name)}">✕</button></div><div class="wk-prev">Last time: ${prev}${e.target ? ` · Coach target ${fmt(e.target)} kg` : ''}</div>
  <div class="wk-sets"><div class="wk-h"><span>Set</span><span>kg</span><span>Reps</span><span></span></div>${e.sets.map((s, si) => `<div class="wk-set ${s.done ? 'done' : ''}"><span class="n">${si + 1}</span><input inputmode="decimal" data-wk="${xi}:${si}:kg" value="${esc(s.kg)}" placeholder="0" aria-label="Set ${si + 1} weight in kg"/><input inputmode="numeric" data-wk="${xi}:${si}:reps" value="${esc(s.reps)}" placeholder="0" aria-label="Set ${si + 1} reps"/><button class="tick" data-wktick="${xi}:${si}" aria-pressed="${s.done}" aria-label="Mark set ${si + 1} done">${s.done ? '✓' : ''}</button></div>`).join('')}</div>
  <div class="row"><button class="btn sm" data-wkaddset="${xi}">+ Add set</button><button class="btn sm ghost" data-wkdelset="${xi}">− Remove set</button></div></section>`;
   })
   .join('')}
 <section class="card"><form id="wkAddEx" class="row addrow"><input name="name" list="wkNames" placeholder="Add an exercise…" required maxlength="60" autocomplete="off"/><datalist id="wkNames">${names.map((n) => `<option value="${esc(n)}">`).join('')}</datalist><button class="btn primary">Add</button></form></section>
 <div class="wk-restbar hidden" id="wkRestBar"><span>Rest <b id="wkRestT">0:00</b></span><button class="btn sm" id="wkRestAdd">+15 s</button><button class="btn sm primary" id="wkRestSkip">Skip</button></div>
 </div>`;
}

function wkFinishModal() {
  const done = S.wk.exs.reduce((a, e) => a + e.sets.filter((s) => s.done).length, 0);
  if (!done) {
    toast('Tick off at least one set before finishing.');
    return;
  }
  const prs = S.wk.exs.filter((e) => e.pr).map((e) => e.name),
    mins = Math.max(1, Math.round((Date.now() - S.wk.startedAt) / 60000));
  const m = document.createElement('div');
  m.className = 'modal-bg';
  m.id = 'wkModal';
  m.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Finish workout"><div class="eyebrow">Workout complete</div><h2>${esc(S.wk.title)}</h2>
 <div class="grid g3 wk-sum"><div><b>${mins}</b><small>minutes</small></div><div><b>${done}</b><small>sets</small></div><div><b>${fmt(volOf(S.wk.exs))}</b><small>kg volume</small></div></div>
 ${prs.length ? `<p class="pr-line">New PR: ${prs.map(esc).join(', ')}</p>` : ''}
 <label class="muted small">How hard was it? (1–10)</label><div class="rpe">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<button type="button" class="chip" data-rpe="${n}">${n}</button>`).join('')}</div>
 <textarea id="wkNotes" rows="2" placeholder="Notes (optional)" maxlength="500"></textarea>
 <div class="row u-mt12"><button class="btn ghost" id="wkBack">Keep going</button><button class="btn primary grow" id="wkSaveBtn">Save workout</button></div></div>`;
  document.body.appendChild(m);
  m.querySelectorAll('[data-rpe]').forEach(
    (b) =>
      (b.onclick = () => {
        S.wk.effort = Number(b.dataset.rpe);
        m.querySelectorAll('[data-rpe]').forEach((x) => x.classList.toggle('on', x === b));
      })
  );
  $('#wkBack').onclick = () => m.remove();
  $('#wkSaveBtn').onclick = async () => {
    const b = $('#wkSaveBtn');
    b.disabled = true;
    b.textContent = 'Saving…';
    S.wk.notes = $('#wkNotes').value.trim();
    try {
      const vol = volOf(S.wk.exs),
        sid = await wkPersist(),
        snap = fbSnapshot(sid);
      m.remove();
      toast(
        'Workout saved · ' +
          fmt(vol) +
          ' kg' +
          (prs.length ? ' · ' + prs.length + ' PR' + (prs.length > 1 ? 's' : '') : '')
      );
      S.wk = null;
      S.wkRest = null;
      wkSave();
      S.wkHist = null;
      await render();
      fbStart(snap);
    } catch (e) {
      fail(e);
      b.disabled = false;
      b.textContent = 'Save workout';
    }
  };
}

async function wkPersist() {
  const exs = S.wk.exs.map((e) => ({ ...e, sets: e.sets.filter((s) => s.done) })).filter((e) => e.sets.length);
  const ses = await q(
    supabase
      .from('workout_sessions')
      .insert({
        user_id: S.user.id,
        local_date: S.wk.date,
        started_at: new Date(S.wk.startedAt).toISOString(),
        duration_minutes: Math.min(1440, Math.max(1, Math.round((Date.now() - S.wk.startedAt) / 60000))),
        workout_type: 'strength',
        title: (S.wk.title || 'Workout').trim().slice(0, 60) || 'Workout',
        notes: S.wk.notes || null,
        perceived_effort: S.wk.effort || null,
      })
      .select('id')
      .single()
  );
  try {
    const exRows = await q(
      supabase
        .from('workout_exercises')
        .insert(
          exs.map((e, i) => ({ user_id: S.user.id, workout_session_id: ses.id, exercise_name: e.name, sort_order: i }))
        )
        .select('id,sort_order')
    );
    const sets = [];
    exRows.forEach((r) => {
      exs[r.sort_order].sets.forEach((s, i) =>
        sets.push({
          user_id: S.user.id,
          workout_exercise_id: r.id,
          set_number: i + 1,
          reps: Math.max(0, Math.round(Number(s.reps) || 0)),
          weight_kg: Math.max(0, Number(s.kg) || 0),
        })
      );
    });
    if (sets.length) await q(supabase.from('workout_sets').insert(sets));
  } catch (e) {
    await supabase.from('workout_sessions').delete().eq('id', ses.id).eq('user_id', S.user.id);
    throw e;
  }
  return ses.id;
}

export function wireWk() {
  const pb = $('#pagebody');
  if (!pb || !S.wk) return;
  pb.querySelectorAll('[data-wk]').forEach(
    (inp) =>
      (inp.oninput = () => {
        const [xi, si, k] = inp.dataset.wk.split(':');
        S.wk.exs[xi].sets[si][k === 'kg' ? 'kg' : 'reps'] = inp.value;
        wkSave();
      })
  );
  pb.querySelectorAll('[data-wktick]').forEach(
    (b) =>
      (b.onclick = () => {
        const [xi, si] = b.dataset.wktick.split(':').map(Number);
        wkToggle(xi, si);
      })
  );
  pb.querySelectorAll('[data-wkaddset]').forEach(
    (b) =>
      (b.onclick = () => {
        const e = S.wk.exs[Number(b.dataset.wkaddset)],
          l = e.sets[e.sets.length - 1];
        e.sets.push({ kg: l?.kg ?? '', reps: l?.reps ?? 10, done: false, pr: false });
        wkSave();
        renderWk(true);
      })
  );
  pb.querySelectorAll('[data-wkdelset]').forEach(
    (b) =>
      (b.onclick = () => {
        const e = S.wk.exs[Number(b.dataset.wkdelset)];
        if (e.sets.length > 1) {
          e.sets.pop();
          wkSave();
          renderWk(true);
        }
      })
  );
  pb.querySelectorAll('[data-wkdelex]').forEach(
    (b) =>
      (b.onclick = async () => {
        const e = S.wk.exs[Number(b.dataset.wkdelex)];
        if (
          e.sets.some((s) => s.done) &&
          !(await uiConfirm('Remove exercise?', 'Remove ' + e.name + ' and its logged sets?', {
            confirm: 'Remove',
            danger: true,
          }))
        )
          return;
        S.wk.exs.splice(Number(b.dataset.wkdelex), 1);
        wkSave();
        renderWk(true);
      })
  );
  pb.querySelectorAll('[data-wkrest]').forEach(
    (b) =>
      (b.onclick = () => {
        S.wkRestDefault = Number(b.dataset.wkrest);
        renderWk(true);
      })
  );
  $('#wkTitle').oninput = (e) => {
    S.wk.title = e.target.value;
    wkSave();
  };
  $('#wkAddEx').onsubmit = (e) => {
    e.preventDefault();
    const n = new FormData(e.currentTarget).get('name').trim();
    if (!n) return;
    S.wk.exs.push(wkMakeEx(n));
    wkSave();
    renderWk(true);
    setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 30);
  };
  $('#wkFinish').onclick = wkFinishModal;
  $('#wkDiscard').onclick = async () => {
    if (
      !(await uiConfirm('Discard workout?', 'Nothing from this session will be saved.', {
        confirm: 'Discard',
        danger: true,
      }))
    )
      return;
    S.wk = null;
    S.wkRest = null;
    wkSave();
    renderWk();
  };
  $('#wkRestAdd').onclick = () => {
    S.wkRest = Math.max(S.wkRest || 0, Date.now()) + 15000;
  };
  $('#wkRestSkip').onclick = () => {
    S.wkRest = null;
  };
  clearInterval(S.wkTick);
  S.wkTick = setInterval(wkTickFn, 500);
  wkTickFn();
}
