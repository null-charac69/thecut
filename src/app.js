
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { esc, today, shift, dateFmt, weekStart, fmt } from './lib/format.js';
import { e1rm, volOf, parsePlanExercise, planTargetKg, diffWeek } from './lib/workout.js';
import { friendlyError } from './lib/errors.js';
import { diffPlans } from './lib/plandiff.js';
const SUPABASE_URL='https://ukyobppectpjkcudgewy.supabase.co';
const SUPABASE_KEY='sb_publishable_Lm9JVKNstznjU-r9NGCZEw_YQE0ASeO';
if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
const supabase=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=s=>document.querySelector(s);
let user=null,session=null,settings={calorie_target:1566,protein_target_g:139,carbs_target_g:105.3,fat_target_g:64.4,water_target_ml:2500},date=today(),tab='overview',day={meals:[],entries:[],prep:[]},templates=[],groceries=[],toastTimer;
let templateHistory=[],aiPlanHistory=[],aiPlanDraft=null,aiActivePlan=null,aiBusy=false;
let lastPlanChange=null,aiProgTimer=null;
/* Refine-plan box state: survives in-app tab switches (memory) and page reloads (localStorage). */
let rf={text:'',pending:null},rfUid=null,rfInterrupted=false;
const RF_KEY=()=>'cut_refine_'+(user?.id||'x');
function rfSave(){try{rf.text||rf.pending?localStorage.setItem(RF_KEY(),JSON.stringify(rf)):localStorage.removeItem(RF_KEY())}catch{}}
function rfEnsure(){
 if(!user||rfUid===user.id)return;rfUid=user.id;
 try{const d=JSON.parse(localStorage.getItem(RF_KEY())||'null');if(d&&typeof d==='object')rf={text:String(d.text||'').slice(0,4000),pending:d.pending||null}}catch{}
 // A pending marker found on a fresh page load means the request died with the old page.
 if(rf.pending&&!aiBusy){rfInterrupted=true;rf.pending=null;rfSave()}
}
function rfBusy(){return !!rf.pending&&aiBusy}
function rfPaint(){
 const f=$('#aiRefineForm');if(!f)return;
 const b=f.querySelector('button[type=submit]'),t=f.querySelector('textarea'),busy=rfBusy();
 b.disabled=busy;b.classList.toggle('busy',busy);b.textContent=busy?'Thinking…':'Refine & apply';t.readOnly=busy;
 if(!busy&&t.value!==rf.text)t.value=rf.text;
 f.querySelector('.rf-note')?.classList.toggle('hidden',!rfInterrupted);
}
let aiUnlocked=false,insights=[],insightsEnabled=true,insightChannel=null,coachReview=null;
let _modalOpener=null,_manualSignOut=false;
async function q(p){let {data,error}=await p;if(error)throw error;return data}
async function bootstrap(){user=session.user; if(!user){renderAuthV2();return} $('#root').innerHTML='<div class="authwrap"><div class="authcard"><span class="loader"></span> Loading your workspace…</div></div>';
try{
 let [pr,st]=await Promise.all([q(supabase.from('profiles').select('*').eq('id',user.id).maybeSingle()),q(supabase.from('user_settings').select('*').eq('user_id',user.id).maybeSingle())]);
 if(!pr) await q(supabase.from('profiles').upsert({id:user.id,display_name:user.user_metadata?.name||user.email?.split('@')[0]||'Member',timezone:'Asia/Kolkata'}));
 if(!st) await q(supabase.from('user_settings').upsert({user_id:user.id,calorie_target:1566,protein_target_g:139,carbs_target_g:105.3,fat_target_g:64.4,water_target_ml:2500}));
 settings=st||{calorie_target:1566,protein_target_g:139,carbs_target_g:105.3,fat_target_g:64.4,water_target_ml:2500};
 if(st && (st.carbs_target_g==null||st.fat_target_g==null)) {settings={...st,carbs_target_g:st.carbs_target_g??105.3,fat_target_g:st.fat_target_g??64.4};await q(supabase.from('user_settings').upsert({user_id:user.id,carbs_target_g:settings.carbs_target_g,fat_target_g:settings.fat_target_g}));}
 await ensureTemplates();await ensureDay(date);await loadDay();await initV2(pr);render();
}catch(e){fail(e);$('#root').innerHTML='<div class="authwrap"><div class="authcard"><h2>Could not load your workspace</h2><p class="muted">'+esc(e.message)+'</p><button class="btn primary" id="retryBtn">Retry</button></div></div>';$('#retryBtn').onclick=()=>location.reload()}}
async function ensureTemplates(){
 let all=await q(supabase.from('meal_templates').select('*,meal_template_items(*)').eq('user_id',user.id).order('sort_order'));
 templateHistory=all;templates=all.filter(t=>t.is_active);
}
async function ensureDay(d){const rows=await q(supabase.from('daily_meals').select('id,meal_template_id').eq('user_id',user.id).eq('local_date',d));const existing=new Set(rows.map(x=>x.meal_template_id));const add=templates.filter(t=>t.is_active&&!existing.has(t.id)).map(t=>({user_id:user.id,local_date:d,meal_template_id:t.id,meal_name:t.name,planned_time:t.planned_time,status:'planned'}));if(add.length)await q(supabase.from('daily_meals').insert(add));}
async function loadDay(){await ensureDay(date);let [meals,entries,prep]=await Promise.all([
q(supabase.from('daily_meals').select('*').eq('user_id',user.id).eq('local_date',date).order('planned_time')),
q(supabase.from('food_entries').select('*').eq('user_id',user.id).eq('local_date',date).order('consumed_at')),
q(supabase.from('prep_tasks').select('*').eq('user_id',user.id).eq('local_date',date).order('sort_order'))
]);day={meals,entries,prep};
}
function getTemplate(meal){return templates.find(t=>t.id===meal.meal_template_id)||templateHistory.find(t=>t.id===meal.meal_template_id)}
function mealPlanTotals(){return day.meals.filter(m=>m.status==='completed').reduce((a,m)=>{let t=getTemplate(m);let total=t?.meal_template_items?.find(i=>i.food_name_snapshot==='__plan_total__');a.k+=Number(total?.calories_kcal||0);a.p+=Number(total?.protein_g||0);return a},{k:0,p:0})}
function totals(){let x=mealPlanTotals();return {k:x.k+day.entries.reduce((s,e)=>s+Number(e.calories_kcal||0),0),p:x.p+day.entries.reduce((s,e)=>s+Number(e.protein_g||0),0),carbs:day.entries.reduce((s,e)=>s+Number(e.carbs_g||0),0),fat:day.entries.reduce((s,e)=>s+Number(e.fat_g||0),0)}}
async function changeDate(d){if(!d||d>today())return;date=d;await loadDay();render()}
async function toggleMeal(m){let status=m.status==='completed'?'planned':'completed';await q(supabase.from('daily_meals').update({status,completed_at:status==='completed'?new Date().toISOString():null}).eq('id',m.id).eq('user_id',user.id));await loadDay();render()}

const NAV_ITEMS=[['ai','✦','Plan','Plan'],['meals','◉','Meals','Meals'],['workout','↗','Workout','Workout'],['weight','▤','Weight','Weight'],['coach','◈','Coach','Coach'],['prep','▣','Prep & Grocery','Prep']];
const LEGACY_TABS={overview:'ai',nutrition:'meals',habits:'meals',training:'workout',progress:'weight',planning:'prep',analytics:'ai',settings:'ai'};
function navBtn([id,ico,label,short],mobile){const locked=!aiUnlocked&&id!=='ai',cls=(tab===id?'active':'')+(locked?' locked':'')+(id==='ai'?' ai-first':'');
 return mobile?`<button data-tab="${id}" class="${cls}" ${locked?'aria-disabled="true"':''}><span>${locked?'🔒':ico}</span>${short}</button>`:`<button class="${cls}" data-tab="${id}" ${locked?'aria-disabled="true" title="Generate your first AI plan to unlock"':''}><span class="ico">${ico}</span>${label}${locked?'<span class="lock">🔒</span>':''}</button>`}
function nav(){return `<aside class="sidebar"><div class="brand"><div class="mark"></div><div><b>THE CUT<span>.</span></b><small>YOUR WORKSPACE</small></div></div><div class="nav-label">YOUR WORKSPACE</div><nav class="nav">${NAV_ITEMS.map(x=>navBtn(x)).join('')}</nav><div class="side-spacer"></div><div class="sidebar-note"><strong>THE DAILY RULE</strong>Make the next good choice. Then repeat.</div><div class="side-status"><i class="dot"></i>Cloud sync enabled</div></aside>`}
function header(){return `<header class="topbar${DATE_TABS.includes(tab)?'':' nodate'}"><div class="crumb">THE CUT / <b>${((NAV_ITEMS.find(x=>x[0]===tab)||[0,0,tab])[2]).toUpperCase()}</b></div><div class="top-actions"><button class="pill" id="prev">←</button><input type="date" id="date" value="${date}" max="${today()}" style="width:145px;padding:6px 8px;font-size:11px"/><button class="pill" id="next" ${date>=today()?'disabled':''}>→</button><button class="pill" id="bell" title="Coach insights" aria-label="Coach insights">${bellHTML()}</button><span class="pill">${esc(user.email)}</span><button class="userpill" id="acctBtn" title="Account" aria-label="Account menu" aria-haspopup="menu" aria-expanded="false">${esc((user.user_metadata?.name||user.email||'U').slice(0,1).toUpperCase())}</button></div></header>`}
function pageHead(k,title,sub,extra=''){return `<div class="pagehead"><div><div class="eyebrow">${k}</div><h1>${title}<em>.</em></h1><p class="subtitle">${sub}</p></div>${extra}</div>`}
function foldCard(title,body){return `<details class="card fold"><summary>${title}<span class="muted small">Edit</span></summary>${body}</details>`}
function card(title,body,extra=''){return `<section class="card"><div class="section-title"><h2>${title}</h2>${extra}</div>${body}</section>`}
function metric(label,value,unit,foot){return `<div class="card metric"><div class="label">${label}</div><strong>${value} <span class="muted" style="font-size:13px">${unit}</span></strong><small>${foot}</small></div>`}
function mealRows(){return day.meals.map((m,i)=>{let t=getTemplate(m),plan=t?.meal_template_items||[],tot=plan.find(x=>x.food_name_snapshot==='__plan_total__');return `<div class="meal"><div class="meal-index">0${i+1}</div><div><h3>${esc(m.meal_name)}</h3><div class="meta">${(m.planned_time||'').slice(0,5)} · ${plan.filter(x=>x.food_name_snapshot!=='__plan_total__').map(x=>`${esc(x.food_name_snapshot)} (${esc(x.unit)})`).join(' · ')}</div></div><div class="kcal">${fmt(tot?.calories_kcal)} <small>kcal · ${fmt(tot?.protein_g)} g protein</small></div><div class="row meal-action"><button class="check ${m.status==='completed'?'done':''}" data-meal="${m.id}" title="Mark complete">${m.status==='completed'?'✓':'○'}</button></div></div>`}).join('')||'<div class="empty">No meal templates. Add one in Nutrition.</div>'}

function aiPlanStatusCard(){
 const draft=aiPlanHistory.find(x=>x.status==='draft'),act=aiActivePlan,prev=aiPlanHistory.find(x=>x.status!=='active'&&x.status!=='draft');
 const tg=x=>{const t=x.plan?.targets||{};return fmt(t.calories_kcal)+' kcal · '+fmt(t.protein_g)+' g protein'};
 let h='';
 if(draft)h+=`<section class="card plan-now"><div class="eyebrow">DRAFT WAITING</div><h2>${esc(draft.title)}</h2><p class="muted small">${tg(draft)}</p><button class="btn primary" data-ai-apply="${draft.id}">Apply to my workspace</button></section>`;
 if(act)h+=`<section class="card plan-now"><div class="eyebrow">ACTIVE PLAN</div><h2>${esc(act.title)}</h2><p class="muted small">${tg(act)}</p><div class="row wrap"><button class="btn" data-goto="meals">See meals</button>${prev?`<button class="btn ghost" data-ai-restore="${prev.id}">Undo last change</button>`:''}</div></section>`;
 return h}
function aiPlannerPage(){
 const r=aiPlanDraft||aiPlanHistory.find(x=>x.status==='active')||aiPlanHistory[0]||null,p=r?.inputs||{},v=(k,d='')=>esc(p[k]??d),opts=(k,a)=>{const selected=p[k]===null||p[k]===undefined||p[k]===''?'':String(p[k]);return (selected===''?'<option value="" selected disabled>Choose…</option>':'')+a.map(([x,y])=>`<option value="${x}" ${selected===String(x)?'selected':''}>${y}</option>`).join('')};
 return `${pageHead('PERSONALIZED PLANNING · AI ASSISTANT','AI Planner','Tell the AI about you. Your plan lands in Meals, Workout and Prep.')}
 <div class="notice" style="margin-bottom:13px">Estimates only, not medical nutrition therapy. Every new plan applies straight away. You can undo it.</div>
 ${aiPlanStatusCard()}
 <div class="ai-page"><div class="grid g2 ai-forms">${(r?foldCard:card)('Your details',`<form id="aiIntakeForm" class="ai-intake-grid">
 <div class="ai-section-title ai-wide">01 · Body profile and goal</div><div class="field"><label>AGE (18+)</label><input name="age_years" type="number" min="18" max="100" required value="${v('age_years')}" placeholder="Years"/></div><div class="field"><label>SEX FOR ENERGY ESTIMATE</label><select name="sex">${opts('sex',[['prefer_not_to_say','Prefer not to say'],['male','Male'],['female','Female']])}</select></div>
 <div class="field"><label>HEIGHT (CM)</label><input name="height_cm" type="number" min="120" max="230" step="0.1" required value="${v('height_cm')}" placeholder="cm"/></div><div class="field"><label>WEIGHT (KG)</label><input name="weight_kg" type="number" min="30" max="350" step="0.1" required value="${v('weight_kg')}" placeholder="kg"/></div>
 <div class="field"><label>TARGET WEIGHT (KG)</label><input name="target_weight_kg" type="number" min="30" max="350" step="0.1" value="${v('target_weight_kg')}" placeholder="Optional"/></div><div class="field"><label>GOAL</label><select name="goal" required>${opts('goal',[['fat_loss','Fat loss'],['muscle_gain','Muscle gain'],['recomposition','Body recomposition'],['maintain','Maintain weight'],['general_fitness','General fitness']])}</select></div>
 <div class="field"><label>ACTIVITY LEVEL</label><select name="activity_level">${opts('activity_level',[['sedentary','Mostly seated'],['light','Light'],['moderate','Moderate'],['high','High']])}</select></div><div class="field"><label>TRAINING EXPERIENCE</label><select name="training_experience">${opts('training_experience',[['beginner','Beginner'],['intermediate','Intermediate'],['advanced','Advanced']])}</select></div>
 <div class="ai-section-title ai-wide">02 · Training schedule</div><div class="field"><label>TRAINING DAYS / WEEK</label><input name="training_days_per_week" type="number" min="0" max="7" required value="${v('training_days_per_week')}" step="1" placeholder="0–7"/></div><div class="field"><label>TRAINING ACCESS</label><select name="training_location" required>${opts('training_location',[['gym','Gym'],['home','Home'],['mixed','Both'],['none','No current training']])}</select></div>
 <div class="ai-section-title ai-wide">03 · Food and routine</div><div class="field"><label>DIET</label><select name="dietary_pattern" required>${opts('dietary_pattern',[['omnivore','Omnivore'],['eggetarian','Eggetarian'],['vegetarian','Vegetarian'],['vegan','Vegan']])}</select></div><div class="field"><label>MEALS PER DAY</label><select name="meals_per_day" required>${opts('meals_per_day',[['2','2'],['3','3'],['4','4'],['5','5'],['6','6']])}</select></div>
 <div class="field"><label>DAILY BUDGET (₹)</label><input name="food_budget_inr" type="number" min="0" max="100000" value="${v('food_budget_inr')}" placeholder="Optional"/></div><div class="field"><label>COOKING TIME (MIN / DAY)</label><input name="cooking_minutes" type="number" min="0" max="180" value="${v('cooking_minutes')}" placeholder="Optional"/></div>
 <div class="field"><label>LOCATION / FOOD MARKET</label><input name="location" value="${v('location')}" placeholder="City, country"/></div><div class="field"><label>TIMELINE (WEEKS)</label><input name="goal_timeline_weeks" type="number" min="1" max="104" value="${v('goal_timeline_weeks')}" placeholder="Optional"/></div>
 <div class="ai-section-title ai-wide">04 · Constraints and preferences</div><div class="field ai-wide"><label>ALLERGIES / FOODS TO AVOID</label><input name="allergies" value="${v('allergies')}" placeholder="Ingredients to exclude"/></div><div class="field ai-wide"><label>FOODS YOU LIKE</label><input name="food_preferences" value="${v('food_preferences')}" placeholder="Chicken, eggs, dal, rice, curd..."/></div>
 <div class="field ai-wide"><label>PREFERRED CUISINES</label><input name="preferred_cuisines" value="${v('preferred_cuisines')}" placeholder="Indian home food, North Indian..."/></div><div class="field ai-wide"><label>OTHER CONSTRAINTS</label><textarea name="additional_notes" rows="3" placeholder="Work shifts, meal timing, equipment, disliked foods...">${v('additional_notes')}</textarea></div>
 <label class="row ai-wide" style="font-size:12px;color:var(--muted)"><input type="checkbox" name="adult_confirmed" required ${p.adult_confirmed?'checked':''}/> I am 18 or older and understand this is general wellness information, not medical advice.</label>
 <div class="ai-wide"><button class="btn primary" id="aiProfileAction" type="submit">${r?'Analyze edits & refine plan':'Generate my AI plan'}</button> ${r?'<button class="btn" type="button" data-ai-generate-new>Generate a fresh plan</button>':''} <span class="ai-muted">Your profile stays editable. When you submit changes, the AI compares them with the previous plan, explains the implications and creates a reviewable draft.</span></div><div class="ai-wide ai-muted" id="aiEditPreview" aria-live="polite"></div></form>`)}
 ${r?(rfEnsure(),card('Refine plan',`<form id="aiRefineForm"><div class="notice warn rf-note ${rfInterrupted?'':'hidden'}" role="status" style="margin-bottom:10px">Your last refine didn’t finish because the page was closed or reloaded. Your text is back below. Tap Refine &amp; apply to send it again.</div><div class="field"><textarea name="instruction" rows="2" required aria-label="What should change?" placeholder="e.g. swap paneer for tofu, shorter prep" ${rfBusy()?'readonly':''}>${esc(rf.text)}</textarea></div><button class="btn primary${rfBusy()?' busy':''}" type="submit" ${rfBusy()?'disabled':''}>${rfBusy()?'Thinking…':'Refine &amp; apply'}</button></form>`)):''}</div></div>`;
}
async function callAIPlanner(action,profile,extra={}){
 const {data:{session:s}}=await supabase.auth.getSession();if(!s?.access_token)throw new Error('Session expired. Sign in again.');
 const r=await fetch(SUPABASE_URL+'/functions/v1/the-cut-ai',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+s.access_token,'apikey':SUPABASE_KEY},body:JSON.stringify({action,profile,...extra})});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'AI request failed.');return d;
}
function readAIProfile(form){
 const f=new FormData(form),raw=k=>{const x=f.get(k);return x===null||x===''?null:x},num=k=>raw(k)===null?null:Number(raw(k));
 return {adult_confirmed:f.get('adult_confirmed')==='on',age_years:num('age_years'),sex:raw('sex'),height_cm:num('height_cm'),weight_kg:num('weight_kg'),target_weight_kg:num('target_weight_kg'),goal:raw('goal'),activity_level:raw('activity_level'),training_experience:raw('training_experience'),training_days_per_week:num('training_days_per_week'),training_location:raw('training_location'),dietary_pattern:raw('dietary_pattern'),meals_per_day:num('meals_per_day'),food_budget_inr:num('food_budget_inr'),cooking_minutes:num('cooking_minutes'),location:raw('location'),goal_timeline_weeks:num('goal_timeline_weeks'),allergies:raw('allergies')||'',food_preferences:raw('food_preferences')||'',preferred_cuisines:raw('preferred_cuisines')||'',additional_notes:raw('additional_notes')||''};
}
function collectAIProfile(form){
 const p=readAIProfile(form);
 if(!p.adult_confirmed||p.age_years===null||p.age_years<18)throw new Error('This planner is for adults aged 18 and above. Enter your age and confirm the checkbox.');
 if(p.height_cm===null||p.height_cm<120||p.height_cm>230||p.weight_kg===null||p.weight_kg<30||p.weight_kg>350)throw new Error('Enter a valid height (120–230 cm) and current weight (30–350 kg).');
 if(!p.goal||!p.dietary_pattern||!p.training_location||p.meals_per_day===null)throw new Error('Choose a goal, dietary pattern, training access and meals per day.');
 if(!Number.isInteger(p.training_days_per_week)||p.training_days_per_week<0||p.training_days_per_week>7)throw new Error('Enter training days as a whole number from 0 to 7.');
 if(p.food_budget_inr!==null&&(p.food_budget_inr<0||p.food_budget_inr>100000))throw new Error('Check your daily food budget.');
 if(p.cooking_minutes!==null&&(p.cooking_minutes<0||p.cooking_minutes>180))throw new Error('Check your daily cooking time.');
 return p;
}
const AI_PROFILE_LABELS={age_years:'Age',sex:'Sex for energy estimate',height_cm:'Height',weight_kg:'Current weight',target_weight_kg:'Target weight',goal:'Goal',activity_level:'Activity level',training_experience:'Training experience',training_days_per_week:'Training days per week',training_location:'Training access',dietary_pattern:'Diet',meals_per_day:'Meals per day',food_budget_inr:'Daily food budget',cooking_minutes:'Cooking time per day',location:'Location / food market',goal_timeline_weeks:'Goal timeline',allergies:'Allergies / foods to avoid',food_preferences:'Foods liked',preferred_cuisines:'Preferred cuisines',additional_notes:'Other constraints'};
function getAIBasePlan(){return aiPlanHistory.find(x=>x.id===aiPlanDraft?.id)||aiPlanHistory.find(x=>x.status==='active')||aiPlanHistory[0]||null;}
function describeAIProfileChanges(before={},after={}){return Object.keys(AI_PROFILE_LABELS).filter(k=>String(before[k]??'')!==String(after[k]??'')).map(k=>({key:k,label:AI_PROFILE_LABELS[k],from:before[k]??null,to:after[k]??null}));}
function aiProfileValue(value,key){
 if(value===null||value===undefined||value==='')return 'Not set';
 const unit={height_cm:' cm',weight_kg:' kg',target_weight_kg:' kg',food_budget_inr:' ₹/day',cooking_minutes:' min/day',goal_timeline_weeks:' weeks',training_days_per_week:' days/week',age_years:' years'}[key]||'';
 return String(value)+unit;
}
function buildAIEditInstruction(base,profile,changes,extraText=''){
 const diff=changes.length?changes.map(x=>'- '+x.label+': '+aiProfileValue(x.from,x.key)+' → '+aiProfileValue(x.to,x.key)).join('\n'):'No profile fields changed.';
 return ['Act as a context-aware nutrition and training planning agent, not a one-shot form generator.','The saved plan is the baseline. The UPDATED PROFILE supplied with this request is the source of truth for the revised plan.','PROFILE EDITS FROM THE USER:\n'+diff,extraText?'USER MESSAGE:\n'+extraText:'','Analyze the practical impact of these edits. Explain relevant effects on energy needs, calorie and macro targets, meal count and portions, food cost, prep effort, training volume, recovery and adherence. Identify conflicts or unsafe/unsustainable requests instead of blindly agreeing.','Use the plan summary and rationale to provide concise, specific insights: what changed, why the revised plan differs, important trade-offs, and the most useful next action. Update assumptions and safety notes when relevant. Keep all recommendations consistent with the updated profile and the supplied structured output schema.'].filter(Boolean).join('\n\n');
}
async function saveAIDraft(result,profile){
 const r=await q(supabase.from('ai_plan_versions').insert({user_id:user.id,title:result.plan.title,status:'draft',inputs:profile,plan:result.plan,model:result.model,prompt_version:result.prompt_version}).select().single());
 aiPlanHistory=[r,...aiPlanHistory.filter(x=>x.id!==r.id)];aiPlanDraft=r;if(!await applyAIPlan(r.id,{auto:true}))await render();
}
function updateAIEditPreview(){
 const el=$('#aiEditPreview'),form=$('#aiIntakeForm');if(!el||!form)return;
 const base=getAIBasePlan();if(!base){el.textContent='Your first plan starts with a blank profile. Complete the fields above; nothing is assumed or copied from unrelated tracker settings.';return;}
 const changes=describeAIProfileChanges(base.inputs||{},readAIProfile(form));
 el.textContent=changes.length?changes.length+' unsent profile edit(s): '+changes.map(x=>x.label).join(' · ')+'. Submit to let the AI assess their impact and create a revised draft.':'No unsent profile edits. Use the AI message box to ask a question or request a change.';
}
function setAIProgress(action){
 clearInterval(aiProgTimer);aiProgTimer=null;let el=document.getElementById('aiProg');
 if(!action){el?.remove();return}
 const msgs=action==='workout'?['Reading your sets…','Comparing with your history…','Weighing your feedback…','Adjusting your training week…','Almost there…']:action==='refine'?['Reading your plan…','Rebalancing macros…','Swapping foods…','Rebuilding your grocery list…','Almost there…']:['Calculating your targets…','Designing your meals…','Building your training week…','Almost there…'];
 if(!el){el=document.createElement('div');el.id='aiProg';el.setAttribute('role','status');el.innerHTML='<span class="aiprog-orb" aria-hidden="true"></span><span class="aiprog-txt"></span><i class="aiprog-bar" aria-hidden="true"></i>';document.body.appendChild(el)}
 let i=0;const t=el.querySelector('.aiprog-txt');t.textContent=msgs[0];
 aiProgTimer=setInterval(()=>{i=Math.min(i+1,msgs.length-1);t.textContent=msgs[i]},3500);
}
function planChangeCard(){
 const c=lastPlanChange;if(!c)return '';
 return `<section class="card plan-change"><div class="row between"><div class="eyebrow">${c.restored?'PLAN RESTORED':'PLAN UPDATED · WHAT CHANGED'}</div><button class="btn sm ghost" data-dismiss-change aria-label="Dismiss">✕</button></div><h2>${esc(c.title)}</h2>${c.summary&&!c.restored?`<p class="muted small clamp3">${esc(c.summary)}</p>`:''}<ul class="chg">${c.lines.map(l=>`<li><b>${esc(l.label)}</b><span>${esc(l.detail)}</span></li>`).join('')}</ul>${c.prevId?`<button class="btn" data-ai-restore="${esc(c.prevId)}">Undo this change</button>`:''}</section>`;
}
const BELL_SVG='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
const bellHTML=()=>BELL_SVG+(unreadCount()?`<b class="badge">${unreadCount()}</b>`:'');
function closeBellMenu(){document.getElementById('bellMenu')?.remove();document.removeEventListener('click',_bellOutside,true);document.removeEventListener('keydown',_bellEsc,true);$('#bell')?.setAttribute('aria-expanded','false')}
function _bellOutside(e){if(!e.target.closest('#bellMenu,#bell'))closeBellMenu()}
function _bellEsc(e){if(e.key==='Escape'){closeBellMenu();$('#bell')?.focus()}}
async function openBellMenu(){
 if(document.getElementById('bellMenu')){closeBellMenu();return}
 const b=$('#bell'),r=b.getBoundingClientRect(),m=document.createElement('div');m.id='bellMenu';m.setAttribute('role','dialog');m.setAttribute('aria-label','Coach notes');
 m.style.cssText='top:'+(r.bottom+8)+'px;right:8px';
 const list=insights.filter(i=>!i.dismissed_at).slice(0,5);
 m.innerHTML=`<div class="bm-head"><b>Coach notes</b><small>${unreadCount()?unreadCount()+' new':'all caught up'}</small></div>${list.length?list.map(i=>`<button class="bm-item ${i.read_at?'':'unread'}" data-bm-open><i class="dot2" aria-hidden="true"></i><span><strong>${esc(i.title)}</strong><em>${esc(i.body)}</em></span></button>`).join(''):'<div class="bm-empty">Nothing yet. Your coach drops notes here as you log.</div>'}<button class="bm-foot" data-bm-open>Open Coach</button>`;
 document.body.appendChild(m);b.setAttribute('aria-expanded','true');
 m.querySelectorAll('[data-bm-open]').forEach(x=>x.onclick=async()=>{closeBellMenu();await gotoTab('coach')});
 setTimeout(()=>{document.addEventListener('click',_bellOutside,true);document.addEventListener('keydown',_bellEsc,true)},0);
 await markInsightsRead();const bb=$('#bell');if(bb)bb.innerHTML=bellHTML();
}
async function runAIPlanRequest(action,profile,extra,button,workingLabel,idleLabel,onResult){
 if(aiBusy)return false;
 let ok=false;
 try{aiBusy=true;setAIProgress(action==='refine'?'refine':'generate');if(button){button.disabled=true;button.classList.add('busy');button.textContent=workingLabel;}const result=await callAIPlanner(action,profile,extra);if(onResult)onResult();await saveAIDraft(result,profile);ok=true}
 catch(e){fail(e)}
 finally{aiBusy=false;setAIProgress(null);if(button&&button.isConnected){button.disabled=false;button.classList.remove('busy');button.textContent=idleLabel;}rfPaint()}
 return ok;
}
async function generateAIPlan(e){
 e.preventDefault();if(aiBusy)return;const form=e.currentTarget,button=form.querySelector('#aiProfileAction');
 try{
  const profile=collectAIProfile(form),base=getAIBasePlan();
  if(base){
   const changes=describeAIProfileChanges(base.inputs||{},profile);
   if(!changes.length)throw new Error('No profile fields have changed. Edit a field or use the AI message box to ask a question.');
   const instruction=buildAIEditInstruction(base,profile,changes);
   await runAIPlanRequest('refine',profile,{instruction,current_plan_id:base.id},button,'Analyzing edits…','Analyze edits & refine plan');
  }else await runAIPlanRequest('generate',profile,{},button,'Generating…','Generate my AI plan');
 }catch(e){fail(e)}
}
async function generateFreshAIPlan(button){
 try{const form=$('#aiIntakeForm'),profile=collectAIProfile(form);await runAIPlanRequest('generate',profile,{},button,'Generating fresh plan…','Generate a fresh plan');}
 catch(e){fail(e)}
}
async function refineAIPlan(e){
 e.preventDefault();if(aiBusy)return;const form=e.currentTarget,button=form.querySelector('button[type=submit]'),base=getAIBasePlan(),message=String(new FormData(form).get('instruction')||'').trim();
 if(!base)return;
 try{
  const profile=collectAIProfile($('#aiIntakeForm')),changes=describeAIProfileChanges(base.inputs||{},profile);
  const instruction=buildAIEditInstruction(base,profile,changes,message);
  rf.text=message;rf.pending={at:Date.now(),planId:base.id};rfInterrupted=false;rfSave();
  try{await runAIPlanRequest('refine',profile,{instruction,current_plan_id:base.id},button,'Thinking…','Refine & apply',()=>{rf.text='';rf.pending=null;rfSave()})}
  finally{if(rf.pending){rf.pending=null;rfSave()}rfPaint()}
 }catch(e){fail(e)}
}
async function applyAIPlanCore(id,opts={}){
 const record=aiPlanHistory.find(x=>x.id===id);
 if(!record||record.status==='active')return false;
 const prevId=aiActivePlan?.id||null,prevPlan=aiActivePlan?.plan||null;
 if(!opts.auto&&!opts.quiet&&!await uiConfirm('Apply this plan?','Active meal templates will be archived, targets updated, and missing grocery/prep items added. Completed and historical meal logs are kept.',{confirm:'Apply plan'}))return;
 try{
  const result=await q(supabase.rpc('apply_ai_plan_version',{p_version_id:id,p_local_date:date,p_week_start:weekStart(date)}));
  await ensureTemplates();await ensureDay(date);await loadDay();
  aiPlanHistory=await q(supabase.from('ai_plan_versions').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(10));
  aiPlanDraft=aiPlanHistory.find(x=>x.id===id)||null;
  settings={...settings,calorie_target:record.plan.targets.calories_kcal,protein_target_g:record.plan.targets.protein_g,carbs_target_g:record.plan.targets.carbs_g,fat_target_g:record.plan.targets.fat_g,fiber_target_g:record.plan.targets.fibre_g,water_target_ml:record.plan.targets.water_ml};
  await loadActivePlan();aiUnlocked=true;
  lastPlanChange={title:record.title,summary:record.plan?.summary||'',lines:diffPlans(prevPlan,record.plan),prevId:opts.quiet?null:prevId,restored:!!opts.quiet};
  if(opts.quiet){await render();toast('Restored that plan.')}
  else if(opts.auto){const onPlan=tab==='ai';if(onPlan)tab='meals';await render();toastUndo(onPlan?'Plan applied. Here is what changed.':'Your plan was updated. Check Meals for what changed.',prevId?()=>applyAIPlan(prevId,{quiet:true}):null)}
  else{toast('AI plan applied. '+(result?.meal_templates_created||0)+' meal templates are now active.');await render()}
  return true;
 }catch(e){fail(e);toast('Plan was not applied. No partial database changes were committed.');return false}
}

async function loadModule(){
 if(tab==='account')await loadPlanHistory();
 if(tab==='ai'){
  aiPlanHistory=await q(supabase.from('ai_plan_versions').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(10));
  if(!aiPlanDraft||!aiPlanHistory.some(x=>x.id===aiPlanDraft.id))aiPlanDraft=aiPlanHistory.find(x=>x.status==='draft')||aiPlanHistory.find(x=>x.status==='active')||aiPlanHistory[0]||null;
 }
}
async function render(){tab=LEGACY_TABS[tab]||tab;if(!aiUnlocked&&tab!=='ai'&&tab!=='account')tab='ai';let root=$('#root');root.innerHTML=`<div class="app">${nav()}<main class="main">${header()}<div class="page" id="pagebody"><span class="loader"></span> Loading…</div></main></div><div class="mobilebar">${NAV_ITEMS.map(x=>navBtn(x,true)).join('')}</div>`;
const mobileBar=root.querySelector('.mobilebar');const activeNav=mobileBar?.querySelector('.active');if(mobileBar&&activeNav&&window.innerWidth<=860)mobileBar.scrollLeft=Math.max(0,activeNav.offsetLeft-(mobileBar.clientWidth-activeNav.offsetWidth)/2);try{await loadActivePlan();if(tab==='ai'||tab==='account')await loadModule();if(tab==='weight')await loadWeight();if(tab==='prep')await loadGroceries();if(tab==='workout'||tab==='coach'){await loadPlanHistory();if(tab==='workout'&&aiActivePlan&&!wkHist){try{await loadWkHistory()}catch(e){console.error(e);wkHist={}}}}await loadInsights();$('#pagebody').innerHTML=({ai:aiPlannerPage,meals:mealsV3,workout:workoutV3,weight:weightV3,account:accountV3,coach:()=>aiActivePlan?coachPanel(true):pageHead('COACH','Coach','Your plan coach.')+needsPlanCard('coaching'),prep:prepV3})[tab]();wire();wireV2();wireV3();if(tab==='workout'&&wk)wireWk();if(tab==='workout')fbResume()}catch(e){fail(e);$('#pagebody').innerHTML=`<div class="notice warn">${esc(e.message)}</div>`}}
function wire(){document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=async()=>{await gotoTab(b.dataset.tab)});document.querySelectorAll('[data-goto]').forEach(b=>b.onclick=async()=>{await gotoTab(b.dataset.goto)});$('#prev').onclick=()=>changeDate(shift(date,-1));$('#next').onclick=()=>changeDate(shift(date,1));$('#date').onchange=e=>changeDate(e.target.value);document.querySelectorAll('[data-meal]').forEach(b=>b.onclick=()=>toggleMeal(day.meals.find(x=>x.id===b.dataset.meal)).catch(fail));$('#addMealTemplate')?.addEventListener('click',addMealTemplate);
$('#foodForm')?.addEventListener('submit',saveFood);$('#groceryForm')?.addEventListener('submit',addGroceryV2);$('#prepForm')?.addEventListener('submit',addPrep);
document.querySelectorAll('[data-delfood]').forEach(b=>b.onclick=()=>deleteFood(b.dataset.delfood));document.querySelectorAll('[data-grocery]').forEach(b=>b.onchange=()=>updateGrocery(b.dataset.grocery,b.checked));document.querySelectorAll('[data-delgrocery]').forEach(b=>b.onclick=()=>deleteRow('grocery_items',b.dataset.delgrocery,'planning'));document.querySelectorAll('[data-prep]').forEach(b=>b.onchange=()=>updatePrep(b.dataset.prep,b.checked));document.querySelectorAll('[data-delprep]').forEach(b=>b.onclick=()=>deleteRow('prep_tasks',b.dataset.delprep,'planning'));document.querySelectorAll('[data-delworkout]').forEach(b=>b.onclick=()=>deleteRow('workout_sessions',b.dataset.delworkout,'training'));$('#aiIntakeForm')?.addEventListener('submit',generateAIPlan);$('#aiIntakeForm')?.addEventListener('input',updateAIEditPreview);$('#aiIntakeForm')?.addEventListener('change',updateAIEditPreview);document.querySelectorAll('[data-ai-generate-new]').forEach(b=>b.onclick=()=>generateFreshAIPlan(b));$('#aiRefineForm')?.addEventListener('submit',refineAIPlan);$('#aiRefineForm textarea')?.addEventListener('input',e=>{rf.text=e.target.value;rfInterrupted=false;$('#aiRefineForm .rf-note')?.classList.add('hidden');rfSave()});document.querySelectorAll('[data-ai-apply]').forEach(b=>b.onclick=()=>applyAIPlan(b.dataset.aiApply));document.querySelectorAll('[data-ai-restore]').forEach(b=>b.onclick=()=>applyAIPlan(b.dataset.aiRestore,{quiet:true}));document.querySelectorAll('[data-dismiss-change]').forEach(b=>b.onclick=()=>{lastPlanChange=null;render()});}
async function after(){await loadDay();await render()}
async function addMealTemplateCore(){
 const saved=await uiForm({
  title:'Add a meal',submit:'Add meal',
  intro:'It joins your active plan. Calories and protein are estimates for the whole meal.',
  fields:[
   {name:'name',label:'Meal name',required:true,maxlength:60,placeholder:'e.g. Post-workout shake'},
   {name:'time',label:'Planned time',type:'time',required:true,value:'12:00'},
   {name:'kcal',label:'Calories (kcal)',type:'number',min:0,max:5000,step:1,inputmode:'numeric',value:'300'},
   {name:'protein',label:'Protein (g)',type:'number',min:0,max:500,step:0.1,inputmode:'decimal',value:'25'},
   {name:'parts',label:'Components (optional)',type:'textarea',rows:4,placeholder:'One per line: ingredient | portion\nchicken breast | 150 g raw',full:true}
  ],
  validate:v=>{if(!v.name.trim())return 'Give the meal a name.';if(!/^\d{2}:\d{2}$/.test(v.time))return 'Choose a planned time.';return ''},
  onSubmit:async v=>{
   const t=await q(supabase.from('meal_templates').insert({user_id:user.id,name:v.name.trim(),sort_order:templates.length,planned_time:v.time+':00',is_active:true}).select().single());
   const items=v.parts.split('\n').map(x=>x.trim()).filter(Boolean).map((x,i)=>{const [food,unit='1 serving']=x.split('|').map(y=>y.trim());return {user_id:user.id,meal_template_id:t.id,food_name_snapshot:food,unit,quantity:1,sort_order:i}});
   items.push({user_id:user.id,meal_template_id:t.id,food_name_snapshot:'__plan_total__',unit:'plan estimate',quantity:1,calories_kcal:Number(v.kcal)||0,protein_g:Number(v.protein)||0,sort_order:99});
   await q(supabase.from('meal_template_items').insert(items));
  }
 });
 if(!saved)return;
 try{templates=await q(supabase.from('meal_templates').select('*,meal_template_items(*)').eq('user_id',user.id).eq('is_active',true).order('sort_order'));await ensureDay(date);toast('Meal added');await after()}catch(e){fail(e)}
}
async function saveFood(e){e.preventDefault();let f=new FormData(e.currentTarget),o={user_id:user.id,local_date:date,consumed_at:new Date().toISOString()};['food_name_snapshot','unit'].forEach(k=>o[k]=f.get(k));['quantity','calories_kcal','protein_g','carbs_g','fat_g','fiber_g'].forEach(k=>o[k]=Number(f.get(k)||0));try{let food=await q(supabase.from('foods').insert({user_id:user.id,name:o.food_name_snapshot,serving_label:o.unit,calories_kcal:o.calories_kcal,protein_g:o.protein_g,carbs_g:o.carbs_g,fat_g:o.fat_g,fiber_g:o.fiber_g}).select().single());o.food_id=food.id;await q(supabase.from('food_entries').insert(o));toast('Food entry saved and added to your food library');await after()}catch(e){fail(e)}}
async function deleteFood(id){if(!await uiConfirm('Delete?','Delete this food entry?',{confirm:'Delete',danger:true}))return;await q(supabase.from('food_entries').delete().eq('id',id).eq('user_id',user.id));await after()}

async function updateGrocery(id,checked){await q(supabase.from('grocery_items').update({is_purchased:checked,purchased_at:checked?new Date().toISOString():null}).eq('id',id).eq('user_id',user.id));await render()}
async function addPrep(e){e.preventDefault();let f=new FormData(e.currentTarget);try{await q(supabase.from('prep_tasks').insert({user_id:user.id,local_date:date,task:f.get('task'),sort_order:day.prep.length}));await after()}catch(e){fail(e)}}
async function updatePrep(id,checked){await q(supabase.from('prep_tasks').update({is_completed:checked,completed_at:checked?new Date().toISOString():null}).eq('id',id).eq('user_id',user.id));await after()}
async function deleteRow(table,id,tabName){if(!await uiConfirm('Delete?','Delete this record?',{confirm:'Delete',danger:true}))return;try{await q(supabase.from(table).delete().eq('id',id).eq('user_id',user.id));await render()}catch(e){fail(e)}}
async function logout(){_manualSignOut=true;await clearPushForCurrentUser();await supabase.auth.signOut();session=null;user=null;renderAuthV2()}

/* ===== THE CUT: AI-first gating, coach/insights, tour ===== */
async function gotoTab(t){if(!aiUnlocked&&t!=='ai'&&t!=='account'){toast('Generate your first AI plan to unlock the rest of the app.');return}tab=t;await render()}

async function initV2(pr){
 tab='ai';
 try{const {count,error}=await supabase.from('ai_plan_versions').select('id',{count:'exact',head:true}).eq('user_id',user.id);if(error)throw error;aiUnlocked=(count||0)>0}
 catch(e){console.error(e);aiUnlocked=true} // fail open: a transient error must never lock a user out
 try{await loadActivePlan()}catch(e){console.error(e)}
 subscribeInsights();
 if(aiUnlocked)setTimeout(runAssess,4000);
}

/* ---- coach insights (rows are written by database rules; this just shows them live) ---- */
const unreadCount=()=>insights.filter(i=>!i.read_at&&!i.dismissed_at).length;
async function loadInsights(){
 if(!insightsEnabled||!user)return;
 try{const since=new Date(Date.now()-3*864e5).toISOString().slice(0,10);
  const {data,error}=await supabase.from('agent_insights').select('*').eq('user_id',user.id).gte('insight_date',since).order('created_at',{ascending:false}).limit(30);
  if(error)throw error;insights=(data||[]).filter(i=>!/^(hydration|recovery)/.test(String(i.kind||'')))}
 catch(e){insights=[];if(/agent_insights|schema cache|PGRST205|42P01/i.test(String(e?.message||e?.code||'')))insightsEnabled=false;else console.error(e)}
}
function subscribeInsights(){
 unsubscribeInsights();if(!insightsEnabled)return;
 try{insightChannel=supabase.channel('agent-insights-'+user.id).on('postgres_changes',{event:'*',schema:'public',table:'agent_insights',filter:'user_id=eq.'+user.id},onInsightChange).subscribe()}catch(e){console.error(e)}
}
function unsubscribeInsights(){if(insightChannel){try{supabase.removeChannel(insightChannel)}catch{}insightChannel=null}}
async function onInsightChange(p){
 await loadInsights();
 const r=p?.new;if(r&&!r.read_at&&!r.dismissed_at&&p.eventType!=='DELETE')toast('Coach: '+r.title);
 refreshCoachDom();
}
function refreshCoachDom(){
 const el=$('#coach');if(el){el.outerHTML=coachPanel(tab==='ai');wireCoach()}
 const bell=$('#bell');if(bell)bell.innerHTML=bellHTML();
}
function coachPanel(full){
 if(!insightsEnabled&&!coachReview)return full?`<section class="card coach" id="coach"><div class="eyebrow">YOUR COACH</div><p class="muted small">The coach feed is not enabled on this environment yet.</p></section>`:'';
 const list=insights.filter(i=>!i.dismissed_at).slice(0,full?8:3);
 const rows=list.map(insightRow).join('');
 const empty='<p class="muted small" style="margin-top:10px">Nothing flagged right now. As you log meals, workouts, water, check-ins and weight, I watch the trends and speak up when something drifts. Days with no logs count as unknown, never as zero.</p>';
 const rv=coachReview?`<div class="coach-review"><strong>${esc(coachReview.headline||'Weekly review')}</strong><p>${esc(coachReview.summary||'')}</p>${(coachReview.suggestions||[]).map(x=>`<p>• ${esc(x)}</p>`).join('')}${coachReview.should_refine&&getAIBasePlan()?'<p><button class="btn" id="refineFromReview">Draft a plan update from this</button></p>':''}</div>`:'';
 return `<section class="card coach" id="coach"><div class="ai-plan-head"><div><div class="eyebrow">YOUR COACH · WATCHING YOUR DATA LIVE</div><h2 style="margin:4px 0 0">What I noticed</h2></div>${full&&getAIBasePlan()?'<button class="btn primary" id="reviewWeek">Review my week</button>':''}</div>${rv}${rows||(rv?'':empty)}${full&&getAIBasePlan()?coachChatHtml():''}</section>`;
}
async function markInsightsRead(){
 const ids=insights.filter(i=>!i.read_at&&!i.dismissed_at).map(i=>i.id);if(!ids.length)return;
 try{await supabase.from('agent_insights').update({read_at:new Date().toISOString()}).in('id',ids);insights=insights.map(i=>ids.includes(i.id)?{...i,read_at:new Date().toISOString()}:i)}catch(e){console.error(e)}
}
async function dismissInsight(id){
 try{const {error}=await supabase.from('agent_insights').update({dismissed_at:new Date().toISOString()}).eq('id',id);if(error)throw error;insights=insights.map(i=>i.id===id?{...i,dismissed_at:new Date().toISOString()}:i);refreshCoachDom()}catch(e){fail(e)}
}
async function edgeCall(payload){
 const {data:{session:s}}=await supabase.auth.getSession();if(!s?.access_token)throw new Error('Session expired. Sign in again.');
 const r=await fetch(SUPABASE_URL+'/functions/v1/the-cut-ai',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+s.access_token,'apikey':SUPABASE_KEY},body:JSON.stringify(payload)});
 let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'AI request failed.');return d;
}
async function reviewWeek(btn){
 if(aiBusy)return;
 try{aiBusy=true;if(btn){btn.disabled=true;btn.textContent='Reviewing your week…'}
  const d=await edgeCall({action:'review'});coachReview=d.review||null;await loadInsights();refreshCoachDom()}
 catch(e){fail(e)}
 finally{aiBusy=false;const b=$('#reviewWeek');if(b){b.disabled=false;b.textContent='Review my week'}}
}
async function refineFromReview(btn){
 const base=getAIBasePlan();if(!base||!coachReview)return;
 const text='WEEKLY REVIEW FROM THE COACH (based on real tracker data; missing days are unknown, not zero):\n'+[coachReview.headline,coachReview.summary,...(coachReview.suggestions||[])].filter(Boolean).join('\n');
 await runAIPlanRequest('refine',base.inputs||{},{instruction:text,current_plan_id:base.id},btn,'Drafting…','Draft a plan update from this');
}

/* ---- coach sync: the AI watches direct plan edits, judges them, and offers three options when it disagrees ---- */
let coachChat=[],coachChatBusy=false,assessTimer=null,assessBusy=false;
function insightRow(i){
 const d=i.data||{};const concern=String(i.kind||'').startsWith('plan_edit')&&d.status==='concern'&&!i.dismissed_at;
 const changes=concern&&(d.changes||[]).length?`<ul class="pe-changes">${d.changes.map(c=>`<li>${esc(c)}</li>`).join('')}</ul>`:'';
 const concerns=concern&&(d.concerns||[]).length?`<ul class="pe-changes">${d.concerns.map(c=>`<li>${esc(c)}</li>`).join('')}</ul>`:'';
 const opts=concern?`<div class="pe-actions"><button class="btn primary small" data-pe-accept="${esc(i.id)}">1 · Accept AI refinement</button><button class="btn small" data-pe-keep="${esc(i.id)}">2 · Keep my version</button><button class="btn small" data-pe-discuss="${esc(i.id)}">3 · Discuss with AI</button></div><p class="muted small">1 drafts a refined plan for you to apply. 2 keeps your edit and I update myself to it. 3 opens a chat with me.</p>`:'';
 return `<div class="insight ${esc(i.severity)} ${i.read_at?'':'unread'}"><div class="grow"><strong>${esc(i.title)}</strong><p>${esc(i.body)}</p>${changes}${concerns}${opts}</div><button class="btn small" data-dismiss-insight="${esc(i.id)}" aria-label="Dismiss insight">✕</button></div>`;
}
function coachChatHtml(){
 const msgs=coachChat.map(m=>`<div class="chat-msg ${m.role}"><b>${m.role==='user'?'You':'Coach'}</b><p>${esc(m.content)}</p>${m.draft_id?`<p><button class="btn small primary" data-open-draft="${esc(m.draft_id)}">Review the draft plan</button></p>`:''}</div>`).join('');
 return `<div class="coach-chat" id="coachChat"><div class="eyebrow" style="margin-top:14px">ASK YOUR COACH</div>${msgs}<form id="coachChatForm" class="chat-form"><input name="msg" placeholder="Ask about your plan, your week, or tell me what you want to change…" maxlength="1500" autocomplete="off" ${coachChatBusy?'disabled':''}/><button class="btn primary small" ${coachChatBusy?'disabled':''}>${coachChatBusy?'Thinking…':'Send'}</button></form></div>`;
}
function scheduleAssess(delay=20000){
 if(!insightsEnabled||!aiUnlocked)return;
 clearTimeout(assessTimer);assessTimer=setTimeout(runAssess,delay);
 toast('Saved. Your coach will review this change in a few seconds.');
}
async function runAssess(){
 if(assessBusy||!user||!aiUnlocked||!insightsEnabled)return;
 assessBusy=true;
 try{const d=await edgeCall({action:'assess'});
  if(d.status==='ok'||d.status==='concern'){await loadInsights();refreshCoachDom()}
 }catch(e){console.error('assess',e)}
 finally{assessBusy=false}
}
async function ackState(){try{await supabase.rpc('agent_ack_state')}catch(e){console.error(e)}}
async function keepMyVersion(id){
 try{await q(supabase.rpc('agent_ack_state'));await dismissInsight(id);toast('Got it. I have updated myself to your version of the plan.')}catch(e){fail(e)}
}
async function acceptRefinement(id,btn){
 const ins=insights.find(x=>x.id===id);const base=getAIBasePlan();if(!ins||!base)return;
 await runAIPlanRequest('refine',base.inputs||{},{instruction:ins.data?.refine_instruction||ins.body,current_plan_id:base.id},btn,'Drafting…','1 · Accept AI refinement');
 await dismissInsight(id);
}
async function discussEdit(id){
 const ins=insights.find(x=>x.id===id);if(!ins)return;
 const text='I edited my plan: '+((ins.data?.changes||[]).join('; ')||'see my live plan')+'. You raised: '+ins.body+' Can we talk it through?';
 await sendChat(text);
}
async function sendChat(text){
 if(coachChatBusy||!text.trim())return;
 coachChat.push({role:'user',content:text.trim()});coachChatBusy=true;refreshCoachDom();
 try{const d=await edgeCall({action:'chat',messages:coachChat.map(m=>({role:m.role,content:m.content}))});
  coachChat.push({role:'assistant',content:d.reply||'…',draft_id:d.draft_id||null});
  if(d.kept){await loadInsights()}
 }catch(e){coachChat.push({role:'assistant',content:'I could not answer just now: '+(e.message||'try again')+'.'})}
 finally{coachChatBusy=false;refreshCoachDom();$('#coachChat')?.scrollIntoView({block:'nearest'})}
}
async function openDraft(id){
 try{aiPlanHistory=await q(supabase.from('ai_plan_versions').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(10));aiPlanDraft=aiPlanHistory.find(x=>x.id===id)||aiPlanDraft;await render()}catch(e){fail(e)}
}
async function saveTrainingWeek(e){
 e.preventDefault();const raw=new FormData(e.currentTarget).get('week')||'';
 const week=String(raw).split('\n').map(l=>l.trim()).filter(Boolean).slice(0,7).map(l=>{const [day,focus='',mins='0',ex='']=l.split('|').map(x=>x.trim());return {day:day.slice(0,30),focus:focus.slice(0,100),session_minutes:Math.min(180,Math.max(0,parseInt(mins,10)||0)),exercises:ex.split(',').map(x=>x.trim()).filter(Boolean).slice(0,10)}}).filter(d=>d.day);
 try{await q(supabase.rpc('save_training_week',{p_week:week}));aiPlanHistory=await q(supabase.from('ai_plan_versions').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(10));await render();scheduleAssess()}catch(e){fail(e)}
}
function trainingWeekEditor(){
 const w=(getAIBasePlan()?.status==='active'?getAIBasePlan():aiPlanHistory.find(x=>x.status==='active'))?.plan?.training_week||[];
 if(!aiPlanHistory.some(x=>x.status==='active'))return '';
 return `<div style="margin-bottom:14px">${card('Edit your training week',`<p class="muted small">One day per line: Day | Focus | minutes | exercise, exercise. Your coach reviews changes and tells you if it agrees.</p><form id="trainingWeekForm"><textarea name="week" rows="6" style="width:100%">${esc(w.map(d=>`${d.day} | ${d.focus} | ${d.session_minutes||0} | ${(d.exercises||[]).join(', ')}`).join('\n'))}</textarea><button class="btn primary small" style="margin-top:8px">Save training week</button></form>`)}</div>`;
}

function wireCoach(){
 $('#reviewWeek')?.addEventListener('click',e=>reviewWeek(e.currentTarget));
 $('#refineFromReview')?.addEventListener('click',e=>refineFromReview(e.currentTarget));
 document.querySelectorAll('[data-dismiss-insight]').forEach(b=>b.onclick=()=>dismissInsight(b.dataset.dismissInsight));
 document.querySelectorAll('[data-pe-accept]').forEach(b=>b.onclick=()=>acceptRefinement(b.dataset.peAccept,b));
 document.querySelectorAll('[data-pe-keep]').forEach(b=>b.onclick=()=>keepMyVersion(b.dataset.peKeep));
 document.querySelectorAll('[data-pe-discuss]').forEach(b=>b.onclick=()=>discussEdit(b.dataset.peDiscuss));
 document.querySelectorAll('[data-open-draft]').forEach(b=>b.onclick=()=>openDraft(b.dataset.openDraft));
 $('#coachChatForm')?.addEventListener('submit',e=>{e.preventDefault();const i=e.currentTarget.querySelector('input');const t=i.value;i.value='';sendChat(t)});
}

/* ---- first-login tour (9 steps; works while sections are still locked) ---- */
function wireV2(){
 wireCoach();
 $('#trainingWeekForm')?.addEventListener('submit',saveTrainingWeek);
 $('#bell')?.addEventListener('click',openBellMenu);
}

/* every plan edit that reaches the database is reviewed by the coach after a short debounce, and applying a plan acknowledges the coach state */
async function applyAIPlan(...a){const r=await applyAIPlanCore(...a);try{ackState()}catch(e){}return r}
async function addMealTemplate(...a){const r=await addMealTemplateCore(...a);try{scheduleAssess()}catch(e){}return r}

supabase.auth.onAuthStateChange((event,s)=>{session=s;if(event==='SIGNED_IN'&&!user&&s&&document.getElementById('verifyModal')){session=s;document.getElementById('verifyModal').remove();bootstrap()}if(event==='SIGNED_OUT'){const wasIn=!!user&&!_manualSignOut;_manualSignOut=false;user=null;wk=null;wkHist=null;aiActivePlan=null;unsubscribeInsights();aiUnlocked=false;insights=[];coachReview=null;renderAuthV2();if(wasIn)uiModal({title:'Session expired',body:'For your security you were signed out. Sign in again to continue.',tone:'info',icon:'\u23f1',actions:[{label:'Sign in',primary:true}]})}if(event==='PASSWORD_RECOVERY'){recoveryMode=true;renderPasswordRecovery()}});
let recoveryMode = false;

async function addGroceryV2(e){e.preventDefault();const f=new FormData(e.currentTarget);try{await q(supabase.from('grocery_items').insert({user_id:user.id,week_start:weekStart(date),name:f.get('name'),quantity:f.get('quantity')||null,category:f.get('category')||'PRODUCE',sort_order:groceries.length}));await render()}catch(e){fail(e)}}

async function clearPushForCurrentUser(){
 try{
  if(!user||!('serviceWorker' in navigator))return;
  const registration=await navigator.serviceWorker.getRegistration('/');
  const subscription=await registration?.pushManager.getSubscription();
  if(subscription){
   await q(supabase.from('push_subscriptions').delete().eq('user_id',user.id).eq('endpoint',subscription.endpoint));
   await subscription.unsubscribe();
  }
 }catch(e){console.warn('Could not clear device push subscription',e)}
}

async function exportData(){
 const tables=['user_settings','foods','meal_templates','meal_template_items','daily_targets','daily_meals','food_entries','daily_checkins','body_measurements','progress_photos','workout_sessions','workout_exercises','workout_sets','daily_activity','water_logs','grocery_items','prep_tasks','reminders','push_notification_deliveries','ai_plan_versions','agent_insights','agent_baseline','workout_feedback','workout_reviews'];
 const backup={product:'THE CUT',schema_version:1,exported_at:new Date().toISOString(),user_id:user.id,data:{}};
 try{const profile=await q(supabase.from('profiles').select('*').eq('id',user.id).maybeSingle());backup.data.profiles=profile?[profile]:[];for(const table of tables){let rows=[],offset=0,batch=[];do{batch=await q(supabase.from(table).select('*').eq('user_id',user.id).range(offset,offset+999));rows=rows.concat(batch);offset+=batch.length}while(batch.length===1000);backup.data[table]=rows}const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='the-cut-backup-'+today()+'.json';document.body.append(a);a.click();a.remove();URL.revokeObjectURL(url);toast('Your JSON backup has been generated.');return true}catch(e){fail(e);return false}
}
function renderPasswordRecovery(){
 $('#root').innerHTML=`<div class="authwrap"><div class="authcard"><div class="brand"><div class="mark"></div><div><b>THE CUT<span>.</span></b><small>ACCOUNT RECOVERY</small></div></div><h1>Set a new password.</h1><p class="muted">Choose a new password for your account.</p><form id="recoverForm"><div class="field"><label>NEW PASSWORD</label><input name="password" type="password" minlength="8" required autocomplete="new-password"/></div><div class="field"><label>CONFIRM PASSWORD</label><input name="confirm" type="password" minlength="8" required autocomplete="new-password"/></div><button class="btn primary" style="width:100%">Update password</button><p class="muted small" id="recoverMsg"></p></form></div></div>`;
 $('#recoverForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),p=f.get('password');if(p!==f.get('confirm')){$('#recoverMsg').textContent='Passwords do not match.';uiModal({title:'Passwords don\u2019t match',body:'Type the same new password in both fields.',actions:[{label:'OK',primary:true}]});return}const b=e.currentTarget.querySelector('button');b.disabled=true;try{const {error}=await supabase.auth.updateUser({password:p});if(error)throw error;recoveryMode=false;session=(await supabase.auth.getSession()).data.session;toast('Password updated');await bootstrap()}catch(err){const f=friendlyError(err);$('#recoverMsg').textContent=f.title+'.';uiModal({title:f.title,body:f.body,actions:[{label:'OK',primary:true}]})}finally{b.disabled=false}};
}
function renderAuthV2(){
 $('#root').innerHTML=`<div class="authwrap"><div class="authcard"><div class="brand"><div class="mark"></div><div><b>THE CUT<span>.</span></b><small>DAILY TRANSFORMATION SYSTEM</small></div></div><h1>Own the process.</h1><p class="muted">Your nutrition, training and progress. One private workspace.</p><div class="authswitch"><button class="btn primary" id="modeIn">Sign in</button><button class="btn" id="modeUp">Create account</button></div><form id="authForm"><div id="nameField" class="field hidden"><label>YOUR NAME</label><input name="name" autocomplete="name" placeholder="Name"/></div><div class="field"><label>EMAIL</label><input name="email" type="email" required autocomplete="email" placeholder="you@example.com"/></div><div class="field"><label>PASSWORD</label><div class="pw"><input name="password" type="password" required minlength="8" autocomplete="current-password" placeholder="At least 8 characters"/><button type="button" class="pwtoggle" id="pwToggle" aria-label="Show password" aria-pressed="false">Show</button></div></div><button class="btn primary" style="width:100%;margin-top:8px" type="submit">Sign in</button><button class="btn ghost" id="forgotPass" style="width:100%;margin-top:8px" type="button">Forgot password?</button><p class="muted small" id="authMsg">Your account is secured with Supabase authentication.</p></form><p class="muted small">Your private tracking data is protected by per-account database policies.</p></div></div>`;
 let mode='in';const setMode=m=>{mode=m;$('#modeIn').classList.toggle('primary',m==='in');$('#modeUp').classList.toggle('primary',m==='up');$('#nameField').classList.toggle('hidden',m==='in');$('#authForm button[type=submit]').textContent=m==='in'?'Sign in':'Create account';$('#authMsg').textContent=m==='in'?'Use your account email and password.':'We may send a verification link to your email.';$('input[name=password]').autocomplete=m==='in'?'current-password':'new-password'};
 $('#modeIn').onclick=()=>setMode('in');$('#modeUp').onclick=()=>setMode('up');
 $('#pwToggle').onclick=()=>{const i=$('input[name=password]'),t=$('#pwToggle'),show=i.type==='password';i.type=show?'text':'password';t.textContent=show?'Hide':'Show';t.setAttribute('aria-pressed',String(show));t.setAttribute('aria-label',show?'Hide password':'Show password')};
 $('#forgotPass').onclick=()=>authForgot();
 $('#authForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),email=String(f.get('email')).trim(),password=f.get('password'),b=e.currentTarget.querySelector('button[type=submit]');
  if(!navigator.onLine){authError({message:'Failed to fetch'},{email,mode,setMode});return}
  b.disabled=true;b.textContent='Please wait…';
  try{if(mode==='up'){const {data,error}=await supabase.auth.signUp({email,password,options:{data:{name:f.get('name')},emailRedirectTo:location.origin}});if(error)throw error;if(data.user&&Array.isArray(data.user.identities)&&data.user.identities.length===0)throw {message:'User already registered'};if(data.session){session=data.session;await bootstrap()}else showVerifyModal(email,password)}else{const {data,error}=await supabase.auth.signInWithPassword({email,password});if(error)throw error;session=data.session;await bootstrap()}}
  catch(err){if(mode==='in'&&/confirm/i.test(err.message||''))showVerifyModal(email,password);else authError(err,{email,mode,setMode})}
  finally{b.disabled=false;b.textContent=mode==='in'?'Sign in':'Create account'}};
}
/* ================= v3: minimal workspace — Plan · Meals · Workout · Weight · Coach · Prep & Grocery ================= */
const DATE_TABS=['meals','prep'];
const needsPlanCard=what=>`<div class="card empty-plan"><div class="eyebrow">NEXT STEP</div><h2>Apply your plan to start ${what}</h2><p class="muted">Your targets, meals and sessions come from your plan. Open it, review it, then press Apply.</p><button class="btn primary" data-tab="ai">Open my plan</button></div>`;
async function loadActivePlan(){const r=await q(supabase.from('ai_plan_versions').select('*').eq('user_id',user.id).eq('status','active').order('applied_at',{ascending:false,nullsFirst:false}).limit(1));aiActivePlan=r[0]||null}
async function loadPlanHistory(){aiPlanHistory=await q(supabase.from('ai_plan_versions').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(10))}
const bar3=(label,val,target,unit)=>{const pct=Math.min(100,Number(val)/Math.max(1,Number(target))*100);return `<div class="mbar"><div class="row between"><span>${label}</span><b>${fmt(val)} <small>/ ${fmt(target)} ${unit}</small></b></div><div class="progress"><i style="width:${pct}%"></i></div></div>`};

/* ---------- Meals ---------- */
function mealsV3(){
 if(!aiActivePlan)return pageHead('DIET','Meals','Your daily meals, from your plan.')+needsPlanCard('logging meals');
 const t=totals(),tg=aiActivePlan.plan?.targets||{};
 return `${pageHead('DIET · '+dateFmt(date),'Meals','Tick each meal as you eat it. Log anything extra below.')}${planChangeCard()}
 <div class="mpage"><div class="grid g2 m-top">${card('Today vs your plan',bar3('Calories',t.k,tg.calories_kcal,'kcal')+bar3('Protein',t.p,tg.protein_g,'g'))}
 ${card('Add something extra',`<form id="foodForm" class="formgrid"><div class="field full"><label>WHAT DID YOU EAT?</label><input name="food_name_snapshot" required placeholder="e.g. protein shake"/></div><div class="field"><label>CALORIES</label><input name="calories_kcal" type="number" min="0" step="0.1" inputmode="decimal" value="" required/></div><div class="field"><label>PROTEIN (G)</label><input name="protein_g" type="number" min="0" step="0.1" inputmode="decimal" value="0"/></div><input type="hidden" name="quantity" value="1"/><input type="hidden" name="unit" value="serving"/><input type="hidden" name="carbs_g" value="0"/><input type="hidden" name="fat_g" value="0"/><input type="hidden" name="fiber_g" value="0"/><button class="btn primary full">Add</button></form>`)}</div>
 <div class="m-meals" style="margin-top:16px">${card('Your meals',mealRows()+`<div class="row wrap" style="margin-top:12px"><button class="btn" id="addMealTemplate">+ Add a meal</button></div>`)}</div>
 ${day.entries.length?`<div class="m-extras" style="margin-top:16px">${card('Extras logged',day.entries.map(e=>`<div class="listitem"><div class="grow"><strong>${esc(e.food_name_snapshot)}</strong><small>${fmt(e.calories_kcal)} kcal · ${fmt(e.protein_g)} g protein</small></div><button class="btn sm danger" data-delfood="${e.id}">Delete</button></div>`).join(''))}</div>`:''}</div>`;
}

/* ---------- Weight ---------- */
let wRows=[];
async function loadWeight(){wRows=await q(supabase.from('body_measurements').select('id,measured_on,weight_kg,body_fat_pct,notes').eq('user_id',user.id).not('weight_kg','is',null).order('measured_on',{ascending:true}).limit(365))}
function spark(vals,goal){
 if(vals.length<2)return '<div class="empty">Log at least two weigh-ins to see your trend.</div>';
 const w=560,h=150,p=16,all=goal?vals.concat(goal):vals,lo=Math.min(...all)-.5,hi=Math.max(...all)+.5,X=i=>p+i*(w-2*p)/(vals.length-1),Y=v=>h-p-(v-lo)/(hi-lo)*(h-2*p);
 return `<svg viewBox="0 0 ${w} ${h}" class="spark" role="img" aria-label="Weight trend"><polyline points="${vals.map((v,i)=>X(i).toFixed(1)+','+Y(v).toFixed(1)).join(' ')}" fill="none" stroke="var(--lime)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${goal?`<line x1="${p}" x2="${w-p}" y1="${Y(goal)}" y2="${Y(goal)}" stroke="var(--orange)" stroke-dasharray="5 5"/>`:''}${vals.map((v,i)=>`<circle cx="${X(i)}" cy="${Y(v)}" r="3.5" fill="var(--lime)"/>`).join('')}</svg>`;
}
function weightV3(){
 const goal=Number(aiActivePlan?.inputs?.target_weight_kg)||null,vals=wRows.map(r=>Number(r.weight_kg)),cur=vals.length?vals[vals.length-1]:null,first=vals.length?vals[0]:null;
 const delta=cur!=null&&first!=null?cur-first:null;
 return `${pageHead('BODY WEIGHT','Weight','One number, logged regularly. The trend matters, not any single day.')}
 <div class="grid g3">${metric('CURRENT',cur!=null?fmt(cur):'—','kg',wRows.length?dateFmt(wRows[wRows.length-1].measured_on,{day:'numeric',month:'short'}):'No weigh-ins yet')}${metric('CHANGE',delta!=null?(delta>0?'+':'')+fmt(delta):'—','kg','Since your first weigh-in')}${metric('GOAL',goal?fmt(goal):'—','kg',goal&&cur!=null?fmt(Math.abs(cur-goal))+' kg to go':'Set in your plan')}</div>
 <div class="grid g2" style="margin-top:16px">${card('Trend',spark(vals.slice(-60),goal))}
 ${card('Log weight',`<form id="weightForm" class="formgrid"><div class="field"><label>DATE</label><input type="date" name="measured_on" value="${today()}" max="${today()}" required/></div><div class="field"><label>WEIGHT (KG)</label><input name="weight_kg" type="number" step="0.1" min="20" max="500" inputmode="decimal" required placeholder="80.0"/></div><button class="btn primary full">Save weigh-in</button></form><p class="muted small">Logging the same date again replaces that day's entry.</p>`)}</div>
 <div style="margin-top:16px">${card('History',wRows.length?wRows.slice().reverse().slice(0,12).map(r=>`<div class="listitem"><div class="grow"><strong>${fmt(r.weight_kg)} kg</strong><small>${dateFmt(r.measured_on,{day:'numeric',month:'short',year:'numeric'})}</small></div><button class="btn sm danger" data-delweight="${r.id}">Delete</button></div>`).join(''):'<div class="empty">No weigh-ins yet.</div>')}</div>`;
}
async function saveWeightV3(e){
 e.preventDefault();const f=new FormData(e.currentTarget),on=f.get('measured_on'),kg=Number(f.get('weight_kg'));
 if(!(kg>=20&&kg<=500)){toast('Enter a weight between 20 and 500 kg.');return}
 try{
  const ex=await q(supabase.from('body_measurements').select('id').eq('user_id',user.id).eq('measured_on',on).limit(1));
  if(ex.length)await q(supabase.from('body_measurements').update({weight_kg:kg}).eq('id',ex[0].id).eq('user_id',user.id));
  else await q(supabase.from('body_measurements').insert({user_id:user.id,measured_on:on,weight_kg:kg}));
  toast('Weight saved');await render();
 }catch(err){fail(err)}
}

/* ---------- Prep & Grocery ---------- */
let prepView='grocery';
async function loadGroceries(){groceries=await q(supabase.from('grocery_items').select('*').eq('user_id',user.id).eq('week_start',weekStart(date)).order('sort_order'))}
function prepV3(){
 if(!aiActivePlan)return pageHead('PREP & GROCERY','Prep & Grocery','Shopping list and meal prep.')+needsPlanCard('shopping and prep');
 const bought=groceries.filter(x=>x.is_purchased).length,donePrep=day.prep.filter(x=>x.is_completed).length;
 const cats=['PROTEIN','DAIRY','PRODUCE','PANTRY'];
 const groc=`<form id="groceryForm" class="row addrow"><input name="name" required placeholder="Add an item"/><input name="quantity" placeholder="Qty" style="max-width:110px"/><input type="hidden" name="category" value="PRODUCE"/><button class="btn primary">Add</button></form>
 ${groceries.length?cats.map(c=>{const items=groceries.filter(x=>(x.category||'PRODUCE')===c);return items.length?`<h3 class="eyebrow cat">${c} <span>${items.filter(x=>x.is_purchased).length}/${items.length}</span></h3>${items.map(x=>`<label class="listitem tick-row"><input type="checkbox" data-grocery="${x.id}" ${x.is_purchased?'checked':''}/><div class="grow"><strong class="${x.is_purchased?'struck':''}">${esc(x.name)}</strong><small>${esc(x.quantity||'')}</small></div><button class="btn sm ghost" data-delgrocery="${x.id}" aria-label="Remove ${esc(x.name)}">✕</button></label>`).join('')}`:''}).join(''):'<div class="empty">Nothing on the list this week.</div>'}`;
 const prep=`<form id="prepForm" class="row addrow"><input name="task" required placeholder="Add a prep task"/><button class="btn primary">Add</button></form>
 ${day.prep.length?day.prep.map(t=>`<label class="listitem tick-row"><input type="checkbox" data-prep="${t.id}" ${t.is_completed?'checked':''}/><div class="grow"><strong class="${t.is_completed?'struck':''}">${esc(t.task)}</strong></div><button class="btn sm ghost" data-delprep="${t.id}" aria-label="Remove task">✕</button></label>`).join(''):'<div class="empty">No prep tasks for this day.</div>'}`;
 return `${pageHead('PREP & GROCERY','Prep & Grocery','Shop once, prep once, eat on plan.')}
 <div class="seg" role="tablist"><button role="tab" data-prepview="grocery" class="${prepView==='grocery'?'on':''}">Groceries <small>${bought}/${groceries.length}</small></button><button role="tab" data-prepview="prep" class="${prepView==='prep'?'on':''}">Meal prep <small>${donePrep}/${day.prep.length}</small></button></div>
 ${card(prepView==='grocery'?'This week’s groceries':'Prep for '+dateFmt(date,{day:'numeric',month:'short'}),prepView==='grocery'?groc:prep)}`;
}

/* ---------- Workout logger ---------- */
const WK_KEY=()=>'cut_wk_'+(user?.id||'x');
let wk=null,wkHist=null,wkSessions=[],wkTick=null,wkRest=null,wkRestDefault=90,wkReview=null;
async function loadWkHistory(){
 const rows=await q(supabase.from('workout_exercises').select('exercise_name,created_at,workout_sets(set_number,reps,weight_kg)').eq('user_id',user.id).order('created_at',{ascending:false}).limit(300));
 const map={};
 rows.forEach(r=>{const k=r.exercise_name.trim().toLowerCase(),sets=(r.workout_sets||[]).slice().sort((a,b)=>a.set_number-b.set_number),m=map[k]??={last:null,best1:0,name:r.exercise_name};if(!m.last&&sets.length)m.last=sets;sets.forEach(s=>{m.best1=Math.max(m.best1,e1rm(Number(s.weight_kg)||0,Number(s.reps)||0))})});
 wkHist=map;
 wkSessions=await q(supabase.from('workout_sessions').select('id,title,local_date,duration_minutes,perceived_effort,workout_exercises(exercise_name,sort_order,workout_sets(set_number,reps,weight_kg))').eq('user_id',user.id).order('local_date',{ascending:false}).order('created_at',{ascending:false}).limit(8));
 try{wkReview=(await q(supabase.from('workout_reviews').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(1)))[0]||null}catch(e){console.error(e);wkReview=null}
}
function wkMakeEx(name,n=3,reps=10,target=null,planned=''){
 const h=wkHist?.[name.trim().toLowerCase()],prev=h?.last||[],last=prev[prev.length-1];
 // The plan is authoritative: its reps and any AI load target win over last time's numbers.
 return {name,pr:false,planned,target,sets:Array.from({length:n},(_,i)=>({kg:target??(prev[i]||last)?.weight_kg??'',reps:planned?reps:(prev[i]||last)?.reps??reps,done:false,pr:false}))};
}
const wkSave=()=>{try{wk?localStorage.setItem(WK_KEY(),JSON.stringify(wk)):localStorage.removeItem(WK_KEY())}catch{}};
function wkLoadDraft(){if(wk)return;try{const d=JSON.parse(localStorage.getItem(WK_KEY())||'null');if(d&&d.exs&&Date.now()-d.startedAt<18*3600e3)wk=d}catch{}}
function planSessions(){return (aiActivePlan?.plan?.training_week||[]).map((d,i)=>({i,...d})).filter(d=>Number(d.session_minutes)>0&&!/rest|recover|mobility|stretch|walk|light cardio|off\b/i.test(String(d.focus||'')))}
function todaySession(){
 const names=['sun','mon','tue','wed','thu','fri','sat'],dow=names[new Date(today()+'T12:00:00').getDay()];
 return planSessions().find(d=>String(d.day).toLowerCase().startsWith(dow))||null;
}
async function wkBegin(idx){
 if(!wkHist){try{await loadWkHistory()}catch(e){console.error(e);wkHist={}}}
 let title='Workout',exs=[],planDay='';
 if(idx!=='empty'){const d=(aiActivePlan?.plan?.training_week||[])[Number(idx)];if(d){title=(d.focus||d.day||'Workout');planDay=String(d.day||'');exs=(d.exercises||[]).map(raw=>({raw:String(raw),...parsePlanExercise(raw)})).map(x=>wkMakeEx(x.name,x.sets,x.reps,planTargetKg(x.raw),x.raw))}}
 wk={title,startedAt:Date.now(),date:today(),exs,effort:null,notes:'',best:{},planDay};wkRest=null;wkSave();renderWk();
}
function renderWk(keepScroll){const y=window.scrollY;$('#pagebody').innerHTML=workoutV3();wireWk();wireV3();if(keepScroll)window.scrollTo(0,y)}
function fmtClock(s){return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')}
function wkTickFn(){
 const c=$('#wkClock');if(!c||!wk){clearInterval(wkTick);wkTick=null;return}
 c.textContent=fmtClock(Math.floor((Date.now()-wk.startedAt)/1000));
 const r=$('#wkRestBar');if(!r)return;
 if(wkRest&&wkRest>Date.now()){const left=Math.ceil((wkRest-Date.now())/1000);r.classList.remove('hidden');$('#wkRestT').textContent=Math.floor(left/60)+':'+String(left%60).padStart(2,'0')}
 else{if(wkRest){wkRest=null;if(navigator.vibrate)navigator.vibrate([120,60,120]);toast('Rest is over. Next set.')}r.classList.add('hidden')}
}
function wkToggle(xi,si){
 const e=wk.exs[xi],s=e.sets[si];s.done=!s.done;
 if(s.done){
  const kg=Number(s.kg)||0,rp=Number(s.reps)||0,h=wkHist?.[e.name.trim().toLowerCase()],v=e1rm(kg,rp),prev=Math.max(h?.best1||0,wk.best[e.name]||0);
  s.kg=s.kg===''?'':kg;s.reps=rp;
  if(h?.best1&&v>prev+.01){s.pr=true;toast('New PR on '+e.name)}
  wk.best[e.name]=Math.max(wk.best[e.name]||0,v);
  wkRest=Date.now()+wkRestDefault*1000;if(navigator.vibrate)navigator.vibrate(15);
 }else{s.pr=false;wkRest=null}
 e.pr=e.sets.some(x=>x.pr);wkSave();renderWk(true);
}
function workoutV3(){
 if(!aiActivePlan)return pageHead('TRAINING','Workout','Log every set, live.')+needsPlanCard('training');
 wkLoadDraft();
 return wk?wkLive():wkStartView();
}
function wkStartView(){
 const ts=todaySession(),all=planSessions();
 const hist=wkSessions.map(s=>{const exs=(s.workout_exercises||[]).slice().sort((a,b)=>a.sort_order-b.sort_order);const vol=exs.reduce((a,e)=>a+(e.workout_sets||[]).reduce((b,x)=>b+(Number(x.weight_kg)||0)*(Number(x.reps)||0),0),0);
  return `<details class="wk-hist"><summary><span><strong>${esc(s.title)}</strong><small>${dateFmt(s.local_date,{day:'numeric',month:'short'})} · ${s.duration_minutes||0} min · ${fmt(vol)} kg${s.perceived_effort?' · RPE '+s.perceived_effort:''}</small></span><button class="btn sm ghost" data-delworkout="${s.id}" aria-label="Delete session">✕</button></summary>${exs.map(e=>`<div class="wk-hx"><b>${esc(e.exercise_name)}</b><span>${(e.workout_sets||[]).slice().sort((a,b)=>a.set_number-b.set_number).map(x=>`${fmt(x.weight_kg)}×${x.reps}`).join(' · ')}</span></div>`).join('')}</details>`}).join('');
 return `${pageHead('TRAINING','Workout','Open a session, log each set as you do it.')}
 ${card(ts?'Today · '+esc(ts.day):'No session planned today',ts?`<h2 class="wk-hero">${esc(ts.focus)}</h2><p class="muted small">${Number(ts.session_minutes)||0} min · ${(ts.exercises||[]).length} exercises</p><div class="wk-chips">${(ts.exercises||[]).slice(0,6).map(x=>`<span>${esc(parsePlanExercise(x).name)}</span>`).join('')}</div><button class="btn primary wk-go" data-wkstart="${ts.i}">Start workout</button>`:`<p class="muted">Rest day by your plan. You can still start a session if you want one.</p><button class="btn primary wk-go" data-wkstart="empty">Start an empty workout</button>`)}
 ${wkReviewCard()}
 ${all.length>(ts?1:0)?`<div style="margin-top:16px">${card('Other sessions in your plan',all.filter(d=>!ts||d.i!==ts.i).map(d=>`<div class="listitem"><div class="grow"><strong>${esc(d.day)} · ${esc(d.focus)}</strong><small>${Number(d.session_minutes)||0} min · ${(d.exercises||[]).length} exercises</small></div><button class="btn sm" data-wkstart="${d.i}">Start</button></div>`).join('')+`<div class="row" style="margin-top:10px"><button class="btn sm ghost" data-wkstart="empty">+ Empty workout</button></div>`)}</div>`:(ts?`<div class="row" style="margin-top:12px"><button class="btn sm ghost" data-wkstart="empty">+ Empty workout instead</button></div>`:'')}
 <div style="margin-top:16px">${card('Recent sessions',hist||'<div class="empty">Your finished sessions show up here with every set.</div>')}</div>
 <details class="wk-edit" style="margin-top:16px"><summary>Edit your weekly training plan</summary>${trainingWeekEditor()}</details>`;
}
function wkLive(){
 const done=wk.exs.reduce((a,e)=>a+e.sets.filter(s=>s.done).length,0),total=wk.exs.reduce((a,e)=>a+e.sets.length,0),names=[...new Set([...(aiActivePlan?.plan?.training_week||[]).flatMap(d=>(d.exercises||[]).map(x=>parsePlanExercise(x).name)),...Object.values(wkHist||{}).map(h=>h.name)])];
 return `<div class="wk">
 <div class="wk-top"><div class="grow"><input class="wk-title" id="wkTitle" value="${esc(wk.title)}" aria-label="Workout name" maxlength="60"/><div class="wk-meta"><span id="wkClock">00:00</span><span>${done}/${total} sets</span><span>${fmt(volOf(wk.exs))} kg</span></div></div><div class="row"><button class="btn ghost" id="wkDiscard">Discard</button><button class="btn primary" id="wkFinish">Finish</button></div></div>
 <div class="progress"><i style="width:${total?done/total*100:0}%"></i></div>
 <div class="wk-restpick"><span class="muted small">REST TIMER</span>${[60,90,120,180].map(s=>`<button class="chip ${wkRestDefault===s?'on':''}" data-wkrest="${s}">${s/60>=1&&s%60===0?s/60+' min':s+' s'}</button>`).join('')}</div>
 ${wk.exs.map((e,xi)=>{const h=wkHist?.[e.name.trim().toLowerCase()],prev=h?.last?h.last.map(x=>`${fmt(x.weight_kg)}×${x.reps}`).join('  ·  '):'First time — no history yet';
  return `<section class="card wk-ex"><div class="row between"><h3>${esc(e.name)}${e.pr?' <span class="pr">PR</span>':''}</h3><button class="btn sm ghost" data-wkdelex="${xi}" aria-label="Remove ${esc(e.name)}">✕</button></div><div class="wk-prev">Last time: ${prev}${e.target?` · Coach target ${fmt(e.target)} kg`:''}</div>
  <div class="wk-sets"><div class="wk-h"><span>SET</span><span>KG</span><span>REPS</span><span></span></div>${e.sets.map((s,si)=>`<div class="wk-set ${s.done?'done':''}"><span class="n">${si+1}</span><input inputmode="decimal" data-wk="${xi}:${si}:kg" value="${esc(s.kg)}" placeholder="0" aria-label="Set ${si+1} weight in kg"/><input inputmode="numeric" data-wk="${xi}:${si}:reps" value="${esc(s.reps)}" placeholder="0" aria-label="Set ${si+1} reps"/><button class="tick" data-wktick="${xi}:${si}" aria-pressed="${s.done}" aria-label="Mark set ${si+1} done">${s.done?'✓':''}</button></div>`).join('')}</div>
  <div class="row"><button class="btn sm" data-wkaddset="${xi}">+ Add set</button><button class="btn sm ghost" data-wkdelset="${xi}">− Remove set</button></div></section>`}).join('')}
 <section class="card"><form id="wkAddEx" class="row addrow"><input name="name" list="wkNames" placeholder="Add an exercise…" required maxlength="60" autocomplete="off"/><datalist id="wkNames">${names.map(n=>`<option value="${esc(n)}">`).join('')}</datalist><button class="btn primary">Add</button></form></section>
 <div class="wk-restbar hidden" id="wkRestBar"><span>Rest <b id="wkRestT">0:00</b></span><button class="btn sm" id="wkRestAdd">+15 s</button><button class="btn sm primary" id="wkRestSkip">Skip</button></div>
 </div>`;
}
function wkFinishModal(){
 const done=wk.exs.reduce((a,e)=>a+e.sets.filter(s=>s.done).length,0);
 if(!done){toast('Tick off at least one set before finishing.');return}
 const prs=wk.exs.filter(e=>e.pr).map(e=>e.name),mins=Math.max(1,Math.round((Date.now()-wk.startedAt)/60000));
 const m=document.createElement('div');m.className='modal-bg';m.id='wkModal';
 m.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-label="Finish workout"><div class="eyebrow">WORKOUT COMPLETE</div><h2>${esc(wk.title)}</h2>
 <div class="grid g3 wk-sum"><div><b>${mins}</b><small>minutes</small></div><div><b>${done}</b><small>sets</small></div><div><b>${fmt(volOf(wk.exs))}</b><small>kg volume</small></div></div>
 ${prs.length?`<p class="pr-line">New PR: ${prs.map(esc).join(', ')}</p>`:''}
 <label class="muted small">HOW HARD WAS IT? (1–10)</label><div class="rpe">${[1,2,3,4,5,6,7,8,9,10].map(n=>`<button type="button" class="chip" data-rpe="${n}">${n}</button>`).join('')}</div>
 <textarea id="wkNotes" rows="2" placeholder="Notes (optional)" maxlength="500"></textarea>
 <div class="row" style="margin-top:12px"><button class="btn ghost" id="wkBack">Keep going</button><button class="btn primary grow" id="wkSaveBtn">Save workout</button></div></div>`;
 document.body.appendChild(m);
 m.querySelectorAll('[data-rpe]').forEach(b=>b.onclick=()=>{wk.effort=Number(b.dataset.rpe);m.querySelectorAll('[data-rpe]').forEach(x=>x.classList.toggle('on',x===b))});
 $('#wkBack').onclick=()=>m.remove();
 $('#wkSaveBtn').onclick=async()=>{const b=$('#wkSaveBtn');b.disabled=true;b.textContent='Saving…';wk.notes=$('#wkNotes').value.trim();try{const vol=volOf(wk.exs),sid=await wkPersist(),snap=fbSnapshot(sid);m.remove();toast('Workout saved · '+fmt(vol)+' kg'+(prs.length?' · '+prs.length+' PR'+(prs.length>1?'s':''):''));wk=null;wkRest=null;wkSave();wkHist=null;await render();fbStart(snap)}catch(e){fail(e);b.disabled=false;b.textContent='Save workout'}};
}
async function wkPersist(){
 const exs=wk.exs.map(e=>({...e,sets:e.sets.filter(s=>s.done)})).filter(e=>e.sets.length);
 const ses=await q(supabase.from('workout_sessions').insert({user_id:user.id,local_date:wk.date,started_at:new Date(wk.startedAt).toISOString(),duration_minutes:Math.min(1440,Math.max(1,Math.round((Date.now()-wk.startedAt)/60000))),workout_type:'strength',title:(wk.title||'Workout').trim().slice(0,60)||'Workout',notes:wk.notes||null,perceived_effort:wk.effort||null}).select('id').single());
 try{
  const exRows=await q(supabase.from('workout_exercises').insert(exs.map((e,i)=>({user_id:user.id,workout_session_id:ses.id,exercise_name:e.name,sort_order:i}))).select('id,sort_order'));
  const sets=[];exRows.forEach(r=>{exs[r.sort_order].sets.forEach((s,i)=>sets.push({user_id:user.id,workout_exercise_id:r.id,set_number:i+1,reps:Math.max(0,Math.round(Number(s.reps)||0)),weight_kg:Math.max(0,Number(s.kg)||0)}))});
  if(sets.length)await q(supabase.from('workout_sets').insert(sets));
 }catch(e){await supabase.from('workout_sessions').delete().eq('id',ses.id).eq('user_id',user.id);throw e}
 return ses.id;
}
function wireWk(){
 const pb=$('#pagebody');if(!pb||!wk)return;
 pb.querySelectorAll('[data-wk]').forEach(inp=>inp.oninput=()=>{const [xi,si,k]=inp.dataset.wk.split(':');wk.exs[xi].sets[si][k==='kg'?'kg':'reps']=inp.value;wkSave()});
 pb.querySelectorAll('[data-wktick]').forEach(b=>b.onclick=()=>{const [xi,si]=b.dataset.wktick.split(':').map(Number);wkToggle(xi,si)});
 pb.querySelectorAll('[data-wkaddset]').forEach(b=>b.onclick=()=>{const e=wk.exs[Number(b.dataset.wkaddset)],l=e.sets[e.sets.length-1];e.sets.push({kg:l?.kg??'',reps:l?.reps??10,done:false,pr:false});wkSave();renderWk(true)});
 pb.querySelectorAll('[data-wkdelset]').forEach(b=>b.onclick=()=>{const e=wk.exs[Number(b.dataset.wkdelset)];if(e.sets.length>1){e.sets.pop();wkSave();renderWk(true)}});
 pb.querySelectorAll('[data-wkdelex]').forEach(b=>b.onclick=async()=>{const e=wk.exs[Number(b.dataset.wkdelex)];if(e.sets.some(s=>s.done)&&!await uiConfirm('Remove exercise?','Remove '+e.name+' and its logged sets?',{confirm:'Remove',danger:true}))return;wk.exs.splice(Number(b.dataset.wkdelex),1);wkSave();renderWk(true)});
 pb.querySelectorAll('[data-wkrest]').forEach(b=>b.onclick=()=>{wkRestDefault=Number(b.dataset.wkrest);renderWk(true)});
 $('#wkTitle').oninput=e=>{wk.title=e.target.value;wkSave()};
 $('#wkAddEx').onsubmit=e=>{e.preventDefault();const n=new FormData(e.currentTarget).get('name').trim();if(!n)return;wk.exs.push(wkMakeEx(n));wkSave();renderWk(true);setTimeout(()=>window.scrollTo(0,document.body.scrollHeight),30)};
 $('#wkFinish').onclick=wkFinishModal;
 $('#wkDiscard').onclick=async()=>{if(!await uiConfirm('Discard workout?','Nothing from this session will be saved.',{confirm:'Discard',danger:true}))return;wk=null;wkRest=null;wkSave();renderWk()};
 $('#wkRestAdd').onclick=()=>{wkRest=Math.max(wkRest||0,Date.now())+15000};
 $('#wkRestSkip').onclick=()=>{wkRest=null};
 clearInterval(wkTick);wkTick=setInterval(wkTickFn,500);wkTickFn();
}


/* ---------- Post-workout feedback -> AI session review -> plan adjustment ---------- */
const FB_KEY=()=>'cut_wkfb_'+(user?.id||'x');
const FB_RATINGS=[['too_easy','Too easy'],['just_right','Just right'],['too_hard','Too hard']];
const FB_ISSUES=[['joint_pain','Joint pain'],['muscle_pain','Muscle pain'],['form_breakdown','Form broke down'],['couldnt_hit_reps','Couldn’t hit reps'],['felt_weak_tired','Felt weak or tired'],['equipment_unavailable','Equipment taken'],['ran_out_of_time','Ran out of time'],['boring_or_dislike','Don’t like it']];
let fb=null;
function fbSave(){try{fb?localStorage.setItem(FB_KEY(),JSON.stringify(fb)):localStorage.removeItem(FB_KEY())}catch{}}
function fbSnapshot(sid){
 return {uid:user.id,sid,title:wk.title,date:wk.date,planDay:wk.planDay||'',effort:wk.effort,notes:wk.notes||'',mins:Math.max(1,Math.round((Date.now()-wk.startedAt)/60000)),at:Date.now(),i:0,saved:false,
  exs:wk.exs.map(e=>({name:e.name,planned:e.planned||'',sets:e.sets.filter(s=>s.done).map(s=>({kg:Number(s.kg)||0,reps:Number(s.reps)||0})),rating:'',issues:[],note:''})).filter(e=>e.sets.length)};
}
function fbStart(snap){fb=snap;fbSave();fbOpen()}
function fbResume(){
 if(!fb){try{const d=JSON.parse(localStorage.getItem(FB_KEY())||'null');if(d&&d.uid===user.id&&d.exs?.length&&Date.now()-d.at<24*3600e3)fb=d}catch{}}
 if(fb&&fb.uid!==user.id){fb=null}
 if(fb)fbOpen();
}
function fbOpen(){
 if(!fb||document.getElementById('fbModal'))return;
 const m=document.createElement('div');m.className='modal-bg';m.id='fbModal';
 m.innerHTML='<div class="modal fb" role="dialog" aria-modal="true" aria-label="Workout feedback"></div>';
 document.body.appendChild(m);fbRender();
}
function fbSetsText(sets){return sets.map(s=>`${fmt(s.kg)}×${s.reps}`).join(' · ')}
function fbRender(){
 const box=document.querySelector('#fbModal .modal');if(!box||!fb)return;
 const e=fb.exs[fb.i],n=fb.exs.length,last=fb.i===n-1;
 box.innerHTML=`<div class="eyebrow">HOW DID IT GO? · ${fb.i+1} OF ${n}</div><h2>${esc(e.name)}</h2><p class="muted small">${esc(fbSetsText(e.sets))}</p>
 <label class="muted small">HOW DID THIS FEEL?</label><div class="fb-chips" id="fbRate">${FB_RATINGS.map(([k,l])=>`<button type="button" class="chip ${e.rating===k?'on':''}" data-fbrate="${k}" aria-pressed="${e.rating===k}">${l}</button>`).join('')}</div>
 <label class="muted small">ANY ISSUES?</label><div class="fb-chips" id="fbIssues">${FB_ISSUES.map(([k,l])=>`<button type="button" class="chip ${e.issues.includes(k)?'on':''}" data-fbissue="${k}" aria-pressed="${e.issues.includes(k)}">${l}</button>`).join('')}</div>
 <textarea id="fbNote" rows="2" maxlength="300" placeholder="Anything else? e.g. left shoulder pinched on the way down (optional)">${esc(e.note)}</textarea>
 <div class="row" style="margin-top:12px"><button class="btn ghost" id="fbBack" ${fb.i?'':'disabled'}>Back</button><button class="btn primary grow" id="fbNext">${last?'Analyze my session':'Next exercise'}</button></div>
 <button class="btn ghost fb-skip" id="fbSkip">Skip the rest and analyze</button>`;
 box.querySelectorAll('[data-fbrate]').forEach(b=>b.onclick=()=>{e.rating=e.rating===b.dataset.fbrate?'':b.dataset.fbrate;fbSave();fbRender()});
 box.querySelectorAll('[data-fbissue]').forEach(b=>b.onclick=()=>{const k=b.dataset.fbissue;e.issues=e.issues.includes(k)?e.issues.filter(x=>x!==k):[...e.issues,k];fbSave();fbRender()});
 $('#fbNote').oninput=ev=>{e.note=ev.target.value;fbSave()};
 $('#fbBack').onclick=()=>{if(fb.i>0){fb.i--;fbSave();fbRender()}};
 $('#fbNext').onclick=()=>{if(last)fbRun();else{fb.i++;fbSave();fbRender()}};
 $('#fbSkip').onclick=fbRun;
}
function fbClose(){document.getElementById('fbModal')?.remove();fb=null;fbSave()}
async function fbRun(){
 const f=fb;if(!f)return;
 if(aiBusy){toast('Another AI request is running. Try again in a moment.');return}
 const box=document.querySelector('#fbModal .modal');
 if(box)box.innerHTML='<div class="eyebrow">COACH REVIEW</div><h2>Analyzing your session…</h2><p class="muted small">Reading your sets and feedback, then adjusting your plan if it needs it.</p><div style="margin:18px 0"><span class="loader"></span></div>';
 try{
  aiBusy=true;setAIProgress('workout');
  const withFb=f.exs.filter(e=>e.rating||e.issues.length||e.note.trim());
  if(withFb.length&&!f.saved){
   try{await q(supabase.from('workout_feedback').insert(withFb.map(e=>({user_id:user.id,workout_session_id:f.sid,exercise_name:e.name.slice(0,60),rating:e.rating||null,issues:e.issues,note:e.note.trim()||null}))));f.saved=true;fbSave()}
   catch(err){console.error(err)}
  }
  const res=await callAIPlanner('workout_review',undefined,{session:{id:f.sid,title:f.title,date:f.date,duration_min:f.mins,effort:f.effort,notes:f.notes,plan_day:f.planDay,exercises:f.exs.map(e=>({name:e.name,planned:e.planned,sets:e.sets}))},feedback:withFb.map(e=>({exercise:e.name,rating:e.rating,issues:e.issues,note:e.note.trim()}))});
  const review=await applyWorkoutReview(f,res);
  fb=null;fbSave();wkHist=null;
  fbShowResult(review);
 }catch(err){fail(err);fbShowError(err)}
 finally{aiBusy=false;setAIProgress(null)}
}
async function applyWorkoutReview(f,res){
 const prev=aiActivePlan?.plan?.training_week||[],r=res.review||{};
 let lines=[];
 if(res.changed&&Array.isArray(res.training_week)){
  await q(supabase.rpc('save_training_week',{p_week:res.training_week}));
  try{await supabase.rpc('agent_ack_state')}catch(e){console.error(e)}
  await loadActivePlan();await loadPlanHistory();
  lines=diffWeek(prev,res.training_week);
 }
 const changed=lines.length>0;
 const row={user_id:user.id,workout_session_id:f.sid,headline:r.headline||'Session review',analysis:r.analysis||'',issues:r.issues||[],change_notes:r.change_notes||[],prev_week:changed?prev:null,new_week:changed?res.training_week:null,model:res.model||null};
 let saved=null;try{saved=await q(supabase.from('workout_reviews').insert(row).select('*').single())}catch(e){console.error(e)}
 wkReview=saved||{...row,id:null,undone_at:null,created_at:new Date().toISOString()};
 return wkReview;
}
function wkReviewBody(r){
 const lines=r.new_week?diffWeek(r.prev_week,r.new_week):[],notes=r.change_notes||[],issues=r.issues||[];
 return `<p class="fb-analysis">${esc(r.analysis)}</p>
 ${issues.length?`<div class="fb-box"><b>What I noticed</b><ul>${issues.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:''}
 ${lines.length?`<div class="fb-box"><b>${r.undone_at?'Plan change (undone)':'Your training week was updated'}</b><ul class="chg">${lines.map(l=>`<li><b>${esc(l.label)}</b><span>${esc(l.detail)}</span></li>`).join('')}</ul>${notes.length?`<p class="muted small" style="margin:8px 0 0">${notes.map(esc).join(' · ')}</p>`:''}</div>`:`<div class="fb-box"><b>No plan changes needed</b><p class="muted small" style="margin:4px 0 0">Keep running next week’s sessions as planned.</p></div>`}`;
}
function wkReviewUndoable(r){return !!(r&&r.id&&r.new_week&&r.prev_week&&!r.undone_at&&JSON.stringify(aiActivePlan?.plan?.training_week||[])===JSON.stringify(r.new_week))}
function fbShowResult(r){
 const box=document.querySelector('#fbModal .modal');
 if(!box){toast(r.headline||'Session reviewed');return}
 box.classList.add('fb-result');
 box.innerHTML=`<div class="eyebrow">COACH REVIEW</div><h2>${esc(r.headline)}</h2>${wkReviewBody(r)}<div class="row" style="margin-top:14px">${wkReviewUndoable(r)?'<button class="btn ghost" id="fbUndo">Undo change</button>':''}<button class="btn primary grow" id="fbDone">Done</button></div>`;
 $('#fbDone').onclick=async()=>{fbClose();await render()};
 $('#fbUndo')?.addEventListener('click',async ev=>{await undoWorkoutReview(r.id,ev.currentTarget,true)});
}
function fbShowError(err){
 const box=document.querySelector('#fbModal .modal');if(!box)return;
 box.innerHTML=`<div class="eyebrow">COACH REVIEW</div><h2>Couldn’t analyze that</h2><p class="muted">${esc(friendlyError(err).body.replace(/<[^>]+>/g,'')||err?.message||'Something went wrong.')} Your workout is saved. Your feedback is kept, so you can retry.</p><div class="row" style="margin-top:14px"><button class="btn ghost" id="fbClose">Close</button><button class="btn primary grow" id="fbRetry">Try again</button></div>`;
 $('#fbClose').onclick=async()=>{fbClose();await render()};
 $('#fbRetry').onclick=fbRun;
}
async function undoWorkoutReview(id,btn,fromModal){
 const r=wkReview&&wkReview.id===id?wkReview:null;if(!r||!wkReviewUndoable(r))return;
 if(btn)btn.disabled=true;
 try{
  await q(supabase.rpc('save_training_week',{p_week:r.prev_week}));
  try{await supabase.rpc('agent_ack_state')}catch(e){console.error(e)}
  await q(supabase.from('workout_reviews').update({undone_at:new Date().toISOString()}).eq('id',r.id).eq('user_id',user.id));
  r.undone_at=new Date().toISOString();await loadActivePlan();await loadPlanHistory();
  toast('Training week restored.');
  if(fromModal){fbShowResult(r)}else await render();
 }catch(e){fail(e);if(btn)btn.disabled=false}
}
function wkReviewCard(){
 const r=wkReview;if(!r||Date.now()-new Date(r.created_at).getTime()>3*86400e3)return '';
 return `<div style="margin-top:16px">${card('Coach review of your last session',`<h3 style="margin-top:0">${esc(r.headline)}</h3>${wkReviewBody(r)}${wkReviewUndoable(r)?`<button class="btn" data-wkundo="${esc(r.id)}">Undo this change</button>`:''}`)}</div>`;
}

/* ---------- wiring for the v3 pages ---------- */
function wireV3(){
 wireAccount();
 document.querySelectorAll('[data-wkstart]').forEach(b=>b.onclick=()=>wkBegin(b.dataset.wkstart));document.querySelectorAll('[data-wkundo]').forEach(b=>b.onclick=()=>undoWorkoutReview(b.dataset.wkundo,b));
 document.querySelectorAll('[data-prepview]').forEach(b=>b.onclick=()=>{prepView=b.dataset.prepview;render()});
 document.querySelectorAll('[data-delweight]').forEach(b=>b.onclick=()=>deleteRow('body_measurements',b.dataset.delweight,'weight'));
 $('#weightForm')?.addEventListener('submit',saveWeightV3);
}

/* ---------- email verification modal ---------- */
function showVerifyModal(email,password){
 document.getElementById('verifyModal')?.remove();
 const m=document.createElement('div');m.className='modal-bg';m.id='verifyModal';
 m.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="vmTitle"><div class="mail-ico">✉</div><h2 id="vmTitle">Verify your email</h2><p class="muted">We sent a verification link to<br><b>${esc(email)}</b>.<br>Open it, then come back here and press the button.</p><p class="muted small" id="vmMsg" role="status"></p>
 <button class="btn primary" id="vmDone" style="width:100%">I have verified</button><div class="row vm-sub"><button class="btn ghost" id="vmResend">Resend email</button><button class="btn ghost" id="vmChange">Use a different email</button></div></div>`;
 document.body.appendChild(m);
 const msg=t=>{$('#vmMsg').textContent=t};
 $('#vmDone').onclick=async()=>{const b=$('#vmDone');b.disabled=true;b.textContent='Checking…';try{const {data,error}=await supabase.auth.signInWithPassword({email,password});if(error){if(/confirm/i.test(error.message))msg('Not verified yet. Open the link in your email first, then try again.');else msg(error.message);return}if(!document.getElementById('verifyModal'))return;session=data.session;m.remove();await bootstrap()}catch(e){msg(e.message)}finally{b.disabled=false;b.textContent='I have verified'}};
 let cool=0;const rb=$('#vmResend');
 rb.onclick=async()=>{if(cool>0)return;try{const {error}=await supabase.auth.resend({type:'signup',email,options:{emailRedirectTo:location.origin}});if(error)throw error;msg('Sent again. Check your inbox and spam folder.');cool=30;rb.disabled=true;const t=setInterval(()=>{cool--;rb.textContent=cool>0?'Resend in '+cool+'s':'Resend email';if(cool<=0){rb.disabled=false;clearInterval(t)}},1000)}catch(e){msg(e.message)}};
 $('#vmChange').onclick=()=>m.remove();
 $('#vmDone').focus();
}

/* ================= v4: feedback layer — popups, friendly errors, offline/session states ================= */
function uiModal({icon='!',title,body='',actions=[{label:'OK',primary:true}],tone='error',id='uiModal'}){
 document.getElementById(id)?.remove();
 _modalOpener=document.activeElement;
 const m=document.createElement('div');m.className='modal-bg';m.id=id;
 m.innerHTML=`<div class="modal tone-${tone}" role="alertdialog" aria-modal="true" aria-labelledby="${id}T" aria-describedby="${id}B"><div class="mail-ico ico-${tone}" aria-hidden="true">${icon}</div><h2 id="${id}T">${esc(title)}</h2><p class="muted" id="${id}B">${body}</p><div class="modal-actions">${actions.map((a,i)=>`<button type="button" class="btn ${a.primary?'primary':a.danger?'danger':'ghost'}" data-act="${i}">${esc(a.label)}</button>`).join('')}</div></div>`;
 document.body.appendChild(m);
 const close=()=>{m.remove();document.removeEventListener('keydown',onKey,true);try{_modalOpener?.focus?.()}catch(_){}};
 const run=i=>{const a=actions[i];close();try{a.onClick&&a.onClick()}catch(e){console.error(e)}};
 const onKey=e=>{if(e.key==='Escape'){e.stopPropagation();run(actions.findIndex(a=>a.cancel)>=0?actions.findIndex(a=>a.cancel):actions.length-1)}
  if(e.key==='Tab'){const f=[...m.querySelectorAll('button')];if(!f.length)return;const first=f[0],last=f[f.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}};
 document.addEventListener('keydown',onKey,true);
 m.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>run(Number(b.dataset.act)));
 const pri=m.querySelector('.btn.primary')||m.querySelector('.btn');pri&&pri.focus();
 return m;
}
function uiConfirm(title,body,{confirm='Confirm',cancel='Cancel',danger=false}={}){
 return new Promise(res=>uiModal({icon:danger?'!':'?',title,body:esc(body),tone:danger?'error':'info',id:'uiConfirm',actions:[{label:cancel,cancel:true,onClick:()=>res(false)},{label:confirm,primary:!danger,danger,onClick:()=>res(true)}]}));
}
/* Modal form: values are validated, the save runs inside the dialog so a failure keeps the input, and a second submit is ignored while saving. Resolves true when saved, false when cancelled. */
function uiForm({title,intro='',submit='Save',fields=[],validate=()=>'',onSubmit,id='uiForm'}){
 return new Promise(res=>{
  document.getElementById(id)?.remove();
  const opener=document.activeElement,m=document.createElement('div');m.className='modal-bg';m.id=id;
  const ctl=f=>{const a=`name="${f.name}" id="${id}_${f.name}"${f.required?' required':''}${f.maxlength?` maxlength="${f.maxlength}"`:''}${f.placeholder?` placeholder="${esc(f.placeholder)}"`:''}`;
   if(f.type==='textarea')return `<textarea ${a} rows="${f.rows||3}">${esc(f.value||'')}</textarea>`;
   return `<input ${a} type="${f.type||'text'}" value="${esc(f.value??'')}"${f.min!=null?` min="${f.min}"`:''}${f.max!=null?` max="${f.max}"`:''}${f.step!=null?` step="${f.step}"`:''}${f.inputmode?` inputmode="${f.inputmode}"`:''}/>`};
  m.innerHTML=`<form class="modal modal-form" role="dialog" aria-modal="true" aria-labelledby="${id}T"${intro?` aria-describedby="${id}B"`:''} novalidate><h2 id="${id}T">${esc(title)}</h2>${intro?`<p class="muted small" id="${id}B">${esc(intro)}</p>`:''}<div class="formgrid">${fields.map(f=>`<div class="field${f.full?' full':''}"><label for="${id}_${f.name}">${esc(f.label)}</label>${ctl(f)}</div>`).join('')}</div><p class="form-error" role="alert" hidden></p><div class="modal-actions"><button type="submit" class="btn primary">${esc(submit)}</button><button type="button" class="btn ghost" data-cancel>Cancel</button></div></form>`;
  document.body.appendChild(m);
  const form=m.querySelector('form'),err=m.querySelector('.form-error'),save=m.querySelector('[type=submit]');let busy=false;
  const close=ok=>{document.removeEventListener('keydown',onKey,true);m.remove();try{opener?.focus?.()}catch(_){}res(ok)};
  const show=t=>{err.textContent=t;err.hidden=!t};
  const onKey=e=>{if(e.key==='Escape'&&!busy){e.stopPropagation();close(false)}
   if(e.key==='Tab'){const f=[...m.querySelectorAll('input,textarea,select,button')].filter(x=>!x.disabled);if(!f.length)return;const a=f[0],z=f[f.length-1];if(e.shiftKey&&document.activeElement===a){e.preventDefault();z.focus()}else if(!e.shiftKey&&document.activeElement===z){e.preventDefault();a.focus()}}};
  document.addEventListener('keydown',onKey,true);
  m.querySelector('[data-cancel]').onclick=()=>{if(!busy)close(false)};
  form.addEventListener('submit',async e=>{e.preventDefault();if(busy)return;
   const v={};fields.forEach(f=>v[f.name]=String(form.elements[f.name].value??''));
   const bad=validate(v);if(bad){show(bad);return}
   busy=true;save.disabled=true;save.textContent='Saving…';show('');
   try{await onSubmit(v);close(true)}
   catch(ex){busy=false;save.disabled=false;save.textContent=submit;show(friendlyError(ex).body||friendlyError(ex).title)}});
  form.elements[fields[0]?.name]?.focus();
 });
}
function authError(err,{email='',mode='in',setMode}={}){
 const f=friendlyError(err);const emailEl=$('input[name=email]'),pwEl=$('input[name=password]');
 const retry=()=>{const el=(f.kind==='exists'||f.kind==='net')?emailEl:pwEl;if(el){el.focus();if(f.kind==='creds'&&el.select)el.select()}};
 const acts=[];
 if(f.kind==='creds')acts.push({label:'Forgot password?',onClick:()=>authForgot(email)},{label:'Create account',onClick:()=>{setMode&&setMode('up');emailEl?.focus()}});
 if(f.kind==='exists')acts.push({label:'Forgot password?',onClick:()=>authForgot(email)},{label:'Sign in instead',onClick:()=>{setMode&&setMode('in');pwEl?.focus()}});
 acts.push({label:f.kind==='net'?'Try again':'OK',primary:true,cancel:true,onClick:retry});
 const am=$('#authMsg');if(am)am.textContent=f.title+'.';
 uiModal({title:f.title,body:f.body,actions:acts,tone:'error'});
}
async function authForgot(emailIn){
 const emailEl=$('input[name=email]');const email=String(emailIn||emailEl?.value||'').trim();
 if(!email){uiModal({icon:'✉',title:'Enter your email first',body:'Type your account email in the email field, then tap “Forgot password?”.',tone:'info',actions:[{label:'OK',primary:true,onClick:()=>emailEl?.focus()}]});return}
 try{const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:location.origin});if(error)throw error;
  uiModal({icon:'✉',title:'Check your email',body:'If an account exists for <b>'+esc(email)+'</b>, a reset link is on its way. Open it on this device. Check spam if you don’t see it.',tone:'ok',actions:[{label:'Got it',primary:true}]})}
 catch(err){const f=friendlyError(err);uiModal({title:f.title,body:f.body,actions:[{label:'OK',primary:true}]})}
}
/* error-aware toast + global safety nets */
function fail(e){console.error(e);const f=friendlyError(e);toast((f.kind==='other'?(e?.message||f.body):f.title+'. '+f.body.replace(/<[^>]+>/g,'')),'error')}
function toastUndo(msg,undo){const t=$('#toast');t.textContent=msg+' ';t.className='toast';t.setAttribute('role','status');if(undo){const b=document.createElement('button');b.className='btn sm';b.type='button';b.textContent='Undo';b.onclick=()=>{t.classList.add('hidden');undo()};t.appendChild(b)}clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.add('hidden'),9000)}
function toast(msg,kind){const t=$('#toast');t.textContent=msg;t.className='toast'+(kind==='error'?' err':'');t.setAttribute('role',kind==='error'?'alert':'status');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.add('hidden'),kind==='error'?6000:3200)}
window.addEventListener('unhandledrejection',ev=>{const r=ev.reason;if(r&&/AbortError|ResizeObserver/.test(String(r.name||r.message||'')))return;console.error(r);if(document.querySelector('.modal-bg'))return;fail(r)});
(function netBanner(){let el=null;const sync=()=>{if(!navigator.onLine){if(!el){el=document.createElement('div');el.id='offlineBar';el.setAttribute('role','alert');el.textContent='You’re offline. Changes can’t be saved until you reconnect.';document.body.appendChild(el)}}else if(el){el.remove();el=null;toast('Back online')}};window.addEventListener('online',sync);window.addEventListener('offline',sync);sync()})();
/* accessibility: tie every .field label to its control */
(function a11yLabels(){let n=0;const link=()=>{document.querySelectorAll('.field').forEach(f=>{const l=f.querySelector('label'),c=f.querySelector('input,select,textarea');if(!l||!c||l.htmlFor)return;if(!c.id)c.id='fld'+(++n);l.htmlFor=c.id;if(!c.getAttribute('aria-label')&&!c.placeholder)c.setAttribute('aria-label',l.textContent.trim())})};new MutationObserver(link).observe(document.getElementById('root'),{childList:true,subtree:true});link()})();
/* session expiry: unexpected sign-out while the app is open */

/* ================= v5: Account page, avatar menu, delete account ================= */
function accountV3(){
 const name=user.user_metadata?.name||'';const since=user.created_at?dateFmt(user.created_at.slice(0,10),{day:'numeric',month:'short',year:'numeric'}):'—';
 return `${pageHead('PROFILE · DATA · SECURITY','Account','Your details, your data and your account controls.')}
 <div class="grid g2">
 ${card('Profile',`<div class="acct-id"><div class="acct-av" aria-hidden="true">${esc((name||user.email||'U').slice(0,1).toUpperCase())}</div><div class="grow"><strong>${esc(name||'No name set')}</strong><small>${esc(user.email)}</small></div><button class="btn sm" type="button" id="acctChangeEmail">Change email</button></div>
 <form id="acctForm" style="margin-top:16px"><div class="field"><label>DISPLAY NAME</label><input name="name" value="${esc(name)}" maxlength="60" placeholder="Your name" autocomplete="name"/></div><button class="btn primary" type="submit">Save name</button></form>
 <div class="acct-meta"><div><small>MEMBER SINCE</small><b>${since}</b></div><div><small>CURRENT PLAN</small><b>${aiActivePlan?esc(aiActivePlan.title||'Active plan'):'No plan applied'}</b></div></div>`)}
 ${card('Data & security',`<p class="muted small" style="margin-top:0">Your data is private to this account. Download a full copy any time.</p>
 <div class="acct-actions"><button class="btn" id="acctExport">Download my data (JSON)</button><button class="btn" id="acctReset">Email me a password reset link</button><button class="btn" id="acctSignout">Sign out</button></div>`)}
 </div>
 ${aiPlanHistory.length?`<div style="margin-top:16px">${card('Plan history',aiPlanHistory.map(x=>`<div class="listitem"><div class="grow"><strong>${esc(x.title)}</strong><small>${dateFmt((x.created_at||'').slice(0,10),{day:'numeric',month:'short'})} · ${esc(x.status)}</small></div>${x.status==='active'?'<span class="tag">In use</span>':x.status==='draft'?'':`<button class="btn sm" data-ai-restore="${x.id}">Restore</button>`}</div>`).join(''))}</div>`:''}
 <div style="margin-top:16px"><section class="card danger-zone"><div class="section-title"><h2>Danger zone</h2></div><p class="muted" style="margin-top:0">Deleting your account permanently erases your plans, meals, workouts, weight history, photos and coach data. This cannot be undone.</p><button class="btn danger" id="acctDelete">Delete account</button></section></div>`;
}
function closeAcctMenu(){document.getElementById('acctMenu')?.remove();document.removeEventListener('click',_acctOutside,true);document.removeEventListener('keydown',_acctEsc,true)}
function _acctOutside(e){if(!e.target.closest('#acctMenu,#acctBtn'))closeAcctMenu()}
function _acctEsc(e){if(e.key==='Escape'){closeAcctMenu();$('#acctBtn')?.focus()}}
function openAcctMenu(){
 if(document.getElementById('acctMenu')){closeAcctMenu();return}
 const b=$('#acctBtn'),r=b.getBoundingClientRect(),m=document.createElement('div');m.id='acctMenu';m.setAttribute('role','menu');
 m.style.cssText='top:'+(r.bottom+8)+'px;right:'+Math.max(8,window.innerWidth-r.right)+'px';
 m.innerHTML=`<div class="am-head"><b>${esc(user.user_metadata?.name||'Your account')}</b><small>${esc(user.email)}</small></div><button role="menuitem" data-am="account">Account &amp; settings</button><button role="menuitem" data-am="export">Download my data</button><button role="menuitem" data-am="signout">Sign out</button><button role="menuitem" class="am-danger" data-am="delete">Delete account…</button>`;
 document.body.appendChild(m);b.setAttribute('aria-expanded','true');
 m.querySelectorAll('[data-am]').forEach(x=>x.onclick=async()=>{const a=x.dataset.am;closeAcctMenu();if(a==='account')await gotoTab('account');else if(a==='export')exportData();else if(a==='signout')logout();else if(a==='delete')deleteAccountFlow()});
 setTimeout(()=>{document.addEventListener('click',_acctOutside,true);document.addEventListener('keydown',_acctEsc,true)},0);
 m.querySelector('button').focus();
}
function wireAccount(){
 const b=$('#acctBtn');if(b)b.onclick=openAcctMenu;
 $('#acctForm')?.addEventListener('submit',async e=>{e.preventDefault();const name=String(new FormData(e.currentTarget).get('name')||'').trim();try{const {data,error}=await supabase.auth.updateUser({data:{name}});if(error)throw error;user=data.user;await q(supabase.from('profiles').update({display_name:name||null}).eq('id',user.id));toast('Name saved');await render()}catch(err){fail(err)}});
 $('#acctChangeEmail')?.addEventListener('click',changeEmailFlow);
 $('#acctExport')?.addEventListener('click',()=>exportData());
 $('#acctSignout')?.addEventListener('click',()=>logout());
 $('#acctReset')?.addEventListener('click',()=>authForgotSignedIn());
 $('#acctDelete')?.addEventListener('click',()=>deleteAccountFlow());
}
function changeEmailFlow(){
 document.getElementById('emModal')?.remove();const opener=document.activeElement;
 const m=document.createElement('div');m.className='modal-bg';m.id='emModal';
 m.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="emT" style="text-align:left"><h2 id="emT" style="text-align:center">Change email</h2><p class="muted" style="text-align:center">Currently <b>${esc(user.email)}</b>. We will send a confirmation link to both your old and new address. The change applies once you confirm.</p><form id="emForm"><div class="field"><label for="emNew">NEW EMAIL</label><input id="emNew" type="email" required autocomplete="email" placeholder="you@example.com"/></div><p class="muted small" id="emMsg" role="status"></p><div class="modal-actions"><button class="btn primary" type="submit" id="emGo">Send confirmation</button><button class="btn ghost" type="button" id="emCancel">Cancel</button></div></form></div>`;
 document.body.appendChild(m);const close=()=>{m.remove();document.removeEventListener('keydown',onKey,true);try{opener?.focus?.()}catch(_){}};
 const onKey=e=>{if(e.key==='Escape'){e.stopPropagation();close()}};document.addEventListener('keydown',onKey,true);
 $('#emCancel').onclick=close;$('#emNew').focus();
 $('#emForm').onsubmit=async e=>{e.preventDefault();const v=$('#emNew').value.trim().toLowerCase();if(v===String(user.email).toLowerCase()){$('#emMsg').textContent='That is already your email.';return}
  const b=$('#emGo');b.disabled=true;b.textContent='Sending…';
  try{const {error}=await supabase.auth.updateUser({email:v},{emailRedirectTo:location.origin});if(error)throw error;close();uiModal({icon:'✉',title:'Check both inboxes',body:'We sent confirmation links to <b>'+esc(user.email)+'</b> and <b>'+esc(v)+'</b>. Open both to finish the change. Until then you keep signing in with your current email.',tone:'ok',actions:[{label:'Got it',primary:true}]})}
  catch(err){b.disabled=false;b.textContent='Send confirmation';const f=friendlyError(err);$('#emMsg').textContent=f.title+'. '+f.body.replace(/<[^>]+>/g,'')}};
}
async function authForgotSignedIn(){try{const {error}=await supabase.auth.resetPasswordForEmail(user.email,{redirectTo:location.origin});if(error)throw error;uiModal({icon:'✉',title:'Check your email',body:'We sent a password reset link to <b>'+esc(user.email)+'</b>.',tone:'ok',actions:[{label:'Got it',primary:true}]})}catch(e){fail(e)}}
function deleteAccountFlow(){
 document.getElementById('delModal')?.remove();const opener=document.activeElement;
 const m=document.createElement('div');m.className='modal-bg';m.id='delModal';
 m.innerHTML=`<div class="modal tone-error" role="alertdialog" aria-modal="true" aria-labelledby="delT" aria-describedby="delB" style="text-align:left"><div class="mail-ico ico-error" aria-hidden="true">!</div><h2 id="delT" style="text-align:center">Delete your account?</h2>
 <div id="delB"><p class="muted">This permanently erases everything tied to <b>${esc(user.email)}</b>:</p><ul class="del-list"><li>Your plan, meals, workouts and weight history</li><li>Progress photos and coach insights</li><li>Your login. You will be signed out for good</li></ul><p class="muted"><b>This cannot be undone.</b></p></div>
 <button class="btn" id="delExport" type="button" style="width:100%">Download my data first</button>
 <div class="field" style="margin-top:14px"><label for="delConfirm">Type <b>DELETE</b> to confirm</label><input id="delConfirm" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="DELETE"/></div>
 <p class="muted small" id="delMsg" role="status"></p>
 <div class="modal-actions"><button class="btn danger" id="delGo" type="button" disabled>Delete my account forever</button><button class="btn ghost" id="delCancel" type="button">Cancel</button></div></div>`;
 document.body.appendChild(m);
 const inp=$('#delConfirm'),go=$('#delGo'),msg=t=>{$('#delMsg').textContent=t};let busy=false;
 const close=()=>{if(busy)return;m.remove();document.removeEventListener('keydown',onKey,true);try{opener?.focus?.()}catch(_){}};
 const onKey=e=>{if(e.key==='Escape'){e.stopPropagation();close()}if(e.key==='Tab'){const f=[...m.querySelectorAll('button:not([disabled]),input')];const a=f[0],z=f[f.length-1];if(e.shiftKey&&document.activeElement===a){e.preventDefault();z.focus()}else if(!e.shiftKey&&document.activeElement===z){e.preventDefault();a.focus()}}};
 document.addEventListener('keydown',onKey,true);
 inp.oninput=()=>{go.disabled=busy||inp.value.trim()!=='DELETE'};
 $('#delCancel').onclick=close;
 $('#delExport').onclick=async()=>{const b=$('#delExport');b.disabled=true;b.textContent='Preparing…';const ok=await exportData();b.disabled=false;b.textContent=ok?'Downloaded. Download again':'Download my data first'};
 go.onclick=async()=>{if(inp.value.trim()!=='DELETE'||busy)return;busy=true;go.disabled=true;$('#delCancel').disabled=true;go.textContent='Deleting…';msg('Erasing your data. Keep this window open.');
  try{try{await clearPushForCurrentUser()}catch(_){}
   const {data,error}=await supabase.functions.invoke('delete-account',{body:{confirm:'DELETE'}});if(error)throw error;if(data&&data.error)throw new Error(data.error);
   const uid=user.id;_manualSignOut=true;try{await supabase.auth.signOut({scope:'local'})}catch(_){}
   try{Object.keys(localStorage).filter(k=>k.startsWith('cut_')&&k.includes(uid)).forEach(k=>localStorage.removeItem(k))}catch(_){}
   busy=false;m.remove();document.removeEventListener('keydown',onKey,true);session=null;user=null;wk=null;wkHist=null;aiActivePlan=null;unsubscribeInsights();renderAuthV2();
   uiModal({icon:'✓',title:'Account deleted',body:'Your account and all its data have been permanently erased.',tone:'ok',actions:[{label:'Done',primary:true}]})}
  catch(err){busy=false;go.disabled=false;$('#delCancel').disabled=false;go.textContent='Delete my account forever';let em=err?.message||'';try{if(err?.context?.json){const j=await err.context.json();em=j.error||em}}catch(_){}msg('');uiModal({title:'Could not delete account',body:esc(em||'Something went wrong. Nothing was deleted if you are still signed in. Please try again.'),id:'delErr',actions:[{label:'OK',primary:true}]})}};
 inp.focus();
}

const {data:{session:initial}}=await supabase.auth.getSession();session=initial;if(session&&!recoveryMode)await bootstrap();else if(!recoveryMode)renderAuthV2();

