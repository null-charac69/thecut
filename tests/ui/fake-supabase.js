// Browser-side stand-in for @supabase/supabase-js, served in place of https://esm.sh/@supabase/supabase-js.
// It keeps an in-memory database in window.__FAKE so the real app can be exercised without a network.
// This is test scaffolding only: it mimics the small slice of the API the app uses.
const F = () => window.__FAKE;
const uid = () => crypto.randomUUID();
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const FK = { meal_template_items: 'meal_template_id', workout_exercises: 'workout_session_id', workout_sets: 'workout_exercise_id' };
const PK = { profiles: ['id'], user_settings: ['user_id'], daily_targets: ['user_id', 'local_date'], body_measurements: ['id'] };

function splitTop(s) {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++; if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function project(table, rows, cols) {
  const parts = splitTop(cols || '*');
  const plain = parts.filter((p) => !p.includes('(')), embeds = parts.filter((p) => p.includes('('));
  return rows.map((r) => {
    const o = plain.includes('*') || !cols ? { ...r } : Object.fromEntries(plain.filter((c) => c in r).map((c) => [c, r[c]]));
    for (const e of embeds) {
      const name = e.slice(0, e.indexOf('(')), inner = e.slice(e.indexOf('(') + 1, -1), fk = FK[name];
      const kids = (F().tables[name] || []).filter((k) => k[fk] === r.id);
      o[name] = project(name, kids, inner);
    }
    return clone(o);
  });
}

class Q {
  constructor(table) { this.t = table; this.op = 'select'; this.filters = []; this.orders = []; this.sel = '*'; this.opts = {}; this.wantRows = false; this.mode = 'many'; this.lim = null; this.rng = null; }
  select(cols = '*', opts = {}) { if (this.op === 'select') { this.sel = cols; this.opts = opts; } else { this.wantRows = true; this.sel = cols; } return this; }
  insert(rows) { this.op = 'insert'; this.payload = rows; return this; }
  upsert(rows, o = {}) { this.op = 'upsert'; this.payload = rows; this.conflict = o.onConflict; return this; }
  update(p) { this.op = 'update'; this.payload = p; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
  neq(c, v) { this.filters.push((r) => r[c] !== v); return this; }
  gte(c, v) { this.filters.push((r) => r[c] >= v); return this; }
  lte(c, v) { this.filters.push((r) => r[c] <= v); return this; }
  in(c, vs) { this.filters.push((r) => vs.includes(r[c])); return this; }
  not(c, op, v) { if (op === 'is') this.filters.push((r) => (v === null ? r[c] !== null && r[c] !== undefined : r[c] !== v)); return this; }
  order(c, o = {}) { this.orders.push([c, o.ascending !== false]); return this; }
  limit(n) { this.lim = n; return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
  run() {
    const db = F(); const tbl = (db.tables[this.t] ||= []);
    db.calls.push({ table: this.t, op: this.op, payload: clone(this.payload) });
    if (db.failOn && db.failOn(this.t, this.op)) return { data: null, error: { message: 'simulated failure', code: 'X' } };
    const match = (r) => this.filters.every((f) => f(r));
    let rows;
    if (this.op === 'insert' || this.op === 'upsert') {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((p) => ({ id: uid(), created_at: new Date().toISOString(), ...clone(p) }));
      rows = [];
      for (const n of list) {
        if (this.op === 'upsert') {
          const keys = this.conflict ? this.conflict.split(',').map((s) => s.trim()) : PK[this.t] || ['id'];
          const ex = tbl.find((r) => keys.every((k) => r[k] === n[k] && n[k] !== undefined));
          if (ex) { Object.assign(ex, clone(this.payload.length ? n : n), { id: ex.id }); rows.push(ex); continue; }
        }
        tbl.push(n); rows.push(n);
      }
      if (!this.wantRows) return { data: null, error: null };
    } else if (this.op === 'update') {
      rows = tbl.filter(match); rows.forEach((r) => Object.assign(r, clone(this.payload), { updated_at: new Date().toISOString() }));
      if (!this.wantRows) return { data: null, error: null };
    } else if (this.op === 'delete') {
      rows = tbl.filter(match); db.tables[this.t] = tbl.filter((r) => !match(r)); return { data: null, error: null };
    } else {
      rows = tbl.filter(match);
    }
    for (const [c, asc] of [...this.orders].reverse()) rows = [...rows].sort((a, b) => (a[c] === b[c] ? 0 : a[c] == null ? 1 : b[c] == null ? -1 : (a[c] > b[c] ? 1 : -1) * (asc ? 1 : -1)));
    if (this.opts.head) return { data: null, count: rows.length, error: null };
    if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
    if (this.lim != null) rows = rows.slice(0, this.lim);
    const out = project(this.t, rows, this.sel);
    if (this.mode === 'single') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
    if (this.mode === 'maybe') return { data: out[0] || null, error: null };
    return { data: out, count: out.length, error: null };
  }
}

// RPCs that mirror the SQL in supabase/migrations (kept small; the SQL itself is covered by tests/db).
const RPC = {
  apply_ai_plan_version({ p_version_id, p_local_date, p_week_start }) {
    const db = F(), T = db.tables, u = db.session.user.id;
    const v = (T.ai_plan_versions || []).find((x) => x.id === p_version_id && x.user_id === u);
    if (!v) throw new Error('AI plan not found for this account');
    T.meal_templates.filter((t) => t.user_id === u).forEach((t) => (t.is_active = false));
    T.daily_meals = T.daily_meals.filter((m) => !(m.local_date === p_local_date && m.status === 'planned' && m.user_id === u));
    v.plan.meals.forEach((m, i) => {
      const t = { id: uid(), user_id: u, name: m.name, sort_order: i, planned_time: (m.time || '12:00') + ':00', is_active: true };
      T.meal_templates.push(t);
      (m.items || []).forEach((it, j) => T.meal_template_items.push({ id: uid(), user_id: u, meal_template_id: t.id, food_name_snapshot: it.name, unit: `${it.quantity || 1} ${it.unit || 'serving'}`, quantity: 1, sort_order: j, calories_kcal: it.calories_kcal || 0, protein_g: it.protein_g || 0 }));
      T.meal_template_items.push({ id: uid(), user_id: u, meal_template_id: t.id, food_name_snapshot: '__plan_total__', unit: 'AI plan total', quantity: 1, sort_order: 999, calories_kcal: m.totals.calories_kcal, protein_g: m.totals.protein_g });
    });
    const tg = v.plan.targets, s = T.user_settings.find((x) => x.user_id === u);
    Object.assign(s, { calorie_target: tg.calories_kcal, protein_target_g: tg.protein_g, carbs_target_g: tg.carbs_g, fat_target_g: tg.fat_g, fiber_target_g: tg.fibre_g, water_target_ml: tg.water_ml });
    const swap = (rows, scope, nameOf, listNames, extra) => {
      const mine = rows.filter((r) => r.user_id === u && scope(r) && r.source_version_id && r.source_version_id !== p_version_id);
      for (const r of mine) {
        if (listNames.includes(nameOf(r).toLowerCase())) r.source_version_id = p_version_id;
        else if (r.is_purchased || r.is_completed) r.source_version_id = null;
        else rows.splice(rows.indexOf(r), 1);
      }
      for (const n of extra) if (!rows.some((r) => r.user_id === u && scope(r) && nameOf(r).toLowerCase() === n.name.toLowerCase())) rows.push({ id: uid(), user_id: u, source_version_id: p_version_id, ...n.row });
    };
    const g = (v.plan.grocery_list || []).filter((x) => x.name);
    swap(T.grocery_items, (r) => r.week_start === p_week_start, (r) => r.name, g.map((x) => x.name.toLowerCase()), g.map((x) => ({ name: x.name, row: { week_start: p_week_start, name: x.name, quantity: x.quantity, category: x.category || 'PRODUCE', sort_order: 0, is_purchased: false } })));
    const p = (v.plan.prep_tasks || []).filter(Boolean);
    swap(T.prep_tasks, (r) => r.local_date === p_local_date, (r) => r.task, p.map((x) => x.toLowerCase()), p.map((x) => ({ name: x, row: { local_date: p_local_date, task: x, sort_order: 0, is_completed: false } })));
    T.ai_plan_versions.filter((x) => x.user_id === u && x.status === 'active' && x.id !== p_version_id).forEach((x) => (x.status = 'superseded'));
    v.status = 'active'; v.applied_at = new Date().toISOString();
    return { applied: true, meal_templates_created: v.plan.meals.length };
  },
  save_training_week({ p_week }) {
    const db = F(), a = db.tables.ai_plan_versions.filter((x) => x.status === 'active')[0];
    if (!a) throw new Error('No active plan');
    a.plan.training_week = clone(p_week);
  },
};

export function createClient() {
  const db = F(); const listeners = [];
  const emit = (ev, s) => listeners.forEach((cb) => cb(ev, s));
  db.emit = emit;
  const err = (m) => ({ data: null, error: { message: m } });
  return {
    auth: {
      getSession: async () => ({ data: { session: db.session || null } }),
      onAuthStateChange: (cb) => { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithPassword: async ({ email, password }) => {
        if (db.accounts?.[email] !== password) return err('Invalid login credentials');
        db.session = db.sessions[email]; emit('SIGNED_IN', db.session); return { data: { session: db.session, user: db.session.user }, error: null };
      },
      signUp: async ({ email }) => { db.signUps = [...(db.signUps || []), email]; return { data: { user: { identities: [{}] }, session: null }, error: null }; },
      signOut: async () => { db.session = null; emit('SIGNED_OUT', null); return { error: null }; },
      updateUser: async (p) => { if (p.data) Object.assign(db.session.user.user_metadata, p.data); db.calls.push({ table: 'auth', op: 'updateUser', payload: p }); return { data: { user: db.session.user }, error: null }; },
      resetPasswordForEmail: async (e) => { db.calls.push({ table: 'auth', op: 'reset', payload: e }); return { data: {}, error: null }; },
      resend: async () => ({ data: {}, error: null }),
    },
    from: (t) => new Q(t),
    rpc: (name, args) => ({ then: (res, rej) => Promise.resolve().then(() => { db.calls.push({ table: 'rpc', op: name, payload: clone(args) }); if (db.failOn && db.failOn('rpc', name)) return { data: null, error: { message: 'simulated failure' } }; try { return { data: RPC[name] ? RPC[name](args || {}) : null, error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } }).then(res, rej) }),
    functions: { invoke: async (name, { body } = {}) => { db.calls.push({ table: 'functions', op: name, payload: body }); if (name === 'delete-account') { for (const k of Object.keys(db.tables)) db.tables[k] = []; db.deleted = true; } return { data: { ok: true }, error: null }; } },
    channel: () => { const c = { on: () => c, subscribe: () => c }; return c; },
    removeChannel: () => {},
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: '' }, error: null }), upload: async () => ({ error: null }), remove: async () => ({ error: null }) }) },
  };
}
