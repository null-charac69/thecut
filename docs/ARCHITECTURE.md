# Architecture

```
Browser (src/index.html + app.js + lib/*.js + styles.css)
  |-- Supabase Auth / PostgREST (RLS: users only see own rows)
  |-- Supabase Realtime  <- agent_insights changes
  '-- POST /functions/v1/the-cut-ai  (JWT required)
        |-- plan.ts: validates + normalises AI output (calorie floor/ceiling, macro math)
        '-- llm.ts : OpenAI-compatible chat adapter -> primary provider, then fallback
Postgres
  |-- triggers on food_entries, water_logs, body_measurements, workout_sessions,
  |   daily_checkins, daily_meals, ai_plan_versions -> agent_scan() -> agent_insights
  |-- workout_feedback (per-exercise feedback), workout_reviews (AI session review + before/after week for Undo)
  '-- RPCs: agent_scan_me(), agent_week_summary(), save_training_week()
```

## Principles
- The model proposes; server code validates. Changes to a plan are either approved by the user or applied automatically with a visible "what changed" and an Undo (plan refine, post-workout training review). AI never silently changes a plan.
- Missing data is unknown, never zero.
- User writes never fail because of the coach (trigger errors are swallowed).
- Only aggregated data goes to the LLM provider.

## Swapping the AI provider
Change Supabase Edge Function secrets only: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, optional `LLM_MODEL_FAST`, and `LLM_FALLBACK_*`. Any OpenAI-compatible endpoint works (Groq, Cerebras, OpenRouter, Gemini, Mistral, vLLM).

## Gating
`aiUnlocked` is true once the user has at least one row in `ai_plan_versions`. Client-side only (UX); data is protected by RLS regardless.
