// reset_plan: "Delete my plan and start fresh".
import test from 'node:test';
import assert from 'node:assert/strict';
import { OTHER, UID, W, addVersion, setup } from './helpers.mjs';

const one = async (db, sql, p = []) => (await db.query(sql, p)).rows[0];
const count = async (db, table, where = 'true') =>
  (await one(db, `select count(*)::int c from public.${table} where ${where}`)).c;
const reset = async (db, today = W) => (await one(db, `select public.reset_plan($1,$2) as r`, [today, W])).r;

async function seeded(db, uid = UID) {
  const v1 = await addVersion(db, 'Old', undefined, uid);
  const v2 = await addVersion(db, 'Current', undefined, uid);
  await db.query(`select set_config('app.uid', $1, false)`, [uid]);
  await db.query(`select public.apply_ai_plan_version($1,$2,$3)`, [v2, W, W]);
  await db.query(
    `insert into public.grocery_items(user_id,week_start,name,source_version_id,is_purchased)
     values ($1,$2,'Chicken',$3,false), ($1,$2,'Rice',$3,true), ($1,$2,'Salt',null,false)`,
    [uid, W, v2]
  );
  await db.query(
    `insert into public.prep_tasks(user_id,local_date,task,source_version_id,is_completed)
     values ($1,$2,'Marinate chicken',$3,false), ($1,$2,'Cook rice',$3,true), ($1,$2,'Wipe counters',null,false)`,
    [uid, W, v2]
  );
  await db.query(
    `insert into public.list_generations(user_id,week_start,plan_hash,plan_version_id,generated_from) values ($1,$2,'h',$3,$2)`,
    [uid, W, v2]
  );
  return { v1, v2 };
}

test('removes the plan, its history, templates, targets and unticked AI list rows', async () => {
  const db = await setup();
  await seeded(db);
  const r = await reset(db);
  assert.deepEqual(r, { plans_deleted: 2, meal_templates_deactivated: 2 });
  assert.equal(await count(db, 'ai_plan_versions'), 0);
  assert.equal(await count(db, 'meal_templates', 'is_active'), 0);
  assert.equal(await count(db, 'list_generations'), 0);
  assert.equal(await count(db, 'daily_targets'), 0);
  const s = await one(db, `select calorie_target c, protein_target_g p, water_target_ml w from public.user_settings`);
  assert.deepEqual(s, { c: null, p: null, w: null });
  const groceries = (await db.query(`select name from public.grocery_items order by name`)).rows.map((x) => x.name);
  assert.deepEqual(groceries, ['Rice', 'Salt']); // ticked and hand-added stay, Chicken (unticked AI) is gone
  const prep = (await db.query(`select task from public.prep_tasks order by task`)).rows.map((x) => x.task);
  assert.deepEqual(prep, ['Cook rice', 'Wipe counters']);
  // What stays is now the user's own, not tied to a deleted plan.
  assert.equal(await count(db, 'grocery_items', 'source_version_id is not null'), 0);
});

test('keeps eaten meals and past-day planned meals; removes planned meals from today on', async () => {
  const db = await setup();
  await seeded(db);
  const t = (await one(db, `select id from public.meal_templates where is_active limit 1`)).id;
  await db.query(
    `insert into public.daily_meals(user_id,local_date,meal_template_id,status) values
     ($1,'2031-01-04',$2,'planned'), ($1,'2031-01-05',$2,'eaten'), ($1,'2031-01-05',$2,'planned'), ($1,'2031-01-06',$2,'planned')`,
    [UID, t]
  );
  await reset(db);
  const left = (await db.query(`select local_date::text d, status from public.daily_meals order by 1,2`)).rows;
  assert.deepEqual(left, [
    { d: '2031-01-04', status: 'planned' },
    { d: '2031-01-05', status: 'eaten' },
  ]);
});

test('works with no plan at all and can be repeated', async () => {
  const db = await setup();
  assert.deepEqual(await reset(db), { plans_deleted: 0, meal_templates_deactivated: 0 });
  assert.deepEqual(await reset(db), { plans_deleted: 0, meal_templates_deactivated: 0 });
});

test("never touches another user's plan or lists", async () => {
  const db = await setup();
  await seeded(db, OTHER);
  await db.query(`select set_config('app.uid', $1, false)`, [UID]);
  await seeded(db, UID);
  await reset(db);
  await db.query(`select set_config('app.uid', $1, false)`, [OTHER]);
  assert.equal(await count(db, 'ai_plan_versions', `user_id='${OTHER}'`), 2);
  assert.equal(await count(db, 'meal_templates', `user_id='${OTHER}' and is_active`), 2);
  assert.equal(await count(db, 'grocery_items', `user_id='${OTHER}'`), 3);
  assert.equal(await count(db, 'list_generations', `user_id='${OTHER}'`), 1);
});

test('requires a signed-in user', async () => {
  const db = await setup();
  await db.query(`select set_config('app.uid', '', false)`);
  await assert.rejects(() => reset(db), /Authentication required/);
});
