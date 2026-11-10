// Runs the real migration SQL (supabase/migrations/20261111_plan_undo_complete.sql) against an in-process
// Postgres (PGlite) with a minimal copy of the tables it touches. No network and no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const UID = '8e0a157e-1010-4657-9e8b-5a65a449b5ae';
const OTHER = '952ca5f8-19cc-4feb-bf22-fb9c0873e42b';
const W = '2031-01-06';

const SCHEMA = `
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
create table public.ai_plan_versions(id uuid primary key default gen_random_uuid(), user_id uuid not null, title text not null,
  status text not null default 'draft' check (status in ('draft','active','superseded')), inputs jsonb not null default '{}', plan jsonb not null,
  model text not null default 't', created_at timestamptz not null default now(), applied_at timestamptz);
create table public.meal_templates(id uuid primary key default gen_random_uuid(), user_id uuid not null, name text, sort_order int, planned_time time, is_active boolean default true);
create table public.meal_template_items(id uuid primary key default gen_random_uuid(), user_id uuid, meal_template_id uuid, food_name_snapshot text, quantity numeric, unit text,
  calories_kcal numeric, protein_g numeric, carbs_g numeric, fat_g numeric, fiber_g numeric, sort_order int);
create table public.daily_meals(id uuid primary key default gen_random_uuid(), user_id uuid, local_date date, meal_template_id uuid, status text);
create table public.user_settings(user_id uuid primary key, calorie_target int, protein_target_g numeric, carbs_target_g numeric, fat_target_g numeric, fiber_target_g numeric, water_target_ml int, height_cm numeric, updated_at timestamptz);
create table public.daily_targets(user_id uuid, local_date date, calorie_target int, protein_target_g numeric, carbs_target_g numeric, fat_target_g numeric, fiber_target_g numeric, water_target_ml int, updated_at timestamptz, unique(user_id, local_date));
create table public.grocery_items(id uuid primary key default gen_random_uuid(), user_id uuid not null, week_start date not null, name text not null, quantity text, is_purchased boolean not null default false, sort_order int not null default 0, category text);
create table public.prep_tasks(id uuid primary key default gen_random_uuid(), user_id uuid not null, local_date date not null, task text not null, is_completed boolean not null default false, sort_order int not null default 0);
`;

const plan = (title, groceries, prep, kcal = 2000) => ({
  title,
  targets: { calories_kcal: kcal, protein_g: 150, carbs_g: 200, fat_g: 60, fibre_g: 30, water_ml: 3000 },
  meals: [
    { name: 'A', time: '08:00', items: [], totals: { calories_kcal: kcal / 2, protein_g: 75 } },
    { name: 'B', time: '13:00', items: [], totals: { calories_kcal: kcal / 2, protein_g: 75 } },
  ],
  grocery_list: groceries.map((name) => ({ name, quantity: '1', category: 'PANTRY' })),
  prep_tasks: prep,
  training_week: [],
});

async function setup() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(readFileSync(new URL('../../supabase/migrations/20261111_plan_undo_complete.sql', import.meta.url), 'utf8'));
  await db.query(`select set_config('app.uid', $1, false)`, [UID]);
  return db;
}
const addVersion = async (db, title, p, uid = UID) =>
  (await db.query(`insert into public.ai_plan_versions(user_id,title,plan) values ($1,$2,$3) returning id`, [uid, title, JSON.stringify(p)])).rows[0].id;
const apply = async (db, id) => (await db.query(`select public.apply_ai_plan_version($1,$2,$2) as r`, [id, W])).rows[0].r;
const names = async (db) => (await db.query(`select name from public.grocery_items where user_id=$1 and week_start=$2 order by name`, [UID, W])).rows.map((r) => r.name);
const tasks = async (db) => (await db.query(`select task from public.prep_tasks where user_id=$1 and local_date=$2 order by task`, [UID, W])).rows.map((r) => r.task);
const statuses = async (db) => Object.fromEntries((await db.query(`select title,status from public.ai_plan_versions`)).rows.map((r) => [r.title, r.status]));

test('a superseded plan can be restored (Undo no longer errors)', async () => {
  const db = await setup();
  const v1 = await addVersion(db, 'P1', plan('P1', ['Chicken'], ['Boil eggs']));
  const v2 = await addVersion(db, 'P2', plan('P2', ['Tofu'], ['Press tofu'], 1800));
  await apply(db, v1);
  await apply(db, v2);
  assert.deepEqual(await statuses(db), { P1: 'superseded', P2: 'active' });
  const r = await apply(db, v1);
  assert.equal(r.applied, true);
  assert.deepEqual(await statuses(db), { P1: 'active', P2: 'superseded' });
  const s = (await db.query(`select calorie_target from public.user_settings where user_id=$1`, [UID])).rows[0];
  assert.equal(s.calorie_target, 2000);
  assert.equal((await db.query(`select count(*)::int c from public.meal_templates where is_active`)).rows[0].c, 2);
});

test('undo removes the groceries and prep tasks the newer plan added', async () => {
  const db = await setup();
  const v1 = await addVersion(db, 'P1', plan('P1', ['Chicken', 'Rice'], ['Boil eggs']));
  const v2 = await addVersion(db, 'P2', plan('P2', ['Tofu', 'Rice'], ['Press tofu']));
  await apply(db, v1);
  await apply(db, v2);
  assert.deepEqual(await names(db), ['Rice', 'Tofu']);
  assert.deepEqual(await tasks(db), ['Press tofu']);
  const r = await apply(db, v1);
  assert.deepEqual(await names(db), ['Chicken', 'Rice']);
  assert.deepEqual(await tasks(db), ['Boil eggs']);
  assert.equal(r.groceries_removed, 1);
  assert.equal(r.prep_tasks_removed, 1);
});

test('items the user added by hand are never removed', async () => {
  const db = await setup();
  const v1 = await addVersion(db, 'P1', plan('P1', ['Chicken'], ['Boil eggs']));
  const v2 = await addVersion(db, 'P2', plan('P2', ['Tofu'], ['Press tofu']));
  await db.query(`insert into public.grocery_items(user_id,week_start,name) values ($1,$2,'Salt')`, [UID, W]);
  await db.query(`insert into public.prep_tasks(user_id,local_date,task) values ($1,$2,'Wipe counters')`, [UID, W]);
  await apply(db, v1);
  await apply(db, v2);
  await apply(db, v1);
  assert.deepEqual(await names(db), ['Chicken', 'Salt']);
  assert.deepEqual(await tasks(db), ['Boil eggs', 'Wipe counters']);
});

test('items already ticked off are kept as personal items and shared items keep their state', async () => {
  const db = await setup();
  const v1 = await addVersion(db, 'P1', plan('P1', ['Chicken', 'Rice'], ['Boil eggs']));
  const v2 = await addVersion(db, 'P2', plan('P2', ['Tofu', 'Rice'], ['Press tofu']));
  await apply(db, v1);
  await db.query(`update public.grocery_items set is_purchased=true where name in ('Chicken','Rice')`);
  await db.query(`update public.prep_tasks set is_completed=true where task='Boil eggs'`);
  await apply(db, v2); // Chicken is bought but not in P2: stays as a personal item. Rice is shared: stays bought.
  assert.deepEqual(await names(db), ['Chicken', 'Rice', 'Tofu']);
  assert.deepEqual(await tasks(db), ['Boil eggs', 'Press tofu']);
  const rice = (await db.query(`select is_purchased, source_version_id from public.grocery_items where name='Rice'`)).rows[0];
  assert.equal(rice.is_purchased, true);
  assert.equal(rice.source_version_id, v2);
  const chicken = (await db.query(`select source_version_id from public.grocery_items where name='Chicken'`)).rows[0];
  assert.equal(chicken.source_version_id, null);
});

test('applying the same plan twice does not duplicate anything', async () => {
  const db = await setup();
  const v1 = await addVersion(db, 'P1', plan('P1', ['Chicken'], ['Boil eggs']));
  await apply(db, v1);
  await apply(db, v1);
  assert.deepEqual(await names(db), ['Chicken']);
  assert.deepEqual(await tasks(db), ['Boil eggs']);
});

test('another account\'s plan cannot be applied', async () => {
  const db = await setup();
  const foreign = await addVersion(db, 'X', plan('X', ['Chicken'], []), OTHER);
  await assert.rejects(() => apply(db, foreign), /not found for this account/);
});

test('signed-out callers are rejected', async () => {
  const db = await setup();
  const v1 = await addVersion(db, 'P1', plan('P1', ['Chicken'], []));
  await db.query(`select set_config('app.uid', '', false)`);
  await assert.rejects(() => apply(db, v1), /Authentication required/);
});

test('the migration can be run twice (idempotent)', async () => {
  const db = await setup();
  await db.exec(readFileSync(new URL('../../supabase/migrations/20261111_plan_undo_complete.sql', import.meta.url), 'utf8'));
});
