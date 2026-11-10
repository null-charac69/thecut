// The edge function's list validation (lists.ts): what the AI may put into a user's grocery and prep lists.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  categoryLabel,
  checkWindow,
  datesFrom,
  isSunday,
  normalizeLists,
  weekdayName,
} from '../../supabase/functions/the-cut-ai/lists.ts';

const SUN = '2026-11-08';
const dates = datesFrom(SUN, '2026-11-10');

test('weeks run Sunday to Saturday', () => {
  assert.equal(isSunday(SUN), true);
  assert.equal(isSunday('2026-11-09'), false);
  assert.equal(weekdayName(SUN), 'Sunday');
  assert.equal(addDays(SUN, 6), '2026-11-14');
  assert.equal(weekdayName(addDays(SUN, 6)), 'Saturday');
  assert.deepEqual(datesFrom(SUN, SUN).length, 7);
  assert.deepEqual(dates, ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']);
  assert.deepEqual(datesFrom(SUN, '2026-11-14'), ['2026-11-14']);
});

test('checkWindow accepts a Sunday week containing today and rejects everything else', () => {
  assert.equal(checkWindow(SUN, '2026-11-10'), null);
  assert.equal(checkWindow(SUN, SUN), null);
  assert.equal(checkWindow(SUN, '2026-11-14'), null);
  assert.match(checkWindow('2026-11-09', '2026-11-10'), /Sunday/);
  assert.match(checkWindow(SUN, '2026-11-15'), /not inside/);
  assert.match(checkWindow(SUN, '2026-11-07'), /not inside/);
  assert.match(checkWindow('nope', '2026-11-10'), /dates/);
  assert.match(checkWindow('2026-02-30', '2026-02-28'), /dates/);
  assert.match(checkWindow(undefined, undefined), /dates/);
});

test('categories are shown in sentence case, whatever the model sends', () => {
  assert.equal(categoryLabel('PROTEIN'), 'Protein');
  assert.equal(categoryLabel('  dairy '), 'Dairy');
  assert.equal(categoryLabel('Seeds & NUTS'), 'Seeds & nuts');
  assert.equal(categoryLabel(''), 'Other');
  assert.equal(categoryLabel(null), 'Other');
  assert.equal(categoryLabel('x'.repeat(80)).length, 30);
});

test('normalizeLists keeps the AI categories, dedupes, and only keeps prep for the requested dates', () => {
  const r = normalizeLists(
    {
      groceries: [
        { name: 'Paneer', quantity: '500 g', category: 'DAIRY' },
        { name: 'paneer', quantity: '1 kg', category: 'dairy' },
        { name: 'Chia seeds', quantity: '1 pack', category: 'seeds & nuts' },
        { name: 'Spinach', quantity: '3 bunches' },
        { name: '', quantity: '1' },
      ],
      prep: [
        { date: '2026-11-10', tasks: ['Soak chana', 'soak chana', '  ', 'Chop onions'] },
        { date: '2026-11-09', tasks: ['Past day'] },
        { date: '2026-11-20', tasks: ['Next week'] },
        { day: 'wednesday', tasks: ['Press tofu'] },
        { date: '2026-11-10', tasks: ['Boil eggs'] },
      ],
    },
    dates
  );
  assert.deepEqual(r.problems, []);
  assert.deepEqual(
    r.groceries.map((g) => [g.name, g.category]),
    [
      ['Paneer', 'Dairy'],
      ['Chia seeds', 'Seeds & nuts'],
      ['Spinach', 'Other'],
    ]
  );
  assert.deepEqual(r.prep, [
    { date: '2026-11-10', tasks: ['Soak chana', 'Chop onions', 'Boil eggs'] },
    { date: '2026-11-11', tasks: ['Press tofu'] },
  ]);
});

test('normalizeLists is bounded', () => {
  const r = normalizeLists(
    {
      groceries: Array.from({ length: 200 }, (_, i) => ({
        name: 'Item ' + i,
        quantity: 'q'.repeat(500),
        category: 'c',
      })),
      prep: [{ date: '2026-11-10', tasks: Array.from({ length: 50 }, (_, i) => 'Task ' + i + 'x'.repeat(500)) }],
    },
    dates
  );
  assert.equal(r.groceries.length, 60);
  assert.ok(r.groceries.every((g) => g.quantity.length <= 80));
  assert.equal(r.prep[0].tasks.length, 8);
  assert.ok(r.prep[0].tasks.every((t) => t.length <= 240));
});

test('normalizeLists rejects an empty or non-object answer so the app never shows a blank list as success', () => {
  assert.match(normalizeLists(null, dates).problems[0], /not a JSON object/);
  assert.match(normalizeLists('x', dates).problems[0], /not a JSON object/);
  assert.match(normalizeLists({ groceries: [{ name: 'Rice' }], prep: [] }, dates).problems[0], /at least|must list/);
  assert.equal(
    normalizeLists({ groceries: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], prep: 'nope' }, dates).problems.length,
    0
  );
});
