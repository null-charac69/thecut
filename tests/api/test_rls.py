"""Row-level security and endpoint-auth tests against the live Supabase project.

Principle: user B must never see, change or delete user A's data, and anonymous callers see nothing.
Every row these tests create is removed in a finally block.
"""
import datetime as dt
import uuid

import pytest

USER_TABLES = [
    "agent_baseline", "agent_insights", "ai_plan_versions", "body_measurements", "daily_activity",
    "daily_checkins", "daily_meals", "daily_targets", "food_entries", "foods", "grocery_items",
    "meal_template_items", "meal_templates", "prep_tasks", "progress_photos", "push_notification_deliveries",
    "push_subscriptions", "reminders", "user_settings", "water_logs", "workout_exercises",
    "workout_feedback", "workout_reviews", "workout_sessions", "workout_sets",
]


def _day():
    return (dt.date.today() - dt.timedelta(days=3000 + uuid.uuid4().int % 500)).isoformat()


# ---------- table-wide invariants ----------

@pytest.mark.parametrize("table", USER_TABLES)
def test_user_only_sees_own_rows(b, table):
    r = b.rest("GET", f"{table}?select=user_id&limit=50")
    assert r.status_code == 200, r.text
    assert all(row["user_id"] == b.user_id for row in r.json())


def test_profiles_only_own_row(b):
    r = b.rest("GET", "profiles?select=id&limit=50")
    assert r.status_code == 200
    assert all(row["id"] == b.user_id for row in r.json())


@pytest.mark.parametrize("table", USER_TABLES)
def test_anon_sees_nothing(anon, table):
    r = anon.rest("GET", f"{table}?select=*&limit=5")
    assert r.status_code in (200, 401, 403)
    if r.status_code == 200:
        assert r.json() == []


def test_anon_cannot_see_profiles(anon):
    r = anon.rest("GET", "profiles?select=id&limit=5")
    assert r.status_code in (200, 401, 403)
    if r.status_code == 200:
        assert r.json() == []


# ---------- cross-user read / write / delete ----------

def test_cross_user_cannot_read_update_or_delete(a, b):
    day = _day()
    r = a.rest("POST", "body_measurements", json={"user_id": a.user_id, "measured_on": day, "weight_kg": 70.5},
               headers={"Prefer": "return=representation"})
    assert r.status_code == 201, r.text
    row_id = r.json()[0]["id"]
    try:
        # A can read it
        assert a.rest("GET", f"body_measurements?id=eq.{row_id}&select=weight_kg").json() == [{"weight_kg": 70.5}]
        # B cannot see it
        assert b.rest("GET", f"body_measurements?id=eq.{row_id}&select=id").json() == []
        # B cannot update it
        up = b.rest("PATCH", f"body_measurements?id=eq.{row_id}", json={"weight_kg": 99},
                    headers={"Prefer": "return=representation"})
        assert up.status_code in (200, 204) and (up.status_code == 204 or up.json() == [])
        # B cannot delete it
        de = b.rest("DELETE", f"body_measurements?id=eq.{row_id}", headers={"Prefer": "return=representation"})
        assert de.status_code in (200, 204) and (de.status_code == 204 or de.json() == [])
        # still intact for A, unchanged
        assert a.rest("GET", f"body_measurements?id=eq.{row_id}&select=weight_kg").json() == [{"weight_kg": 70.5}]
    finally:
        a.rest("DELETE", f"body_measurements?id=eq.{row_id}")


def test_cannot_insert_row_owned_by_someone_else(a, b):
    r = b.rest("POST", "body_measurements", json={"user_id": a.user_id, "measured_on": _day(), "weight_kg": 60})
    assert r.status_code in (401, 403), r.text
    assert a.rest("GET", f"body_measurements?measured_on=eq.{_day()}&select=id").json() == []


def test_cannot_reassign_row_to_another_user(a, b):
    day = _day()
    r = a.rest("POST", "body_measurements", json={"user_id": a.user_id, "measured_on": day, "weight_kg": 71},
               headers={"Prefer": "return=representation"})
    row_id = r.json()[0]["id"]
    try:
        up = a.rest("PATCH", f"body_measurements?id=eq.{row_id}", json={"user_id": b.user_id})
        assert up.status_code in (400, 401, 403), up.status_code
    finally:
        a.rest("DELETE", f"body_measurements?id=eq.{row_id}")


def test_db_check_constraints_hold(a):
    bad = a.rest("POST", "body_measurements", json={"user_id": a.user_id, "measured_on": _day(), "weight_kg": 5})
    assert bad.status_code == 400  # CHECK weight 20..500


# ---------- RPCs ----------

def test_apply_plan_rpc_cannot_touch_another_users_plan(a, b):
    r = a.rest("POST", "ai_plan_versions", headers={"Prefer": "return=representation"}, json={
        "user_id": a.user_id, "title": "rls-test draft", "status": "draft", "plan": {"title": "x"}, "model": "test"})
    assert r.status_code == 201, r.text
    plan_id = r.json()[0]["id"]
    try:
        res = b.rpc("apply_ai_plan_version", {"p_version_id": plan_id, "p_local_date": dt.date.today().isoformat(),
                                              "p_week_start": dt.date.today().isoformat()})
        assert res.status_code >= 400 or res.json() in (None, False, [], {}), res.text
        status = a.rest("GET", f"ai_plan_versions?id=eq.{plan_id}&select=status").json()
        assert status == [{"status": "draft"}]
    finally:
        a.rest("DELETE", f"ai_plan_versions?id=eq.{plan_id}")


@pytest.mark.parametrize("fn", ["agent_week_summary", "agent_plan_state"])
def test_rpcs_require_login(anon, fn):
    r = anon.rpc(fn)
    assert r.status_code in (401, 403, 404) or r.json() in (None, [], {}), r.text


# ---------- storage ----------

def test_storage_private_and_isolated(a, b, anon):
    assert b.storage("POST", "object/list/progress-photos", json={"prefix": a.user_id, "limit": 10}).json() == []
    r = b.storage("POST", f"object/progress-photos/{a.user_id}/intruder.txt", content_type="text/plain", data=b"x")
    assert r.status_code in (400, 401, 403), r.text
    pub = anon.storage("GET", f"object/public/progress-photos/{a.user_id}/anything.jpg")
    assert pub.status_code in (400, 401, 403, 404)


# ---------- edge functions ----------

def test_ai_function_requires_jwt(anon):
    assert anon.fn("the-cut-ai", {"action": "review"}, auth=False).status_code == 401
    assert anon.fn("the-cut-ai", {"action": "review"}).status_code == 401  # anon key as bearer is not a user JWT


def test_ai_function_rejects_unknown_action(a):
    r = a.fn("the-cut-ai", {"action": "nope"})
    assert r.status_code == 400


def test_ai_function_rejects_minor_profile(a):
    r = a.fn("the-cut-ai", {"action": "generate", "profile": {"adult_confirmed": False, "age_years": 15,
                                                               "height_cm": 170, "weight_kg": 60, "training_days_per_week": 3}})
    assert r.status_code == 400


def test_delete_account_requires_jwt(anon):
    assert anon.fn("delete-account", {"confirm": "DELETE"}, auth=False).status_code == 401
    assert anon.fn("delete-account", {"confirm": "DELETE"}).status_code == 401


def test_delete_account_requires_exact_confirmation(b):
    for body in ({}, {"confirm": "delete"}, {"confirm": "yes"}):
        r = b.fn("delete-account", body)
        assert r.status_code == 400, (body, r.status_code)
    # account must still exist
    assert b.rest("GET", "profiles?select=id").json() == [{"id": b.user_id}]


def test_push_dispatch_rejects_unauthenticated(anon):
    r = anon.fn("the-cut-push-dispatch", {}, auth=False)
    assert r.status_code in (401, 403)


# ---------- auth ----------

def test_wrong_password_is_rejected(login_raw):
    import os
    email = os.environ.get("TEST_A_EMAIL")
    if not email:
        pytest.skip("TEST_A_EMAIL not set")
    r = login_raw(email, "definitely-wrong-password")
    assert r.status_code == 400
    assert r.json().get("error_code") == "invalid_credentials"
