// Pure formatting and date helpers (no DOM, no app state).
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());
export const shift=(d,n)=>{let x=new Date(d+'T12:00:00');x.setDate(x.getDate()+n);return x.toISOString().slice(0,10)};
export const dateFmt=(d,opts={weekday:'long',day:'numeric',month:'long'})=>new Date(d+'T12:00:00').toLocaleDateString('en-IN',opts);
export const weekStart=d=>{let x=new Date(d+'T12:00:00');x.setDate(x.getDate()-((x.getDay()+6)%7));return x.toISOString().slice(0,10)};
export const fmt=n=>Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:1});
