# THE CUT 2.0

A personal nutrition, training and transformation tracker with an AI planner and a live coach.

- **App:** single-file static web app (`src/index.html`), hosted on Vercel (project `the-cut-tracker`, Root Directory `src`).
- **Backend:** Supabase (Postgres + RLS, Auth, Realtime, Edge Functions, pg_cron).
- **AI:** Supabase Edge Function `the-cut-ai`, provider-agnostic (OpenAI-compatible API; Groq free tier today).

## What's new in 2.0
- AI Planner is the first tab. Every other section stays locked until the first AI plan exists.
- Coach: database rules watch your logs in real time and write insights; "Review my week" adds an LLM summary. AI output is always a draft.
- First-login 9-step tour (replay from the `? Tour` button).
- Favicon, UI polish, reduced-motion support.

## Docs
- [Architecture](docs/ARCHITECTURE.md)
- [Coach / agent rules](docs/AGENT.md)
- [Deployment & runbook](docs/RUNBOOK.md)

## Repo layout
```
src/                       Vercel root: index.html, favicon.*, sw.js, vercel.json, api/ (legacy)
supabase/functions/the-cut-ai/   Edge function (index.ts, llm.ts, plan.ts)
supabase/migrations/       SQL migrations (apply in order)
docs/                      Documentation
```

## Workflow
Work on a branch -> Vercel builds a preview -> test -> merge to `main` (auto-deploys production). Never test destructive changes on production data.
