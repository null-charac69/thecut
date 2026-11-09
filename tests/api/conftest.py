"""Shared fixtures for API/RLS tests. Credentials come from the environment, never from the repo.

Required env (tests skip if missing):
  TEST_A_EMAIL / TEST_A_PASSWORD   throwaway user A
  TEST_B_EMAIL / TEST_B_PASSWORD   throwaway user B
Optional:
  SUPABASE_URL, SUPABASE_ANON_KEY  default to the public production project values
"""
import os

import pytest
import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://ukyobppectpjkcudgewy.supabase.co").rstrip("/")
# Publishable (public) key: it is already shipped in app.js.
ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "sb_publishable_Lm9JVKNstznjU-r9NGCZEw_YQE0ASeO")


class Client:
    def __init__(self, token=None, user_id=None):
        self.token = token
        self.user_id = user_id

    @property
    def headers(self):
        h = {"apikey": ANON_KEY, "Content-Type": "application/json"}
        h["Authorization"] = f"Bearer {self.token or ANON_KEY}"
        return h

    def rest(self, method, path, **kw):
        extra = kw.pop("headers", {})
        return requests.request(method, f"{SUPABASE_URL}/rest/v1/{path}", headers={**self.headers, **extra}, timeout=30, **kw)

    def rpc(self, fn, body=None):
        return requests.post(f"{SUPABASE_URL}/rest/v1/rpc/{fn}", headers=self.headers, json=body or {}, timeout=30)

    def fn(self, name, body=None, auth=True):
        h = self.headers if auth else {"apikey": ANON_KEY, "Content-Type": "application/json"}
        return requests.post(f"{SUPABASE_URL}/functions/v1/{name}", headers=h, json=body or {}, timeout=60)

    def storage(self, method, path, content_type="application/json", **kw):
        h = {**self.headers, "Content-Type": content_type}
        return requests.request(method, f"{SUPABASE_URL}/storage/v1/{path}", headers=h, timeout=30, **kw)


def _login(prefix):
    email, pw = os.environ.get(f"{prefix}_EMAIL"), os.environ.get(f"{prefix}_PASSWORD")
    if not email or not pw:
        pytest.skip(f"{prefix}_EMAIL / {prefix}_PASSWORD not set")
    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        headers={"apikey": ANON_KEY, "Content-Type": "application/json"},
        json={"email": email, "password": pw},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed for {prefix}: {r.status_code}"
    d = r.json()
    return Client(d["access_token"], d["user"]["id"])


@pytest.fixture(scope="session")
def anon():
    return Client()


@pytest.fixture(scope="session")
def a():
    return _login("TEST_A")


@pytest.fixture(scope="session")
def b():
    return _login("TEST_B")


@pytest.fixture(scope="session")
def login_raw():
    """Password-grant call without asserting success (for negative tests)."""
    def go(email, password):
        return requests.post(
            f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
            headers={"apikey": ANON_KEY, "Content-Type": "application/json"},
            json={"email": email, "password": password},
            timeout=30,
        )
    return go
