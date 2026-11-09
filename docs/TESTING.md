# Testing

The app has no build step. Dev tooling lives in `package.json` and is never shipped (Vercel serves `src/`).

| Layer | Tool | Command | What it proves |
|---|---|---|---|
| Unit (pure logic) | `node:test` | `npm run test:unit` | `src/lib/*` helpers (dates, formatting, workout maths, workout parsers, error mapping) and the edge function's plan validation (`plan.ts`) |
| API / RLS | `pytest` + `requests` | `npm run test:api` | One user can never read, change or delete another's rows; anon sees nothing; plan RPC and storage are isolated; `the-cut-ai` and `delete-account` reject bad calls |
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

Tests skip (not fail) when credentials are missing. Add them as GitHub Actions secrets for CI. Never commit credentials.

Create a throwaway user with the SQL pattern in `docs/RUNBOOK.md` or the Supabase dashboard (Auth, Add user, auto-confirm).

## Running locally
```bash
npm ci
npm run test:unit
pip install -r tests/api/requirements.txt
TEST_A_EMAIL=... TEST_A_PASSWORD=... TEST_B_EMAIL=... TEST_B_PASSWORD=... npm run test:api
E2E_EMAIL=... E2E_PASSWORD=... npm run test:e2e
```

## CI
`.github/workflows/ci.yml`: unit on every push/PR; API tests on every push/PR; e2e on pushes to `main` and manual runs.

## Not covered
Signed-in feature flows (logging meals, workouts, weight), AI generation quality, push delivery, and delete-account's actual wipe (verified manually with a throwaway user, see REQUIREMENTS ACCT-07).
