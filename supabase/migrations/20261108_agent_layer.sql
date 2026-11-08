-- THE CUT 2.0 — proactive agent layer (additive only; no existing table is altered except profiles.tour_completed_at)

alter table public.profiles add column if not exists tour_completed_at timestamptz;

create table if not exists public.agent_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  severity text not null default 'info' check (severity in ('info','good','watch','alert')),
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  insight_date date not null default current_date,
  source text not null default 'rules' check (source in ('rules','ai')),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  dismissed_at timestamptz,
  unique (user_id, kind, insight_date)
);
create index if not exists agent_insights_user_created_idx on public.agent_insights (user_id, created_at desc);

alter table public.agent_insights enable row level security;
drop policy if exists agent_insights_select_own on public.agent_insights;
create policy agent_insights_select_own on public.agent_insights
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists agent_insights_update_own on public.agent_insights;
create policy agent_insights_update_own on public.agent_insights
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.agent_insights from anon, authenticated;
grant select on public.agent_insights to authenticated;
grant update (read_at, dismissed_at) on public.agent_insights to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.agent_insights;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- Upsert an insight; only touches the row (and so only fires realtime) when something changed.
create or replace function public.agent_put(
  p_user uuid, p_kind text, p_sev text, p_title text, p_body text, p_data jsonb, p_date date
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.agent_insights (user_id, kind, severity, title, body, data, insight_date)
  values (p_user, p_kind, p_sev, p_title, p_body, coalesce(p_data, '{}'::jsonb), p_date)
  on conflict (user_id, kind, insight_date) do update set
    severity = excluded.severity, title = excluded.title, body = excluded.body, data = excluded.data,
    read_at = null, dismissed_at = null
  where (agent_insights.severity, agent_insights.title, agent_insights.body)
        is distinct from (excluded.severity, excluded.title, excluded.body);
end $$;

create or replace function public.agent_clear(p_user uuid, p_kind text, p_date date)
returns void language sql security definer set search_path = public, pg_temp as $$
  delete from public.agent_insights
  where user_id = p_user and kind = p_kind and insight_date = p_date and source = 'rules';
$$;

-- Aggregates the last 7 full days (+ today for workouts) from every tracker source.
-- Missing data stays NULL / 0-count: it is never interpreted as a zero intake.
create or replace function public.agent_metrics(p_user uuid, p_today date default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tz text; v_today date; v_from date; v_to date;
  s public.user_settings%rowtype;
  v_days int; v_kcal numeric; v_prot numeric;
  v_skipped int; v_water_days int; v_water numeric; v_workouts int;
  v_inputs jsonb; v_applied timestamptz; v_plan_title text;
  v_wf numeric; v_wl numeric; v_wd int; v_wc int;
  v_ci int; v_sleep numeric; v_energy numeric;
begin
  select coalesce(timezone, 'Asia/Kolkata') into v_tz from public.profiles where id = p_user;
  v_tz := coalesce(v_tz, 'Asia/Kolkata');
  v_today := coalesce(p_today, (now() at time zone v_tz)::date);
  v_from := v_today - 7; v_to := v_today - 1;
  select * into s from public.user_settings where user_id = p_user;

  select count(*), avg(k), avg(p) into v_days, v_kcal, v_prot from (
    select local_date, sum(k) as k, sum(p) as p from (
      select local_date, calories_kcal as k, protein_g as p from public.food_entries
        where user_id = p_user and local_date between v_from and v_to
      union all
      select dm.local_date, i.calories_kcal, i.protein_g
        from public.daily_meals dm
        join public.meal_template_items i
          on i.meal_template_id = dm.meal_template_id and i.user_id = dm.user_id and i.food_name_snapshot = '__plan_total__'
        where dm.user_id = p_user and dm.status = 'completed' and dm.local_date between v_from and v_to
    ) x group by local_date having sum(k) > 0
  ) d;

  select count(*) into v_skipped from public.daily_meals
    where user_id = p_user and status = 'skipped' and local_date between v_from and v_to;

  select count(*), avg(t) into v_water_days, v_water from (
    select local_date, sum(amount_ml) as t from public.water_logs
      where user_id = p_user and local_date between v_from and v_to group by local_date
  ) w;

  select count(*) into v_workouts from public.workout_sessions
    where user_id = p_user and local_date between v_from and v_today;

  select inputs, applied_at, title into v_inputs, v_applied, v_plan_title from public.ai_plan_versions
    where user_id = p_user and status = 'active' order by applied_at desc nulls last limit 1;

  select (array_agg(weight_kg order by measured_on asc))[1],
         (array_agg(weight_kg order by measured_on desc))[1],
         coalesce(max(measured_on) - min(measured_on), 0), count(*)
    into v_wf, v_wl, v_wd, v_wc
    from public.body_measurements
    where user_id = p_user and weight_kg is not null and measured_on between v_today - 14 and v_today;

  select count(*), avg(sleep_hours), avg(energy_score) into v_ci, v_sleep, v_energy
    from public.daily_checkins where user_id = p_user and local_date between v_from and v_to;

  return jsonb_build_object(
    'today', v_today, 'from', v_from, 'to', v_to, 'timezone', v_tz,
    'has_plan', v_inputs is not null,
    'plan_title', v_plan_title,
    'applied_date', case when v_applied is null then null else (v_applied at time zone v_tz)::date end,
    'goal', v_inputs->>'goal',
    'planned_training_days', nullif(v_inputs->>'training_days_per_week', '')::int,
    'targets', jsonb_build_object(
      'kcal', coalesce(s.calorie_target, 1566), 'protein_g', coalesce(s.protein_target_g, 139),
      'water_ml', coalesce(s.water_target_ml, 2500)),
    'food_days', v_days, 'avg_kcal', round(v_kcal), 'avg_protein_g', round(v_prot),
    'skipped_meals', v_skipped, 'water_days', v_water_days, 'avg_water_ml', round(v_water),
    'workouts', v_workouts,
    'weight', jsonb_build_object('first', v_wf, 'last', v_wl, 'span_days', v_wd, 'count', v_wc),
    'checkins', jsonb_build_object('count', v_ci, 'avg_sleep_h', round(v_sleep, 1), 'avg_energy', round(v_energy, 1))
  );
end $$;

-- Deterministic rules. Runs after every tracker change; never blocks the user's write (see triggers).
create or replace function public.agent_scan(p_user uuid, p_today date default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m jsonb; v_today date;
  v_days int; v_kcal numeric; v_prot numeric; v_tk numeric; v_tp numeric; v_tw numeric;
  v_ratio numeric; v_dev numeric; v_skipped int; v_wd int; v_water numeric; v_workouts int; v_planned int;
  v_goal text; v_applied date; v_wc int; v_wspan int; v_wf numeric; v_wl numeric; v_rate numeric; v_pct numeric;
  v_ci int; v_sleep numeric; v_energy numeric;
begin
  m := public.agent_metrics(p_user, p_today);
  if not (m->>'has_plan')::boolean then return; end if;
  v_today := (m->>'today')::date;
  v_days := coalesce((m->>'food_days')::int, 0);
  v_kcal := (m->>'avg_kcal')::numeric; v_prot := (m->>'avg_protein_g')::numeric;
  v_tk := (m->'targets'->>'kcal')::numeric; v_tp := (m->'targets'->>'protein_g')::numeric;
  v_tw := (m->'targets'->>'water_ml')::numeric;
  v_skipped := coalesce((m->>'skipped_meals')::int, 0);
  v_wd := coalesce((m->>'water_days')::int, 0); v_water := (m->>'avg_water_ml')::numeric;
  v_workouts := coalesce((m->>'workouts')::int, 0); v_planned := coalesce((m->>'planned_training_days')::int, 0);
  v_goal := m->>'goal'; v_applied := (m->>'applied_date')::date;
  v_wc := coalesce((m->'weight'->>'count')::int, 0); v_wspan := coalesce((m->'weight'->>'span_days')::int, 0);
  v_wf := (m->'weight'->>'first')::numeric; v_wl := (m->'weight'->>'last')::numeric;
  v_ci := coalesce((m->'checkins'->>'count')::int, 0);
  v_sleep := (m->'checkins'->>'avg_sleep_h')::numeric; v_energy := (m->'checkins'->>'avg_energy')::numeric;

  -- 1. Tracking gaps (missing data is unknown, not zero)
  if v_days <= 3 then
    perform public.agent_put(p_user, 'tracking_gap', 'watch', 'Not much logged this week',
      format('Food was logged on %s of the last 7 days. Missing days are unknown, not zero, so I am holding back calorie and protein verdicts until there is more data.', v_days),
      jsonb_build_object('logged_days', v_days), v_today);
  else perform public.agent_clear(p_user, 'tracking_gap', v_today); end if;

  -- 2. Protein
  if v_days >= 3 and v_prot is not null and v_tp > 0 then
    v_ratio := v_prot / v_tp;
    if v_ratio < 0.85 then
      perform public.agent_put(p_user, 'protein', 'watch', 'Protein is running low',
        format('Protein averages %s g on logged days vs your %s g target (%s%%). Anchor the meal that usually falls short with a protein source.', round(v_prot), round(v_tp), round(v_ratio * 100)),
        jsonb_build_object('avg', v_prot, 'target', v_tp), v_today);
    elsif v_ratio >= 0.95 then
      perform public.agent_put(p_user, 'protein', 'good', 'Protein is on target',
        format('Averaging %s g vs a %s g target across %s logged days. Keep it up.', round(v_prot), round(v_tp), v_days),
        jsonb_build_object('avg', v_prot, 'target', v_tp), v_today);
    else perform public.agent_clear(p_user, 'protein', v_today); end if;
  else perform public.agent_clear(p_user, 'protein', v_today); end if;

  -- 3. Calorie drift
  if v_days >= 3 and v_kcal is not null and v_tk > 0 then
    v_dev := (v_kcal - v_tk) / v_tk;
    if abs(v_dev) > 0.15 then
      perform public.agent_put(p_user, 'calories', 'watch', case when v_dev > 0 then 'Eating above your target' else 'Eating well below your target' end,
        format('Intake averages %s kcal on logged days, %s%% %s your %s kcal target. %s', round(v_kcal), round(abs(v_dev) * 100),
          case when v_dev > 0 then 'above' else 'below' end, round(v_tk),
          case when v_dev > 0 then 'If this is on purpose, consider refining the plan; if not, tighten portions at the biggest meal.'
               else 'Large, sustained deficits hurt recovery. Check you are logging everything you eat.' end),
        jsonb_build_object('avg', v_kcal, 'target', v_tk), v_today);
    else perform public.agent_clear(p_user, 'calories', v_today); end if;
  else perform public.agent_clear(p_user, 'calories', v_today); end if;

  -- 4. Skipped meals
  if v_skipped >= 3 then
    perform public.agent_put(p_user, 'meal_skips', 'watch', 'Meals are getting skipped',
      format('%s planned meals were marked skipped in the last 7 days. If the timing or prep is the problem, refine the plan around your real schedule.', v_skipped),
      jsonb_build_object('skipped', v_skipped), v_today);
  else perform public.agent_clear(p_user, 'meal_skips', v_today); end if;

  -- 5. Hydration
  if v_wd >= 3 and v_water is not null and v_tw > 0 and v_water < 0.6 * v_tw then
    perform public.agent_put(p_user, 'hydration', 'info', 'Water is lagging',
      format('Logged water averages %s ml vs your %s ml target. Front-load a glass at each meal.', round(v_water), round(v_tw)),
      jsonb_build_object('avg', v_water, 'target', v_tw), v_today);
  else perform public.agent_clear(p_user, 'hydration', v_today); end if;

  -- 6. Training vs plan (only once the plan has had about a week to run)
  if v_planned > 0 and v_applied is not null and v_today - v_applied >= 6 then
    if v_workouts >= v_planned then
      perform public.agent_put(p_user, 'training', 'good', 'Training is on plan',
        format('%s sessions logged vs %s planned this week.', v_workouts, v_planned),
        jsonb_build_object('done', v_workouts, 'planned', v_planned), v_today);
    elsif v_workouts < v_planned - 1 then
      perform public.agent_put(p_user, 'training', 'watch', 'Behind on training',
        format('%s sessions logged vs %s planned. If the schedule does not fit, refine the training week instead of dropping it.', v_workouts, v_planned),
        jsonb_build_object('done', v_workouts, 'planned', v_planned), v_today);
    else perform public.agent_clear(p_user, 'training', v_today); end if;
  else perform public.agent_clear(p_user, 'training', v_today); end if;

  -- 7. Weight trend vs goal
  if v_wc >= 2 and v_wspan >= 5 and v_wl > 0 then
    v_rate := (v_wl - v_wf) / (v_wspan / 7.0);
    v_pct := v_rate / v_wl * 100;
    if coalesce(v_goal, '') ~* '(loss|lose|cut|fat|lean)' then
      if v_pct < -1.0 then
        perform public.agent_put(p_user, 'weight_trend', 'alert', 'Losing weight faster than advised',
          format('Trend is %s kg/week (about %s%% of body weight). Above roughly 1%% per week risks muscle loss; consider eating a little more.', round(v_rate, 2), round(abs(v_pct), 1)),
          jsonb_build_object('rate_kg_week', v_rate), v_today);
      elsif v_rate > -0.05 and v_wspan >= 10 then
        perform public.agent_put(p_user, 'weight_trend', 'watch', 'Weight has stalled',
          format('Weight is flat over %s days (%s kg/week). Check logging accuracy first, then consider a small calorie or activity adjustment.', v_wspan, round(v_rate, 2)),
          jsonb_build_object('rate_kg_week', v_rate), v_today);
      elsif v_rate < 0 then
        perform public.agent_put(p_user, 'weight_trend', 'good', 'Weight is trending down',
          format('%s kg/week over the last %s days, in a sustainable range.', round(v_rate, 2), v_wspan),
          jsonb_build_object('rate_kg_week', v_rate), v_today);
      else perform public.agent_clear(p_user, 'weight_trend', v_today); end if;
    else perform public.agent_clear(p_user, 'weight_trend', v_today); end if;
  else perform public.agent_clear(p_user, 'weight_trend', v_today); end if;

  -- 8. Recovery
  if v_ci >= 3 and (coalesce(v_sleep, 8) < 6 or coalesce(v_energy, 10) <= 4) then
    perform public.agent_put(p_user, 'recovery', 'watch', 'Recovery looks low',
      format('Check-ins average %s h sleep and energy %s/10. Consider a lighter session or an earlier night before pushing volume.', v_sleep, v_energy),
      jsonb_build_object('sleep', v_sleep, 'energy', v_energy), v_today);
  else perform public.agent_clear(p_user, 'recovery', v_today); end if;
end $$;

-- Triggers: scan the owning user after any tracker change. Failures never block the user's write.
create or replace function public.agent_trigger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid;
begin
  if tg_op = 'DELETE' then v_user := old.user_id; else v_user := new.user_id; end if;
  begin
    perform public.agent_scan(v_user);
  exception when others then
    raise warning 'agent_scan failed: %', sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists trg_agent_food_entries on public.food_entries;
create trigger trg_agent_food_entries after insert or update or delete on public.food_entries
  for each row execute function public.agent_trigger();
drop trigger if exists trg_agent_water_logs on public.water_logs;
create trigger trg_agent_water_logs after insert or update or delete on public.water_logs
  for each row execute function public.agent_trigger();
drop trigger if exists trg_agent_body_measurements on public.body_measurements;
create trigger trg_agent_body_measurements after insert or update or delete on public.body_measurements
  for each row execute function public.agent_trigger();
drop trigger if exists trg_agent_workout_sessions on public.workout_sessions;
create trigger trg_agent_workout_sessions after insert or update or delete on public.workout_sessions
  for each row execute function public.agent_trigger();
drop trigger if exists trg_agent_daily_checkins on public.daily_checkins;
create trigger trg_agent_daily_checkins after insert or update or delete on public.daily_checkins
  for each row execute function public.agent_trigger();
drop trigger if exists trg_agent_daily_meals on public.daily_meals;
create trigger trg_agent_daily_meals after update of status on public.daily_meals
  for each row when (old.status is distinct from new.status) execute function public.agent_trigger();

-- Plan lifecycle: announce new drafts and explain exactly what changed when a plan is applied.
create or replace function public.agent_plan_trigger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prev jsonb; v_new jsonb; v_parts text[] := '{}'; v_k text; v_label text; v_a numeric; v_b numeric;
  v_today date := current_date;
begin
  begin
    if tg_op = 'INSERT' and new.status = 'draft' then
      perform public.agent_put(new.user_id, 'draft_' || left(new.id::text, 8), 'info', 'New plan draft ready',
        format('"%s" is waiting for your review. Nothing changes until you apply it.', new.title),
        jsonb_build_object('plan_id', new.id), v_today);
    elsif tg_op = 'UPDATE' and new.status = 'active' and old.status is distinct from 'active' then
      v_new := new.plan->'targets';
      select plan->'targets' into v_prev from public.ai_plan_versions
        where user_id = new.user_id and id <> new.id and applied_at is not null
        order by applied_at desc limit 1;
      if v_prev is null then
        perform public.agent_put(new.user_id, 'plan_applied_' || left(new.id::text, 8), 'info', 'Your plan is live',
          format('"%s" is now active. I will compare your next few days against it and flag what drifts.', new.title),
          jsonb_build_object('plan_id', new.id), v_today);
      else
        foreach v_k in array array['calories_kcal','protein_g','carbs_g','fat_g'] loop
          v_a := (v_prev->>v_k)::numeric; v_b := (v_new->>v_k)::numeric;
          if v_a is distinct from v_b and v_a is not null and v_b is not null then
            v_label := case v_k when 'calories_kcal' then 'Calories' when 'protein_g' then 'Protein' when 'carbs_g' then 'Carbs' else 'Fat' end;
            v_parts := v_parts || format('%s %s → %s (%s%s)', v_label, round(v_a), round(v_b), case when v_b > v_a then '+' else '' end, round(v_b - v_a));
          end if;
        end loop;
        perform public.agent_put(new.user_id, 'plan_applied_' || left(new.id::text, 8), 'info', 'Plan applied: here is what changed',
          case when array_length(v_parts, 1) is null then format('"%s" is active with the same daily targets.', new.title)
               else format('"%s" is active. %s. I will compare your next 3 days against these targets.', new.title, array_to_string(v_parts, ' · ')) end,
          jsonb_build_object('plan_id', new.id), v_today);
      end if;
      perform public.agent_scan(new.user_id);
    end if;
  exception when others then
    raise warning 'agent_plan_trigger failed: %', sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists trg_agent_plan on public.ai_plan_versions;
create trigger trg_agent_plan after insert or update of status on public.ai_plan_versions
  for each row execute function public.agent_plan_trigger();

-- Client entry points
create or replace function public.agent_scan_me() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform public.agent_scan(auth.uid());
end $$;

create or replace function public.agent_week_summary() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  return public.agent_metrics(auth.uid())
    || jsonb_build_object('open_insights', coalesce((
         select jsonb_agg(jsonb_build_object('kind', kind, 'severity', severity, 'title', title))
         from public.agent_insights
         where user_id = auth.uid() and insight_date = (public.agent_metrics(auth.uid())->>'today')::date and dismissed_at is null), '[]'::jsonb));
end $$;

revoke all on function public.agent_put(uuid, text, text, text, text, jsonb, date) from public, anon, authenticated;
revoke all on function public.agent_clear(uuid, text, date) from public, anon, authenticated;
revoke all on function public.agent_metrics(uuid, date) from public, anon, authenticated;
revoke all on function public.agent_scan(uuid, date) from public, anon, authenticated;
revoke all on function public.agent_trigger() from public, anon, authenticated;
revoke all on function public.agent_plan_trigger() from public, anon, authenticated;
revoke all on function public.agent_scan_me() from public, anon;
revoke all on function public.agent_week_summary() from public, anon;
grant execute on function public.agent_scan_me() to authenticated;
grant execute on function public.agent_week_summary() to authenticated;
