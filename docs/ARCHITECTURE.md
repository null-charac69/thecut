# Architecture

```
Browser (src/index.html + app.js entry + feature modules + lib/*.js + styles.css)
  |-- Supabase Auth / PostgREST (RLS: users only see own rows)
  |-- Supabase Realtime  <- agent_insights changes
  '-- POST /functions/v1/the-cut-ai  (JWT required)
        |-- plan.ts: validates + normalises AI output (calorie floor/ceiling, macro math)
        |-- lists.ts: validates the AI grocery list and prep tasks (action `lists`)
        '-- llm.ts : OpenAI-compatible chat adapter -> primary provider, then fallback
Postgres
  |-- triggers on food_entries, water_logs, body_measurements, workout_sessions,
  |   daily_checkins, daily_meals, ai_plan_versions -> agent_scan() -> agent_insights
  |-- workout_feedback (per-exercise feedback), workout_reviews (AI session review + before/after week for Undo)
  |-- list_generations (which live-meals hash each Sunday week's AI lists came from)
  '-- RPCs: agent_scan_me(), agent_week_summary(), save_training_week(), replace_generated_lists()
```

## Principles
- The model proposes; server code validates. Changes to a plan are either approved by the user or applied automatically with a visible "what changed" and an Undo (plan refine, post-workout training review). AI never silently changes a plan.
- Missing data is unknown, never zero.
- User writes never fail because of the coach (trigger errors are swallowed).
- Only aggregated data goes to the LLM provider.
- Nothing is hard-coded: the grocery list, prep tasks and targets come from the AI and follow the live plan.

## Grocery and prep lists
Built by the `lists` action from the live meal templates, not from the plan JSON. Weeks run Sunday to Saturday. The server hashes the live meals; if the hash matches `list_generations` for the week it returns `current` without calling the model. No row for the week means a whole-week build (`new_week`); a row means a rebuild of today to Saturday (`rest_of_week`). `replace_generated_lists` swaps only unticked AI rows (`source_version_id` set); ticked, hand-added and past-day rows are kept. `apply_ai_plan_version` clears stale AI rows and resets the hash so the next Prep open rebuilds. Client side: `ensureLists` and `markListsStale` in `src/prep.js`.

## Swapping the AI provider
Change Supabase Edge Function secrets only: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, optional `LLM_MODEL_FAST`, and `LLM_FALLBACK_*`. Any OpenAI-compatible endpoint works (Groq, Cerebras, OpenRouter, Gemini, Mistral, vLLM).

## Gating
`aiUnlocked` is true once the user has at least one row in `ai_plan_versions`. Client-side only (UX); data is protected by RLS regardless.

## Frontend modules (`src/`)
No build step; native ES modules. Cross-module calls use hoisted function declarations, so import cycles are safe.

| Module | Responsibility |
|---|---|
| `app.js` | Entry: registers the service worker, reads the session, boots |
| `client.js` | Supabase client, `$`, `q`, small helpers |
| `state.js` | The single shared mutable state object `S` (read and written as `S.<name>`) |
| `ui.js` | Modals (`uiModal`, `uiConfirm`, `uiForm`), toasts, error banner, a11y labels |
| `auth.js` | Sign-in/up, recovery, verification, auth-state listener |
| `shell.js` | Bootstrap, navigation, header, `render()`, event wiring |
| `plan.js` | AI planner page, generate/refine/apply, plan history |
| `meals.js`, `prep.js`, `weight.js` | Those tabs |
| `workout.js`, `feedback.js` | Workout runner and the post-session coach review |
| `coach.js` | Insights, chat, assessments, training-week editor |
| `account.js` | Account page, email change, export, delete |
| `icons.js` | Lucide icons used in navigation |

CSP: `style-src 'self'`. Markup must not carry `style=` attributes; use classes (`u-*` utilities, `pw-N` for bar widths).
