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

## AWS Bedrock provider (SigV4, no API key)
Set these Supabase Edge Function secrets: `LLM_BASE_URL=https://bedrock-runtime.<region>.amazonaws.com/openai/v1`, `LLM_AWS_ACCESS_KEY_ID`, `LLM_AWS_SECRET_ACCESS_KEY`, `LLM_AWS_REGION`, `LLM_MODEL=openai.gpt-oss-120b-1:0`. The IAM user only needs `bedrock:InvokeModel`. Use the 120b model for both plan and weekly review: the 20b model emits malformed JSON. The adapter strips `<reasoning>` blocks and retries once on bad JSON.

## Production release checklist
1. Migration `20261108_agent_layer.sql` applied (agent_insights, triggers, RPCs).
2. Edge function `the-cut-ai` deployed (verify_jwt on) and `generate` + `review` return 200.
3. Preview: first login lands on AI Planner with other tabs locked; generating a plan unlocks them; Apply creates an active plan and a "Plan applied" insight; Review my week works; the tour runs 9 steps.
4. Merge `feat/2.0` into `main` (Vercel auto-deploys production), then smoke test production.
