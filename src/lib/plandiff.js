// Pure plan-to-plan comparison used for the "What changed" card (no DOM, no app state).
/** @typedef {{name?:string,time?:string,totals?:{calories_kcal?:number,protein_g?:number}}} PMeal */
/** @typedef {{day?:string,focus?:string,session_minutes?:number}} PTrain */
/** @typedef {{targets?:Record<string,number>,meals?:PMeal[],training_week?:PTrain[]}} Plan */

const TARGETS = /** @type {Array<[string,string,string]>} */ ([
  ['calories_kcal', 'Calories', 'kcal'],
  ['protein_g', 'Protein', 'g'],
  ['carbs_g', 'Carbs', 'g'],
  ['fat_g', 'Fat', 'g'],
]);
/** @param {number} n @returns {string} */
const r = (n) => String(Math.round(n * 10) / 10);
/** @param {string[]} a @param {string[]} b @returns {string[]} items of b not in a (case-insensitive) */
const added = (a, b) => {
  const s = new Set(a.map((x) => x.toLowerCase()));
  return b.filter((x) => !s.has(x.toLowerCase()));
};
/** @param {Array<{name?:string}>|undefined} l @returns {string[]} */
const names = (l) => (l || []).map((x) => String(x.name || '').trim()).filter(Boolean);

/**
 * Human-readable list of what differs between two plans.
 * @param {Plan|null|undefined} prev
 * @param {Plan|null|undefined} next
 * @returns {{label:string,detail:string}[]}
 */
export function diffPlans(prev, next) {
  /** @type {{label:string,detail:string}[]} */
  const out = [];
  if (!next) return out;
  if (!prev) return [{ label: 'New plan', detail: 'First plan applied' }];
  for (const [k, label, unit] of TARGETS) {
    const a = Number(prev.targets?.[k]),
      b = Number(next.targets?.[k]);
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) >= 0.5)
      out.push({ label, detail: `${r(a)} → ${r(b)} ${unit}` });
  }
  const pm = prev.meals || [],
    nm = next.meals || [];
  const pn = names(pm),
    nn = names(nm);
  const add = added(pn, nn),
    rem = added(nn, pn);
  if (add.length) out.push({ label: 'Meals added', detail: add.join(', ') });
  if (rem.length) out.push({ label: 'Meals removed', detail: rem.join(', ') });
  for (const m of nm) {
    const o = pm.find((x) => String(x.name || '').toLowerCase() === String(m.name || '').toLowerCase());
    if (!o) continue;
    const a = Number(o.totals?.calories_kcal),
      b = Number(m.totals?.calories_kcal);
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) >= 10)
      out.push({ label: String(m.name), detail: `${r(a)} → ${r(b)} kcal` });
  }
  const pt = prev.training_week || [],
    nt = next.training_week || [];
  const sig = /** @param {PTrain[]} l */ (l) => l.map((x) => `${x.day}:${x.focus}`).join('|');
  if (sig(pt) !== sig(nt)) out.push({ label: 'Training week', detail: `${pt.length} → ${nt.length} sessions` });
  if (!out.length) out.push({ label: 'No visible changes', detail: 'Targets, meals and training are the same' });
  return out;
}
