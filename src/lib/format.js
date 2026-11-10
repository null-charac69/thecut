// Pure formatting and date helpers (no DOM, no app state).
/** @param {unknown} s @returns {string} */
export const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      /** @type {Record<string,string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
/** Today's date (YYYY-MM-DD) in Asia/Kolkata. @returns {string} */
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
/** @param {string} d YYYY-MM-DD @param {number} n days @returns {string} */
export const shift = (d, n) => {
  let x = new Date(d + 'T12:00:00');
  x.setDate(x.getDate() + n);
  return x.toISOString().slice(0, 10);
};
/** @param {string} d YYYY-MM-DD @param {Intl.DateTimeFormatOptions} [opts] @returns {string} */
export const dateFmt = (
  d,
  opts = /** @type {Intl.DateTimeFormatOptions} */ ({ weekday: 'long', day: 'numeric', month: 'long' })
) => new Date(d + 'T12:00:00').toLocaleDateString('en-IN', opts);
/** Sunday of the week containing d (weeks run Sunday to Saturday). @param {string} d YYYY-MM-DD @returns {string} */
export const weekStart = (d) => {
  let x = new Date(d + 'T12:00:00');
  x.setDate(x.getDate() - x.getDay());
  return x.toISOString().slice(0, 10);
};
/** @param {number|string|null|undefined} n @returns {string} */
export const fmt = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 });
