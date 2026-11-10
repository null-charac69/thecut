# SECURITY DEFINER audit (closes OI-07)

Date: 2026-11-10. Scope: every function in the `public` schema of the production project, checked against its EXECUTE grants.

## Result
No function lets one user act on another user's data.

| Function | Callable by | Scope |
|---|---|---|
| `save_training_week` | authenticated | Reads and writes only the caller's active plan, keyed on `auth.uid()` |
| `agent_ack_state` | authenticated | Caller's own baseline row (`auth.uid()`) |
| `agent_plan_state` | authenticated | Returns the caller's own plan state (`auth.uid()`) |
| `agent_put_ai` | authenticated | Inserts an insight for `auth.uid()` only |
| `agent_scan_me` | authenticated | Runs the scan for `auth.uid()` only |
| `agent_week_summary` | authenticated | Summary of the caller's own week |
| `apply_ai_plan_version` | authenticated | SECURITY INVOKER: RLS applies, rows are filtered by `auth.uid()` |
| `agent_clear`, `agent_metrics`, `agent_plan_trigger`, `agent_put`, `agent_scan`, `agent_state_for`, `agent_trigger`, `get_the_cut_push_config`, `handle_new_user` | nobody (EXECUTE revoked from `anon` and `authenticated`) | Internal: triggers, cron, auth hook |
| `set_updated_at` | everyone | Trigger helper, SECURITY INVOKER, touches no data |

`anon` has EXECUTE on no SECURITY DEFINER function. The Supabase advisors list only these six intentional "authenticated can execute a SECURITY DEFINER function" warnings, plus leaked-password protection (Supabase Pro only, OI-01).

## How to re-check
```sql
select p.proname, p.prosecdef,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' order by p.prosecdef desc, p.proname;
```
Any new SECURITY DEFINER function must either derive the user from `auth.uid()` or have EXECUTE revoked from `public`, `anon` and `authenticated`.
