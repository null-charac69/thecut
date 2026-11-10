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

const addD = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
// AI rows (source_version_id set) in scope: ticked ones become the user's own, the rest are deleted.
function clearAi(rows, u, scope, done) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.user_id !== u || !r.source_version_id || !scope(r)) continue;
    if (done(r)) r.source_version_id = null; else rows.splice(i, 1);
  }
}

// RPCs that mirror the SQL in supabase/migrations (kept small; the SQL itself is covered by tests/db).
const RPC = {
  replace_generated_lists({ p_week_start, p_from, p_plan_hash, p_plan_version_id, p_groceries, p_prep }) {
    const db = F(), T = db.tables, u = db.session.user.id, end = addD(p_week_start, 6);
    if (p_from < p_week_start || p_from > end) throw new Error('Date is outside the week');
    clearAi(T.grocery_items, u, (r) => r.week_start === p_week_start, (r) => r.is_purchased);
    for (const g of p_groceries) if (g.name && !T.grocery_items.some((r) => r.user_id === u && r.week_start === p_week_start && r.name.toLowerCase() === g.name.toLowerCase())) T.grocery_items.push({ id: uid(), user_id: u, week_start: p_week_start, name: g.name, quantity: g.quantity, category: g.category || null, sort_order: T.grocery_items.length, is_purchased: false, source_version_id: p_plan_version_id });
    clearAi(T.prep_tasks, u, (r) => r.local_date >= p_from && r.local_date <= end, (r) => r.is_completed);
    for (const d of p_prep) if (d.date >= p_from && d.date <= end) for (const t of d.tasks) if (!T.prep_tasks.some((r) => r.user_id === u && r.local_date === d.date && r.task.toLowerCase() === t.toLowerCase())) T.prep_tasks.push({ id: uid(), user_id: u, local_date: d.date, task: t, sort_order: T.prep_tasks.length, is_completed: false, source_version_id: p_plan_version_id });
    T.list_generations = (T.list_generations || []).filter((g) => !(g.user_id === u && g.week_start === p_week_start));
    T.list_generations.push({ user_id: u, week_start: p_week_start, plan_hash: p_plan_hash, plan_version_id: p_plan_version_id, generated_from: p_from });
    return { groceries_added: p_groceries.length, prep_added: p_prep.length };
  },
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
    // Clear this plan's AI lists (this week's groceries, prep from today on); ticked rows become the user's own.
    const end = addD(p_week_start, 6);
    clearAi(T.grocery_items, u, (r) => r.week_start === p_week_start, (r) => r.is_purchased);
    clearAi(T.prep_tasks, u, (r) => r.local_date >= p_local_date && r.local_date <= end, (r) => r.is_completed);
    (T.list_generations || []).filter((g) => g.user_id === u && g.week_start === p_week_start).forEach((g) => (g.plan_hash = ''));
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
  db.runRpc = (name, args) => RPC[name](args); // lets the test's mock of the AI function write like the real one
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
