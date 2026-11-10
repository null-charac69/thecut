import { friendlyError } from './lib/errors.js';
import { esc } from './lib/format.js';
import { S } from './state.js';
import { $, q, supabase } from './client.js';
import { unsubscribeInsights } from './coach.js';
import { bootstrap } from './shell.js';
import { authError, authForgot, toast, uiModal } from './ui.js';

export async function logout() {
  S._manualSignOut = true;
  await clearPushForCurrentUser();
  await supabase.auth.signOut();
  S.session = null;
  S.user = null;
  renderAuthV2();
}

supabase.auth.onAuthStateChange((event, s) => {
  S.session = s;
  if (event === 'SIGNED_IN' && !S.user && s && document.getElementById('verifyModal')) {
    S.session = s;
    document.getElementById('verifyModal').remove();
    bootstrap();
  }
  if (event === 'SIGNED_OUT') {
    const wasIn = !!S.user && !S._manualSignOut;
    S._manualSignOut = false;
    S.user = null;
    S.wk = null;
    S.wkHist = null;
    S.aiActivePlan = null;
    unsubscribeInsights();
    S.aiUnlocked = false;
    S.insights = [];
    S.coachReview = null;
    renderAuthV2();
    if (wasIn)
      uiModal({
        title: 'Session expired',
        body: 'For your security you were signed out. Sign in again to continue.',
        tone: 'info',
        icon: '\u23f1',
        actions: [{ label: 'Sign in', primary: true }],
      });
  }
  if (event === 'PASSWORD_RECOVERY') {
    S.recoveryMode = true;
    renderPasswordRecovery();
  }
});

export async function clearPushForCurrentUser() {
  try {
    if (!S.user || !('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await q(
        supabase.from('push_subscriptions').delete().eq('user_id', S.user.id).eq('endpoint', subscription.endpoint)
      );
      await subscription.unsubscribe();
    }
  } catch (e) {
    console.warn('Could not clear device push subscription', e);
  }
}

function renderPasswordRecovery() {
  $('#root').innerHTML =
    `<div class="authwrap"><div class="authcard"><div class="brand"><div class="mark"></div><div><b>THE CUT<span>.</span></b><small>ACCOUNT RECOVERY</small></div></div><h1>Set a new password.</h1><p class="muted">Choose a new password for your account.</p><form id="recoverForm"><div class="field"><label>NEW PASSWORD</label><input name="password" type="password" minlength="8" required autocomplete="new-password"/></div><div class="field"><label>CONFIRM PASSWORD</label><input name="confirm" type="password" minlength="8" required autocomplete="new-password"/></div><button class="btn primary u-w100">Update password</button><p class="muted small" id="recoverMsg"></p></form></div></div>`;
  $('#recoverForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      p = f.get('password');
    if (p !== f.get('confirm')) {
      $('#recoverMsg').textContent = 'Passwords do not match.';
      uiModal({
        title: 'Passwords don\u2019t match',
        body: 'Type the same new password in both fields.',
        actions: [{ label: 'OK', primary: true }],
      });
      return;
    }
    const b = e.currentTarget.querySelector('button');
    b.disabled = true;
    try {
      const { error } = await supabase.auth.updateUser({ password: p });
      if (error) throw error;
      S.recoveryMode = false;
      S.session = (await supabase.auth.getSession()).data.session;
      toast('Password updated');
      await bootstrap();
    } catch (err) {
      const f = friendlyError(err);
      $('#recoverMsg').textContent = f.title + '.';
      uiModal({ title: f.title, body: f.body, actions: [{ label: 'OK', primary: true }] });
    } finally {
      b.disabled = false;
    }
  };
}

export function renderAuthV2() {
  $('#root').innerHTML =
    `<div class="authwrap"><div class="authcard"><div class="brand"><div class="mark"></div><div><b>THE CUT<span>.</span></b><small>DAILY TRANSFORMATION SYSTEM</small></div></div><h1>Own the process.</h1><p class="muted">Your nutrition, training and progress. One private workspace.</p><div class="authswitch"><button class="btn primary" id="modeIn">Sign in</button><button class="btn" id="modeUp">Create account</button></div><form id="authForm"><div id="nameField" class="field hidden"><label>YOUR NAME</label><input name="name" autocomplete="name" placeholder="Name"/></div><div class="field"><label>EMAIL</label><input name="email" type="email" required autocomplete="email" placeholder="you@example.com"/></div><div class="field"><label>PASSWORD</label><div class="pw"><input name="password" type="password" required minlength="8" autocomplete="current-password" placeholder="At least 8 characters"/><button type="button" class="pwtoggle" id="pwToggle" aria-label="Show password" aria-pressed="false">Show</button></div></div><button class="btn primary u-w100 u-mt8" type="submit">Sign in</button><button class="btn ghost u-w100 u-mt8" id="forgotPass" type="button">Forgot password?</button><p class="muted small" id="authMsg">Your account is secured with Supabase authentication.</p></form><p class="muted small">Your private tracking data is protected by per-account database policies.</p></div></div>`;
  let mode = 'in';
  const setMode = (m) => {
    mode = m;
    $('#modeIn').classList.toggle('primary', m === 'in');
    $('#modeUp').classList.toggle('primary', m === 'up');
    $('#nameField').classList.toggle('hidden', m === 'in');
    $('#authForm button[type=submit]').textContent = m === 'in' ? 'Sign in' : 'Create account';
    $('#authMsg').textContent =
      m === 'in' ? 'Use your account email and password.' : 'We may send a verification link to your email.';
    $('input[name=password]').autocomplete = m === 'in' ? 'current-password' : 'new-password';
  };
  $('#modeIn').onclick = () => setMode('in');
  $('#modeUp').onclick = () => setMode('up');
  $('#pwToggle').onclick = () => {
    const i = $('input[name=password]'),
      t = $('#pwToggle'),
      show = i.type === 'password';
    i.type = show ? 'text' : 'password';
    t.textContent = show ? 'Hide' : 'Show';
    t.setAttribute('aria-pressed', String(show));
    t.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  };
  $('#forgotPass').onclick = () => authForgot();
  $('#authForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      email = String(f.get('email')).trim(),
      password = f.get('password'),
      b = e.currentTarget.querySelector('button[type=submit]');
    if (!navigator.onLine) {
      authError({ message: 'Failed to fetch' }, { email, mode, setMode });
      return;
    }
    b.disabled = true;
    b.textContent = 'Please wait…';
    try {
      if (mode === 'up') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name: f.get('name') }, emailRedirectTo: location.origin },
        });
        if (error) throw error;
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0)
          throw { message: 'User already registered' };
        if (data.session) {
          S.session = data.session;
          await bootstrap();
        } else showVerifyModal(email, password);
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        S.session = data.session;
        await bootstrap();
      }
    } catch (err) {
      if (mode === 'in' && /confirm/i.test(err.message || '')) showVerifyModal(email, password);
      else authError(err, { email, mode, setMode });
    } finally {
      b.disabled = false;
      b.textContent = mode === 'in' ? 'Sign in' : 'Create account';
    }
  };
}

/* ---------- email verification modal ---------- */
function showVerifyModal(email, password) {
  document.getElementById('verifyModal')?.remove();
  const m = document.createElement('div');
  m.className = 'modal-bg';
  m.id = 'verifyModal';
  m.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="vmTitle"><div class="mail-ico">✉</div><h2 id="vmTitle">Verify your email</h2><p class="muted">We sent a verification link to<br><b>${esc(email)}</b>.<br>Open it, then come back here and press the button.</p><p class="muted small" id="vmMsg" role="status"></p>
 <button class="btn primary u-w100" id="vmDone">I have verified</button><div class="row vm-sub"><button class="btn ghost" id="vmResend">Resend email</button><button class="btn ghost" id="vmChange">Use a different email</button></div></div>`;
  document.body.appendChild(m);
  const msg = (t) => {
    $('#vmMsg').textContent = t;
  };
  $('#vmDone').onclick = async () => {
    const b = $('#vmDone');
    b.disabled = true;
    b.textContent = 'Checking…';
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        if (/confirm/i.test(error.message)) msg('Not verified yet. Open the link in your email first, then try again.');
        else msg(error.message);
        return;
      }
      if (!document.getElementById('verifyModal')) return;
      S.session = data.session;
      m.remove();
      await bootstrap();
    } catch (e) {
      msg(e.message);
    } finally {
      b.disabled = false;
      b.textContent = 'I have verified';
    }
  };
  let cool = 0;
  const rb = $('#vmResend');
  rb.onclick = async () => {
    if (cool > 0) return;
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: location.origin },
      });
      if (error) throw error;
      msg('Sent again. Check your inbox and spam folder.');
      cool = 30;
      rb.disabled = true;
      const t = setInterval(() => {
        cool--;
        rb.textContent = cool > 0 ? 'Resend in ' + cool + 's' : 'Resend email';
        if (cool <= 0) {
          rb.disabled = false;
          clearInterval(t);
        }
      }, 1000);
    } catch (e) {
      msg(e.message);
    }
  };
  $('#vmChange').onclick = () => m.remove();
  $('#vmDone').focus();
}
