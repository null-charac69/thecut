# THE CUT 2.0

> Proprietary software. All rights reserved. Not licensed for use, copying or distribution. See [LICENSE](LICENSE).

A personal nutrition, training and transformation tracker with an AI planner and an agentic coach that always knows your live plan.

**Live:** https://the-cut-tracker.vercel.app

## Features
- **AI Planner (first tab).** Generates a nutrition plan (targets, meal templates) and a training week from your profile. All other tabs stay locked until the first plan exists. AI output is always a draft you apply.
- **Live coach.** Database rules watch your logs and write insights in real time (Supabase Realtime). "Review my week" adds an LLM summary.
- **Plan-edit review.** Edit targets, meal templates or the training week yourself. The coach reviews the change (debounced after saves, and on load):
  - fine -> it keeps your version and says it has adjusted itself;
  - concern -> three options: accept the AI refinement (creates a draft), keep your version, or discuss with the coach.
- **Coach chat.** Tool-using loop (live plan, profile, plan changes, week summary, recent logs, propose draft, keep my version). It never changes a plan directly.
- **Training week editor** in the Training tab.
- First-login 9-step tour (replay with `? Tour`), favicon, reduced-motion support.

## Stack
| Layer | Tech |
|---|---|
| Frontend | Single-file static app `src/index.html`, Vercel (project `the-cut-tracker`, Root Directory `src`) |
| Backend | Supabase: Postgres + RLS, Auth, Realtime, Edge Functions, pg_cron (project `the-cut-cloud`) |
| AI | Edge Function `the-cut-ai` (Deno), provider-agnostic OpenAI-compatible adapter. Current: AWS Bedrock `openai.gpt-oss-120b-1:0` via SigV4 |

## AI configuration (Supabase secrets)
`LLM_BASE_URL`, `LLM_MODEL`, `LLM_MODEL_FAST`, `LLM_AWS_ACCESS_KEY_ID`, `LLM_AWS_SECRET_ACCESS_KEY`, `LLM_AWS_REGION`. Swapping the model is a secrets change; see [docs/RUNBOOK.md](docs/RUNBOOK.md).

## Docs
- [Architecture](docs/ARCHITECTURE.md)
- [Coach / agent rules](docs/AGENT.md)
- [Deployment & runbook](docs/RUNBOOK.md)

## Repo layout
```
src/                              Vercel root: index.html, favicon.*, sw.js, vercel.json, api/ (legacy)
supabase/functions/the-cut-ai/    Edge function (index.ts, llm.ts, plan.ts)
supabase/migrations/              SQL migrations (apply in order)
docs/                             Documentation
```

## Workflow
Branch -> Vercel preview -> test -> merge to `main` (auto-deploys production). Never test destructive changes on production data.

## License
Copyright (c) 2026 Anant Kumar Thakur. Proprietary and confidential. See [LICENSE](LICENSE).
