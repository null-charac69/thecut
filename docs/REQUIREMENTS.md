# THE CUT — Requirements Specification & Progress Tracker

| | |
|---|---|
| **Product** | THE CUT — personal nutrition, training and transformation tracker with an AI planner and a live coach |
| **Document** | `docs/REQUIREMENTS.md` |
| **Version** | 1.5 |
| **Date** | 2026-11-10 |
| **Baseline** | `main` @ `b5c1e86` (dynamic workouts: per-exercise feedback and AI session review; previous baselines `f8db945`, `81677d8`); production: https://the-cut-tracker.vercel.app |
| **Owner** | Anant Kumar Thakur |
| **Status** | Living document. Update the status column in the same pull request that changes behaviour. |

---

## 1. Purpose and scope

This document is the single register of what THE CUT **is required to do**, **already does**, and **does not yet do**. It was built from the deployed code (`src/index.html`, `supabase/functions/*`, `supabase/migrations/*`), the live Supabase project and the Vercel project as of the baseline above. Nothing here is aspirational: every requirement marked **Done** or **Partial** points at the place it lives. Items that are open, skipped or removed are listed in sections 10–13.

It serves two purposes:

1. **Tracker.** Every requirement has an ID, priority and status, so progress is measurable.
2. **Database of capability.** Main flows carry user stories and Given/When/Then acceptance criteria (section 6) so behaviour can be re-tested.

### 1.1 Status legend

| Status | Meaning |
|---|---|
| **Done** | Implemented, deployed on production, and reachable by a user (or enforced server-side). |
| **Partial** | Implemented in part, or implemented in code/backend but with no reachable user interface. The gap is stated in the Evidence column. |
| **Planned** | Agreed but not built. (None at this baseline; see section 10 for open items.) |
| **Skipped** | Deliberately not done, usually because it needs a paid plan or a manual dashboard action. See section 11. |
| **Removed** | Existed earlier and was deliberately taken out. See section 12. |

### 1.2 Priority legend

| Priority | Meaning |
|---|---|
| **P0** | Product cannot function or user data is at risk without it. |
| **P1** | Core user value. |
| **P2** | Supporting or quality-of-life. |

### 1.3 Reading the Evidence column

Evidence names a function in `src/index.html`, a file or edge function, or a database object. Function names are stable; line numbers are deliberately not used.

---

## 2. Product overview

THE CUT is a single-user-per-account web app. A new user signs up, verifies their email, completes an AI intake, reviews an AI-generated plan (nutrition targets, meals, groceries, prep tasks, training week) and applies it. Only then do the daily tabs unlock. Day to day the user ticks meals, logs extras, logs weight, runs live workouts and ticks groceries. A database-driven coach watches the logs and raises insights; an LLM adds weekly reviews, plan-edit review and a chat. **The AI never changes a plan silently: plan refinements and post-workout training adjustments are applied automatically, always show exactly what changed, and can be undone.**

### 2.1 Primary navigation

| Tab | Id | Purpose |
|---|---|---|
| Plan | `ai` | AI planner: intake and refine only; output lands in Meals, Workout, Prep; plan history in Account |
| Meals | `meals` | Today's meals from the active plan, extras, plan-vs-actual |
| Workout | `workout` | Live workout logger, session history, weekly training plan editor |
| Weight | `weight` | Weigh-ins, trend, history |
| Coach | `coach` | Insights feed, weekly review, coach chat |
| Prep & Grocery | `prep` | Weekly grocery list and daily meal-prep tasks |
| Account (via avatar menu, not in nav) | `account` | Profile, change email/password, export data, delete account |

Legacy tab names (`overview`, `nutrition`, `habits`, `training`, `progress`, `planning`, `analytics`, `settings`) are redirected to the tabs above by `LEGACY_TABS`.

---

## 3. System architecture and inventory

### 3.1 Technology stack

| Layer | Technology |
|---|---|
| Frontend | Static ES modules, no build step: `src/index.html` (shell), `src/app.js` (app, top-level `await`), `src/styles.css`, `src/lib/{format,workout,errors}.js` (pure helpers); `@supabase/supabase-js` loaded from `esm.sh` |
| Hosting | Vercel project `the-cut-tracker`, Root Directory `src`; `main` auto-deploys production; branches get preview deployments |
| Backend | Supabase project `the-cut-cloud` (`ukyobppectpjkcudgewy`, ap-south-1): Postgres + RLS, Auth, Realtime, Storage, Edge Functions (Deno), `pg_cron` |
| AI | Edge function `the-cut-ai` → provider-agnostic OpenAI-compatible adapter (`llm.ts`); current provider AWS Bedrock with SigV4 signing; model `DeepSeek V3.2` (configured by secrets `LLM_BASE_URL`, `LLM_MODEL`, `LLM_MODEL_FAST`, `LLM_AWS_*`) |
| Source control | GitHub `null-charac69/thecut` |

### 3.2 Deployed components

| Component | Version / state | Auth | Source in repo |
|---|---|---|---|
| Web app (`index.html`, `app.js`, `styles.css`, `lib/`, `manifest.webmanifest`, `icons/`, `sw.js`, favicons) | production on `main` | — | yes |
| Throwaway test users `rls-test-a@thecut.invalid`, `rls-test-b@thecut.invalid` | exist in production Auth (used by API/e2e tests) | password sign-in | no (database only) |
| `src/vercel.json` (security headers, CSP, cache rules) | production | — | yes |
| Edge function `the-cut-ai` | v53, ACTIVE (adds `workout.ts`) | `verify_jwt` true | yes |
| Edge function `delete-account` | v1, ACTIVE | `verify_jwt` true (service role inside) | yes |
| Edge function `the-cut-push-dispatch` | v41, ACTIVE | `verify_jwt` false; guarded by a secret header | **no** (deployed only) |
| Edge functions `the-cut-auth-smoke-qa`, `the-cut-ai-smoke-qa`, `cut-test-provision` | ACTIVE stubs from QA | `verify_jwt` false | **no** — pending deletion (OI-04) |
| `pg_cron` job `the-cut-push-dispatch` | every minute | — | no (database only) |
| Storage bucket `progress-photos` | private | RLS on `storage.objects` | no (database only) |
| Migrations `20261108_agent_layer.sql`, `20261109_coach_sync.sql`, `20261110_workout_feedback.sql` | applied | — | yes |

### 3.3 Environment configuration

| Item | Where | Notes |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Vercel env | Publishable key only; no service-role key in the frontend |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_MODEL_FAST`, `LLM_AWS_ACCESS_KEY_ID`, `LLM_AWS_SECRET_ACCESS_KEY`, `LLM_AWS_REGION` | Supabase edge secrets | Optional `LLM_API_KEY`, `LLM_FALLBACK_*` for a fallback provider |
| Web Push configuration | Database function `get_the_cut_push_config` + push dispatch secrets | Used by `the-cut-push-dispatch` |
| Time zone | Hard-coded `Asia/Kolkata` in `today()` and reminders | See KL-01 |

---

## 4. Functional requirements

Evidence abbreviations: **FE** = `src/index.html`; **EF** = edge function; **DB** = Supabase database.

### 4.1 Authentication and session (AUTH)

| ID | Requirement | Pri | Status | Evidence |
|---|---|---|---|---|
| AUTH-01 | Users can sign up with email and password | P0 | Done | FE `renderAuthV2`; Supabase Auth |
| AUTH-02 | Email confirmation is required before first sign-in; a "check your inbox" dialog is shown after sign-up | P0 | Done | Auth setting "Confirm email" ON; FE `showVerifyModal` |
| AUTH-03 | Sign-up with an already-registered email is detected and reported | P1 | Done | FE sign-up handler (`identities.length===0` check) |
| AUTH-04 | Users can sign in with email and password | P0 | Done | FE `renderAuthV2` |
| AUTH-05 | Wrong credentials, unconfirmed email, rate limit, weak password and network failures show a modal dialog with a plain-language message | P0 | Done | FE `authError`, `friendlyError`, `uiModal` |
| AUTH-06 | Password field has a show/hide toggle | P2 | Done | FE `#pwToggle` |
| AUTH-07 | Forgot password sends a reset email; the reset link opens a "Set a new password" screen with confirm field | P0 | Done | FE `authForgot`, `renderPasswordRecovery` |
| AUTH-08 | New password minimum length is 8 on the client | P1 | Done | FE `renderPasswordRecovery` (`minlength=8`) |
| AUTH-09 | Server-side minimum password length is 8 | P1 | Partial | Server still enforces 6 (OI-02) |
| AUTH-10 | Sign out is an explicit action in the avatar menu and returns to the sign-in screen | P0 | Done | FE `logout` |
| AUTH-11 | An unexpected sign-out (expired or revoked session) shows a "Session expired" dialog instead of failing silently | P1 | Done | FE `_manualSignOut` flag + auth state handler |
| AUTH-12 | The session persists across reloads and is refreshed automatically | P0 | Done | `supabase-js` session handling; FE bootstrap |
| AUTH-13 | A profile row and a settings row are created automatically for each new user | P0 | Done | DB trigger `on_auth_user_created` → `handle_new_user` |
| AUTH-14 | Leaked-password (HIBP) protection | P2 | Skipped | Supabase Pro feature (section 11) |

### 4.2 AI planner (PLAN)

| ID | Requirement | Pri | Status | Evidence |
|---|---|---|---|---|
| PLAN-01 | The Plan tab is the first tab. All other tabs are locked (🔒) until the user has at least one plan version; locked tabs redirect to Plan | P0 | Done | FE `NAV_ITEMS`, `navBtn`, `render` (`aiUnlocked`) |
| PLAN-02 | Intake form captures: age (18+), sex for energy estimate, height, weight, target weight, goal, activity level, training experience, training days/week, training access, diet, meals per day, daily budget (₹), cooking minutes, location, timeline (weeks), allergies, liked foods, cuisines, other constraints | P0 | Done | FE `aiPlannerPage` |
| PLAN-03 | Goal options: fat loss, muscle gain, recomposition, maintain, general fitness | P1 | Done | FE `aiPlannerPage` |
| PLAN-04 | Diet options: omnivore, eggetarian, vegetarian, vegan; meals per day 2–6 | P1 | Done | FE `aiPlannerPage` |
| PLAN-05 | The user must confirm they are 18+ and that output is general wellness information, not medical advice | P0 | Done | FE adult checkbox (`required`); EF `validateProfile` |
| PLAN-06 | Server validates the profile: adult, height 120–230 cm, weight 30–350 kg, training days an integer 0–7; free text is truncated to 500 characters per field | P0 | Done | EF `plan.ts` `validateProfile`, `cleanProfile` |
| PLAN-07 | "Generate my AI plan" creates a plan containing: title, summary, rationale, assumptions, safety notes, estimated daily cost (₹), targets (kcal, protein, carbs, fat, fibre, water), 2–6 meals with items and macros, grocery list, prep tasks, training week | P0 | Done | EF `the-cut-ai` action `generate`; FE `generateAIPlan` |
| PLAN-08 | Generated plans are validated and normalised server-side: calorie floor 1,200 kcal, ceiling 6,000 kcal, macro/calorie consistency, minimum protein (1.2 g/kg fat loss, 0.8 g/kg otherwise) | P0 | Done | EF `plan.ts` `normalizePlan`, `qualityChecks` |
| PLAN-09 | A plan that fails quality checks gets one corrective retry; if it still fails the user sees a safety-check error and nothing is saved | P1 | Done | EF `runPlan`; returns 422 |
| PLAN-10 | AI output is saved as a version, then **applied automatically**; Undo toast and "Undo last change" restore the previous plan; coach-proposed drafts still wait for Apply | P0 | Done | FE `saveAIDraft`; DB `ai_plan_versions.status` |
| PLAN-11 | On-page plan review (targets, reasoning, meals, groceries, prep, training week) | P1 | Removed | Superseded by PLAN-20 and the tabs themselves; `aiPlanCard` deleted |
| PLAN-12 | Plans from the Coach (drafts) still need an explicit "Apply to my workspace" with confirmation; the RPC atomically activates the plan (targets, meal templates, groceries, prep tasks, training week) | P0 | Done | FE `applyAIPlan` + `uiConfirm`; DB RPC `apply_ai_plan_version` |
| PLAN-13 | Profile stays editable; submitting edits analyses the change against the previous plan and applies the revised plan | P1 | Done | FE `describeAIProfileChanges`, `buildAIEditInstruction`, `updateAIEditPreview`, action `refine` |
| PLAN-14 | "Refine plan": free-text instruction produces a revised plan that is applied automatically; refinement keeps calories within 20% of the accepted plan unless the instruction requires more, never below 1,200 kcal | P1 | Done | FE `refineAIPlan`; EF action `refine`, `qualityChecks` |
| PLAN-15 | "Generate a fresh plan" creates a new plan independent of the current one | P2 | Done | FE `generateFreshAIPlan` |
| PLAN-16 | Plan history is listed in Account with Restore on any older version; the Plan page offers "Undo last change" | P1 | Done | FE `accountV3` ("Plan history"), `aiPlanStatusCard`, `loadPlanHistory` |
| PLAN-17 | Refinement uses the user's live plan (including direct edits) as the base | P1 | Done | EF `liveState`, `baselineRow` |
| PLAN-18 | Prompt-injection hardening: user data is passed inside `<user_data>` and the model is told to treat it as data | P0 | Done | EF `SYSTEM` prompt |
| PLAN-19 | Plan generation is attributed to a prompt version (`the-cut-plan-v2`) | P2 | Done | EF `plan.ts` `PROMPT_VERSION` |
| PLAN-20 | After a plan is applied, Meals shows a dismissible "What changed" card: the AI's one-line reason plus a diff (targets, meals added/removed, per-meal kcal, groceries, training week) and "Undo this change" | P1 | Done | FE `planChangeCard`, `lastPlanChange`; `src/lib/plandiff.js` + unit tests |
| PLAN-21 | Generation/refine shows progress that survives tab changes: shimmering button and a floating status pill with rotating messages; the user stays on the tab they moved to | P2 | Done | FE `setAIProgress`, `#aiProg` |
| PLAN-22 | Plan page is input only: status card (active plan, draft waiting, undo), collapsed "Your details" with Edit, compact refine box | P1 | Done | FE `aiPlannerPage`, `aiPlanStatusCard`, `foldCard` |
| PLAN-23 | Generate and Refine apply the plan immediately (no review step); Undo toast (9 s) restores the previous plan | P1 | Done | FE `saveAIDraft` → `applyAIPlan({auto:true})`, `toastUndo` |
| PLAN-24 | The Refine box keeps its text and its running state when the user switches tabs, switches apps on a phone or reloads: the text is never lost, a running request repaints as busy, and after a reload an interrupted request shows a note instead of an empty box | P1 | Done | FE `rf`, `rfEnsure`, `rfPaint`, `rfBusy`, `runAIPlanRequest`; storage key `cut_refine_<uid>` (cleared on logout) |

### 4.3 AI service (AISVC)

| ID | Requirement | Pri | Status | Evidence |
|---|---|---|---|---|
| AISVC-01 | A single JWT-protected endpoint serves all AI actions: `generate`, `refine`, `review`, `assess`, `chat`, `workout_review`; unknown actions return 400 | P0 | Done | EF `the-cut-ai` (`verify_jwt` true) |
| AISVC-02 | The provider is swappable by secrets only (any OpenAI-compatible endpoint) | P1 | Done | EF `llm.ts`; `docs/ARCHITECTURE.md` |
| AISVC-03 | AWS Bedrock is supported without an API key through SigV4 request signing | P1 | Done | EF `llm.ts` (`AwsClient`, service `bedrock`) |
| AISVC-04 | Optional fallback provider is tried after the primary fails | P2 | Done | EF `llm.ts` (`LLM_FALLBACK_*`) |
| AISVC-05 | One retry on rate limit (wait ≤ 15 s) and one retry on malformed JSON; 100 s request timeout | P1 | Done | EF `llm.ts` |
| AISVC-06 | Only aggregated data is sent to the LLM provider | P0 | Done | `docs/ARCHITECTURE.md`; EF summary builders |
| AISVC-07 | The caller's own data is read through their JWT, so database RLS applies to every AI read | P0 | Done | EF `createClient` with user's Authorization header |
| AISVC-08 | AI request failures surface as a readable error toast or dialog | P1 | Done | FE `callAIPlanner`, `fail` |

### 4.4 Coach (COACH)

| ID | Requirement | Pri | Status | Evidence |
|---|---|---|---|---|
| COACH-01 | Deterministic coach rules run in Postgres and write one insight per user/kind/day | P0 | Done | DB `agent_scan`, `agent_put`; `agent_insights` unique key |
| COACH-02 | Rules: tracking gap; protein and calories vs plan (7-day); skipped meals; hydration; training sessions vs plan; 14-day weight trend vs goal; recovery (low energy/sleep) | P1 | Done | DB `agent_scan`; `docs/AGENT.md` |
| COACH-03 | Rules fire automatically on writes to food entries, water logs, body measurements, workout sessions, check-ins, daily meals and plan versions; trigger errors never block the user's write | P0 | Done | DB triggers `trg_agent_*` |
| COACH-04 | Missing data is treated as unknown, never zero | P1 | Done | `docs/ARCHITECTURE.md`; DB rules |
| COACH-05 | Insights stream live to the browser; the bell shows an unread count and opens a "Coach notes" dropdown (latest 5, unread dots, Open Coach) | P1 | Done | Realtime on `agent_insights`; FE `subscribeInsights`, `onInsightChange`, `openBellMenu`, `bellHTML` |
| COACH-06 | Insights can be marked read and dismissed | P2 | Done | FE `markInsightsRead`, `dismissInsight` |
| COACH-07 | "Review my week" produces an LLM summary (headline, summary, suggestions) | P1 | Done | FE `reviewWeek`; EF action `review`; DB `agent_week_summary` |
| COACH-08 | A review can offer "Draft a plan update from this", which creates a draft needing approval | P1 | Done | FE `refineFromReview` |
| COACH-09 | Direct edits to targets, meal templates or the training week are reviewed by the coach after a 20 s debounce and once on load | P1 | Done | FE `scheduleAssess`, `runAssess`; EF action `assess` |
| COACH-10 | Review outcome **ok** acknowledges the new baseline; **concern** raises an insight with three options: accept AI refinement, keep my version, discuss with AI | P1 | Done | FE `acceptRefinement`, `keepMyVersion`, `discussEdit`; DB `agent_ack_state` |
| COACH-11 | Deterministic guards on edits: 1,200 kcal floor; meals vs target gap > 20% (only if new since baseline) | P1 | Done | EF `assess` |
| COACH-12 | Coach chat is a tool-using loop (max 8 steps) with tools `get_live_plan`, `get_profile`, `get_plan_changes`, `get_week_summary`, `get_recent_logs`, `propose_plan_update` (draft only), `keep_my_version` | P1 | Done | EF `chat`; FE `sendChat`, `coachChatHtml` |
| COACH-13 | Chat-proposed plan changes appear as a draft with a "Review the draft plan" button | P1 | Done | FE `openDraft` |
| COACH-14 | The coach always reads the live plan (settings targets + active meal templates + active training week), with a stored baseline of what it last acknowledged | P0 | Done | DB `agent_plan_state`, `agent_baseline`; migration `20261109_coach_sync.sql` |
| COACH-15 | Plan changes raise insights (draft ready, plan applied with target diff) | P2 | Done | DB `agent_plan_trigger`; `docs/AGENT.md` |
| COACH-16 | Coach page shows an empty-state message when nothing is flagged; shows a "not enabled" message when the feed is off | P2 | Done | FE `coachPanel` |
| COACH-17 | A user can run the scan on demand | P2 | Partial | DB RPC `agent_scan_me` exists; the frontend never calls it |

### 4.5 Meals (MEAL)

| ID | Requirement | Pri | Status | Evidence |
|---|---|---|---|---|
| MEAL-01 | Meals tab shows today's meals created from the active plan's meal templates, with time and components | P0 | Done | FE `mealsV3`, `mealRows`, `ensureDay` |
| MEAL-02 | Each meal can be ticked complete / untick | P0 | Done | FE `toggleMeal`; DB `daily_meals.status` |
| MEAL-03 | "Today vs your plan" shows calories and protein against plan targets | P1 | Done | FE `mealsV3` (`bar3`), `totals` |
| MEAL-04 | Users can log an extra food (name, calories, protein) | P1 | Done | FE `saveFood`; DB `food_entries` |
| MEAL-05 | Extras are listed and can be deleted after confirmation | P1 | Done | FE `deleteFood` + `uiConfirm` |
| MEAL-06 | A past day can be viewed with the date selector; future dates are blocked (`max=today`) | P1 | Done | FE `header`, `changeDate` |
| MEAL-07 | "+ Add a meal" creates a new meal template (name, time, calories, protein, components) | P2 | Partial | FE `addMealTemplate` works but collects input with browser `prompt()` boxes (OI-05) |
| MEAL-08 | Edit / delete a meal template | P2 | Removed | Removed in v1.5: the edit/delete buttons were only on a retired tab. Code deleted; templates are replaced when a plan is applied |
| MEAL-09 | Food catalog (saved foods with per-serving values) | P2 | Removed | Removed in v1.5: no screen existed, so the unreachable code was deleted. The database table is kept. |
| MEAL-10 | Water log (add/delete entries) | P2 | Removed | Removed in v1.5: no screen existed, so the unreachable code was deleted. The database table is kept. |
| MEAL-11 | Daily check-in (sleep/energy) and daily activity | P2 | Removed | Removed in v1.5: no screen existed, so the unreachable code was deleted. The database table is kept. |

### 4.6 Workout (WORK)

| ID | Requirement | Pri | Status | Evidence |
|---|---|---|---|---|
| WORK-01 | Workout tab shows today's planned session (matched by weekday) with its exercises, or "No session planned today" | P1 | Done | FE `todaySession`, `wkStartView` |
| WORK-02 | Other sessions in the plan can be started on any day; an empty workout can be started | P1 | Done | FE `planSessions`, `wkBegin` |
| WORK-03 | Rest/recovery/mobility days are excluded from startable sessions | P2 | Done | FE `planSessions` (regex) |
| WORK-04 | Plan exercise strings are parsed into name, sets (1–8) and reps | P1 | Done | FE `parsePlanExercise` |
| WORK-05 | Live logger: per-set weight and reps, tick to complete, add/remove sets, add exercises (with autocomplete from plan and history), remove exercise | P0 | Done | FE `wkLive`, `wireWk`, `wkMakeEx` |
| WORK-06 | Previous performance ("Last time") is shown per exercise and used to pre-fill sets | P1 | Done | FE `loadWkHistory`, `wkMakeEx` |
| WORK-07 | New personal record detection by estimated 1RM (Epley) with a PR badge and toast | P2 | Done | FE `e1rm`, `wkToggle` |
| WORK-08 | Rest timer with 60/90/120/180 s presets, +15 s, skip, vibration on completion | P2 | Done | FE `wkRestDefault`, `wkTickFn` |
| WORK-09 | Elapsed clock, set count, running volume and progress bar | P2 | Done | FE `wkLive`, `volOf` |
| WORK-10 | An in-progress workout survives reload/close (device storage, valid for 18 h) | P1 | Done | FE `wkSave`, `wkLoadDraft` (`cut_wk_<uid>`) |
| WORK-11 | Finish dialog: duration, sets, volume, PRs, effort 1–10, notes; requires at least one completed set | P1 | Done | FE `wkFinishModal` |
| WORK-12 | Saving persists session, exercises and sets; if exercise/set insert fails the session is rolled back | P0 | Done | FE `wkPersist` |
| WORK-13 | Discard workout and remove-exercise (with logged sets) ask for confirmation | P1 | Done | FE `uiConfirm` in `wireWk` |
| WORK-14 | Recent sessions (last 8) are listed with date, duration, volume, effort and every set; sessions can be deleted after confirmation | P1 | Done | FE `wkStartView`, `deleteRow` |
| WORK-15 | Weekly training plan can be edited as text (`Day | Focus | minutes | exercises`) and saved; the change is reviewed by the coach | P1 | Done | FE `trainingWeekEditor`, `saveTrainingWeek`; DB RPC `save_training_week` |
| WORK-16 | Edit an already-saved session (title, duration, exercises) | P2 | Removed | Removed in v1.5: the edit entry point only existed on a retired tab. Code deleted |
| WORK-17 | After saving a workout, a popup walks through each exercise with quick feedback: too easy / just right / too hard, issue chips (joint or muscle pain, form, missed reps, tired, equipment, time, dislike) and an optional note. Every step is skippable, and unfinished feedback survives a reload (24 h) | P1 | Done | FE `fbStart`, `fbRender`, `fbResume` (`cut_wkfb_<uid>`); DB `workout_feedback` |
| WORK-18 | The finished session, feedback, recent history of the same lifts and the live training week go to the AI (`workout_review`), which explains how the session went, lists issues and proposes a revised week | P1 | Done | EF `workoutReview`; `workout.ts` (prompt version `the-cut-workout-v1`) |
| WORK-19 | The revised week is validated server-side (same days and order, rest days untouched, session length within 30%, 1–10 exercises, at most 8 sets) and then auto-applied to the active plan's training week; the user sees the exact differences and can Undo while the week is unchanged | P1 | Done | EF `normalizeWeek`; FE `applyWorkoutReview`, `undoWorkoutReview`; DB `workout_reviews`, `save_training_week` |
| WORK-20 | AI load targets in plan exercise strings (`Bench Press 3x8 @ 62.5 kg`) pre-fill the sets and show as the coach target; plan reps win over last time's reps | P2 | Done | FE `planTargetKg`, `wkMakeEx` |

### 4.7 Weight (WGT)

| ID | Requirement | Pri | Status | Evidence |
|---|---|---|---|---|
| WGT-01 | Metrics: current weight, change since first weigh-in, goal and distance to goal | P1 | Done | FE `weightV3`, `metric` |
| WGT-02 | Trend chart of the last 60 weigh-ins with a dashed goal line; message when fewer than 2 entries | P1 | Done | FE `spark` |
| WGT-03 | Log weight with a date (not in the future); weight must be 20–500 kg | P0 | Done | FE `saveWeightV3` |
| WGT-04 | Logging the same date again replaces that day's entry | P1 | Done | FE `saveWeightV3` |
| WGT-05 | History lists the latest 12 entries; entries can be deleted after confirmation | P1 | Done | FE `weightV3`, `deleteRow` |
| WGT-06 | Body fat %, notes and other body measurements | P2 | Partial | DB columns kept; only weight is exposed in the UI. Unreachable edit helpers deleted in v1.5 |
| WGT-07 | Progress photos upload / list / delete, stored in the private bucket | P2 | Removed | Removed in v1.5: no screen existed, so the unreachable code was deleted. The database table is kept. |

### 4.8 Prep & Grocery (PREP)

| ID | Requirement | Pri | Status | Evidence |
|---|---|---|---|---|
| PREP-01 | Weekly grocery list (from the applied plan) grouped by Protein / Dairy / Produce / Pantry with per-category counts | P1 | Done | FE `prepV3`, `loadGroceries`; DB `grocery_items` |
| PREP-02 | Tick items purchased; add an item with quantity; remove an item | P1 | Done | FE `addGroceryV2`, `updateGrocery`, `deleteRow` |
| PREP-03 | Daily meal-prep tasks: tick, add, remove | P1 | Done | FE `addPrep`, `updatePrep`, `deleteRow`; DB `prep_tasks` |
| PREP-04 | Segmented switch between Groceries and Meal prep with done counts | P2 | Done | FE `prepView` |
| PREP-05 | Items added manually default to the Produce category | P2 | Done | FE hidden `category` field |

### 4.9 Account, data export and deletion (ACCT)

| ID | Requirement | Pri | Status | Evidence |
|---|---|---|---|---|
| ACCT-01 | Header avatar opens a menu (Account, Sign out) and does not sign the user out by itself | P0 | Done | FE `accountV3`, `openAcctMenu`, `closeAcctMenu` (outside click, Esc) |
| ACCT-02 | Account page shows avatar initial, display name, email, member-since date and current plan; reachable before the first plan exists | P1 | Done | FE `accountV3`; `render`/`gotoTab` allow `account` |
| ACCT-02a | Display name can be edited and saved | P2 | Done | FE `accountV3` (`#acctForm`) |
| ACCT-03 | Change email: new address is entered and a confirmation is sent (secure email change: both addresses confirm) | P1 | Done | FE `changeEmailFlow`; Auth "Secure email change" ON |
| ACCT-04 | Change password: sends a reset link to the signed-in user's email | P1 | Done | FE `authForgotSignedIn` |
| ACCT-05 | Export my data as a JSON file covering profile and 24 user tables (settings, foods, meal templates and items, targets, daily meals, food entries, check-ins, measurements, photo records, workouts/exercises/sets, workout feedback and AI session reviews, activity, water, groceries, prep, reminders, push deliveries, AI plan versions, coach insights and baseline) | P1 | Done | FE `exportData` |
| ACCT-06 | Delete account: dialog requires typing `DELETE`, offers "Download my data first", then wipes the account | P0 | Done | FE `deleteAccountFlow` |
| ACCT-07 | Deletion removes all stored progress-photo files and the auth user; every table row is removed by `ON DELETE CASCADE` from `auth.users` | P0 | Done | EF `delete-account` v1; DB foreign keys; wipe verified with a throwaway user |
| ACCT-08 | The deletion endpoint accepts only the caller's own valid JWT and a body of `{confirm:"DELETE"}` | P0 | Done | EF `delete-account` |
| ACCT-09 | After deletion the user is signed out and returned to sign-in | P1 | Done | FE `deleteAccountFlow` |

### 4.10 UX feedback layer (UX)

| ID | Requirement | Pri | Status | Evidence |
|---|---|---|---|---|
| UX-01 | Accessible modal dialog (`role=dialog`, focus trap/return, Esc) used for errors and confirmations | P1 | Done | FE `uiModal`, `_modalOpener` |
| UX-02 | Styled confirmation dialog with a danger style for destructive actions | P1 | Done | FE `uiConfirm` |
| UX-03 | Destructive confirmations converted to styled dialogs: apply plan, discard workout, remove exercise, deletes of food, workout, weight, photo, grocery, prep, reminder | P1 | Done | FE `uiConfirm` call sites |
| UX-04 | Error toast (red, 6 s, `role=alert`) for save/network failures via one `fail()` helper | P1 | Done | FE `fail`, `toast(msg,kind)` |
| UX-05 | Technical errors are translated into plain language | P1 | Done | FE `friendlyError` |
| UX-06 | Persistent offline banner while the browser is offline; auth and AI actions are pre-checked | P1 | Done | FE `#offlineBar`, offline pre-check in auth |
| UX-07 | Unhandled promise rejections are caught and surfaced instead of failing silently | P2 | Done | FE `unhandledrejection` handler |
| UX-08 | Form labels are linked to inputs automatically | P2 | Done | FE label-linking `MutationObserver` |
| UX-09 | Auth message region is announced to screen readers (`role=status`, `aria-live=polite`) | P2 | Done | FE auth form |
| UX-10 | Mobile: 16 px inputs (no iOS zoom), 44 px tap targets, six-slot bottom tab bar (no scrolling) with lock icons | P2 | Done | FE CSS "Mobile-first consolidation" block; `.mobilebar` |
| UX-11 | Reduced-motion preference is respected | P2 | Done | FE CSS |
| UX-12 | First-login app tour with a "? Tour" replay button | P2 | Removed | Removed in v1.5: tour code, button and styles deleted (RM-06) |
| UX-13 | Loading states for pages and buttons ("Loading…", "Saving…", "Thinking…") | P2 | Done | FE `render`, `wkSaveBtn`, `coachChatBusy` |
| UX-14 | Empty states on every list (no weigh-ins, no groceries, no sessions, etc.) | P2 | Done | FE `.empty` blocks |
| UX-15 | Edit flows for meal templates, extras, catalog foods and saved sessions use native `prompt()` boxes | P2 | Done | "+ Add a meal" now uses an accessible modal form (`uiForm`: labels, validation, inline errors, Escape to cancel, no double submit). No native `prompt()` remains (OI-05) |
| UX-16 | Mobile layout: single consolidated block at the end of `styles.css` replaces the stacked legacy rules; compact sticky top bar (date nav, bell, avatar), tighter page rhythm, 2-line subtitle clamp, Meals ordered progress → meals → extras | P1 | Done | FE CSS; verified at 390×844 in Chrome mobile mode with mocked Supabase, not on a physical device |
| UX-17 | Tabs without a date picker show the logo mark and page title in the top bar on phones | P2 | Done | FE CSS `.topbar.nodate .crumb` |

### 4.11 Reminders and push notifications (PUSH)

| ID | Requirement | Pri | Status | Evidence |
|---|---|---|---|---|
| PUSH-01 | Service worker displays push notifications and focuses/opens the app on click | P2 | Done | `src/sw.js` |
| PUSH-02 | A scheduled job runs every minute and dispatches due reminders to subscribed devices | P2 | Done | `pg_cron` job; EF `the-cut-push-dispatch` v41 (secret-header guarded) |
| PUSH-03 | Reminders (title, type water/meal/other, time, repeat daily/weekdays/weekend) and push subscriptions are stored per user with RLS | P2 | Done | DB `reminders`, `push_subscriptions`, `push_notification_deliveries` |
| PUSH-04 | In-app creation, toggle and deletion of reminders; enabling/disabling push on this device | P2 | Removed | Removed in v1.5: no reachable screen. Server-side push (PUSH-02) and the service-worker handler remain |
| PUSH-05 | In-page reminder check every 30 s when notification permission is granted | P2 | Removed | Removed in v1.5: unused in-page reminder loop deleted (OI-13) |
| PUSH-06 | Push is cleared for the device on sign-out | P2 | Done | FE `clearPushForCurrentUser` |

### 4.12 Installable app / PWA (PWA)

| ID | Requirement | Pri | Status | Evidence |
|---|---|---|---|---|
| PWA-01 | Web app manifest (name, short name, standalone display, portrait, theme/background colours, start URL, scope, categories) | P2 | Done | `src/manifest.webmanifest`; linked from `index.html` |
| PWA-02 | Icons 192 and 512 (any) and 512 maskable, generated from the favicon | P2 | Done | `src/icons/` |
| PWA-03 | Install-meta tags for mobile (`mobile-web-app-capable`, Apple title) and cache headers for manifest and icons | P2 | Done | `src/index.html`, `src/vercel.json` |
| PWA-04 | Installable from Chrome on Android ("Install app") | P2 | Partial | Served and valid on production; not yet tried on a physical device (OI-15) |
| PWA-05 | Google Play listing / signed APK or AAB | P2 | Skipped | Needs the $25 Play developer account; an APK could not be built in the workspace (section 11) |

### 4.13 Quality assurance (QA)

| ID | Requirement | Pri | Status | Evidence |
|---|---|---|---|---|
| QA-01 | Unit tests for pure logic, plan validation and workout-review validation (36 tests, all passing) | P1 | Done | `tests/unit/*.test.mjs`; `npm run test:unit` |
| QA-02 | API/RLS tests: cross-user read/update/delete/insert/reassign blocked, anon sees nothing, plan RPC and storage isolated, edge functions reject bad calls; includes `workout_feedback` and `workout_reviews` (67 tests collected) | P1 | Partial | `tests/api/`; expected results confirmed manually against production; the suite itself could not be run from the workspace (no network) (OI-13) |
| QA-03 | Browser tests (assets, headers, sign-in, plan gate, Account page, delete-dialog guard and signed-in flows against a faked backend) | P1 | Done | `tests/e2e/` (real backend, needs credentials) plus `tests/ui/` (mocked backend, no credentials, runs in `npm run check`): every live screen, sign-in, meals, weight, prep, workout logging, plan generate/refine/apply/undo/restore, coach chat, account delete guard, CSP cleanliness |
| QA-04 | CI workflow runs lint, typecheck, unit, API and e2e | P1 | Skipped | Removed: GitHub Actions needs a billing method. Run `npm run check` locally |
| QA-05 | Lint (`no-undef`, redeclare, unreachable) over `src/` and strict JSDoc typecheck over `src/lib/` | P2 | Done | `eslint.config.mjs`, `jsconfig.json`; `npm run check` |
| QA-06 | Testing guide and throwaway-user procedure | P2 | Done | `docs/TESTING.md` |

---

## 5. Non-functional requirements

### 5.1 Security (SEC)

| ID | Requirement | Pri | Status | Evidence |
|---|---|---|---|---|
| SEC-01 | Row-level security enabled on all 26 public tables; users can only read/write their own rows (40 policies) | P0 | Done | DB `pg_policies`, `relrowsecurity` |
| SEC-02 | Progress-photo bucket is private; storage policies limit read/insert/update/delete to the owner | P0 | Done | DB `storage.buckets`, `progress_photos_*_own` |
| SEC-03 | Frontend holds only the publishable Supabase key; service-role key exists only inside edge functions | P0 | Done | Vercel env; EF `delete-account` |
| SEC-04 | AI and delete-account endpoints require a valid JWT | P0 | Done | `verify_jwt` true on both |
| SEC-05 | Security response headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy` | P1 | Done | `src/vercel.json` |
| SEC-06 | Content-Security-Policy: `default-src 'self'`; scripts from self and `https://esm.sh` only (no inline scripts); styles allow inline (92 inline `style=` attributes); connections to self, Supabase (https/wss) and esm.sh; images from self, data, blob, Supabase; `frame-ancestors 'none'` | P1 | Done | `src/vercel.json` |
| SEC-07 | Admin and SECURITY DEFINER RPCs do not let one user act on another (17 public functions, 15 of them SECURITY DEFINER) | P1 | Done | Audited 2026-11-10: see `docs/SECURITY-AUDIT.md`. Six user-callable functions, all scoped to `auth.uid()`; internal functions have EXECUTE revoked (OI-07 closed) |
| SEC-08 | HTML escaping of all user- and AI-supplied text rendered into the page | P0 | Done | FE `esc()` used in templates |
| SEC-09 | Secrets are never committed (AI keys in Supabase secrets; Vercel env for public keys) | P0 | Done | README; RUNBOOK |
| SEC-10 | WAF / firewall rules and rate limiting at the Vercel edge | P2 | Skipped | Manual dashboard task; API returned 404 (section 11) |
| SEC-11 | Supabase Auth: secure email change ON; email confirmation ON | P1 | Done | Auth settings |
| SEC-12 | Hidden QA edge functions are removed from production | P1 | Partial | Three stubs still deployed (OI-04) |

### 5.2 Privacy and data protection (PRIV)

| ID | Requirement | Pri | Status | Evidence |
|---|---|---|---|---|
| PRIV-01 | A user can obtain a complete JSON copy of their data | P1 | Done | ACCT-05 |
| PRIV-02 | A user can permanently delete their account and all associated data and files | P0 | Done | ACCT-06/07 |
| PRIV-03 | Only aggregated summaries, not raw rows, are sent to the AI provider; user data is delimited as data in prompts | P0 | Done | AISVC-06, PLAN-18 |
| PRIV-04 | Nutrition output is presented as estimates / general wellness information, not medical advice | P0 | Done | FE planner notice and adult checkbox |
| PRIV-05 | Proprietary license; all rights reserved | P2 | Done | `LICENSE`, README |

### 5.3 Performance and delivery (PERF)

| ID | Requirement | Pri | Status | Evidence |
|---|---|---|---|---|
| PERF-01 | Static assets cached with appropriate cache headers; HTML revalidated | P2 | Done | `src/vercel.json` |
| PERF-02 | No build step; single static page served from the Vercel edge | P2 | Done | Project config |
| PERF-03 | AI requests time out at 100 s with one retry on rate limit | P2 | Done | EF `llm.ts` |
| PERF-04 | Vercel Speed Insights / analytics enabled | P2 | Skipped | Manual dashboard task (section 11) |

### 5.4 Reliability and operations (OPS)

| ID | Requirement | Pri | Status | Evidence |
|---|---|---|---|---|
| OPS-01 | Release flow: branch → preview deployment → test → merge to `main` → automatic production deploy | P0 | Done | README "Workflow"; Vercel Git integration |
| OPS-02 | Rollback of the web app by promoting a previous Vercel deployment | P1 | Done | `docs/RUNBOOK.md` |
| OPS-03 | Edge functions are redeployable from git; migrations are additive | P1 | Done | `docs/RUNBOOK.md` |
| OPS-04 | Incident triage order, CSP maintenance notes and production-checklist status are documented | P2 | Done | `docs/RUNBOOK.md` |
| OPS-05 | Database triggers never block user writes (errors in the coach layer are swallowed) | P0 | Done | `docs/ARCHITECTURE.md` |
| OPS-06 | Source of the `the-cut-push-dispatch` function is stored in the repository | P2 | Partial | Deployed v41 but not in `supabase/functions/` (OI-08) |
| OPS-07 | Merged feature branches are removed from the GitHub remote | P2 | Partial | Local branches cleaned; remote deletion blocked from the build environment (OI-03) |

### 5.5 Accessibility (A11Y)

| ID | Requirement | Pri | Status | Evidence |
|---|---|---|---|---|
| A11Y-01 | Dialogs expose `role=dialog`, `aria-modal`, return focus and close on Esc | P1 | Done | FE `uiModal` |
| A11Y-02 | Errors use `role=alert`; status messages use `aria-live=polite` | P1 | Done | FE `toast`, auth form |
| A11Y-03 | Icon-only buttons carry `aria-label`; charts have `role=img` with a label | P2 | Done | FE templates |
| A11Y-04 | Locked tabs are marked `aria-disabled` | P2 | Done | FE `navBtn` |
| A11Y-05 | Keyboard operation of the tour (left/right arrows, Esc) | P2 | Done | FE `tourKeys` |

---

## 6. User stories and acceptance criteria

### US-01 Sign up and verify (AUTH-01/02/03/05)
*As a new user I want to create an account and verify my email so that my data is mine.*
- **Given** I am on the sign-up form, **when** I submit a new email and valid password, **then** a dialog tells me to check my inbox and I am not signed in until I confirm.
- **Given** I use an email that is already registered, **when** I submit, **then** I see a message that the account exists and no new account is created.
- **Given** I am offline, **when** I submit, **then** I see an offline message and no request is sent.

### US-02 Sign in with clear errors (AUTH-04/05/11)
- **Given** I enter a wrong password, **when** I submit, **then** a modal dialog explains it in plain language (not a footnote).
- **Given** my session expires while I am using the app, **then** a "Session expired" dialog appears and I am returned to sign-in.
- **Given** I click Sign out in the avatar menu, **then** I return to sign-in without the expiry dialog.

### US-03 Recover a password (AUTH-07/08)
- **Given** I request a reset, **when** I open the emailed link, **then** I see "Set a new password" with a confirm field.
- **Given** the two fields differ, **then** a dialog says they must match and nothing is changed.
- **Given** a password shorter than 8 characters, **then** the form refuses it.

### US-04 First plan unlocks the app (PLAN-01…12)
- **Given** I have no plan, **then** every tab except Plan shows a lock and redirects to Plan.
- **Given** I complete the intake and confirm I am 18+, **when** I choose Generate, **then** the plan is applied and I land on Meals with an Undo option.
- **Given** a draft, **when** I choose "Apply this plan to my workspace" and confirm, **then** my targets, meals, groceries, prep tasks and training week are set, and the other tabs unlock.
- **Given** the AI returns a plan below 1,200 kcal/day, **then** it is rejected or corrected and never shown as valid.

### US-05 Refine a plan safely (PLAN-13…17)
- **Given** an active plan, **when** I change my profile or type an instruction and submit, **then** a new draft is created and the active plan is unchanged until I apply it.
- **Given** a refinement, **then** calories stay within 20% of my accepted plan unless my instruction clearly requires more, and never below 1,200 kcal.

- **Given** I type a refinement and switch to another tab or app while it runs, **when** I return, **then** my text is still there and the box shows it is still working (PLAN-24).

### US-06 Track my day (MEAL-01…06)
- **Given** an active plan, **when** I open Meals, **then** I see today's meals with times and components.
- **When** I tick a meal, **then** it shows complete and the calories/protein bars update.
- **When** I add an extra food and later delete it, **then** I am asked to confirm and totals update.

### US-07 Run a workout (WORK-01…14)
- **Given** my plan has a session today, **when** I open Workout, **then** I see it with a Start button.
- **When** I tick a set, **then** a rest timer starts and a PR is flagged if my estimated 1RM beats my history.
- **Given** I reload mid-workout, **then** my in-progress workout is restored (within 18 hours).
- **When** I choose Finish with no completed sets, **then** I am told to complete at least one set.
- **When** I save, **then** the session, exercises and sets are stored and appear in Recent sessions; if saving fails nothing is left half-saved.

### US-08 Log weight (WGT-03/04/05)
- **When** I log a weight for a date I already logged, **then** that day's entry is replaced.
- **When** I enter a weight outside 20–500 kg, **then** it is rejected with a message.

### US-09 Use the coach (COACH-05…13)
- **Given** my protein stays below plan for the week, **then** an insight appears live and the bell count rises.
- **When** I edit my training week and the edit looks unsafe, **then** after about 20 seconds the coach offers: accept the AI refinement, keep my version, or discuss.
- **When** the coach proposes a plan change in chat, **then** it is a draft I must apply; my plan is not changed by chat.

### US-10 Export and delete my account (ACCT-05…09)
- **Given** I open Delete account, **then** I can first download my data as JSON.
- **Given** I type anything other than `DELETE`, **then** the delete button stays disabled.
- **When** I confirm with `DELETE`, **then** my photos, all rows and my login are removed and I am signed out; signing in again fails.

### US-11 Change email (ACCT-03)
- **When** I submit a new email on Account, **then** confirmation is requested and my sign-in email does not change until it is confirmed.

### US-12 Get my plan adjusted from a workout (WORK-17…20)
- **Given** I saved a workout, **then** a popup asks about each exercise (too easy / just right / too hard, issue chips, optional note) and I can skip any step.
- **Given** I reload before finishing the popup, **then** my unfinished feedback is restored (within 24 hours).
- **When** the review finishes, **then** I see how the session went, the issues found and the exact changes to my training week, already applied, with Undo.
- **Given** I report joint pain on a lift, **then** the review swaps or reduces it rather than progressing it.
- **Given** the AI proposes a week that breaks the rules (different days, rest days changed, session length beyond 30%, more than 8 sets), **then** it is rejected, my plan is unchanged and I still get the analysis.
- **When** I press Undo while my training week is unchanged, **then** the previous week is restored.

---

## 7. Data model

### 7.1 Tables (26, all with RLS and `ON DELETE CASCADE` to `auth.users`)

| Group | Tables |
|---|---|
| Identity & settings | `profiles`, `user_settings` |
| Plans | `ai_plan_versions`, `daily_targets` |
| Meals | `meal_templates`, `meal_template_items`, `daily_meals`, `food_entries`, `foods` |
| Training | `workout_sessions`, `workout_exercises`, `workout_sets`, `workout_feedback` (per-exercise rating, issue tags, note), `workout_reviews` (AI analysis plus exact before/after training week, for Undo) |
| Body | `body_measurements`, `progress_photos` |
| Habits | `water_logs`, `daily_checkins`, `daily_activity` |
| Shopping & prep | `grocery_items`, `prep_tasks` |
| Notifications | `reminders`, `push_subscriptions`, `push_notification_deliveries` |
| Coach | `agent_insights`, `agent_baseline` |

### 7.2 Functions (17 in `public`)

| Purpose | Functions |
|---|---|
| Plans | `apply_ai_plan_version`, `save_training_week` |
| Coach engine | `agent_scan`, `agent_scan_me`, `agent_put`, `agent_put_ai`, `agent_clear`, `agent_metrics`, `agent_plan_state`, `agent_state_for`, `agent_week_summary`, `agent_ack_state`, `agent_trigger`, `agent_plan_trigger` |
| Platform | `handle_new_user`, `set_updated_at`, `get_the_cut_push_config` |

### 7.3 Triggers, schedules and realtime
- Auth: `on_auth_user_created` → `handle_new_user` (creates profile and settings).
- Coach triggers: `trg_agent_*` on `food_entries`, `water_logs`, `body_measurements`, `workout_sessions`, `daily_checkins`, `daily_meals`, `ai_plan_versions`.
- `trg_*_updated_at` on mutable tables.
- `pg_cron`: `the-cut-push-dispatch`, every minute.
- Realtime publication: `agent_insights` only.
- Storage: private bucket `progress-photos` with four owner policies.

### 7.4 Device storage
`cut_wk_<uid>` (in-progress workout), `cut_tour_…` (tour state). Neither holds credentials.

---

## 8. Documentation set

| File | Contents |
|---|---|
| `README.md` | Overview, stack, AI configuration, repo layout, workflow |
| `docs/ARCHITECTURE.md` | Architecture diagram, principles, provider swap, gating |
| `docs/AGENT.md` | Coach rules and coach sync |
| `docs/RUNBOOK.md` | Deployment, release checklist, rollback, incident response, production-checklist status |
| `docs/TESTING.md` | Test layers, throwaway users, how to run, CI |
| `docs/REQUIREMENTS.md` | This document |

---

## 9. Release history (from `main`)

| Release | Summary |
|---|---|
| Agent layer (`20261108`) | Coach rules, insights, Realtime feed, weekly review |
| Coach sync (`20261109`) | Live-plan state, baseline, edit review, coach chat, training-week editor |
| v3 UI | Six-tab navigation (Plan, Meals, Workout, Weight, Coach, Prep & Grocery); live workout logger |
| Production hardening | Security headers and CSP in `vercel.json`; runbook additions |
| UX feedback layer | Modal errors, styled confirmations, offline banner, session-expired dialog, accessibility and mobile fixes |
| Account release (`81677d8`) | Avatar menu, Account page, change email/password, data export, delete account (`delete-account` v1) |
| Requirements register | `docs/REQUIREMENTS.md` v1.0 |
| PWA (`5af461b`) | Manifest, icons, install meta, cache headers |
| Cleanup (`96c9e94`) | 7 superseded duplicate functions removed; 11 style blocks merged into one |
| Asset split (`1c6915f`) | `styles.css`, `app.js`, `lib/` modules; inline scripts removed; CSP `script-src` without `'unsafe-inline'` |
| Test suite (`2a32896`) | Unit, API/RLS, e2e smoke (CI workflow later removed) |
| Typecheck and docs | ESLint, strict JSDoc typecheck for `lib/`, README/RUNBOOK drift fixed |
| CI removed (`c144166`) | GitHub Actions workflow deleted (hosted runners need billing); `npm run check` is the local gate |
| Mobile UI (`262418a`) | Consolidated mobile CSS; input-only Plan page; auto-apply with undo; plan history in Account |
| Top bar title (`57a8b35`) | Logo mark and page title on non-date tabs |
| Plan feedback (`f8db945`) | What-changed card, global AI progress pill, bell dropdown, button spacing |
| Dynamic workouts (`b5c1e86`) | Per-exercise feedback popup, AI session review (`workout_review`, `workout.ts`), auto-applied training-week changes with Undo, Refine box persistence; migration `20261110_workout_feedback` |

---

## 10. Known open items

| ID | Item | Owner action | Pri |
|---|---|---|---|
| OI-01 | Leaked-password protection | Needs Supabase Pro | P2 |
| OI-02 | Raise server-side minimum password length from 6 to 8 | Supabase dashboard → Auth → Passwords | P1 |
| OI-03 | Delete merged branches from the GitHub remote (`feat/account-delete`, `ux/*`, `docs/requirements`, others) | Delete in GitHub; blocked from the build environment | P2 |
| OI-04 | Delete stub QA edge functions `the-cut-auth-smoke-qa`, `the-cut-ai-smoke-qa`, `cut-test-provision` | Supabase dashboard | P1 |
| OI-05 | ~~Replace native `prompt()` dialogs~~ Done in v1.5 (the only remaining one, Add a meal, is now a modal form; the edit flows were removed) | Closed | P2 |
| OI-06 | Vercel firewall rules and Speed Insights | Vercel dashboard (API returned 404) | P2 |
| OI-07 | ~~Audit SECURITY DEFINER RPCs~~ Done in v1.5, see `docs/SECURITY-AUDIT.md` | Closed | P1 |
| OI-08 | Add `the-cut-push-dispatch` source to `supabase/functions/` | Code change | P2 |
| OI-09 | ~~README/RUNBOOK drift~~ Fixed in v1.1 | Closed | P2 |
| OI-10 | Weight-row delete confirmation not exercised in a signed-in browser test | Test | P2 |
| OI-11 | ~~Tour: restore or delete~~ Deleted in v1.5 | Closed | P2 |
| OI-12 | ~~Reachable UI for backend-only features~~ Decided in v1.5: not in the UI means not in the code; DB tables kept | Closed | P1 |
| OI-13 | ~~Wire or delete `startReminderLoop`~~ Deleted in v1.5 | Closed | P1 |
| OI-14 | Delete throwaway Auth users `rls-test-a`, `rls-test-b` if the API/e2e tests are retired (`rls-test` rows are removed by the tests themselves) | Supabase dashboard | P2 |
| OI-15 | Try Install app on a physical Android phone | Manual test | P2 |
| OI-16 | ~~Split `app.js`~~ Done in v1.5: 13 modules plus a shared `S` state object (`src/state.js`), formatted with Prettier | Closed | P2 |
| OI-17 | ~~Remove inline `style=`~~ Done in v1.5: zero inline styles, CSP `style-src 'self'`, guarded by a unit test and a runtime CSP test | Closed | P2 |
| OI-19 | Apply migration `20261111_plan_undo_complete.sql` to production (Undo/Restore of older plans and full grocery/prep rollback, KL-11). Tested on an in-process Postgres (`npm run test:db`); not yet applied | Owner approval | P1 |
| OI-18 | Verify `workout_review` against the real LLM and the feedback popup, Undo and Refine-box persistence in a signed-in browser (shipped with DB, RLS and unit-level checks only; the build sandbox cannot reach Supabase) | Manual test | P1 |

## 11. Skipped items (paid plan or manual action)

| ID | Item | Reason |
|---|---|---|
| SK-01 | Leaked-password protection (AUTH-14) | Supabase Pro plan only; project is on Free |
| SK-02 | Vercel firewall / rate-limit rules (SEC-10) | Dashboard-only; API unavailable |
| SK-03 | Vercel Speed Insights (PERF-04) | Dashboard toggle |
| SK-04 | Supabase server-side password length change | Settings change requires the owner to save it (OI-02) |
| SK-05 | Google Play listing / APK (PWA-05) | $25 Play account not purchased; workspace cannot download the Android SDK. Chrome install (PWA-04) is the free route |

## 12. Removed features

| ID | Item | Notes |
|---|---|---|
| RM-01 | Tabs Overview, Nutrition, Habits, Training, Progress, Planning, Analytics, Settings from the navigation | Replaced by the six-tab v3 layout; old names redirect via `LEGACY_TABS`; their code was deleted in v1.5 |
| RM-02 | Header sign-out button | Replaced by the avatar menu (ACCT-01) |
| RM-03 | Inline footnote auth messages as the only error channel | Replaced by modal dialogs (AUTH-05) |
| RM-04 | Browser `confirm()` boxes for destructive actions on reachable screens | Replaced by `uiConfirm` (UX-03) |
| RM-05 | Seven superseded duplicate functions (`addGrocery`, `deletePhoto`, `editMeasurement`, `editWorkout`, `saveWorkout`, `renderAuth`, `settingsPage`) | Replaced by their V2/V3 versions; no feature lost |
| RM-06 | App tour | Deleted in v1.5 |
| RM-07 | Water, check-in, activity, food catalog, progress photo, reminder and push-enable screens and their code; meal-template edit/delete; saved-session and measurement edit; the seeded demo meals, groceries and prep list | Not in the UI, so deleted in v1.5. Database tables remain |

## 13. Known limitations

| ID | Limitation |
|---|---|
| KL-01 | Time zone is fixed to `Asia/Kolkata` for "today", dates and reminders. |
| KL-02 | The tab lock (`aiUnlocked`) is a client-side convenience; data protection relies on RLS. |
| KL-05 | The in-progress workout draft lives in browser storage, so it does not follow the user to another device. |
| KL-07 | The CSP blocks self-framing, so the app cannot be embedded for mobile-width testing. |
| KL-11 | Until `20261111_plan_undo_complete.sql` is applied (OI-19), Undo of a plan older than the last one fails and grocery/prep items the newer plan added are not removed. |
| KL-12 | Auto-applied plans skip the old review step; safety concerns now surface through the Coach (and the AI's own summary on the What-changed card). |
| KL-13 | Workout reviews change the recurring weekly training week of the active plan, not a dated calendar; Undo is offered only while that week is unchanged since the review. |
| KL-08 | Nutrition and training output are AI estimates, not medical advice. |
| KL-09 | The coach rules for water and check-ins only fire on existing data, because there is no logging screen for them. |

---

## 14. Change log

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-11-10 | Initial requirements register built from `main` @ `81677d8` |
| 1.1 | 2026-11-10 | Added PWA and QA modules; asset split and CSP change; corrected PUSH-05 and UX-12; closed OI-09; new open items OI-13 to OI-17 |
| 1.2 | 2026-11-10 | Mobile layout and top bar; input-only Plan page with auto-apply/undo (PLAN-11, 12, 13, 16 revised; PLAN-20 to 23 added); bell dropdown (COACH-05); UX-16/17; CI workflow removed (QA-04 Skipped); KL-11/12 |
| 1.3 | 2026-11-10 | Dynamic workouts: WORK-17 to 20 and US-12; PLAN-24 (Refine box persistence); `workout_review` action (AISVC-01); tables 24 → 26 and policies 33 → 40 (SEC-01, 7.1); export covers 24 tables; edge function v53; QA counts (36 unit, 67 API); OI-18, KL-13 |
| 1.4 | 2026-11-10 | Product name changed from "THE CUT 2.0" to "THE CUT" (first release): app title, manifest, export `product`, README, LICENSE, docs, SQL comments |
| 1.5 | 2026-11-11 | Dead code for features not in the UI deleted (RM-07); `app.js` split into modules with shared state; monkey patches replaced; Add-a-meal modal form; inline styles and `unsafe-inline` removed; CSS pruned; Lucide icons, sentence-case labels, data-driven sidebar summary; Coach chat visibility bug fixed; SECURITY DEFINER audit (SEC-07); mocked-backend UI tests and in-process Postgres tests; migration for complete plan undo written (OI-19) |
