import { today, dateFmt, fmt } from './lib/format.js';
import { S } from './state.js';
import { q, supabase } from './client.js';
import { card, metric, pageHead, render } from './shell.js';
import { fail, toast } from './ui.js';

export async function loadWeight() {
  S.wRows = await q(
    supabase
      .from('body_measurements')
      .select('id,measured_on,weight_kg,body_fat_pct,notes')
      .eq('user_id', S.user.id)
      .not('weight_kg', 'is', null)
      .order('measured_on', { ascending: true })
      .limit(365)
  );
}

function spark(vals, goal) {
  if (vals.length < 2) return '<div class="empty">Log at least two weigh-ins to see your trend.</div>';
  const w = 560,
    h = 150,
    p = 16,
    all = goal ? vals.concat(goal) : vals,
    lo = Math.min(...all) - 0.5,
    hi = Math.max(...all) + 0.5,
    X = (i) => p + (i * (w - 2 * p)) / (vals.length - 1),
    Y = (v) => h - p - ((v - lo) / (hi - lo)) * (h - 2 * p);
  return `<svg viewBox="0 0 ${w} ${h}" class="spark" role="img" aria-label="Weight trend"><polyline points="${vals.map((v, i) => X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ')}" fill="none" stroke="var(--lime)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${goal ? `<line x1="${p}" x2="${w - p}" y1="${Y(goal)}" y2="${Y(goal)}" stroke="var(--orange)" stroke-dasharray="5 5"/>` : ''}${vals.map((v, i) => `<circle cx="${X(i)}" cy="${Y(v)}" r="3.5" fill="var(--lime)"/>`).join('')}</svg>`;
}

export function weightV3() {
  const goal = Number(S.aiActivePlan?.inputs?.target_weight_kg) || null,
    vals = S.wRows.map((r) => Number(r.weight_kg)),
    cur = vals.length ? vals[vals.length - 1] : null,
    first = vals.length ? vals[0] : null;
  const delta = cur != null && first != null ? cur - first : null;
  return `${pageHead('Body weight', 'Weight', 'One number, logged regularly. The trend matters, not any single day.')}
 <div class="grid g3">${metric('Current', cur != null ? fmt(cur) : '—', 'kg', S.wRows.length ? dateFmt(S.wRows[S.wRows.length - 1].measured_on, { day: 'numeric', month: 'short' }) : 'No weigh-ins yet')}${metric('Change', delta != null ? (delta > 0 ? '+' : '') + fmt(delta) : '—', 'kg', 'Since your first weigh-in')}${metric('Goal', goal ? fmt(goal) : '—', 'kg', goal && cur != null ? fmt(Math.abs(cur - goal)) + ' kg to go' : 'Set in your plan')}</div>
 <div class="grid g2 u-mt16">${card('Trend', spark(vals.slice(-60), goal))}
 ${card('Log weight', `<form id="weightForm" class="formgrid"><div class="field"><label>Date</label><input type="date" name="measured_on" value="${today()}" max="${today()}" required/></div><div class="field"><label>Weight (kg)</label><input name="weight_kg" type="number" step="0.1" min="20" max="500" inputmode="decimal" required placeholder="80.0"/></div><button class="btn primary full">Save weigh-in</button></form><p class="muted small">Logging the same date again replaces that day's entry.</p>`)}</div>
 <div class="u-mt16">${card(
   'History',
   S.wRows.length
     ? S.wRows
         .slice()
         .reverse()
         .slice(0, 12)
         .map(
           (r) =>
             `<div class="listitem"><div class="grow"><strong>${fmt(r.weight_kg)} kg</strong><small>${dateFmt(r.measured_on, { day: 'numeric', month: 'short', year: 'numeric' })}</small></div><button class="btn sm danger" data-delweight="${r.id}">Delete</button></div>`
         )
         .join('')
     : '<div class="empty">No weigh-ins yet.</div>'
 )}</div>`;
}

export async function saveWeightV3(e) {
  e.preventDefault();
  const f = new FormData(e.currentTarget),
    on = f.get('measured_on'),
    kg = Number(f.get('weight_kg'));
  if (!(kg >= 20 && kg <= 500)) {
    toast('Enter a weight between 20 and 500 kg.');
    return;
  }
  try {
    const ex = await q(
      supabase.from('body_measurements').select('id').eq('user_id', S.user.id).eq('measured_on', on).limit(1)
    );
    if (ex.length)
      await q(supabase.from('body_measurements').update({ weight_kg: kg }).eq('id', ex[0].id).eq('user_id', S.user.id));
    else await q(supabase.from('body_measurements').insert({ user_id: S.user.id, measured_on: on, weight_kg: kg }));
    toast('Weight saved');
    await render();
  } catch (err) {
    fail(err);
  }
}
