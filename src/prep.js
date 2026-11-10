import { weekStart, esc, dateFmt } from './lib/format.js';
import { S } from './state.js';
import { q, supabase } from './client.js';
import { after, card, needsPlanCard, pageHead, render } from './shell.js';
import { fail, uiConfirm } from './ui.js';

export async function updateGrocery(id, checked) {
  await q(
    supabase
      .from('grocery_items')
      .update({ is_purchased: checked, purchased_at: checked ? new Date().toISOString() : null })
      .eq('id', id)
      .eq('user_id', S.user.id)
  );
  await render();
}

export async function addPrep(e) {
  e.preventDefault();
  let f = new FormData(e.currentTarget);
  try {
    await q(
      supabase
        .from('prep_tasks')
        .insert({ user_id: S.user.id, local_date: S.date, task: f.get('task'), sort_order: S.day.prep.length })
    );
    await after();
  } catch (e) {
    fail(e);
  }
}

export async function updatePrep(id, checked) {
  await q(
    supabase
      .from('prep_tasks')
      .update({ is_completed: checked, completed_at: checked ? new Date().toISOString() : null })
      .eq('id', id)
      .eq('user_id', S.user.id)
  );
  await after();
}

export async function deleteRow(table, id, tabName) {
  if (!(await uiConfirm('Delete?', 'Delete this record?', { confirm: 'Delete', danger: true }))) return;
  try {
    await q(supabase.from(table).delete().eq('id', id).eq('user_id', S.user.id));
    await render();
  } catch (e) {
    fail(e);
  }
}

export async function addGroceryV2(e) {
  e.preventDefault();
  const f = new FormData(e.currentTarget);
  try {
    await q(
      supabase.from('grocery_items').insert({
        user_id: S.user.id,
        week_start: weekStart(S.date),
        name: f.get('name'),
        quantity: f.get('quantity') || null,
        category: f.get('category') || 'PRODUCE',
        sort_order: S.groceries.length,
      })
    );
    await render();
  } catch (e) {
    fail(e);
  }
}

export async function loadGroceries() {
  S.groceries = await q(
    supabase
      .from('grocery_items')
      .select('*')
      .eq('user_id', S.user.id)
      .eq('week_start', weekStart(S.date))
      .order('sort_order')
  );
}

export function prepV3() {
  if (!S.aiActivePlan)
    return (
      pageHead('PREP & GROCERY', 'Prep & Grocery', 'Shopping list and meal prep.') + needsPlanCard('shopping and prep')
    );
  const bought = S.groceries.filter((x) => x.is_purchased).length,
    donePrep = S.day.prep.filter((x) => x.is_completed).length;
  const cats = ['PROTEIN', 'DAIRY', 'PRODUCE', 'PANTRY'];
  const groc = `<form id="groceryForm" class="row addrow"><input name="name" required placeholder="Add an item"/><input name="quantity" placeholder="Qty" class="u-maxw110"/><input type="hidden" name="category" value="PRODUCE"/><button class="btn primary">Add</button></form>
 ${
   S.groceries.length
     ? cats
         .map((c) => {
           const items = S.groceries.filter((x) => (x.category || 'PRODUCE') === c);
           return items.length
             ? `<h3 class="eyebrow cat">${c} <span>${items.filter((x) => x.is_purchased).length}/${items.length}</span></h3>${items.map((x) => `<label class="listitem tick-row"><input type="checkbox" data-grocery="${x.id}" ${x.is_purchased ? 'checked' : ''}/><div class="grow"><strong class="${x.is_purchased ? 'struck' : ''}">${esc(x.name)}</strong><small>${esc(x.quantity || '')}</small></div><button class="btn sm ghost" data-delgrocery="${x.id}" aria-label="Remove ${esc(x.name)}">✕</button></label>`).join('')}`
             : '';
         })
         .join('')
     : '<div class="empty">Nothing on the list this week.</div>'
 }`;
  const prep = `<form id="prepForm" class="row addrow"><input name="task" required placeholder="Add a prep task"/><button class="btn primary">Add</button></form>
 ${S.day.prep.length ? S.day.prep.map((t) => `<label class="listitem tick-row"><input type="checkbox" data-prep="${t.id}" ${t.is_completed ? 'checked' : ''}/><div class="grow"><strong class="${t.is_completed ? 'struck' : ''}">${esc(t.task)}</strong></div><button class="btn sm ghost" data-delprep="${t.id}" aria-label="Remove task">✕</button></label>`).join('') : '<div class="empty">No prep tasks for this day.</div>'}`;
  return `${pageHead('PREP & GROCERY', 'Prep & Grocery', 'Shop once, prep once, eat on plan.')}
 <div class="seg" role="tablist"><button role="tab" data-prepview="grocery" class="${S.prepView === 'grocery' ? 'on' : ''}">Groceries <small>${bought}/${S.groceries.length}</small></button><button role="tab" data-prepview="prep" class="${S.prepView === 'prep' ? 'on' : ''}">Meal prep <small>${donePrep}/${S.day.prep.length}</small></button></div>
 ${card(S.prepView === 'grocery' ? 'This week’s groceries' : 'Prep for ' + dateFmt(S.date, { day: 'numeric', month: 'short' }), S.prepView === 'grocery' ? groc : prep)}`;
}
