-- THE CUT: complete plan undo/restore. Additive and idempotent.
--
-- Fixes two defects in apply_ai_plan_version:
--  1. Restoring (undoing to) a previous plan failed with "Only a draft or active plan can be applied",
--     because replaced plans are 'superseded'. A superseded plan can now be re-applied.
--  2. Grocery and prep items added by a plan were never removed, so after Undo the list still held the
--     newer plan's items. Items are now tagged with the plan version that created them; applying any
--     plan swaps the plan-derived items for that plan's own list.
--
-- What is kept on purpose: items the user added by hand (no source_version_id), and anything the user
-- already ticked (bought groceries, completed prep tasks), which becomes a permanent personal item.

alter table public.grocery_items add column if not exists source_version_id uuid references public.ai_plan_versions(id) on delete set null;
alter table public.prep_tasks    add column if not exists source_version_id uuid references public.ai_plan_versions(id) on delete set null;
create index if not exists grocery_items_source_version_idx on public.grocery_items (source_version_id) where source_version_id is not null;
create index if not exists prep_tasks_source_version_idx    on public.prep_tasks (source_version_id)    where source_version_id is not null;

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
  v_grocery jsonb;
  v_task jsonb;
  v_template_id uuid;
  v_index integer := 0;
  v_item_index integer;
  v_added_groceries integer := 0;
  v_added_prep integer := 0;
  v_removed_groceries integer := 0;
  v_removed_prep integer := 0;
  v_targets jsonb;
  v_time text;
  v_n integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select * into v_record from public.ai_plan_versions
  where id = p_version_id and user_id = v_user for update;
  if not found then raise exception 'AI plan not found for this account'; end if;
  -- 'superseded' is allowed so Undo / Restore can bring an earlier plan back.
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

  -- Groceries: swap the plan-derived items of this week for this plan's list.
  -- 1) items from another plan that this plan also lists are adopted (keeps their ticked state)
  update public.grocery_items g set source_version_id = p_version_id
  where g.user_id = v_user and g.week_start = p_week_start
    and g.source_version_id is not null and g.source_version_id <> p_version_id
    and exists (
      select 1 from jsonb_array_elements(coalesce(v_record.plan->'grocery_list','[]'::jsonb)) e
      where lower(trim(e->>'name')) = lower(g.name)
    );
  -- 2) items from another plan that this plan does not list: ticked ones become personal items, the rest go
  update public.grocery_items g set source_version_id = null
  where g.user_id = v_user and g.week_start = p_week_start
    and g.source_version_id is not null and g.source_version_id <> p_version_id and g.is_purchased;
  delete from public.grocery_items g
  where g.user_id = v_user and g.week_start = p_week_start
    and g.source_version_id is not null and g.source_version_id <> p_version_id;
  get diagnostics v_removed_groceries = row_count;

  for v_grocery in select value from jsonb_array_elements(coalesce(v_record.plan->'grocery_list','[]'::jsonb))
  loop
    if nullif(trim(v_grocery->>'name'),'') is not null and not exists (
      select 1 from public.grocery_items g
      where g.user_id=v_user and g.week_start=p_week_start and lower(g.name)=lower(trim(v_grocery->>'name'))
    ) then
      insert into public.grocery_items(user_id,week_start,name,quantity,category,sort_order,source_version_id)
      values (
        v_user,p_week_start,left(trim(v_grocery->>'name'),100),left(coalesce(v_grocery->>'quantity',''),80),
        case when v_grocery->>'category' in ('PROTEIN','DAIRY','PANTRY','PRODUCE') then v_grocery->>'category' else 'PRODUCE' end,
        coalesce((select max(sort_order)+1 from public.grocery_items where user_id=v_user and week_start=p_week_start),0),
        p_version_id
      );
      v_added_groceries := v_added_groceries + 1;
    end if;
  end loop;

  -- Prep tasks: same swap for the selected day.
  update public.prep_tasks p set source_version_id = p_version_id
  where p.user_id = v_user and p.local_date = p_local_date
    and p.source_version_id is not null and p.source_version_id <> p_version_id
    and exists (
      select 1 from jsonb_array_elements(coalesce(v_record.plan->'prep_tasks','[]'::jsonb)) e
      where lower(trim(e#>>'{}')) = lower(p.task)
    );
  update public.prep_tasks p set source_version_id = null
  where p.user_id = v_user and p.local_date = p_local_date
    and p.source_version_id is not null and p.source_version_id <> p_version_id and p.is_completed;
  delete from public.prep_tasks p
  where p.user_id = v_user and p.local_date = p_local_date
    and p.source_version_id is not null and p.source_version_id <> p_version_id;
  get diagnostics v_removed_prep = row_count;

  for v_task in select value from jsonb_array_elements(coalesce(v_record.plan->'prep_tasks','[]'::jsonb))
  loop
    if nullif(trim(v_task#>>'{}'),'') is not null and not exists (
      select 1 from public.prep_tasks p
      where p.user_id=v_user and p.local_date=p_local_date and lower(p.task)=lower(trim(v_task#>>'{}'))
    ) then
      insert into public.prep_tasks(user_id,local_date,task,sort_order,source_version_id)
      values (
        v_user,p_local_date,left(trim(v_task#>>'{}'),240),
        coalesce((select max(sort_order)+1 from public.prep_tasks where user_id=v_user and local_date=p_local_date),0),
        p_version_id
      );
      v_added_prep := v_added_prep + 1;
    end if;
  end loop;

  -- Plan status: the plan being applied becomes active, the previous one is kept as 'superseded'.
  update public.ai_plan_versions set status='superseded'
  where user_id=v_user and status='active' and id<>p_version_id;
  update public.ai_plan_versions set status='active',applied_at=now()
  where id=p_version_id and user_id=v_user;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'Could not activate the plan'; end if;

  return jsonb_build_object('applied',true,'meal_templates_created',v_index,
    'groceries_added',v_added_groceries,'groceries_removed',v_removed_groceries,
    'prep_tasks_added',v_added_prep,'prep_tasks_removed',v_removed_prep);
end;
$function$;

revoke all on function public.apply_ai_plan_version(uuid, date, date) from public, anon;
grant execute on function public.apply_ai_plan_version(uuid, date, date) to authenticated;
