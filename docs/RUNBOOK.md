# Deployment & runbook

## Vercel
- Project `the-cut-tracker`, Root Directory = `src`. Push to `main` => production. Other branches => preview.
- Rollback: Vercel dashboard -> Deployments -> previous -> Promote.

## Supabase (project `the-cut-cloud`)
1. Apply `supabase/migrations/20261108_agent_layer.sql` (SQL editor or `supabase db push`). Until applied, the app hides the coach feed gracefully and "Review my week" reports unavailable.
2. Edge function `the-cut-ai`: deploy from `supabase/functions/the-cut-ai` (verify_jwt on).
3. Secrets: `LLM_BASE_URL` (e.g. https://api.groq.com/openai/v1), `LLM_API_KEY`, `LLM_MODEL` (llama-3.3-70b-versatile), `LLM_MODEL_FAST` (llama-3.1-8b-instant).

## Release checklist
- [ ] Preview deploy loads, sign in works
- [ ] New user: lands on AI Planner, other tabs locked, tour runs
- [ ] Generate plan -> tabs unlock -> apply works
- [ ] Migration applied; log a meal -> insight appears live
- [ ] Merge to main; verify production returns 200 and app mounts

## Housekeeping
- Rotate the Groq key (it was shared in chat).
- Remove QA edge functions `auth-smoke-qa`, `ai-smoke-qa` (verify_jwt off).
- Enable leaked-password protection in Supabase Auth settings.
- `src/api/ai-plan.js` is legacy; the app now calls the edge function.
