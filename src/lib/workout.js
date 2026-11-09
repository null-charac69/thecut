// Pure workout maths and parsers.
export const e1rm=(kg,reps)=>kg>0&&reps>0?kg*(1+reps/30):0;
export const volOf=ex=>ex.reduce((a,e)=>a+e.sets.filter(s=>s.done).reduce((b,s)=>b+(Number(s.kg)||0)*(Number(s.reps)||0),0),0);
export function parsePlanExercise(raw){
 const s=String(raw||'').trim();
 const sm=s.match(/(\d+)\s*(?:sets?\b|[x×])/i),rm=s.match(/[x×]\s*(\d+)/i)||s.match(/(\d+)(?:\s*[-–]\s*\d+)?\s*reps?/i);
 const name=s.replace(/\s*[:(–—].*$/,'').replace(/\s+\d+\s*(?:sets?\b|[x×]).*$/i,'').trim()||s;
 return {name:name.slice(0,60),sets:Math.min(8,Math.max(1,Number(sm?.[1])||3)),reps:Number(rm?.[1])||10};
}
export function parseWorkoutExerciseLine(line){
 const [nm,...tail]=line.split('|');const name=nm.trim();if(!name)return null;const rest=tail.join('|').trim();
 if(rest.includes('@'))return {name,sets:rest.split(',').map((x,i)=>{const [r,k]=x.trim().split('@');return {set_number:i+1,reps:Math.max(0,Number(r)||0),weight_kg:Math.max(0,Number(k??0)||0)}})};
 const [count='3',reps='10',kg='0']=rest.split('|').length?rest.split('|'):['3','10','0'];
 return {name,sets:Array.from({length:Math.max(1,Math.min(30,Number(count)||3))},(_,i)=>({set_number:i+1,reps:Math.max(0,Number(reps)||10),weight_kg:Math.max(0,Number(kg)||0)}))};
}
