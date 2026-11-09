# Deployment & runbook

## Vercel
- Project `the-cut-tracker`, Root Directory = `src`. Push to `main` => production. Other branches => preview.
- Rollback: Vercel dashboard -> Deployments -> previous -> Promote.

## Supabase (project `the-cut-cloud`)
1. Apply `supabase/migrations/20261108_agent_layer.sql` (SQL editor or `supabase db push`). Until applied, the app hides the coach feed gracefully and "Review my week" reports unavailable.
2. Edge function `the-cut-ai`: deploy from `supabase/functions/the-cut-ai` (verify_jwt on).
3. Secrets: see "AWS Bedrock provider" below (current). Any OpenAI-compatible endpoint also works with `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, optional `LLM_MODEL_FAST`.
4. Edge function `delete-account`: deploy from `supabase/functions/delete-account` (verify_jwt on).

## Release checklist
- [ ] Preview deploy loads, sign in works
- [ ] New user: lands on AI Planner, other tabs locked
- [ ] Generate plan -> tabs unlock -> apply works
- [ ] Migration applied; log a meal -> insight appears live
- [ ] Merge to main; verify production returns 200 and app mounts

## Housekeeping
- Run `npm run check` and the API/e2e tests (docs/TESTING.md) before merging.
- Remove QA edge functions `the-cut-auth-smoke-qa`, `the-cut-ai-smoke-qa`, `cut-test-provision` (verify_jwt off).
- Enable leaked-password protection in Supabase Auth settings.
- The legacy `src/api/ai-plan.js` proxy was removed; the app calls the `the-cut-ai` edge function directly.

## AWS Bedrock provider (SigV4, no API key)
Set these Supabase Edge Function secrets: `LLM_BASE_URL=https://bedrock-runtime.<region>.amazonaws.com/openai/v1`, `LLM_AWS_ACCESS_KEY_ID`, `LLM_AWS_SECRET_ACCESS_KEY`, `LLM_AWS_REGION`, `LLM_MODEL=<bedrock model id>`. The IAM user only needs `bedrock:InvokeModel`. Use the 120b model for both plan and weekly review: the 20b model emits malformed JSON. The adapter strips `<reasoning>` blocks and retries once on bad JSON.

## Production release checklist
1. Migration `20261108_agent_layer.sql` applied (agent_insights, triggers, RPCs).
2. Edge function `the-cut-ai` deployed (verify_jwt on) and `generate` + `review` return 200.
3. Preview: first login lands on AI Planner with other tabs locked; generating a plan unlocks them; Apply creates an active plan and a "Plan applied" insight; Review my week works.
4. Merge the branch into `main` (Vercel auto-deploys production), then smoke test production.

## Incident response & rollback (Vercel production checklist)
- **Detect**: Vercel -> Project -> Logs / Runtime Errors; Supabase -> Logs (edge function `the-cut-ai`, auth, postgres).
- **Roll back the frontend (instant, no rebuild)**: Vercel -> Deployments -> last good production deployment -> "Promote to Production" (or `request_rollback`). Re-test with a stage/preview URL first when time allows.
- **Roll back the edge function**: redeploy the previous version of `supabase/functions/the-cut-ai` from git history (the function is shared by preview and production).
- **Roll back DB changes**: migrations are additive; revert with a new migration, never by editing history.
- **Triage order**: 1) is the site up (200 on `/`)? 2) auth failing (Supabase status/Auth logs)? 3) AI failing (edge function logs, Bedrock quota/budget)? 4) comms: note the incident and fix in the repo's PR.
- **Security headers/CSP** live in `src/vercel.json`. If a feature breaks with a CSP error in the browser console, add the origin to the matching directive, test on a preview, then merge.
- **Stage before promote**: every branch gets a preview URL; merge to `main` only after smoke tests pass there.

## Production checklist status
- Paid/Enterprise-only items intentionally skipped: SAML SSO, SCIM, Audit Logs, cookie policy, Observability Plus, Function/Secure Compute failover, load testing, Spend Management thresholds.
- Manual dashboard items: Firewall (rate limit + bot filter + OWASP managed rules), Speed Insights, Supabase leaked-password protection, Deployment Protection for previews.
