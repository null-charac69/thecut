# Testing

The app has no build step. Dev tooling lives in `package.json` and is never shipped (Vercel serves `src/`).

| Layer | Tool | Command | What it proves |
|---|---|---|---|
| Unit (pure logic) | `node:test` | `npm run test:unit` | `src/lib/*` helpers (dates, formatting, workout maths, workout parsers, error mapping) and the edge function's plan validation (`plan.ts`) |
| API / RLS | `pytest` + `requests` | `npm run test:api` | One user can never read, change or delete another's rows; anon sees nothing; plan RPC and storage are isolated; `the-cut-ai` and `delete-account` reject bad calls |
| In-process Postgres | PGlite + `node:test` | `npm run test:db` | The plan-apply/undo SQL (restore of superseded plans, grocery/prep rollback) against a stub schema; needs no network |
| Browser, mocked backend | Playwright (system Chrome) | `npm run test:ui` | The real app against a faked Supabase and AI endpoint (`tests/ui/fake-supabase.js`): every live screen, sign-in, meals, weight, prep, workouts, plan generate/refine/apply/undo/restore, coach chat, delete-dialog guard, zero CSP violations. Needs no credentials |
| Browser smoke | Playwright (system Chrome) | `npm run test:e2e` | Assets and security headers, sign-in errors, plan gate, Account page, delete-dialog guard, sign-out |

## Throwaway test users
API and e2e tests sign in as throwaway accounts. They are **never** the real user and the tests never confirm deletion.

| Env var | Used by | Notes |
|---|---|---|
| `TEST_A_EMAIL`, `TEST_A_PASSWORD` | api, e2e (`E2E_*` can reuse A) | user A |
| `TEST_B_EMAIL`, `TEST_B_PASSWORD` | api | user B (the "intruder") |
| `E2E_EMAIL`, `E2E_PASSWORD` | e2e | must have **no applied plan** |
| `E2E_BASE_URL` | e2e | defaults to production; use a Vercel preview URL to test a branch |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | api | default to the production project and its public key |

Tests skip (not fail) when credentials are missing. Export them in your shell to run locally. Never commit credentials.

Create a throwaway user with the SQL pattern in `docs/RUNBOOK.md` or the Supabase dashboard (Auth, Add user, auto-confirm).

## Running locally
```bash
npm ci
npm run check   # lint, format, typecheck, unit, db, ui
pip install -r tests/api/requirements.txt
TEST_A_EMAIL=... TEST_A_PASSWORD=... TEST_B_EMAIL=... TEST_B_PASSWORD=... npm run test:api
E2E_EMAIL=... E2E_PASSWORD=... npm run test:e2e
```

## CI
None. GitHub Actions was removed (hosted runners need a billing method). Run `npm run check` locally before merging (it includes the db and ui tests); Vercel preview deploys are the only automated gate.

## Not covered
AI generation quality (the UI tests fake the AI), the real backend's RLS from the browser (covered by `test:api`), a physical Android install of the PWA, push delivery, and delete-account's actual wipe (verified manually with a throwaway user, see REQUIREMENTS ACCT-07).

## Mocked-backend UI tests
`tests/ui/` serves `src/` with the same headers as `src/vercel.json`, replaces `https://esm.sh/@supabase/supabase-js` with `fake-supabase.js` (an in-memory query builder with auth, RPC emulation and Realtime), answers `the-cut-ai` with canned JSON and pins the clock to 2026-11-10 in Asia/Kolkata. `baseline.spec.mjs` writes text and screenshots of every screen when `UI_SNAP_DIR` is set, which is how refactors are checked for visual drift.
