"""Tests for channel CRUD in OrgStore + org_router endpoints (O5).

Uses SQLite in-memory (make_test_engine) + FastAPI TestClient. Offline.
No live Postgres, no live Telegram.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import quire.db.org_models  # noqa — register tables
from quire.db.engine import make_test_engine
from quire.db.models import Base
from quire.db.org_models import ensure_org_tables
from quire.org_store import OrgStore, seed_demo_org
from quire.store import Store


@pytest.fixture
def engine(tmp_path):
    # Use a file-backed SQLite so the TestClient (which runs in a worker
    # thread) sees the same data as the fixture setup connection.
    eng = make_test_engine(url=f"sqlite:///{tmp_path}/test_channels.db")
    ensure_org_tables(eng)
    yield eng
    Base.metadata.drop_all(eng)


@pytest.fixture
def store(engine):
    s = OrgStore(engine=engine)
    seed_demo_org(s)
    return s


@pytest.fixture
def client(store, tmp_path):
    from quire.org_router import create_org_router
    from fastapi import FastAPI

    app = FastAPI()
    alignment_store = Store(url=f"sqlite:///{tmp_path}/test_align.db")
    app.include_router(create_org_router(store, alignment_store))
    return TestClient(app)


# ── OrgStore channel CRUD ──────────────────────────────────────────────


def test_add_and_list_channels(store):
    ch_id = store.add_channel("quire", "telegram", {"token": "tok", "chat_id": "123"}, ["alarms"])
    assert ch_id  # UUID returned
    channels = store.list_channels("quire")
    assert len(channels) == 1
    assert channels[0]["transport"] == "telegram"
    # token must be redacted in list_channels output (value should be "***", not "tok")
    cfg_pub = channels[0].get("config_public", {})
    assert cfg_pub.get("token") == "***"
    cfg = channels[0].get("config", {})
    assert cfg.get("token") == "***"
    assert "alarms" in channels[0]["purposes"]


def test_add_channel_different_chat_ids_are_distinct(store):
    """Different chat_ids → different channel rows (each is independent)."""
    id1 = store.add_channel("quire", "telegram", {"token": "tok", "chat_id": "123"}, ["alarms"])
    id2 = store.add_channel("quire", "telegram", {"token": "tok", "chat_id": "456"}, ["alarms"])
    assert id1 != id2
    assert len(store.list_channels("quire")) == 2


def test_get_alarm_channels_includes_full_config(store):
    store.add_channel("quire", "telegram", {"token": "secrettoken", "chat_id": "123"}, ["alarms"])
    channels = store.get_alarm_channels("quire")
    assert len(channels) == 1
    assert channels[0]["config"]["token"] == "secrettoken"  # full config for delivery


def test_get_alarm_channels_filters_by_purpose(store):
    store.add_channel("quire", "telegram", {"token": "tok", "chat_id": "c1"}, ["digest"])
    store.add_channel("quire", "telegram", {"token": "tok", "chat_id": "c2"}, ["alarms"])
    alarm_channels = store.get_alarm_channels("quire")
    assert len(alarm_channels) == 1
    assert alarm_channels[0]["config"]["chat_id"] == "c2"


def test_get_alarm_channels_no_channels(store):
    channels = store.get_alarm_channels("quire")
    assert channels == []


def test_update_delivery_state(store):
    ch_id = store.add_channel("quire", "telegram", {"token": "t", "chat_id": "c"}, ["alarms"])
    store.update_channel_delivery_state(ch_id, ["key1", "key2"])
    channels = store.get_alarm_channels("quire")
    assert set(channels[0]["delivered_keys"]) == {"key1", "key2"}


def test_update_delivery_state_accumulates(store):
    """Re-calling update_delivery_state replaces the full list (caller owns it)."""
    ch_id = store.add_channel("quire", "telegram", {"token": "t", "chat_id": "c"}, ["alarms"])
    store.update_channel_delivery_state(ch_id, ["key1"])
    store.update_channel_delivery_state(ch_id, ["key1", "key2", "key3"])
    channels = store.get_alarm_channels("quire")
    assert set(channels[0]["delivered_keys"]) == {"key1", "key2", "key3"}


def test_remove_channel(store):
    ch_id = store.add_channel("quire", "telegram", {"token": "t", "chat_id": "c"}, ["alarms"])
    assert store.remove_channel(ch_id) is True
    assert store.list_channels("quire") == []


def test_remove_channel_not_found(store):
    assert store.remove_channel("no-such-id") is False


def test_get_channel_full_config(store):
    ch_id = store.add_channel("quire", "telegram", {"token": "mytoken", "chat_id": "c"}, ["alarms"])
    row = store.get_channel(ch_id)
    assert row is not None
    assert row["config"]["token"] == "mytoken"


# ── API endpoints ──────────────────────────────────────────────────────


def test_api_list_channels_empty(client):
    resp = client.get("/api/channels")
    assert resp.status_code == 200
    assert resp.json() == []


def test_api_add_channel(client):
    resp = client.post("/api/channels", json={
        "transport": "telegram",
        "config": {"token": "mytoken", "chat_id": "mychat"},
        "purposes": ["alarms"],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"]
    assert data["status"] == "ok"
    # Listing should now show one channel
    resp2 = client.get("/api/channels")
    assert len(resp2.json()) == 1
    # Token is redacted in list output (shows "***" not the real value)
    ch_list = resp2.json()
    assert ch_list[0]["config_public"].get("token") == "***"


def test_api_add_channel_missing_transport(client):
    resp = client.post("/api/channels", json={"config": {}, "purposes": ["alarms"]})
    assert resp.status_code == 400


def test_api_delete_channel(client):
    resp = client.post("/api/channels", json={
        "transport": "telegram", "config": {"token": "t", "chat_id": "c"}, "purposes": ["alarms"],
    })
    ch_id = resp.json()["id"]
    del_resp = client.delete(f"/api/channels/{ch_id}")
    assert del_resp.status_code == 200
    assert del_resp.json()["deleted"] is True
    assert client.get("/api/channels").json() == []


def test_api_delete_channel_not_found(client):
    resp = client.delete("/api/channels/no-such-id")
    assert resp.status_code == 404


def test_api_test_channel_stub(client):
    """Test-send with stub config (no real token/chat_id) uses StubChannel → ok=True."""
    resp = client.post("/api/channels", json={
        "transport": "telegram",
        "config": {"token": "", "chat_id": ""},
        "purposes": ["alarms"],
    })
    ch_id = resp.json()["id"]
    test_resp = client.post(f"/api/channels/{ch_id}/test")
    assert test_resp.status_code == 200
    body = test_resp.json()
    assert "ok" in body
    # StubChannel (token missing → fallback) should return ok=True
    assert body["ok"] is True


def test_api_test_channel_not_found(client):
    resp = client.post("/api/channels/no-such-id/test")
    assert resp.status_code == 404
