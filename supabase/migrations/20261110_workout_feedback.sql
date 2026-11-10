-- THE CUT dynamic training: per-exercise feedback after a workout, and the AI review of each session
-- (analysis + exact before/after of the training week so the change can be undone). Additive only.

create table if not exists public.workout_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workout_session_id uuid not null references public.workout_sessions(id) on delete cascade,
  exercise_name text not null check (char_length(exercise_name) between 1 and 60),
  rating text check (rating in ('too_easy', 'just_right', 'too_hard')),
  issues text[] not null default '{}',
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists workout_feedback_user_created_idx on public.workout_feedback (user_id, created_at desc);
create index if not exists workout_feedback_session_idx on public.workout_feedback (workout_session_id);

create table if not exists public.workout_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workout_session_id uuid references public.workout_sessions(id) on delete set null,
  headline text not null,
  analysis text not null,
  issues jsonb not null default '[]'::jsonb,
  change_notes jsonb not null default '[]'::jsonb,
  prev_week jsonb,
  new_week jsonb,
  model text,
  undone_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists workout_reviews_user_created_idx on public.workout_reviews (user_id, created_at desc);
create index if not exists workout_reviews_session_idx on public.workout_reviews (workout_session_id);

alter table public.workout_feedback enable row level security;
alter table public.workout_reviews enable row level security;

drop policy if exists workout_feedback_select_own on public.workout_feedback;
drop policy if exists workout_feedback_insert_own on public.workout_feedback;
drop policy if exists workout_feedback_delete_own on public.workout_feedback;
create policy workout_feedback_select_own on public.workout_feedback for select to authenticated using (user_id = (select auth.uid()));
create policy workout_feedback_insert_own on public.workout_feedback for insert to authenticated with check (user_id = (select auth.uid()));
create policy workout_feedback_delete_own on public.workout_feedback for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists workout_reviews_select_own on public.workout_reviews;
drop policy if exists workout_reviews_insert_own on public.workout_reviews;
drop policy if exists workout_reviews_update_own on public.workout_reviews;
drop policy if exists workout_reviews_delete_own on public.workout_reviews;
create policy workout_reviews_select_own on public.workout_reviews for select to authenticated using (user_id = (select auth.uid()));
create policy workout_reviews_insert_own on public.workout_reviews for insert to authenticated with check (user_id = (select auth.uid()));
create policy workout_reviews_update_own on public.workout_reviews for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy workout_reviews_delete_own on public.workout_reviews for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.workout_feedback from anon;
revoke all on public.workout_reviews from anon;
grant select, insert, delete on public.workout_feedback to authenticated;
grant select, insert, update, delete on public.workout_reviews to authenticated;
