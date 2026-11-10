-- reset_plan: "Delete my plan and start fresh".
-- Removes everything that comes from the plan: the plan versions (history included), the active meal templates,
-- targets, the plan's AI-built grocery and prep rows, and the list-build records. Keeps everything the user logged
-- (food entries, eaten meals, workouts, weights, photos), their own grocery/prep rows, and ticked rows.
-- SECURITY INVOKER: every statement runs under the caller's RLS, so it can only touch the caller's rows.
create or replace function public.reset_plan(p_local_date date, p_week_start date)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user uuid := auth.uid();
  v_plans integer;
  v_templates integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  -- Planned (not yet eaten) meals from today on go; eaten meals stay as history.
  delete from public.daily_meals
  where user_id = v_user and local_date >= p_local_date and status = 'planned';

  update public.meal_templates set is_active = false where user_id = v_user and is_active = true;
  get diagnostics v_templates = row_count;

  -- Unticked AI rows go. Ticked ones stay, as the user's own.
  delete from public.grocery_items
  where user_id = v_user and source_version_id is not null and not is_purchased and week_start >= p_week_start;
  delete from public.prep_tasks
  where user_id = v_user and source_version_id is not null and not is_completed and local_date >= p_local_date;

  delete from public.list_generations where user_id = v_user;
  delete from public.daily_targets where user_id = v_user and local_date >= p_local_date;
  update public.user_settings
  set calorie_target = null, protein_target_g = null, carbs_target_g = null, fat_target_g = null,
      fiber_target_g = null, water_target_ml = null, updated_at = now()
  where user_id = v_user;

  -- Deleting the versions sets source_version_id to null on the remaining (ticked or older) rows.
  delete from public.ai_plan_versions where user_id = v_user;
  get diagnostics v_plans = row_count;

  return jsonb_build_object('plans_deleted', v_plans, 'meal_templates_deactivated', v_templates);
end;
$function$;

revoke all on function public.reset_plan(date, date) from public, anon;
grant execute on function public.reset_plan(date, date) to authenticated;
