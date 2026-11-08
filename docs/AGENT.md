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
