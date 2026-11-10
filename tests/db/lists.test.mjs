// replace_generated_lists: the RPC the AI edge function uses to write a week's groceries and daily prep.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, addVersion, UID, OTHER, W } from './helpers.mjs';

const D = (n) => `2031-01-0${5 + n}`; // W is Sunday 2031-01-05; D(6) is Saturday
const call = async (db, { from = W, hash = 'h1', version, groceries = [], prep = [], week = W } = {}) =>
  (
    await db.query(`select public.replace_generated_lists($1,$2,$3,$4,$5,$6) as r`, [
      week,
      from,
      hash,
      version,
      JSON.stringify(groceries),
      JSON.stringify(prep),
    ])
  ).rows[0].r;
const g = (name, category = 'Produce', quantity = '1 kg') => ({ name, quantity, category });
const items = async (db) =>
  (
    await db.query(
      `select name, category, source_version_id v, is_purchased from public.grocery_items where user_id=$1 and week_start=$2 order by name`,
      [UID, W]
    )
  ).rows;
const tasks = async (db) =>
  (
    await db.query(
      `select local_date::text d, task from public.prep_tasks where user_id=$1 order by local_date, sort_order`,
      [UID]
    )
  ).rows.map((r) => `${r.d} ${r.task}`);
const version = (db) => addVersion(db, 'P');

test('writes AI groceries with their own categories and prep per day, and records the plan hash', async () => {
  const db = await setup();
  const v = await version(db);
  const r = await call(db, {
    version: v,
    groceries: [g('Paneer', 'Dairy'), g('Spinach', 'Produce'), g('Chia seeds', 'Seeds & nuts')],
    prep: [
      { date: D(1), tasks: ['Soak chana', 'Chop onions'] },
      { date: D(2), tasks: ['Press tofu'] },
    ],
  });
  assert.deepEqual(r, { groceries_added: 3, groceries_removed: 0, prep_added: 3, prep_removed: 0 });
  assert.deepEqual(
    (await items(db)).map((x) => [x.name, x.category]),
    [
      ['Chia seeds', 'Seeds & nuts'],
      ['Paneer', 'Dairy'],
      ['Spinach', 'Produce'],
    ]
  );
  assert.deepEqual(await tasks(db), [`${D(1)} Soak chana`, `${D(1)} Chop onions`, `${D(2)} Press tofu`]);
  const gen = (await db.query(`select plan_hash, generated_from::text f, plan_version_id from public.list_generations`))
    .rows;
  assert.deepEqual(gen, [{ plan_hash: 'h1', f: W, plan_version_id: v }]);
});

test('regenerating mid-week replaces the AI items from today on and leaves the past, ticked and own items alone', async () => {
  const db = await setup();
  const v = await version(db);
  await call(db, {
    version: v,
    groceries: [g('Chicken', 'Protein'), g('Rice', 'Grains'), g('Eggs', 'Protein')],
    prep: [
      { date: D(0), tasks: ['Cook rice'] },
      { date: D(1), tasks: ['Marinate chicken'] },
      { date: D(2), tasks: ['Boil eggs'] },
    ],
  });
  await db.query(`update public.grocery_items set is_purchased=true where name='Rice'`);
  await db.query(`insert into public.grocery_items(user_id,week_start,name) values ($1,$2,'Salt')`, [UID, W]);
  await db.query(`insert into public.prep_tasks(user_id,local_date,task) values ($1,$2,'Wipe counters')`, [UID, D(2)]);

  const v2 = await version(db);
  const r = await call(db, {
    version: v2,
    hash: 'h2',
    from: D(1), // veg switch on Monday
    groceries: [g('Tofu', 'Protein'), g('Rice', 'Grains'), g('Paneer', 'Dairy')],
    prep: [
      { date: D(0), tasks: ['IGNORED: before the start date'] },
      { date: D(1), tasks: ['Press tofu'] },
      { date: D(2), tasks: ['Soak chana'] },
    ],
  });
  assert.equal(r.groceries_removed, 2); // Chicken and Eggs, unticked AI items
  assert.deepEqual(
    (await items(db)).map((x) => x.name),
    ['Paneer', 'Rice', 'Salt', 'Tofu']
  );
  // Bought Rice is not duplicated and is now the user's own item (kept); the new list never re-adds it.
  assert.equal((await items(db)).find((x) => x.name === 'Rice').v, null);
  assert.deepEqual(await tasks(db), [
    `${D(0)} Cook rice`,
    `${D(1)} Press tofu`,
    `${D(2)} Wipe counters`,
    `${D(2)} Soak chana`,
  ]);
  assert.deepEqual((await db.query(`select plan_hash from public.list_generations`)).rows, [{ plan_hash: 'h2' }]);
});

test('running it twice with the same input does not duplicate anything', async () => {
  const db = await setup();
  const v = await version(db);
  const input = {
    version: v,
    groceries: [g('Tofu'), g('tofu'), g('Rice')],
    prep: [{ date: D(1), tasks: ['Press tofu', 'press tofu'] }],
  };
  await call(db, input);
  await call(db, input);
  assert.deepEqual(
    (await items(db)).map((x) => x.name),
    ['Rice', 'Tofu']
  );
  assert.deepEqual(await tasks(db), [`${D(1)} Press tofu`]);
});

test('input is bounded and sanitised', async () => {
  const db = await setup();
  const v = await version(db);
  await call(db, {
    version: v,
    groceries: [
      g('  '),
      { quantity: '1' },
      { name: 'x'.repeat(300), category: 'c'.repeat(80) },
      ...Array.from({ length: 200 }, (_, i) => g('Item ' + i)),
    ],
    prep: [
      { date: 'not a date', tasks: ['Bad day'] },
      { date: D(9), tasks: ['Outside the week'] },
      { date: D(1), tasks: Array.from({ length: 30 }, (_, i) => 'Task ' + i) },
    ],
  });
  const rows = await items(db);
  assert.ok(rows.length <= 78 && rows.every((x) => x.name.length <= 100 && (x.category || '').length <= 30));
  const t = await tasks(db);
  assert.equal(t.length, 8);
  assert.ok(t.every((x) => x.startsWith(D(1))));
});

test('guards: sunday weeks only, date inside the week, own active plan, signed in', async () => {
  const db = await setup();
  const v = await version(db);
  await assert.rejects(() => call(db, { version: v, week: '2031-01-06', from: '2031-01-06' }), /Sunday/);
  await assert.rejects(() => call(db, { version: v, from: D(7) }), /outside the week/);
  await assert.rejects(() => call(db, { version: v, from: '2030-12-31' }), /outside the week/);
  await assert.rejects(() => call(db, { version: null }), /active plan is required/);
  const foreign = await addVersion(db, 'X', undefined, OTHER);
  await assert.rejects(() => call(db, { version: foreign }), /not found for this account/);
  await db.query(`select set_config('app.uid', '', false)`);
  await assert.rejects(() => call(db, { version: v }), /Authentication required/);
});

test("other accounts' rows are never touched", async () => {
  const db = await setup();
  const v = await version(db);
  await db.query(
    `insert into public.grocery_items(user_id,week_start,name,source_version_id) values ($1,$2,'Theirs',$3)`,
    [OTHER, W, v]
  );
  await call(db, { version: v, groceries: [g('Mine')] });
  assert.equal(
    (await db.query(`select count(*)::int c from public.grocery_items where user_id=$1`, [OTHER])).rows[0].c,
    1
  );
});
