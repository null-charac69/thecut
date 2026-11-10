// Plan apply / undo / restore, the Sunday-week migration and its cleanups.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MIGRATIONS, OTHER, UID, W, addVersion, plan, run, setup } from './helpers.mjs';

const apply = async (db, id, day = W) =>
  (await db.query(`select public.apply_ai_plan_version($1,$2,$3) as r`, [id, day, W])).rows[0].r;
const statuses = async (db) =>
  Object.fromEntries(
    (await db.query(`select title,status from public.ai_plan_versions`)).rows.map((r) => [r.title, r.status])
  );
const names = async (db) =>
  (
    await db.query(`select name from public.grocery_items where user_id=$1 and week_start=$2 order by name`, [UID, W])
  ).rows.map((r) => r.name);
const tasks = async (db, d = W) =>
  (
    await db.query(`select task from public.prep_tasks where user_id=$1 and local_date=$2 order by task`, [UID, d])
  ).rows.map((r) => r.task);

test('a superseded plan can be restored (Undo no longer errors)', async () => {
  const db = await setup();
  const v1 = await addVersion(db, 'P1');
  const v2 = await addVersion(db, 'P2', plan('P2', 1800));
  await apply(db, v1);
  await apply(db, v2);
  assert.deepEqual(await statuses(db), { P1: 'superseded', P2: 'active' });
  const r = await apply(db, v1);
  assert.equal(r.applied, true);
  assert.equal(r.meal_templates_created, 2);
  assert.deepEqual(await statuses(db), { P1: 'active', P2: 'superseded' });
  const s = (await db.query(`select calorie_target from public.user_settings where user_id=$1`, [UID])).rows[0];
  assert.equal(s.calorie_target, 2000);
  assert.equal((await db.query(`select count(*)::int c from public.meal_templates where is_active`)).rows[0].c, 2);
});

test('applying a plan clears the old AI lists from today on, keeps ticked and hand-added items, and past days', async () => {
  const db = await setup();
  const v1 = await addVersion(db, 'P1');
  const v2 = await addVersion(db, 'P2');
  await apply(db, v1);
  const d = (n) => `2031-01-0${5 + n}`;
  await db.query(
    `insert into public.grocery_items(user_id,week_start,name,source_version_id,is_purchased) values
       ($1,$2,'Chicken',$3,false), ($1,$2,'Rice',$3,true), ($1,$2,'Salt',null,false)`,
    [UID, W, v1]
  );
  await db.query(
    `insert into public.prep_tasks(user_id,local_date,task,source_version_id,is_completed) values
       ($1,$2,'Past prep',$5,false), ($1,$3,'Boil eggs',$5,false), ($1,$3,'Soak rice',$5,true), ($1,$4,'Wipe counters',null,false), ($1,$4,'Marinate chicken',$5,false)`,
    [UID, d(0), d(2), d(3), v1]
  );
  await db.query(
    `insert into public.list_generations(user_id,week_start,plan_hash,plan_version_id,generated_from) values ($1,$2,'h1',$3,$2)`,
    [UID, W, v1]
  );
  await apply(db, v2, d(2)); // today is the 7th
  assert.deepEqual((await db.query(`select plan_hash from public.list_generations`)).rows, [{ plan_hash: '' }]); // rebuild on next open
  assert.deepEqual(await names(db), ['Rice', 'Salt']); // Chicken (AI, unticked) is gone; ticked Rice is personal now
  assert.equal(
    (await db.query(`select source_version_id from public.grocery_items where name='Rice'`)).rows[0].source_version_id,
    null
  );
  assert.deepEqual(await tasks(db, d(0)), ['Past prep']); // before today: untouched
  assert.deepEqual(await tasks(db, d(2)), ['Soak rice']);
  assert.deepEqual(await tasks(db, d(3)), ['Wipe counters']);
});

test("another account's plan cannot be applied", async () => {
  const db = await setup();
  const foreign = await addVersion(db, 'X', plan('X'), OTHER);
  await assert.rejects(() => apply(db, foreign), /not found for this account/);
});

test('signed-out callers are rejected', async () => {
  const db = await setup();
  const v1 = await addVersion(db, 'P1');
  await db.query(`select set_config('app.uid', '', false)`);
  await assert.rejects(() => apply(db, v1), /Authentication required/);
});

test('the migrations can be run twice (idempotent)', async () => {
  const db = await setup();
  for (const f of MIGRATIONS) await run(db, f);
});

test('migration re-keys Monday weeks to Sunday and shows categories in sentence case', async () => {
  const db = await setup({ upTo: 1 });
  await db.query(
    `insert into public.grocery_items(user_id,week_start,name,category,is_purchased) values
       ($1,'2020-02-03','Eggs','PROTEIN',true), ($1,'2020-02-03','Oats','PANTRY',true), ($1,'2020-02-10','Milk','DAIRY',true)`,
    [UID]
  );
  await run(db, MIGRATIONS[1]);
  const rows = (await db.query(`select name, week_start::text w, category from public.grocery_items order by name`))
    .rows;
  assert.deepEqual(rows, [
    { name: 'Eggs', w: '2020-02-02', category: 'Protein' },
    { name: 'Milk', w: '2020-02-09', category: 'Dairy' },
    { name: 'Oats', w: '2020-02-02', category: 'Pantry' },
  ]);
});

test('migration clears unticked leftovers for this week and today on, and nothing older', async () => {
  const db = await setup({ upTo: 1 });
  const t = (await db.query(`select (now() at time zone 'Asia/Kolkata')::date as d`)).rows[0].d
    .toISOString()
    .slice(0, 10);
  const wk = (await db.query(`select (($1::date) - extract(dow from $1::date)::int)::text as w`, [t])).rows[0].w;
  await db.query(
    `insert into public.grocery_items(user_id,week_start,name,is_purchased) values
       ($1,$2::date + 1,'Old chicken',false), ($1,$2::date + 1,'Bought rice',true), ($1,$2::date - 6,'Last week item',false)`,
    [UID, wk]
  );
  // Monday-keyed rows are what production holds before the migration: the cleanup runs after the re-key.
  await db.query(
    `update public.grocery_items set week_start = $2::date + 1 where name in ('Old chicken','Bought rice') and user_id=$1`,
    [UID, wk]
  );
  await db.query(
    `insert into public.prep_tasks(user_id,local_date,task,is_completed) values
       ($1,$2::date,'Boil chicken',false), ($1,$2::date,'Done thing',true), ($1,$2::date - 1,'Yesterday',false)`,
    [UID, t]
  );
  await run(db, MIGRATIONS[1]);
  const g = (await db.query(`select name from public.grocery_items order by name`)).rows.map((r) => r.name);
  assert.deepEqual(g, ['Bought rice', 'Last week item']);
  const p = (await db.query(`select task from public.prep_tasks order by task`)).rows.map((r) => r.task);
  assert.deepEqual(p, ['Done thing', 'Yesterday']);
});

test('user_settings no longer seeds default targets', async () => {
  const db = await setup();
  await db.query(`insert into public.user_settings(user_id) values ($1)`, [OTHER]);
  const s = (await db.query(`select calorie_target, protein_target_g, water_target_ml from public.user_settings`))
    .rows[0];
  assert.deepEqual(s, { calorie_target: null, protein_target_g: null, water_target_ml: null });
});
