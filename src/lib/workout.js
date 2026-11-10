// Pure workout maths and parsers.
/** Epley estimated one-rep max. @param {number} kg @param {number} reps @returns {number} */
export const e1rm = (kg, reps) => (kg > 0 && reps > 0 ? kg * (1 + reps / 30) : 0);
/** Total volume (kg) of completed sets. @param {{sets:{kg:unknown,reps:unknown,done?:boolean}[]}[]} ex @returns {number} */
export const volOf = (ex) =>
  ex.reduce(
    (a, e) => a + e.sets.filter((s) => s.done).reduce((b, s) => b + (Number(s.kg) || 0) * (Number(s.reps) || 0), 0),
    0
  );
/** @param {unknown} raw @returns {{name:string,sets:number,reps:number}} */
export function parsePlanExercise(raw) {
  const s = String(raw || '').trim();
  const sm = s.match(/(\d+)\s*(?:sets?\b|[x×])/i),
    rm = s.match(/[x×]\s*(\d+)/i) || s.match(/(\d+)(?:\s*[-–]\s*\d+)?\s*reps?/i);
  const name =
    s
      .replace(/\s*[:(–—].*$/, '')
      .replace(/\s+\d+\s*(?:sets?\b|[x×]).*$/i, '')
      .trim() || s;
  return { name: name.slice(0, 60), sets: Math.min(8, Math.max(1, Number(sm?.[1]) || 3)), reps: Number(rm?.[1]) || 10 };
}
/** @param {string} line @returns {{name:string,sets:{set_number:number,reps:number,weight_kg:number}[]}|null} */
export function parseWorkoutExerciseLine(line) {
  const [nm, ...tail] = line.split('|');
  const name = nm.trim();
  if (!name) return null;
  const rest = tail.join('|').trim();
  if (rest.includes('@'))
    return {
      name,
      sets: rest.split(',').map((x, i) => {
        const [r, k] = x.trim().split('@');
        return { set_number: i + 1, reps: Math.max(0, Number(r) || 0), weight_kg: Math.max(0, Number(k ?? 0) || 0) };
      }),
    };
  const [count = '3', reps = '10', kg = '0'] = rest.split('|').length ? rest.split('|') : ['3', '10', '0'];
  return {
    name,
    sets: Array.from({ length: Math.max(1, Math.min(30, Number(count) || 3)) }, (_, i) => ({
      set_number: i + 1,
      reps: Math.max(0, Number(reps) || 10),
      weight_kg: Math.max(0, Number(kg) || 0),
    })),
  };
}
/** Target load written by the AI coach, e.g. "Bench Press 3x8 @ 62.5 kg" or "(try 62.5 kg)". @param {unknown} raw @returns {number|null} */
export function planTargetKg(raw) {
  const m = String(raw || '').match(/(\d+(?:\.\d+)?)\s*kg\b/i);
  const v = m ? Number(m[1]) : NaN;
  return Number.isFinite(v) && v > 0 && v <= 1000 ? v : null;
}
/**
 * Exact, human-readable differences between two training weeks (same day order).
 * @param {{day?:string,focus?:string,session_minutes?:number,exercises?:string[]}[]|null|undefined} prev
 * @param {{day?:string,focus?:string,session_minutes?:number,exercises?:string[]}[]|null|undefined} next
 * @returns {{label:string,detail:string}[]}
 */
export function diffWeek(prev, next) {
  /** @type {{label:string,detail:string}[]} */
  const out = [];
  const a = prev || [],
    b = next || [];
  b.forEach((nd, i) => {
    const pd = a[i];
    if (!pd) return;
    const parts = [];
    if (Number(pd.session_minutes) !== Number(nd.session_minutes))
      parts.push(`${Number(pd.session_minutes) || 0} → ${Number(nd.session_minutes) || 0} min`);
    const key = (/** @type {string} */ x) => parsePlanExercise(x).name.toLowerCase();
    const pm = new Map((pd.exercises || []).map((x) => [key(x), String(x)])),
      nm = new Map((nd.exercises || []).map((x) => [key(x), String(x)]));
    for (const [k, v] of nm) {
      if (!pm.has(k)) parts.push(`added ${v}`);
      else if (pm.get(k) !== v) parts.push(`${pm.get(k)} → ${v}`);
    }
    for (const [k, v] of pm) if (!nm.has(k)) parts.push(`removed ${v}`);
    if (parts.length)
      out.push({ label: `${nd.day || 'Day ' + (i + 1)}${nd.focus ? ' · ' + nd.focus : ''}`, detail: parts.join('; ') });
  });
  return out;
}
