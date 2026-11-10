import { esc } from './lib/format.js';
import { friendlyError } from './lib/errors.js';
import { S } from './state.js';
import { $, supabase } from './client.js';

/* ================= v4: feedback layer — popups, friendly errors, offline/session states ================= */
export function uiModal({
  icon = '!',
  title,
  body = '',
  actions = [{ label: 'OK', primary: true }],
  tone = 'error',
  id = 'uiModal',
}) {
  document.getElementById(id)?.remove();
  S._modalOpener = document.activeElement;
  const m = document.createElement('div');
  m.className = 'modal-bg';
  m.id = id;
  m.innerHTML = `<div class="modal tone-${tone}" role="alertdialog" aria-modal="true" aria-labelledby="${id}T" aria-describedby="${id}B"><div class="mail-ico ico-${tone}" aria-hidden="true">${icon}</div><h2 id="${id}T">${esc(title)}</h2><p class="muted" id="${id}B">${body}</p><div class="modal-actions">${actions.map((a, i) => `<button type="button" class="btn ${a.primary ? 'primary' : a.danger ? 'danger' : 'ghost'}" data-act="${i}">${esc(a.label)}</button>`).join('')}</div></div>`;
  document.body.appendChild(m);
  const close = () => {
    m.remove();
    document.removeEventListener('keydown', onKey, true);
    try {
      S._modalOpener?.focus?.();
    } catch (_) {}
  };
  const run = (i) => {
    const a = actions[i];
    close();
    try {
      a.onClick && a.onClick();
    } catch (e) {
      console.error(e);
    }
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      run(actions.findIndex((a) => a.cancel) >= 0 ? actions.findIndex((a) => a.cancel) : actions.length - 1);
    }
    if (e.key === 'Tab') {
      const f = [...m.querySelectorAll('button')];
      if (!f.length) return;
      const first = f[0],
        last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey, true);
  m.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => run(Number(b.dataset.act))));
  const pri = m.querySelector('.btn.primary') || m.querySelector('.btn');
  pri && pri.focus();
  return m;
}

export function uiConfirm(title, body, { confirm = 'Confirm', cancel = 'Cancel', danger = false } = {}) {
  return new Promise((res) =>
    uiModal({
      icon: danger ? '!' : '?',
      title,
      body: esc(body),
      tone: danger ? 'error' : 'info',
      id: 'uiConfirm',
      actions: [
        { label: cancel, cancel: true, onClick: () => res(false) },
        { label: confirm, primary: !danger, danger, onClick: () => res(true) },
      ],
    })
  );
}

/* Modal form: values are validated, the save runs inside the dialog so a failure keeps the input, and a second submit is ignored while saving. Resolves true when saved, false when cancelled. */
export function uiForm({
  title,
  intro = '',
  submit = 'Save',
  fields = [],
  validate = () => '',
  onSubmit,
  id = 'uiForm',
}) {
  return new Promise((res) => {
    document.getElementById(id)?.remove();
    const opener = document.activeElement,
      m = document.createElement('div');
    m.className = 'modal-bg';
    m.id = id;
    const ctl = (f) => {
      const a = `name="${f.name}" id="${id}_${f.name}"${f.required ? ' required' : ''}${f.maxlength ? ` maxlength="${f.maxlength}"` : ''}${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''}`;
      if (f.type === 'textarea') return `<textarea ${a} rows="${f.rows || 3}">${esc(f.value || '')}</textarea>`;
      return `<input ${a} type="${f.type || 'text'}" value="${esc(f.value ?? '')}"${f.min != null ? ` min="${f.min}"` : ''}${f.max != null ? ` max="${f.max}"` : ''}${f.step != null ? ` step="${f.step}"` : ''}${f.inputmode ? ` inputmode="${f.inputmode}"` : ''}/>`;
    };
    m.innerHTML = `<form class="modal modal-form" role="dialog" aria-modal="true" aria-labelledby="${id}T"${intro ? ` aria-describedby="${id}B"` : ''} novalidate><h2 id="${id}T">${esc(title)}</h2>${intro ? `<p class="muted small" id="${id}B">${esc(intro)}</p>` : ''}<div class="formgrid">${fields.map((f) => `<div class="field${f.full ? ' full' : ''}"><label for="${id}_${f.name}">${esc(f.label)}</label>${ctl(f)}</div>`).join('')}</div><p class="form-error" role="alert" hidden></p><div class="modal-actions"><button type="submit" class="btn primary">${esc(submit)}</button><button type="button" class="btn ghost" data-cancel>Cancel</button></div></form>`;
    document.body.appendChild(m);
    const form = m.querySelector('form'),
      err = m.querySelector('.form-error'),
      save = m.querySelector('[type=submit]');
    let busy = false;
    const close = (ok) => {
      document.removeEventListener('keydown', onKey, true);
      m.remove();
      try {
        opener?.focus?.();
      } catch (_) {}
      res(ok);
    };
    const show = (t) => {
      err.textContent = t;
      err.hidden = !t;
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation();
        close(false);
      }
      if (e.key === 'Tab') {
        const f = [...m.querySelectorAll('input,textarea,select,button')].filter((x) => !x.disabled);
        if (!f.length) return;
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
    m.querySelector('[data-cancel]').onclick = () => {
      if (!busy) close(false);
    };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;
      const v = {};
      fields.forEach((f) => (v[f.name] = String(form.elements[f.name].value ?? '')));
      const bad = validate(v);
      if (bad) {
        show(bad);
        return;
      }
      busy = true;
      save.disabled = true;
      save.textContent = 'Saving…';
      show('');
      try {
        await onSubmit(v);
        close(true);
      } catch (ex) {
        busy = false;
        save.disabled = false;
        save.textContent = submit;
        show(friendlyError(ex).body || friendlyError(ex).title);
      }
    });
    form.elements[fields[0]?.name]?.focus();
  });
}

export function authError(err, { email = '', mode = 'in', setMode } = {}) {
  const f = friendlyError(err);
  const emailEl = $('input[name=email]'),
    pwEl = $('input[name=password]');
  const retry = () => {
    const el = f.kind === 'exists' || f.kind === 'net' ? emailEl : pwEl;
    if (el) {
      el.focus();
      if (f.kind === 'creds' && el.select) el.select();
    }
  };
  const acts = [];
  if (f.kind === 'creds')
    acts.push(
      { label: 'Forgot password?', onClick: () => authForgot(email) },
      {
        label: 'Create account',
        onClick: () => {
          setMode && setMode('up');
          emailEl?.focus();
        },
      }
    );
  if (f.kind === 'exists')
    acts.push(
      { label: 'Forgot password?', onClick: () => authForgot(email) },
      {
        label: 'Sign in instead',
        onClick: () => {
          setMode && setMode('in');
          pwEl?.focus();
        },
      }
    );
  acts.push({ label: f.kind === 'net' ? 'Try again' : 'OK', primary: true, cancel: true, onClick: retry });
  const am = $('#authMsg');
  if (am) am.textContent = f.title + '.';
  uiModal({ title: f.title, body: f.body, actions: acts, tone: 'error' });
}

export async function authForgot(emailIn) {
  const emailEl = $('input[name=email]');
  const email = String(emailIn || emailEl?.value || '').trim();
  if (!email) {
    uiModal({
      icon: '✉',
      title: 'Enter your email first',
      body: 'Type your account email in the email field, then tap “Forgot password?”.',
      tone: 'info',
      actions: [{ label: 'OK', primary: true, onClick: () => emailEl?.focus() }],
    });
    return;
  }
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
    if (error) throw error;
    uiModal({
      icon: '✉',
      title: 'Check your email',
      body:
        'If an account exists for <b>' +
        esc(email) +
        '</b>, a reset link is on its way. Open it on this device. Check spam if you don’t see it.',
      tone: 'ok',
      actions: [{ label: 'Got it', primary: true }],
    });
  } catch (err) {
    const f = friendlyError(err);
    uiModal({ title: f.title, body: f.body, actions: [{ label: 'OK', primary: true }] });
  }
}

/* error-aware toast + global safety nets */
export function fail(e) {
  console.error(e);
  const f = friendlyError(e);
  toast(f.kind === 'other' ? e?.message || f.body : f.title + '. ' + f.body.replace(/<[^>]+>/g, ''), 'error');
}

export function toastUndo(msg, undo) {
  const t = $('#toast');
  t.textContent = msg + ' ';
  t.className = 'toast';
  t.setAttribute('role', 'status');
  if (undo) {
    const b = document.createElement('button');
    b.className = 'btn sm';
    b.type = 'button';
    b.textContent = 'Undo';
    b.onclick = () => {
      t.classList.add('hidden');
      undo();
    };
    t.appendChild(b);
  }
  clearTimeout(S.toastTimer);
  S.toastTimer = setTimeout(() => t.classList.add('hidden'), 9000);
}

export function toast(msg, kind) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (kind === 'error' ? ' err' : '');
  t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  clearTimeout(S.toastTimer);
  S.toastTimer = setTimeout(() => t.classList.add('hidden'), kind === 'error' ? 6000 : 3200);
}

window.addEventListener('unhandledrejection', (ev) => {
  const r = ev.reason;
  if (r && /AbortError|ResizeObserver/.test(String(r.name || r.message || ''))) return;
  console.error(r);
  if (document.querySelector('.modal-bg')) return;
  fail(r);
});

(function netBanner() {
  let el = null;
  const sync = () => {
    if (!navigator.onLine) {
      if (!el) {
        el = document.createElement('div');
        el.id = 'offlineBar';
        el.setAttribute('role', 'alert');
        el.textContent = 'You’re offline. Changes can’t be saved until you reconnect.';
        document.body.appendChild(el);
      }
    } else if (el) {
      el.remove();
      el = null;
      toast('Back online');
    }
  };
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  sync();
})();

/* accessibility: tie every .field label to its control */
(function a11yLabels() {
  let n = 0;
  const link = () => {
    document.querySelectorAll('.field').forEach((f) => {
      const l = f.querySelector('label'),
        c = f.querySelector('input,select,textarea');
      if (!l || !c || l.htmlFor) return;
      if (!c.id) c.id = 'fld' + ++n;
      l.htmlFor = c.id;
      if (!c.getAttribute('aria-label') && !c.placeholder) c.setAttribute('aria-label', l.textContent.trim());
    });
  };
  new MutationObserver(link).observe(document.getElementById('root'), { childList: true, subtree: true });
  link();
})();
