-- THE CUT coach sync: the AI always reads the LIVE plan (targets + meal templates + training week)
-- and compares it with the last state the coach acknowledged. Additive only.

create table if not exists public.agent_baseline (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_id uuid,
  state jsonb not null,
  state_hash text not null,
  updated_at timestamptz not null default now()
);
alter table public.agent_baseline enable row level security;
drop policy if exists agent_baseline_select_own on public.agent_baseline;
create policy agent_baseline_select_own on public.agent_baseline for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.agent_baseline from anon, authenticated;
grant select on public.agent_baseline to authenticated;

-- Live plan state, built from what the user actually has right now.
create or replace function public.agent_state_for(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.user_settings%rowtype; v_plan_id uuid; v_title text; v_training jsonb; v_meals jsonb;
begin
  select * into s from public.user_settings where user_id = p_user;
  select id, title, coalesce(plan->'training_week', '[]'::jsonb) into v_plan_id, v_title, v_training
    from public.ai_plan_versions where user_id = p_user and status = 'active' order by applied_at desc nulls last limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
      'name', t.name, 'time', left(coalesce(t.planned_time::text, ''), 5),
      'calories_kcal', (select i.calories_kcal from public.meal_template_items i where i.meal_template_id = t.id and i.food_name_snapshot = '__plan_total__' limit 1),
      'protein_g', (select i.protein_g from public.meal_template_items i where i.meal_template_id = t.id and i.food_name_snapshot = '__plan_total__' limit 1),
      'items', coalesce((select jsonb_agg(i.food_name_snapshot order by i.sort_order) from public.meal_template_items i where i.meal_template_id = t.id and i.food_name_snapshot <> '__plan_total__'), '[]'::jsonb)
    ) order by t.sort_order), '[]'::jsonb) into v_meals
    from public.meal_templates t where t.user_id = p_user and t.is_active;
  return jsonb_build_object(
    'plan_id', v_plan_id, 'plan_title', v_title,
    'targets', jsonb_build_object('calories_kcal', s.calorie_target, 'protein_g', s.protein_target_g, 'carbs_g', s.carbs_target_g,
                                  'fat_g', s.fat_target_g, 'fibre_g', s.fiber_target_g, 'water_ml', s.water_target_ml),
    'meals', v_meals, 'training_week', coalesce(v_training, '[]'::jsonb));
end $$;

create or replace function public.agent_plan_state() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  return public.agent_state_for(auth.uid());
end $$;

-- Marks the current live state as acknowledged (plan applied, edit accepted, or user keeps their version).
create or replace function public.agent_ack_state() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  v := public.agent_state_for(auth.uid());
  insert into public.agent_baseline (user_id, plan_id, state, state_hash, updated_at)
  values (auth.uid(), nullif(v->>'plan_id','')::uuid, v - 'plan_title', md5((v - 'plan_title' - 'plan_id')::text), now())
  on conflict (user_id) do update set plan_id = excluded.plan_id, state = excluded.state, state_hash = excluded.state_hash, updated_at = now();
end $$;

-- AI-authored coach messages (source = 'ai'). Restricted kinds so a client cannot forge rule insights.
create or replace function public.agent_put_ai(p_kind text, p_sev text, p_title text, p_body text, p_data jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_kind not like 'plan_edit%' and p_kind not like 'coach_%' then raise exception 'Invalid kind'; end if;
  if p_sev not in ('info','good','watch','alert') then p_sev := 'info'; end if;
  insert into public.agent_insights (user_id, kind, severity, title, body, data, insight_date, source)
  values (auth.uid(), p_kind, p_sev, left(p_title, 120), left(p_body, 900), coalesce(p_data, '{}'::jsonb), current_date, 'ai')
  on conflict (user_id, kind, insight_date) do update set
    severity = excluded.severity, title = excluded.title, body = excluded.body, data = excluded.data,
    read_at = null, dismissed_at = null, created_at = now();
end $$;

-- Lets the user edit the training week of the active plan directly.
create or replace function public.save_training_week(p_week jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_week) <> 'array' or jsonb_array_length(p_week) > 7 then raise exception 'training week must be an array of at most 7 days'; end if;
  select id into v_id from public.ai_plan_versions where user_id = auth.uid() and status = 'active' order by applied_at desc nulls last limit 1;
  if v_id is null then raise exception 'No active plan'; end if;
  update public.ai_plan_versions set plan = jsonb_set(plan, '{training_week}', p_week) where id = v_id;
end $$;

revoke all on function public.agent_state_for(uuid) from public, anon, authenticated;
revoke all on function public.agent_plan_state() from public, anon;
revoke all on function public.agent_ack_state() from public, anon;
revoke all on function public.agent_put_ai(text, text, text, text, jsonb) from public, anon;
revoke all on function public.save_training_week(jsonb) from public, anon;
grant execute on function public.agent_plan_state() to authenticated;
grant execute on function public.agent_ack_state() to authenticated;
grant execute on function public.agent_put_ai(text, text, text, text, jsonb) to authenticated;
grant execute on function public.save_training_week(jsonb) to authenticated;
