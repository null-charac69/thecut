-- AI-built grocery and prep lists, Sunday-based weeks, no seeded default targets.
--
-- * Weeks now start on Sunday. Existing Monday-keyed grocery rows are re-keyed one day earlier.
-- * grocery_items / prep_tasks rows with source_version_id set are "AI generated". They are replaced whenever the
--   plan changes. Ticked rows and rows the user added stay (source_version_id null).
-- * list_generations remembers which plan (hash of the live meals) each week's lists were built from, so the app
--   only calls the AI when the week is new or the plan changed.
-- * apply_ai_plan_version no longer copies a plan-time grocery/prep list. It clears the stale AI lists and the app
--   asks the AI for fresh ones built from the live plan.
-- * Leftovers from older plans are cleared once (unticked items for this week and today onwards).
-- * user_settings targets lose their built-in defaults (they were one person's numbers); a plan sets them.

-- 1. Sunday weeks (only Monday-keyed rows move; safe to re-run)
update public.grocery_items set week_start = week_start - 1 where extract(dow from week_start) = 1;

-- Category labels are free text chosen by the AI; show them in sentence case.
update public.grocery_items set category = initcap(lower(btrim(category))) where category is not null and category <> initcap(lower(btrim(category)));

-- 2. One-off cleanup of leftovers from earlier plans (unticked only; ticked rows are kept)
delete from public.grocery_items
where is_purchased = false
  and week_start >= ((now() at time zone 'Asia/Kolkata')::date - extract(dow from (now() at time zone 'Asia/Kolkata')::date)::int);
delete from public.prep_tasks
where is_completed = false
  and local_date >= (now() at time zone 'Asia/Kolkata')::date;

-- 3. Which plan each week's lists were built from
create table if not exists public.list_generations (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week_start date not null,
  plan_hash text not null,
  plan_version_id uuid references public.ai_plan_versions(id) on delete set null,
  generated_from date not null,
  generated_at timestamptz not null default now(),
  primary key (user_id, week_start)
);
alter table public.list_generations enable row level security;
drop policy if exists owner_all on public.list_generations;
create policy owner_all on public.list_generations for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.list_generations from anon;

-- 4. No built-in targets
alter table public.user_settings alter column calorie_target drop not null, alter column calorie_target drop default;
alter table public.user_settings alter column protein_target_g drop not null, alter column protein_target_g drop default;
alter table public.user_settings alter column water_target_ml drop not null, alter column water_target_ml drop default;

-- 5. Replace the AI-generated lists for a week (called by the AI edge function with the user's JWT).
--    p_groceries: [{name, quantity, category}]; p_prep: [{date, tasks:[text]}].
--    Ticked AI rows become the user's own rows; unticked AI rows are replaced; prep for days before p_from is untouched.
create or replace function public.replace_generated_lists(
  p_week_start date, p_from date, p_plan_hash text, p_plan_version_id uuid, p_groceries jsonb, p_prep jsonb
) returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user uuid := auth.uid();
  v_item jsonb;
  v_day jsonb;
  v_task jsonb;
  v_date date;
  v_name text;
  v_text text;
  v_g_added integer := 0;
  v_p_added integer := 0;
  v_g_removed integer := 0;
  v_p_removed integer := 0;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_plan_version_id is null then raise exception 'An active plan is required'; end if;
  if extract(dow from p_week_start) <> 0 then raise exception 'Weeks start on Sunday'; end if;
  if p_from < p_week_start or p_from > p_week_start + 6 then raise exception 'Date is outside the week'; end if;
  if jsonb_typeof(coalesce(p_groceries, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_prep, '[]'::jsonb)) <> 'array' then
    raise exception 'Lists must be arrays';
  end if;
  if not exists (select 1 from public.ai_plan_versions where id = p_plan_version_id and user_id = v_user) then
    raise exception 'AI plan not found for this account';
  end if;

  -- groceries: week level
  update public.grocery_items set source_version_id = null
  where user_id = v_user and week_start = p_week_start and source_version_id is not null and is_purchased;
  delete from public.grocery_items where user_id = v_user and week_start = p_week_start and source_version_id is not null;
  get diagnostics v_g_removed = row_count;

  for v_item in select value from jsonb_array_elements(coalesce(p_groceries, '[]'::jsonb)) limit 80
  loop
    v_name := left(btrim(coalesce(v_item->>'name', '')), 100);
    if v_name = '' then continue; end if;
    if exists (select 1 from public.grocery_items g where g.user_id = v_user and g.week_start = p_week_start and lower(g.name) = lower(v_name)) then
      continue;
    end if;
    insert into public.grocery_items(user_id, week_start, name, quantity, category, sort_order, source_version_id)
    values (
      v_user, p_week_start, v_name, left(btrim(coalesce(v_item->>'quantity', '')), 80),
      nullif(left(btrim(coalesce(v_item->>'category', '')), 30), ''),
      coalesce((select max(sort_order) + 1 from public.grocery_items where user_id = v_user and week_start = p_week_start), 0),
      p_plan_version_id
    );
    v_g_added := v_g_added + 1;
  end loop;

  -- prep: day level, from p_from to the end of the week
  update public.prep_tasks set source_version_id = null
  where user_id = v_user and local_date between p_from and p_week_start + 6 and source_version_id is not null and is_completed;
  delete from public.prep_tasks
  where user_id = v_user and local_date between p_from and p_week_start + 6 and source_version_id is not null;
  get diagnostics v_p_removed = row_count;

  for v_day in select value from jsonb_array_elements(coalesce(p_prep, '[]'::jsonb)) limit 7
  loop
    begin
      v_date := (v_day->>'date')::date;
    exception when others then
      continue;
    end;
    if v_date < p_from or v_date > p_week_start + 6 then continue; end if;
    if jsonb_typeof(v_day->'tasks') <> 'array' then continue; end if;
    for v_task in select value from jsonb_array_elements(v_day->'tasks') limit 8
    loop
      v_text := left(btrim(coalesce(v_task #>> '{}', '')), 240);
      if v_text = '' then continue; end if;
      if exists (select 1 from public.prep_tasks p where p.user_id = v_user and p.local_date = v_date and lower(p.task) = lower(v_text)) then
        continue;
      end if;
      insert into public.prep_tasks(user_id, local_date, task, sort_order, source_version_id)
      values (
        v_user, v_date, v_text,
        coalesce((select max(sort_order) + 1 from public.prep_tasks where user_id = v_user and local_date = v_date), 0),
        p_plan_version_id
      );
      v_p_added := v_p_added + 1;
    end loop;
  end loop;

  insert into public.list_generations(user_id, week_start, plan_hash, plan_version_id, generated_from, generated_at)
  values (v_user, p_week_start, p_plan_hash, p_plan_version_id, p_from, now())
  on conflict (user_id, week_start) do update
    set plan_hash = excluded.plan_hash, plan_version_id = excluded.plan_version_id,
        generated_from = excluded.generated_from, generated_at = now();

  return jsonb_build_object('groceries_added', v_g_added, 'groceries_removed', v_g_removed,
                            'prep_added', v_p_added, 'prep_removed', v_p_removed);
end;
$function$;

revoke all on function public.replace_generated_lists(date, date, text, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.replace_generated_lists(date, date, text, uuid, jsonb, jsonb) to authenticated;

-- 6. Applying or restoring a plan: swap meals and targets, then clear the stale AI lists.
--    The app then asks the AI for lists built from the new live plan.
create or replace function public.apply_ai_plan_version(p_version_id uuid, p_local_date date, p_week_start date)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user uuid := auth.uid();
  v_record public.ai_plan_versions%rowtype;
  v_meal jsonb;
  v_item jsonb;
  v_template_id uuid;
  v_index integer := 0;
  v_item_index integer;
  v_targets jsonb;
  v_time text;
  v_n integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select * into v_record from public.ai_plan_versions
  where id = p_version_id and user_id = v_user for update;
  if not found then raise exception 'AI plan not found for this account'; end if;
  if v_record.status not in ('draft','active','superseded') then raise exception 'This plan cannot be applied'; end if;
  if jsonb_typeof(v_record.plan->'meals') <> 'array'
     or jsonb_array_length(v_record.plan->'meals') < 2
     or jsonb_array_length(v_record.plan->'meals') > 6 then
    raise exception 'The AI plan has an invalid meal list';
  end if;

  v_targets := v_record.plan->'targets';

  delete from public.daily_meals dm
  using public.meal_templates mt
  where dm.meal_template_id = mt.id and dm.user_id = v_user
    and dm.local_date = p_local_date and dm.status = 'planned'
    and mt.user_id = v_user and mt.is_active = true;

  update public.meal_templates set is_active = false
  where user_id = v_user and is_active = true;

  for v_meal in select value from jsonb_array_elements(v_record.plan->'meals')
  loop
    v_time := coalesce(nullif(left(trim(v_meal->>'time'),5),''),'12:00');
    if v_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then v_time := '12:00'; end if;

    insert into public.meal_templates(user_id,name,sort_order,planned_time,is_active)
    values (v_user,left(coalesce(v_meal->>'name','Meal '||(v_index+1)),60),v_index,v_time::time,true)
    returning id into v_template_id;

    v_item_index := 0;
    for v_item in select value from jsonb_array_elements(coalesce(v_meal->'items','[]'::jsonb))
    loop
      insert into public.meal_template_items(
        user_id,meal_template_id,food_name_snapshot,quantity,unit,
        calories_kcal,protein_g,carbs_g,fat_g,fiber_g,sort_order
      ) values (
        v_user,v_template_id,left(coalesce(v_item->>'name','Food item'),100),
        1,left(trim(coalesce(v_item->>'quantity','1')||' '||coalesce(v_item->>'unit','serving')),80),
        greatest(0,coalesce((v_item->>'calories_kcal')::numeric,0)),
        greatest(0,coalesce((v_item->>'protein_g')::numeric,0)),
        greatest(0,coalesce((v_item->>'carbs_g')::numeric,0)),
        greatest(0,coalesce((v_item->>'fat_g')::numeric,0)),
        greatest(0,coalesce((v_item->>'fibre_g')::numeric,0)),
        v_item_index
      );
      v_item_index := v_item_index + 1;
    end loop;

    insert into public.meal_template_items(
      user_id,meal_template_id,food_name_snapshot,quantity,unit,
      calories_kcal,protein_g,carbs_g,fat_g,fiber_g,sort_order
    ) values (
      v_user,v_template_id,'__plan_total__',1,'AI plan total',
      greatest(0,coalesce((v_meal->'totals'->>'calories_kcal')::numeric,0)),
      greatest(0,coalesce((v_meal->'totals'->>'protein_g')::numeric,0)),
      greatest(0,coalesce((v_meal->'totals'->>'carbs_g')::numeric,0)),
      greatest(0,coalesce((v_meal->'totals'->>'fat_g')::numeric,0)),
      greatest(0,coalesce((v_meal->'totals'->>'fibre_g')::numeric,0)),
      999
    );
    v_index := v_index + 1;
  end loop;

  insert into public.user_settings(
    user_id,calorie_target,protein_target_g,carbs_target_g,fat_target_g,
    fiber_target_g,water_target_ml,height_cm
  ) values (
    v_user,(v_targets->>'calories_kcal')::integer,(v_targets->>'protein_g')::numeric,
    (v_targets->>'carbs_g')::numeric,(v_targets->>'fat_g')::numeric,
    (v_targets->>'fibre_g')::numeric,(v_targets->>'water_ml')::integer,
    nullif(v_record.inputs->>'height_cm','')::numeric
  )
  on conflict (user_id) do update set
    calorie_target=excluded.calorie_target,protein_target_g=excluded.protein_target_g,
    carbs_target_g=excluded.carbs_target_g,fat_target_g=excluded.fat_target_g,
    fiber_target_g=excluded.fiber_target_g,water_target_ml=excluded.water_target_ml,
    height_cm=excluded.height_cm,updated_at=now();

  insert into public.daily_targets(
    user_id,local_date,calorie_target,protein_target_g,carbs_target_g,fat_target_g,fiber_target_g,water_target_ml
  ) values (
    v_user,p_local_date,(v_targets->>'calories_kcal')::integer,
    (v_targets->>'protein_g')::numeric,(v_targets->>'carbs_g')::numeric,
    (v_targets->>'fat_g')::numeric,(v_targets->>'fibre_g')::numeric,(v_targets->>'water_ml')::integer
  )
  on conflict (user_id,local_date) do update set
    calorie_target=excluded.calorie_target,protein_target_g=excluded.protein_target_g,
    carbs_target_g=excluded.carbs_target_g,fat_target_g=excluded.fat_target_g,
    fiber_target_g=excluded.fiber_target_g,water_target_ml=excluded.water_target_ml,updated_at=now();

  -- Clear the AI lists of the old plan: this week's groceries and prep from today on. Ticked rows become the
  -- user's own; rows the user added are not touched; days before today are history.
  update public.grocery_items set source_version_id = null
  where user_id = v_user and week_start = p_week_start and source_version_id is not null and is_purchased;
  delete from public.grocery_items where user_id = v_user and week_start = p_week_start and source_version_id is not null;
  update public.prep_tasks set source_version_id = null
  where user_id = v_user and local_date between p_local_date and p_week_start + 6 and source_version_id is not null and is_completed;
  delete from public.prep_tasks
  where user_id = v_user and local_date between p_local_date and p_week_start + 6 and source_version_id is not null;

  -- Mark this week's lists as built for a different plan, so the app rebuilds them (rest of the week) on next open.
  update public.list_generations set plan_hash = '' where user_id = v_user and week_start = p_week_start;

  update public.ai_plan_versions set status='superseded'
  where user_id=v_user and status='active' and id<>p_version_id;
  update public.ai_plan_versions set status='active',applied_at=now()
  where id=p_version_id and user_id=v_user;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'Could not activate the plan'; end if;

  return jsonb_build_object('applied', true, 'meal_templates_created', v_index);
end;
$function$;

revoke all on function public.apply_ai_plan_version(uuid, date, date) from public, anon;
grant execute on function public.apply_ai_plan_version(uuid, date, date) to authenticated;
