# Coach (agent) rules

Deterministic, real-time, in Postgres (`agent_scan`). Rows land in `agent_insights` (unique per user/kind/day) and stream to the UI via Realtime. Insights can be dismissed or marked read.

| Rule | Fires when |
|---|---|
| tracking_gap | too few days logged to judge |
| protein / calories | 7-day logged intake vs plan targets |
| meal_skips | planned meals marked skipped repeatedly |
| hydration | water below target |
| training | sessions below planned days |
| weight_trend | 14-day trend against goal direction |
| recovery | low energy/sleep check-ins |

Plan changes also raise insights (draft ready, plan applied with target diff). The LLM layer (`review` action) summarises `agent_week_summary()` and may suggest a plan refinement, which becomes a draft needing approval.

## Coach sync (direct plan edits)
The coach always reads the live plan: `agent_plan_state()` builds it from `user_settings` (targets), active `meal_templates` (meals) and the active plan's `training_week`. `agent_baseline` stores the last state the coach acknowledged.

- **Edits are reviewed.** After a settings save, a meal-template change or a training-week save, the client waits 20s (debounced) and calls `assess`. It also runs once on load. The edge function diffs live vs baseline, applies deterministic guards (1200 kcal floor; meals vs target gap > 20%, only if new since baseline), then asks the model for a verdict.
- **ok** -> baseline is acknowledged and the coach says it has adjusted itself. **concern** -> an insight with three options: 1) Accept AI refinement (creates a draft; applying it acknowledges the new baseline), 2) Keep my version (acknowledges the edit), 3) Discuss with AI (opens the coach chat).
- **Coach chat** (`chat` action) is a tool loop over a JSON protocol (provider-agnostic): `get_live_plan`, `get_profile`, `get_plan_changes`, `get_week_summary`, `get_recent_logs`, `propose_plan_update` (draft only), `keep_my_version`. Plans only change when the user applies a draft.
- **Training week** can be edited in the Training tab (`save_training_week` RPC); edits go through the same review.
- Migration: `supabase/migrations/20261109_coach_sync.sql`.
