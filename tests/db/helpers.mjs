// Shared setup for the database tests: runs the real migrations (production order) on PGlite.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const UID = '8e0a157e-1010-4657-9e8b-5a65a449b5ae';
export const OTHER = '952ca5f8-19cc-4feb-bf22-fb9c0873e42b';
export const W = '2031-01-05'; // a Sunday

export const SCHEMA = `
create role anon; create role authenticated;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
create table public.ai_plan_versions(id uuid primary key default gen_random_uuid(), user_id uuid not null, title text not null,
  status text not null default 'draft' check (status in ('draft','active','superseded')), inputs jsonb not null default '{}', plan jsonb not null,
  model text not null default 't', created_at timestamptz not null default now(), applied_at timestamptz);
create table public.meal_templates(id uuid primary key default gen_random_uuid(), user_id uuid not null, name text, sort_order int, planned_time time, is_active boolean default true);
create table public.meal_template_items(id uuid primary key default gen_random_uuid(), user_id uuid, meal_template_id uuid, food_name_snapshot text, quantity numeric, unit text,
  calories_kcal numeric, protein_g numeric, carbs_g numeric, fat_g numeric, fiber_g numeric, sort_order int);
create table public.daily_meals(id uuid primary key default gen_random_uuid(), user_id uuid, local_date date, meal_template_id uuid, status text);
create table public.user_settings(user_id uuid primary key, calorie_target int not null default 1566, protein_target_g numeric not null default 139, carbs_target_g numeric, fat_target_g numeric, fiber_target_g numeric, water_target_ml int not null default 2500, height_cm numeric, updated_at timestamptz);
create table public.daily_targets(user_id uuid, local_date date, calorie_target int, protein_target_g numeric, carbs_target_g numeric, fat_target_g numeric, fiber_target_g numeric, water_target_ml int, updated_at timestamptz, unique(user_id, local_date));
create table public.grocery_items(id uuid primary key default gen_random_uuid(), user_id uuid not null, week_start date not null, name text not null, quantity text, is_purchased boolean not null default false, sort_order int not null default 0, category text);
create table public.prep_tasks(id uuid primary key default gen_random_uuid(), user_id uuid not null, local_date date not null, task text not null, is_completed boolean not null default false, sort_order int not null default 0);
`;
export const MIGRATIONS = ['20261111_plan_undo_complete.sql', '20261112_ai_lists_sunday_weeks.sql'];
export const run = (db, file) =>
  db.exec(readFileSync(new URL('../../supabase/migrations/' + file, import.meta.url), 'utf8'));

export async function setup({ upTo = MIGRATIONS.length } = {}) {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.query(`insert into auth.users(id) values ($1), ($2)`, [UID, OTHER]);
  for (const f of MIGRATIONS.slice(0, upTo)) await run(db, f);
  await db.query(`select set_config('app.uid', $1, false)`, [UID]);
  return db;
}

export const plan = (title, kcal = 2000) => ({
  title,
  targets: { calories_kcal: kcal, protein_g: 150, carbs_g: 200, fat_g: 60, fibre_g: 30, water_ml: 3000 },
  meals: [
    { name: 'A', time: '08:00', items: [], totals: { calories_kcal: kcal / 2, protein_g: 75 } },
    { name: 'B', time: '13:00', items: [], totals: { calories_kcal: kcal / 2, protein_g: 75 } },
  ],
  training_week: [],
});
export const addVersion = async (db, title, p = plan(title), uid = UID) =>
  (
    await db.query(`insert into public.ai_plan_versions(user_id,title,plan) values ($1,$2,$3) returning id`, [
      uid,
      title,
      JSON.stringify(p),
    ])
  ).rows[0].id;
