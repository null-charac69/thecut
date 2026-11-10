import { today, esc, dateFmt } from './lib/format.js';
import { friendlyError } from './lib/errors.js';
import { S } from './state.js';
import { clearPushForCurrentUser, logout, renderAuthV2 } from './auth.js';
import { $, q, supabase } from './client.js';
import { unsubscribeInsights } from './coach.js';
import { card, gotoTab, pageHead, render } from './shell.js';
import { fail, toast, uiModal } from './ui.js';

async function exportData() {
  const tables = [
    'user_settings',
    'foods',
    'meal_templates',
    'meal_template_items',
    'daily_targets',
    'daily_meals',
    'food_entries',
    'daily_checkins',
    'body_measurements',
    'progress_photos',
    'workout_sessions',
    'workout_exercises',
    'workout_sets',
    'daily_activity',
    'water_logs',
    'grocery_items',
    'prep_tasks',
    'reminders',
    'push_notification_deliveries',
    'ai_plan_versions',
    'agent_insights',
    'agent_baseline',
    'workout_feedback',
    'workout_reviews',
  ];
  const backup = {
    product: 'THE CUT',
    schema_version: 1,
    exported_at: new Date().toISOString(),
    user_id: S.user.id,
    data: {},
  };
  try {
    const profile = await q(supabase.from('profiles').select('*').eq('id', S.user.id).maybeSingle());
    backup.data.profiles = profile ? [profile] : [];
    for (const table of tables) {
      let rows = [],
        offset = 0,
        batch = [];
      do {
        batch = await q(
          supabase
            .from(table)
            .select('*')
            .eq('user_id', S.user.id)
            .range(offset, offset + 999)
        );
        rows = rows.concat(batch);
        offset += batch.length;
      } while (batch.length === 1000);
      backup.data[table] = rows;
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'the-cut-backup-' + today() + '.json';
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Your JSON backup has been generated.');
    return true;
  } catch (e) {
    fail(e);
    return false;
  }
}

/* session expiry: unexpected sign-out while the app is open */

/* ================= v5: Account page, avatar menu, delete account ================= */
export function accountV3() {
  const name = S.user.user_metadata?.name || '';
  const since = S.user.created_at
    ? dateFmt(S.user.created_at.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';
  return `${pageHead('Profile · Data · Security', 'Account', 'Your details, your data and your account controls.')}
 <div class="grid g2">
 ${card(
   'Profile',
   `<div class="acct-id"><div class="acct-av" aria-hidden="true">${esc((name || S.user.email || 'U').slice(0, 1).toUpperCase())}</div><div class="grow"><strong>${esc(name || 'No name set')}</strong><small>${esc(S.user.email)}</small></div><button class="btn sm" type="button" id="acctChangeEmail">Change email</button></div>
 <form id="acctForm" class="u-mt16"><div class="field"><label>Display name</label><input name="name" value="${esc(name)}" maxlength="60" placeholder="Your name" autocomplete="name"/></div><button class="btn primary" type="submit">Save name</button></form>
 <div class="acct-meta"><div><small>Member since</small><b>${since}</b></div><div><small>Current plan</small><b>${S.aiActivePlan ? esc(S.aiActivePlan.title || 'Active plan') : 'No plan applied'}</b></div></div>`
 )}
 ${card(
   'Data & security',
   `<p class="muted small u-mt0">Your data is private to this account. Download a full copy any time.</p>
 <div class="acct-actions"><button class="btn" id="acctExport">Download my data (JSON)</button><button class="btn" id="acctReset">Email me a password reset link</button><button class="btn" id="acctSignout">Sign out</button></div>`
 )}
 </div>
 ${S.aiPlanHistory.length ? `<div class="u-mt16">${card('Plan history', S.aiPlanHistory.map((x) => `<div class="listitem"><div class="grow"><strong>${esc(x.title)}</strong><small>${dateFmt((x.created_at || '').slice(0, 10), { day: 'numeric', month: 'short' })} · ${esc(x.status)}</small></div>${x.status === 'active' ? '<span class="tag">In use</span>' : x.status === 'draft' ? '' : `<button class="btn sm" data-ai-restore="${x.id}">Restore</button>`}</div>`).join(''))}</div>` : ''}
 <div class="u-mt16"><section class="card danger-zone"><div class="section-title"><h2>Danger zone</h2></div><p class="muted u-mt0">Deleting your account permanently erases your plans, meals, workouts, weight history, photos and coach data. This cannot be undone.</p><button class="btn danger" id="acctDelete">Delete account</button></section></div>`;
}

function closeAcctMenu() {
  document.getElementById('acctMenu')?.remove();
  document.removeEventListener('click', _acctOutside, true);
  document.removeEventListener('keydown', _acctEsc, true);
}

function _acctOutside(e) {
  if (!e.target.closest('#acctMenu,#acctBtn')) closeAcctMenu();
}

function _acctEsc(e) {
  if (e.key === 'Escape') {
    closeAcctMenu();
    $('#acctBtn')?.focus();
  }
}

function openAcctMenu() {
  if (document.getElementById('acctMenu')) {
    closeAcctMenu();
    return;
  }
  const b = $('#acctBtn'),
    r = b.getBoundingClientRect(),
    m = document.createElement('div');
  m.id = 'acctMenu';
  m.setAttribute('role', 'menu');
  m.style.cssText = 'top:' + (r.bottom + 8) + 'px;right:' + Math.max(8, window.innerWidth - r.right) + 'px';
  m.innerHTML = `<div class="am-head"><b>${esc(S.user.user_metadata?.name || 'Your account')}</b><small>${esc(S.user.email)}</small></div><button role="menuitem" data-am="account">Account &amp; settings</button><button role="menuitem" data-am="export">Download my data</button><button role="menuitem" data-am="signout">Sign out</button><button role="menuitem" class="am-danger" data-am="delete">Delete account…</button>`;
  document.body.appendChild(m);
  b.setAttribute('aria-expanded', 'true');
  m.querySelectorAll('[data-am]').forEach(
    (x) =>
      (x.onclick = async () => {
        const a = x.dataset.am;
        closeAcctMenu();
        if (a === 'account') await gotoTab('account');
        else if (a === 'export') exportData();
        else if (a === 'signout') logout();
        else if (a === 'delete') deleteAccountFlow();
      })
  );
  setTimeout(() => {
    document.addEventListener('click', _acctOutside, true);
    document.addEventListener('keydown', _acctEsc, true);
  }, 0);
  m.querySelector('button').focus();
}

export function wireAccount() {
  const b = $('#acctBtn');
  if (b) b.onclick = openAcctMenu;
  $('#acctForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name') || '').trim();
    try {
      const { data, error } = await supabase.auth.updateUser({ data: { name } });
      if (error) throw error;
      S.user = data.user;
      await q(
        supabase
          .from('profiles')
          .update({ display_name: name || null })
          .eq('id', S.user.id)
      );
      toast('Name saved');
      await render();
    } catch (err) {
      fail(err);
    }
  });
  $('#acctChangeEmail')?.addEventListener('click', changeEmailFlow);
  $('#acctExport')?.addEventListener('click', () => exportData());
  $('#acctSignout')?.addEventListener('click', () => logout());
  $('#acctReset')?.addEventListener('click', () => authForgotSignedIn());
  $('#acctDelete')?.addEventListener('click', () => deleteAccountFlow());
}

function changeEmailFlow() {
  document.getElementById('emModal')?.remove();
  const opener = document.activeElement;
  const m = document.createElement('div');
  m.className = 'modal-bg';
  m.id = 'emModal';
  m.innerHTML = `<div class="modal u-tal" role="dialog" aria-modal="true" aria-labelledby="emT"><h2 id="emT" class="u-tac">Change email</h2><p class="muted u-tac">Currently <b>${esc(S.user.email)}</b>. We will send a confirmation link to both your old and new address. The change applies once you confirm.</p><form id="emForm"><div class="field"><label for="emNew">New email</label><input id="emNew" type="email" required autocomplete="email" placeholder="you@example.com"/></div><p class="muted small" id="emMsg" role="status"></p><div class="modal-actions"><button class="btn primary" type="submit" id="emGo">Send confirmation</button><button class="btn ghost" type="button" id="emCancel">Cancel</button></div></form></div>`;
  document.body.appendChild(m);
  const close = () => {
    m.remove();
    document.removeEventListener('keydown', onKey, true);
    try {
      opener?.focus?.();
    } catch (_) {}
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  $('#emCancel').onclick = close;
  $('#emNew').focus();
  $('#emForm').onsubmit = async (e) => {
    e.preventDefault();
    const v = $('#emNew').value.trim().toLowerCase();
    if (v === String(S.user.email).toLowerCase()) {
      $('#emMsg').textContent = 'That is already your email.';
      return;
    }
    const b = $('#emGo');
    b.disabled = true;
    b.textContent = 'Sending…';
    try {
      const { error } = await supabase.auth.updateUser({ email: v }, { emailRedirectTo: location.origin });
      if (error) throw error;
      close();
      uiModal({
        icon: '✉',
        title: 'Check both inboxes',
        body:
          'We sent confirmation links to <b>' +
          esc(S.user.email) +
          '</b> and <b>' +
          esc(v) +
          '</b>. Open both to finish the change. Until then you keep signing in with your current email.',
        tone: 'ok',
        actions: [{ label: 'Got it', primary: true }],
      });
    } catch (err) {
      b.disabled = false;
      b.textContent = 'Send confirmation';
      const f = friendlyError(err);
      $('#emMsg').textContent = f.title + '. ' + f.body.replace(/<[^>]+>/g, '');
    }
  };
}

async function authForgotSignedIn() {
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(S.user.email, { redirectTo: location.origin });
    if (error) throw error;
    uiModal({
      icon: '✉',
      title: 'Check your email',
      body: 'We sent a password reset link to <b>' + esc(S.user.email) + '</b>.',
      tone: 'ok',
      actions: [{ label: 'Got it', primary: true }],
    });
  } catch (e) {
    fail(e);
  }
}

function deleteAccountFlow() {
  document.getElementById('delModal')?.remove();
  const opener = document.activeElement;
  const m = document.createElement('div');
  m.className = 'modal-bg';
  m.id = 'delModal';
  m.innerHTML = `<div class="modal tone-error u-tal" role="alertdialog" aria-modal="true" aria-labelledby="delT" aria-describedby="delB"><div class="mail-ico ico-error" aria-hidden="true">!</div><h2 id="delT" class="u-tac">Delete your account?</h2>
 <div id="delB"><p class="muted">This permanently erases everything tied to <b>${esc(S.user.email)}</b>:</p><ul class="del-list"><li>Your plan, meals, workouts and weight history</li><li>Progress photos and coach insights</li><li>Your login. You will be signed out for good</li></ul><p class="muted"><b>This cannot be undone.</b></p></div>
 <button class="btn u-w100" id="delExport" type="button">Download my data first</button>
 <div class="field u-mt14"><label for="delConfirm">Type <b>DELETE</b> to confirm</label><input id="delConfirm" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="DELETE"/></div>
 <p class="muted small" id="delMsg" role="status"></p>
 <div class="modal-actions"><button class="btn danger" id="delGo" type="button" disabled>Delete my account forever</button><button class="btn ghost" id="delCancel" type="button">Cancel</button></div></div>`;
  document.body.appendChild(m);
  const inp = $('#delConfirm'),
    go = $('#delGo'),
    msg = (t) => {
      $('#delMsg').textContent = t;
    };
  let busy = false;
  const close = () => {
    if (busy) return;
    m.remove();
    document.removeEventListener('keydown', onKey, true);
    try {
      opener?.focus?.();
    } catch (_) {}
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
    if (e.key === 'Tab') {
      const f = [...m.querySelectorAll('button:not([disabled]),input')];
      const a = f[0],
        z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey, true);
  inp.oninput = () => {
    go.disabled = busy || inp.value.trim() !== 'DELETE';
  };
  $('#delCancel').onclick = close;
  $('#delExport').onclick = async () => {
    const b = $('#delExport');
    b.disabled = true;
    b.textContent = 'Preparing…';
    const ok = await exportData();
    b.disabled = false;
    b.textContent = ok ? 'Downloaded. Download again' : 'Download my data first';
  };
  go.onclick = async () => {
    if (inp.value.trim() !== 'DELETE' || busy) return;
    busy = true;
    go.disabled = true;
    $('#delCancel').disabled = true;
    go.textContent = 'Deleting…';
    msg('Erasing your data. Keep this window open.');
    try {
      try {
        await clearPushForCurrentUser();
      } catch (_) {}
      const { data, error } = await supabase.functions.invoke('delete-account', { body: { confirm: 'DELETE' } });
      if (error) throw error;
      if (data && data.error) throw new Error(data.error);
      const uid = S.user.id;
      S._manualSignOut = true;
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch (_) {}
      try {
        Object.keys(localStorage)
          .filter((k) => k.startsWith('cut_') && k.includes(uid))
          .forEach((k) => localStorage.removeItem(k));
      } catch (_) {}
      busy = false;
      m.remove();
      document.removeEventListener('keydown', onKey, true);
      S.session = null;
      S.user = null;
      S.wk = null;
      S.wkHist = null;
      S.aiActivePlan = null;
      unsubscribeInsights();
      renderAuthV2();
      uiModal({
        icon: '✓',
        title: 'Account deleted',
        body: 'Your account and all its data have been permanently erased.',
        tone: 'ok',
        actions: [{ label: 'Done', primary: true }],
      });
    } catch (err) {
      busy = false;
      go.disabled = false;
      $('#delCancel').disabled = false;
      go.textContent = 'Delete my account forever';
      let em = err?.message || '';
      try {
        if (err?.context?.json) {
          const j = await err.context.json();
          em = j.error || em;
        }
      } catch (_) {}
      msg('');
      uiModal({
        title: 'Could not delete account',
        body: esc(em || 'Something went wrong. Nothing was deleted if you are still signed in. Please try again.'),
        id: 'delErr',
        actions: [{ label: 'OK', primary: true }],
      });
    }
  };
  inp.focus();
}
