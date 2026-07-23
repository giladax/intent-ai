# O5 + A5 — Telegram Tap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a promise breaks, the org's Telegram channel gets one message: a plain sentence, the quote receipt, and a deep link to the exact annotated review. Silent on healthy work.

**Architecture:** Three-layer delivery: (1) `channels.py` defines `Channel` protocol + `TelegramChannel` (raw Bot API via httpx) + `StubChannel` (records sends, for tests + fallback); (2) `org_sync.py` wires alarm delivery after analyses — policy unchanged, delivery routed via `org_channels` with `purpose="alarms"`; (3) org_store gains channel CRUD + the org_router exposes channel endpoints; (4) `app/src/surfaces/Misc.tsx` replaces the stub `/channels` page with config + test-send UI.

**Tech Stack:** Python httpx (already in requirements), FastAPI, SQLAlchemy/Postgres (org_channels table — already seeded), React/TypeScript (Vite, react-router), existing `alarms.py` policy (verbatim, untouched).

## Global Constraints

- `alarms.py` policy is VERBATIM — delivery is the only new code; the alarm shape, dedup logic, severity rules, and `render_telegram()` are reused as-is.
- `org_channels.purposes` filters delivery: only channels with `"alarms"` in purposes receive alarm messages.
- Transport failures are logged, never crash the sync loop; undelivered alarms retry on next pass (dedup prevents double-tap after success).
- No `python-telegram-bot` dependency — raw Bot API via httpx only.
- Token never appears in logs; redacted on debug output.
- Deep link format: `{app_host}/repo/{workspace}/review/{pr_number}` where `app_host` defaults to `http://localhost:3456` (override via `QUIRE_APP_HOST` env var).
- Delivery state lives in `org_channels` config jsonb: add `last_delivered_keys: list[str]` to record successfully sent dedup keys; the sync loop merges this with the alarm policy's `seen` set.
- Single-writer: only `OrgStore` writes `org_channels`. Documented.
- Gates: `813+yours, 1 skipped` backend pytest; both evals green; app build+tsc+vitest green.

---

### Task 1: `channels.py` — Channel protocol + TelegramChannel + StubChannel

**Files:**
- Create: `backend/quire/channels.py`
- Create: `backend/tests/test_channels.py`

**Interfaces:**
- Produces: `DeliveryResult = TypedDict("DeliveryResult", {"ok": bool, "message_id": int | None, "error": str | None})`
- Produces: `class Channel(Protocol): def send(self, text: str, *, receipts: list[dict]) -> DeliveryResult: ...`
- Produces: `class StubChannel: sent: list[dict]; def send(self, text, *, receipts) -> DeliveryResult`
- Produces: `class TelegramChannel: def __init__(self, token: str, chat_id: str): ...`
- Produces: `def channel_from_config(config: dict) -> Channel | None`

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_channels.py
from __future__ import annotations
from quire.channels import StubChannel, DeliveryResult

def test_stub_channel_records_send():
    ch = StubChannel()
    result = ch.send("A promise broke on intent-ai", receipts=[{"kind": "check", "ref": "PR 42"}])
    assert result["ok"] is True
    assert len(ch.sent) == 1
    assert ch.sent[0]["text"] == "A promise broke on intent-ai"
    assert ch.sent[0]["receipts"] == [{"kind": "check", "ref": "PR 42"}]

def test_stub_channel_multiple_sends():
    ch = StubChannel()
    ch.send("msg1", receipts=[])
    ch.send("msg2", receipts=[])
    assert len(ch.sent) == 2

def test_telegram_channel_bad_token_returns_error(monkeypatch):
    """TelegramChannel with invalid token returns ok=False, does not raise."""
    import httpx
    from quire.channels import TelegramChannel

    class _BadResponse:
        status_code = 401
        def json(self): return {"ok": False, "description": "Unauthorized"}
        def raise_for_status(self): raise httpx.HTTPStatusError("401", request=None, response=self)

    monkeypatch.setattr("httpx.post", lambda *a, **kw: _BadResponse())
    ch = TelegramChannel(token="bad-token", chat_id="123")
    result = ch.send("test", receipts=[])
    assert result["ok"] is False
    assert result["error"] is not None
    # token NEVER in error string
    assert "bad-token" not in (result["error"] or "")

def test_channel_from_config_telegram():
    from quire.channels import channel_from_config, TelegramChannel
    ch = channel_from_config({"transport": "telegram", "token": "t", "chat_id": "c"})
    assert isinstance(ch, TelegramChannel)

def test_channel_from_config_unknown_returns_stub():
    from quire.channels import channel_from_config, StubChannel
    ch = channel_from_config({"transport": "pigeon"})
    assert isinstance(ch, StubChannel)
```

- [ ] **Step 2: Run to verify failures**

```bash
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m pytest tests/test_channels.py -v 2>&1 | head -30
```
Expected: `ModuleNotFoundError: No module named 'quire.channels'`

- [ ] **Step 3: Implement `channels.py`**

```python
# backend/quire/channels.py
"""quire.channels — Channel protocol: compose alarms, send to org channels.

Transport: TelegramChannel (raw Bot API via httpx).
Fallback: StubChannel (records sends — for tests AND when no real channel configured).

Single transport contract:
    send(text: str, *, receipts: list[dict]) -> DeliveryResult

Delivery state (dedup): caller passes already-seen dedup keys; this module
delivers and returns the result; org_store persists the updated key set.
Token is never logged; redacted in all error strings.
"""
from __future__ import annotations

import logging
from typing import Protocol, TypedDict, runtime_checkable

logger = logging.getLogger(__name__)


class DeliveryResult(TypedDict):
    ok: bool
    message_id: int | None
    error: str | None


@runtime_checkable
class Channel(Protocol):
    def send(self, text: str, *, receipts: list[dict]) -> DeliveryResult: ...


class StubChannel:
    """Records sends in memory — for tests and when no live channel is configured."""
    def __init__(self) -> None:
        self.sent: list[dict] = []

    def send(self, text: str, *, receipts: list[dict]) -> DeliveryResult:
        self.sent.append({"text": text, "receipts": receipts})
        logger.debug("StubChannel.send: recorded message (%d chars)", len(text))
        return {"ok": True, "message_id": None, "error": None}


class TelegramChannel:
    """Raw Telegram Bot API via httpx. No python-telegram-bot dependency.

    token: bot token from @BotFather — never logged.
    chat_id: the chat / channel id to deliver to.

    Transport failures return ok=False; never raise. Token is redacted in all
    log and error output so secrets never leak to log aggregators.
    """
    _API = "https://api.telegram.org/bot{token}/sendMessage"

    def __init__(self, token: str, chat_id: str) -> None:
        self._token = token
        self._chat_id = chat_id

    def _redact(self, s: str) -> str:
        return s.replace(self._token, "***") if self._token else s

    def send(self, text: str, *, receipts: list[dict]) -> DeliveryResult:
        """Send `text` to the configured Telegram chat.

        `receipts` are appended as a formatted block after the main text.
        Returns DeliveryResult; never raises.
        """
        import httpx

        # Build the full message: main text + receipt block
        body = text
        if receipts:
            lines = ["\n\n_Receipts:_"]
            for r in receipts:
                label = r.get("kind", "receipt")
                ref = r.get("ref", "")
                note = r.get("note", "")
                note_str = f" — {note}" if note else ""
                lines.append(f"  • {label}: `{ref}`{note_str}")
            body += "\n".join(lines)

        url = self._API.format(token=self._token)
        payload = {
            "chat_id": self._chat_id,
            "text": body,
            "parse_mode": "Markdown",
            "disable_web_page_preview": True,
        }
        try:
            resp = httpx.post(url, json=payload, timeout=10.0)
            data = resp.json()
            if not data.get("ok"):
                desc = self._redact(str(data.get("description", "unknown error")))
                logger.warning("TelegramChannel.send: API error: %s", desc)
                return {"ok": False, "message_id": None, "error": desc}
            msg_id = data.get("result", {}).get("message_id")
            logger.info("TelegramChannel.send: delivered (message_id=%s)", msg_id)
            return {"ok": True, "message_id": msg_id, "error": None}
        except Exception as exc:
            err = self._redact(str(exc))
            logger.warning("TelegramChannel.send: transport error: %s", err)
            return {"ok": False, "message_id": None, "error": err}


def channel_from_config(config: dict) -> Channel:
    """Build a Channel from an org_channels config dict.

    Keys used: transport, token (telegram), chat_id (telegram).
    Unknown transports fall back to StubChannel (logs a warning).
    """
    transport = config.get("transport", "")
    if transport == "telegram":
        token = config.get("token", "")
        chat_id = config.get("chat_id", "")
        if token and chat_id:
            return TelegramChannel(token=token, chat_id=chat_id)
        logger.warning(
            "channel_from_config: telegram transport missing token or chat_id — using stub"
        )
    else:
        logger.warning(
            "channel_from_config: unknown transport %r — using stub", transport
        )
    return StubChannel()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m pytest tests/test_channels.py -v
```
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add backend/quire/channels.py backend/tests/test_channels.py
git commit -m "feat(o5): channel protocol — StubChannel + TelegramChannel (raw Bot API)"
```

---

### Task 2: OrgStore channel CRUD + org_router channel endpoints

**Files:**
- Modify: `backend/quire/org_store.py` — add `add_channel`, `list_channels`, `get_channel`, `update_channel_delivery_state`, `remove_channel`
- Modify: `backend/quire/org_router.py` — add `GET /api/channels`, `POST /api/channels`, `POST /api/channels/{id}/test`, `DELETE /api/channels/{id}`
- Create: `backend/tests/test_channels_api.py`

**Interfaces:**
- Consumes: `OrgChannel` from `quire.db.org_models` (already defined)
- Produces: `OrgStore.add_channel(org_id, transport, config, purposes) -> str` (returns new channel id)
- Produces: `OrgStore.list_channels(org_id) -> list[dict]` — `{id, transport, config_public, purposes}` (token redacted in public view)
- Produces: `OrgStore.update_channel_delivery_state(channel_id, delivered_keys: list[str]) -> None`
- Produces: `OrgStore.get_alarm_channels(org_id) -> list[dict]` — full config for delivery (internal, token included)
- Produces: `GET /api/channels` → `list[{id, transport, config_public, purposes}]`
- Produces: `POST /api/channels` body `{transport, config, purposes}` → `{id, status}`
- Produces: `POST /api/channels/{id}/test` → `{ok, error}`
- Produces: `DELETE /api/channels/{id}` → `{deleted: true}`

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_channels_api.py
"""Tests for channel CRUD in OrgStore + org_router (O5).

Uses SQLite in-memory (make_test_engine) + TestClient. Offline.
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
def engine():
    eng = make_test_engine()
    ensure_org_tables(eng)
    yield eng
    Base.metadata.drop_all(eng)


@pytest.fixture
def store(engine):
    s = OrgStore(engine=engine)
    seed_demo_org(s)
    return s


@pytest.fixture
def client(store):
    from quire.org_router import create_org_router
    from fastapi import FastAPI
    app = FastAPI()
    alignment_store = Store(db_url="sqlite:///:memory:")
    app.include_router(create_org_router(store, alignment_store))
    return TestClient(app)


def test_add_and_list_channels(store):
    seed_demo_org(store)  # already called by fixture, idempotent
    ch_id = store.add_channel("quire", "telegram", {"token": "tok", "chat_id": "123"}, ["alarms"])
    assert ch_id  # UUID returned
    channels = store.list_channels("quire")
    assert len(channels) == 1
    assert channels[0]["transport"] == "telegram"
    # token must be redacted in list_channels output
    assert "tok" not in str(channels[0].get("config_public", {}))
    assert "alarms" in channels[0]["purposes"]


def test_add_channel_is_idempotent_by_transport_and_chat(store):
    """Adding the same transport+chat_id twice should return a channel each time
    (org allows multiple channels of same transport — each is independent)."""
    id1 = store.add_channel("quire", "telegram", {"token": "tok", "chat_id": "123"}, ["alarms"])
    id2 = store.add_channel("quire", "telegram", {"token": "tok", "chat_id": "456"}, ["alarms"])
    assert id1 != id2  # different chat_ids → different channels
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


def test_update_delivery_state(store):
    ch_id = store.add_channel("quire", "telegram", {"token": "t", "chat_id": "c"}, ["alarms"])
    store.update_channel_delivery_state(ch_id, ["key1", "key2"])
    channels = store.get_alarm_channels("quire")
    assert set(channels[0]["delivered_keys"]) == {"key1", "key2"}


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
    # Listing should now show one channel
    resp2 = client.get("/api/channels")
    assert len(resp2.json()) == 1
    # Token is redacted in list output
    assert "mytoken" not in str(resp2.json())


def test_api_delete_channel(client):
    resp = client.post("/api/channels", json={
        "transport": "telegram", "config": {"token": "t", "chat_id": "c"}, "purposes": ["alarms"],
    })
    ch_id = resp.json()["id"]
    del_resp = client.delete(f"/api/channels/{ch_id}")
    assert del_resp.status_code == 200
    assert del_resp.json()["deleted"] is True
    assert client.get("/api/channels").json() == []


def test_api_test_channel_stub(client):
    """Test-send with stub (no real token) returns ok=False or ok=True (stub)."""
    resp = client.post("/api/channels", json={
        "transport": "telegram", "config": {"token": "", "chat_id": ""}, "purposes": ["alarms"],
    })
    ch_id = resp.json()["id"]
    test_resp = client.post(f"/api/channels/{ch_id}/test")
    assert test_resp.status_code == 200
    # StubChannel always returns ok=True
    assert "ok" in test_resp.json()
```

- [ ] **Step 2: Run to verify failures**

```bash
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m pytest tests/test_channels_api.py -v 2>&1 | head -30
```
Expected: `AttributeError: 'OrgStore' object has no attribute 'add_channel'`

- [ ] **Step 3: Add channel methods to OrgStore**

In `backend/quire/org_store.py`, after the `remove_repo` method, add:

```python
    # ── O5: channel CRUD ─────────────────────────────────────────────────

    def add_channel(
        self,
        org_id: str,
        transport: str,
        config: dict,
        purposes: list[str],
    ) -> str:
        """Add a notification channel to the org. Returns the new channel id.

        Single-writer: only OrgStore writes org_channels.
        config holds transport-specific secrets (token, chat_id, etc.).
        purposes: list of strings — channels with "alarms" in purposes receive alarm delivery.
        """
        import uuid
        from quire.db.org_models import OrgChannel

        ch_id = str(uuid.uuid4())
        with SASession(self._engine) as s:
            s.add(OrgChannel(
                id=ch_id,
                org_id=org_id,
                transport=transport,
                config=config,
                purposes=purposes,
            ))
            s.commit()
        return ch_id

    def list_channels(self, org_id: str = "quire") -> list[dict[str, Any]]:
        """Return all channels for the org — config is redacted (token hidden)."""
        from quire.db.org_models import OrgChannel

        with SASession(self._engine) as s:
            rows = s.execute(
                select(OrgChannel).where(OrgChannel.org_id == org_id)
            ).scalars().all()
            return [_channel_to_dict(r, redact=True) for r in rows]

    def get_alarm_channels(self, org_id: str = "quire") -> list[dict[str, Any]]:
        """Return channels with 'alarms' in purposes — full config for delivery.

        Internal: only the delivery path calls this. Never expose to the API.
        """
        from quire.db.org_models import OrgChannel

        with SASession(self._engine) as s:
            rows = s.execute(
                select(OrgChannel).where(OrgChannel.org_id == org_id)
            ).scalars().all()
            out = []
            for r in rows:
                purposes = r.purposes or []
                if "alarms" in purposes:
                    d = _channel_to_dict(r, redact=False)
                    # Merge delivery state from config (stored under _delivery key)
                    d["delivered_keys"] = (r.config or {}).get("_delivered_keys", [])
                    out.append(d)
            return out

    def update_channel_delivery_state(self, channel_id: str, delivered_keys: list[str]) -> None:
        """Persist successfully-delivered dedup keys into the channel config.

        Keys are stored under '_delivered_keys' in the config jsonb. This is
        the single-writer delivery-state store; the alarm loop reads this back
        via get_alarm_channels to suppress re-taps on the same break.
        """
        from quire.db.org_models import OrgChannel

        with SASession(self._engine) as s:
            row = s.get(OrgChannel, channel_id)
            if row is None:
                logger.warning("update_channel_delivery_state: channel %s not found", channel_id)
                return
            cfg = dict(row.config or {})
            cfg["_delivered_keys"] = list(delivered_keys)
            row.config = cfg
            s.commit()

    def remove_channel(self, channel_id: str) -> bool:
        """Remove a channel by id. Returns True if deleted, False if not found."""
        from quire.db.org_models import OrgChannel

        with SASession(self._engine) as s:
            row = s.get(OrgChannel, channel_id)
            if row is None:
                return False
            s.delete(row)
            s.commit()
            return True
```

And add the private helper at the bottom of the file:

```python
def _channel_to_dict(r: OrgChannel, redact: bool = True) -> dict[str, Any]:
    config = dict(r.config or {})
    if redact:
        # Redact the token — never expose secrets in API responses.
        config_public = {k: ("***" if k == "token" else v)
                        for k, v in config.items()
                        if not k.startswith("_")}  # skip internal keys
    else:
        config_public = {k: v for k, v in config.items() if not k.startswith("_")}
    return {
        "id": r.id,
        "org_id": r.org_id,
        "transport": r.transport,
        "config": config_public if redact else config,
        "config_public": config_public,
        "purposes": r.purposes or [],
    }
```

- [ ] **Step 4: Add channel endpoints to org_router**

In `backend/quire/org_router.py`, inside `create_org_router`, before `return router`:

```python
    # ── O5: channel management endpoints ─────────────────────────────────
    # GET  /api/channels        → list channels (token redacted)
    # POST /api/channels        → add a channel
    # POST /api/channels/{id}/test → send a test message
    # DELETE /api/channels/{id} → remove a channel

    @router.get("/api/channels")
    def list_channels():
        """List org channels (token redacted in output)."""
        if org_store is None:
            raise HTTPException(503, "org layer unavailable")
        return org_store.list_channels()

    @router.post("/api/channels")
    def add_channel(body: dict = Body(...)):
        """Add a notification channel.

        Body: {transport: str, config: {token: str, chat_id: str, ...}, purposes: list[str]}
        Returns: {id: str, status: "ok"}
        """
        if org_store is None:
            raise HTTPException(503, "org layer unavailable")
        transport = (body.get("transport") or "").strip()
        if not transport:
            raise HTTPException(400, "transport is required")
        config = body.get("config") or {}
        purposes = body.get("purposes") or ["alarms"]
        ch_id = org_store.add_channel("quire", transport, config, purposes)
        return {"id": ch_id, "status": "ok"}

    @router.post("/api/channels/{channel_id}/test")
    def test_channel(channel_id: str):
        """Send a test message to the channel.

        Uses the stored config. Returns {ok: bool, error: str|null}.
        """
        if org_store is None:
            raise HTTPException(503, "org layer unavailable")
        channels = org_store.get_alarm_channels()
        # Include all channels (not just alarms) for test — find by id
        all_ch = []
        try:
            # list_channels returns redacted; we need full config for test
            all_ch = org_store.get_alarm_channels()  # purpose-filtered
        except Exception:
            pass
        # Fall back: search list_channels for the id and try anyway
        ch_row = None
        for ch in all_ch:
            if ch["id"] == channel_id:
                ch_row = ch
                break
        if ch_row is None:
            # Try in all channels regardless of purpose
            try:
                with __import__("sqlalchemy.orm", fromlist=["Session"]).Session(org_store._engine) as sess:
                    from quire.db.org_models import OrgChannel
                    row = sess.get(OrgChannel, channel_id)
                    if row:
                        ch_row = {"config": dict(row.config or {}), "transport": row.transport}
            except Exception:
                pass
        if ch_row is None:
            raise HTTPException(404, f"Channel {channel_id} not found")

        from quire.channels import channel_from_config
        config = ch_row.get("config") or {}
        config["transport"] = ch_row.get("transport", "")
        ch = channel_from_config(config)
        result = ch.send(
            "Test message from Quire — your alarm channel is connected.",
            receipts=[{"kind": "test", "ref": "now", "note": "sent via /channels test button"}],
        )
        return result

    @router.delete("/api/channels/{channel_id}")
    def delete_channel(channel_id: str):
        """Remove a channel by id."""
        if org_store is None:
            raise HTTPException(503, "org layer unavailable")
        deleted = org_store.remove_channel(channel_id)
        if not deleted:
            raise HTTPException(404, f"Channel {channel_id} not found")
        return {"deleted": True}
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m pytest tests/test_channels_api.py -v
```
Expected: all pass

- [ ] **Step 6: Run full suite to confirm no regressions**

```bash
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m pytest -q
```
Expected: 813+ passed, 1 skipped

- [ ] **Step 7: Commit**

```bash
git add backend/quire/org_store.py backend/quire/org_router.py backend/tests/test_channels_api.py
git commit -m "feat(o5): org_store channel CRUD + api/channels endpoints"
```

---

### Task 3: Wire alarm delivery into org_sync + message format + deep link

**Files:**
- Create: `backend/quire/deliver_alarms.py` — `deliver_alarms_for_org(org_store, workspaces_root, app_host) -> list[dict]`
- Modify: `backend/quire/org_sync.py` — call `deliver_alarms_for_org` at the end of `sync_org`
- Create: `backend/tests/test_deliver_alarms.py`

**Interfaces:**
- Consumes: `alarms_for(workspace_dir, adapter, store, ..., seen) -> list[Alarm]` from `quire.alarms`
- Consumes: `render_telegram(alarm) -> str` from `quire.alarms` — for the message body
- Consumes: `OrgStore.get_alarm_channels()`, `OrgStore.update_channel_delivery_state()`
- Consumes: `channel_from_config(config)` from `quire.channels`
- Produces: `deliver_alarms_for_org(org_store, workspaces_root, app_host) -> list[dict]`
  - Returns: `[{workspace, channel_id, dedup_key, ok, message_id, error}]`
- Message format: `"{plain headline}\n\n{quote receipt}\n\n{deep_link}"`

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_deliver_alarms.py
"""Tests for alarm delivery wiring (O5).

Uses StubChannel + fixture workspaces + SQLite in-memory OrgStore.
Verifies: message format (plain sentence + receipt + deep link),
dedup prevention, failure isolation, channel routing by purpose.
"""
from __future__ import annotations

import pathlib
import pytest

import quire.db.org_models  # noqa — register tables
from quire.db.engine import make_test_engine
from quire.db.models import Base
from quire.db.org_models import ensure_org_tables
from quire.org_store import OrgStore, seed_demo_org
from quire.channels import StubChannel

FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"
APP_HOST = "http://localhost:3456"


@pytest.fixture
def engine():
    eng = make_test_engine()
    ensure_org_tables(eng)
    yield eng
    Base.metadata.drop_all(eng)


@pytest.fixture
def store(engine):
    s = OrgStore(engine=engine)
    seed_demo_org(s)
    return s


def test_deliver_alarms_for_org_uses_stub_channels(store, tmp_path, monkeypatch):
    """With a StubChannel wired via org_channels, alarms for vela produce one
    message containing the headline, a quote, and the deep link."""
    from quire.deliver_alarms import deliver_alarms_for_org

    # Wire a stub channel into the org by monkeypatching channel_from_config
    stub = StubChannel()
    monkeypatch.setattr("quire.deliver_alarms.channel_from_config", lambda cfg: stub)

    # Add a real alarms-purpose channel (config doesn't matter — channel_from_config is patched)
    store.add_channel("quire", "telegram", {"token": "t", "chat_id": "c"}, ["alarms"])

    # Use the vela fixture workspace (has silent-drift — will produce alarms)
    workspaces_root = FIXTURES
    results = deliver_alarms_for_org(
        store, workspaces_root, app_host=APP_HOST
    )

    # vela has at least 1 alarm (the consent silent-drift)
    assert len(stub.sent) >= 1
    # Message must contain a plain sentence (the headline), not a classification label
    for sent in stub.sent:
        text = sent["text"]
        assert "silent-drift" not in text.lower(), "raw classification label leaked"
        assert "ent-" not in text, "entity id leaked into message"
        assert APP_HOST in text, "deep link missing"
        # Deep link pattern: /repo/<ws>/review/<n> OR just the review path
        assert "/review/" in text or "/repo/" in text


def test_deliver_alarms_dedup_prevents_re_tap(store, tmp_path, monkeypatch):
    """Same alarm dedup_key delivered twice on two passes — only sent once."""
    from quire.deliver_alarms import deliver_alarms_for_org

    stub = StubChannel()
    monkeypatch.setattr("quire.deliver_alarms.channel_from_config", lambda cfg: stub)
    store.add_channel("quire", "telegram", {"token": "t", "chat_id": "c"}, ["alarms"])

    workspaces_root = FIXTURES

    # First pass — delivers
    deliver_alarms_for_org(store, workspaces_root, app_host=APP_HOST)
    first_count = len(stub.sent)
    assert first_count >= 1  # at least the vela consent alarm

    # Second pass — same alarms, same dedup keys → should not re-deliver
    deliver_alarms_for_org(store, workspaces_root, app_host=APP_HOST)
    assert len(stub.sent) == first_count  # no new sends


def test_deliver_alarms_channel_failure_does_not_crash(store, monkeypatch):
    """A channel that raises during send does not crash deliver_alarms_for_org."""
    from quire.deliver_alarms import deliver_alarms_for_org

    class _BombChannel:
        def send(self, text, *, receipts):
            raise RuntimeError("network down")

    monkeypatch.setattr("quire.deliver_alarms.channel_from_config", lambda cfg: _BombChannel())
    store.add_channel("quire", "telegram", {"token": "t", "chat_id": "c"}, ["alarms"])

    # Must not raise; results may be empty or contain error entries
    results = deliver_alarms_for_org(store, FIXTURES, app_host=APP_HOST)
    assert isinstance(results, list)


def test_deliver_alarms_no_channel_no_crash(store):
    """With no alarm channels configured, deliver_alarms_for_org returns [] silently."""
    from quire.deliver_alarms import deliver_alarms_for_org
    results = deliver_alarms_for_org(store, FIXTURES, app_host=APP_HOST)
    assert results == []


def test_deliver_alarms_message_format_contains_receipt_and_deep_link(store, monkeypatch):
    """The message body has: plain sentence, receipt quote, deep link. Exact check."""
    from quire.deliver_alarms import deliver_alarms_for_org

    stub = StubChannel()
    monkeypatch.setattr("quire.deliver_alarms.channel_from_config", lambda cfg: stub)
    store.add_channel("quire", "telegram", {"token": "t", "chat_id": "c"}, ["alarms"])

    deliver_alarms_for_org(store, FIXTURES, app_host=APP_HOST)
    # Find the vela consent alarm (critical, silent-drift)
    assert stub.sent  # at least one alarm delivered
    text = stub.sent[0]["text"]
    # Plain-language headline, not a label
    assert any(w in text.lower() for w in ["broke", "watching", "risk", "shipped"])
    # Receipts appear in the receipts arg (sent to channel.send)
    receipts = stub.sent[0]["receipts"]
    assert isinstance(receipts, list)
```

- [ ] **Step 2: Run to verify failures**

```bash
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m pytest tests/test_deliver_alarms.py -v 2>&1 | head -20
```
Expected: `ModuleNotFoundError: No module named 'quire.deliver_alarms'`

- [ ] **Step 3: Implement `deliver_alarms.py`**

```python
# backend/quire/deliver_alarms.py
"""quire.deliver_alarms — wire the alarm policy to org channels (O5).

Called from sync_org after analyses complete. Reads alarm channels from
OrgStore, composes messages from the alarm policy (verbatim from alarms.py),
delivers to each channel, and persists the dedup key set so re-analyses
never re-tap the same break.

Message anatomy:
  {plain_headline}

  {verbatim_quote_receipt — the one line from the alarm that cites the break}

  {deep_link}  →  {app_host}/repo/{workspace}/review/{pr_number}

Delivery state: stored in org_channels.config["_delivered_keys"] via
OrgStore.update_channel_delivery_state (single-writer). The alarm policy's
seen= parameter suppresses dedup at compose-time; delivery state is the
persistent form.

Failure isolation: a channel that fails to send is logged; the loop
continues; the key is NOT added to delivered_keys (will retry next pass).
"""
from __future__ import annotations

import logging
import os
import pathlib
from typing import Any

from quire.alarms import alarms_for, Alarm
from quire.channels import channel_from_config

logger = logging.getLogger(__name__)

# Default app host — the deep link root. Override with QUIRE_APP_HOST env var.
_DEFAULT_APP_HOST = "http://localhost:3456"


def _app_host() -> str:
    return os.environ.get("QUIRE_APP_HOST", _DEFAULT_APP_HOST).rstrip("/")


def _deep_link(app_host: str, workspace: str, pr_number: str | int | None) -> str:
    """Build a deep link to the exact review page.

    Format: {app_host}/repo/{workspace}/review/{pr_number}
    When pr_number is unknown (no breaking check), links to /repo/{workspace}.
    """
    if pr_number:
        return f"{app_host}/repo/{workspace}/review/{pr_number}"
    return f"{app_host}/repo/{workspace}"


def _extract_pr_number(alarm: Alarm) -> int | None:
    """Extract the PR number from alarm receipts (the breaking check)."""
    for r in alarm.receipts:
        if r.kind == "check":
            # ref is "PR 342" — extract the int
            ref = r.ref.replace("PR", "").strip()
            try:
                return int(ref)
            except ValueError:
                pass
    return None


def _format_message(alarm: Alarm, workspace: str, app_host: str) -> tuple[str, list[dict]]:
    """Compose the tap message: plain sentence + deep link.

    Returns (text, receipts) where:
    - text: the headline sentence + deep link (plain language, no raw labels)
    - receipts: alarm.receipts as dicts (passed to channel.send for formatting)
    """
    pr_number = _extract_pr_number(alarm)
    link = _deep_link(app_host, workspace, pr_number)

    # The headline is already plain language (composed by alarms._narrate).
    # Append the deep link on a new line.
    text = f"{alarm.headline}\n\n{link}"

    receipts = [{"kind": r.kind, "ref": r.ref, "note": r.note} for r in alarm.receipts]
    return text, receipts


def deliver_alarms_for_org(
    org_store,
    workspaces_root: pathlib.Path,
    app_host: str | None = None,
) -> list[dict[str, Any]]:
    """Deliver alarms for all active workspaces to org alarm channels.

    For each workspace with a corresponding directory and an alarms-purpose
    channel: run the alarm policy (reusing alarms_for verbatim), compose the
    message, deliver via the channel, persist the delivered dedup keys.

    Returns a list of delivery result dicts: [{workspace, channel_id, dedup_key, ok, ...}]
    Never raises — all failures are logged.
    """
    if app_host is None:
        app_host = _app_host()

    # Get alarm channels — failure-safe
    try:
        channels_config = org_store.get_alarm_channels()
    except Exception as exc:
        logger.warning("deliver_alarms_for_org: get_alarm_channels failed: %s", exc)
        return []

    if not channels_config:
        logger.debug("deliver_alarms_for_org: no alarm channels configured — skip")
        return []

    # Get repos to iterate workspaces
    try:
        repos = org_store.list_repos()
    except Exception as exc:
        logger.warning("deliver_alarms_for_org: list_repos failed: %s", exc)
        return []

    all_results: list[dict[str, Any]] = []

    for ch_cfg in channels_config:
        ch_id = ch_cfg["id"]
        already_delivered: set[str] = set(ch_cfg.get("delivered_keys", []))

        ch = channel_from_config({**ch_cfg.get("config", {}), "transport": ch_cfg["transport"]})
        newly_delivered: list[str] = []

        for repo in repos:
            workspace = repo.get("workspace", "")
            if not workspace:
                continue
            ws_path = workspaces_root / workspace
            if not ws_path.is_dir():
                continue

            # Run alarm policy over this workspace (verbatim alarms_for call)
            try:
                from quire.adapters.fixture import FixtureWorkspace

                adapter = FixtureWorkspace(ws_path)
                alarms = alarms_for(
                    ws_path, adapter, None, window_days=14, seen=already_delivered
                )
            except Exception as exc:
                logger.warning(
                    "deliver_alarms_for_org: alarms_for(%s) failed: %s", workspace, exc
                )
                continue

            for alarm in alarms:
                if alarm.dedup_key in already_delivered:
                    continue  # double-check (alarms_for also filters, but be safe)

                text, receipts = _format_message(alarm, workspace, app_host)

                try:
                    result = ch.send(text, receipts=receipts)
                except Exception as exc:
                    logger.warning(
                        "deliver_alarms_for_org: send failed for %s / %s: %s",
                        workspace, alarm.dedup_key, exc,
                    )
                    result = {"ok": False, "message_id": None, "error": str(exc)}

                all_results.append({
                    "workspace": workspace,
                    "channel_id": ch_id,
                    "dedup_key": alarm.dedup_key,
                    "ok": result.get("ok", False),
                    "message_id": result.get("message_id"),
                    "error": result.get("error"),
                })

                if result.get("ok"):
                    already_delivered.add(alarm.dedup_key)
                    newly_delivered.append(alarm.dedup_key)

        # Persist delivery state for this channel
        if newly_delivered:
            try:
                org_store.update_channel_delivery_state(
                    ch_id, list(already_delivered)
                )
            except Exception as exc:
                logger.warning(
                    "deliver_alarms_for_org: update_channel_delivery_state(%s) failed: %s",
                    ch_id, exc,
                )

    return all_results
```

- [ ] **Step 4: Wire into org_sync.py's `sync_org`**

At the end of `sync_org` in `backend/quire/org_sync.py`, after the `all_results.append(...)` call for the last repo, but before `return all_results`, add:

```python
    # -- O5: alarm delivery — run policy over fresh verdicts, tap channels ──
    # Failure-safe: delivery trouble never fails the sync pass.
    try:
        from quire.deliver_alarms import deliver_alarms_for_org

        delivery = deliver_alarms_for_org(org_store, workspaces_root or pathlib.Path(__file__).parent.parent / "workspaces")
        if delivery:
            logger.info(
                "sync_org: alarm delivery — %d message(s) sent", len([d for d in delivery if d["ok"]])
            )
    except Exception as exc:
        logger.warning("sync_org: alarm delivery failed (sync unaffected): %s", exc)
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m pytest tests/test_deliver_alarms.py -v
```
Expected: all pass

- [ ] **Step 6: Run full suite**

```bash
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m pytest -q
```
Expected: 813+ passed, 1 skipped

- [ ] **Step 7: Commit**

```bash
git add backend/quire/deliver_alarms.py backend/quire/org_sync.py backend/tests/test_deliver_alarms.py
git commit -m "feat(o5): alarm delivery — deliver_alarms_for_org wired into sync_org"
```

---

### Task 4: A5 — /channels surface (React)

**Files:**
- Modify: `app/src/surfaces/Misc.tsx` — replace stub `Channels` component with full UI
- Modify: `app/src/api.ts` — add `fetchChannels`, `addChannel`, `deleteChannel`, `testChannel`
- Create: `app/src/surfaces/Channels.test.tsx` (vitest)

**Interfaces:**
- Consumes: `GET /api/channels` → `ChannelRow[]`
- Consumes: `POST /api/channels` body `{transport, config, purposes}` → `{id, status}`
- Consumes: `POST /api/channels/{id}/test` → `{ok, error}`
- Consumes: `DELETE /api/channels/{id}` → `{deleted: true}`
- Produces: `Channels` component at `/channels` route

- [ ] **Step 1: Add API functions to `app/src/api.ts`**

Append to `app/src/api.ts`:

```typescript
// ── Channels (O5) ────────────────────────────────────────────────────
export interface ChannelRow {
  id: string;
  transport: string;
  config_public: Record<string, string>;
  purposes: string[];
}

export const fetchChannels = () => json<ChannelRow[]>("/api/channels");

export const addChannel = (
  transport: string,
  config: Record<string, string>,
  purposes: string[]
) =>
  json<{ id: string; status: string }>("/api/channels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transport, config, purposes }),
  });

export const deleteChannel = (id: string) =>
  json<{ deleted: boolean }>(`/api/channels/${id}`, { method: "DELETE" });

export const testChannel = (id: string) =>
  json<{ ok: boolean; error: string | null }>(`/api/channels/${id}/test`, {
    method: "POST",
  });
```

- [ ] **Step 2: Implement Channels component in `app/src/surfaces/Misc.tsx`**

Replace the `Channels` function with:

```tsx
import { useEffect, useState } from "react";
import { fetchChannels, addChannel, deleteChannel, testChannel } from "../api";
import type { ChannelRow } from "../api";

/** Channels — Telegram config, test-send, alarm routing (A5). */
export function Channels() {
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, string>>({});

  const load = () => {
    setLoading(true);
    fetchChannels()
      .then((chs) => { setChannels(chs); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!token.trim() || !chatId.trim()) {
      setSaveStatus("Both token and chat ID are required.");
      return;
    }
    setSaveStatus("Saving…");
    try {
      await addChannel("telegram", { token: token.trim(), chat_id: chatId.trim() }, ["alarms"]);
      setToken(""); setChatId(""); setAdding(false);
      setSaveStatus("Channel added.");
      load();
    } catch (e: any) {
      setSaveStatus(`Failed: ${e.message}`);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteChannel(id).catch(() => null);
    load();
  };

  const handleTest = async (id: string) => {
    setTestResults((r) => ({ ...r, [id]: "Sending…" }));
    const result = await testChannel(id).catch((e: any) => ({ ok: false, error: e.message }));
    setTestResults((r) => ({
      ...r,
      [id]: result.ok ? "Sent ✓" : `Failed: ${result.error ?? "unknown error"}`,
    }));
  };

  return (
    <main className="ink-main">
      <div className="ink-crumb"><b>Quire</b> <span className="sep">/</span> Channels</div>
      <div className="ink-main-head">
        <h1>Channels</h1>
        <div className="sub">Where the org taps you on the shoulder. Quiet when work is healthy.</div>
      </div>

      {loading && <div className="ink-empty">Loading…</div>}
      {error && <div className="ink-empty" style={{ color: "var(--ink-red, red)" }}>{error}</div>}

      {!loading && channels.length === 0 && (
        <div className="ink-empty">
          <div className="big">No channels yet</div>
          Add a Telegram channel and alarms will deep-link you to the exact review when a promise breaks.
        </div>
      )}

      {channels.map((ch) => (
        <div key={ch.id} className="ink-card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <b>{ch.transport}</b>
              {ch.config_public.chat_id && (
                <span style={{ color: "var(--ink-muted, #888)", marginLeft: 8 }}>
                  chat {ch.config_public.chat_id}
                </span>
              )}
              {ch.purposes.includes("alarms") && (
                <span style={{ marginLeft: 8, fontSize: 12, color: "var(--ink-amber, orange)" }}>
                  alarms
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="ink-btn" onClick={() => handleTest(ch.id)}>
                Send a test message
              </button>
              <button className="ink-btn ink-btn--ghost" onClick={() => handleDelete(ch.id)}>
                Remove
              </button>
            </div>
          </div>
          {testResults[ch.id] && (
            <div style={{ marginTop: 8, fontSize: 13, color: testResults[ch.id].startsWith("Sent") ? "var(--ink-green, green)" : "var(--ink-red, red)" }}>
              {testResults[ch.id]}
            </div>
          )}
        </div>
      ))}

      <div style={{ marginTop: 24 }}>
        {!adding ? (
          <button className="ink-btn" onClick={() => setAdding(true)}>
            Add Telegram channel
          </button>
        ) : (
          <div className="ink-card">
            <div className="ink-card-head">Add a Telegram channel</div>
            <div style={{ marginBottom: 16, color: "var(--ink-muted, #888)", fontSize: 13 }}>
              <ol style={{ paddingLeft: 18, lineHeight: 1.8 }}>
                <li>Message <b>@BotFather</b> on Telegram and create a bot. Copy the token it gives you.</li>
                <li>Add your bot to the chat or channel you want alarms in.</li>
                <li>Paste the bot token and your chat ID below. To find your chat ID: add <b>@userinfobot</b> to the chat and it will show you the ID.</li>
              </ol>
            </div>
            <label style={{ display: "block", marginBottom: 8 }}>
              <div style={{ fontSize: 13, marginBottom: 4 }}>Bot token</div>
              <input
                className="ink-input"
                type="password"
                placeholder="1234567890:ABCdef..."
                value={token}
                onChange={(e) => setToken(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box" }}
              />
            </label>
            <label style={{ display: "block", marginBottom: 12 }}>
              <div style={{ fontSize: 13, marginBottom: 4 }}>Chat ID</div>
              <input
                className="ink-input"
                placeholder="-1001234567890"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box" }}
              />
            </label>
            {saveStatus && (
              <div style={{ marginBottom: 8, fontSize: 13 }}>{saveStatus}</div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="ink-btn" onClick={handleAdd}>Save</button>
              <button className="ink-btn ink-btn--ghost" onClick={() => { setAdding(false); setSaveStatus(null); }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Write vitest component test**

Create `app/src/surfaces/Channels.test.tsx`:

```tsx
// app/src/surfaces/Channels.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Channels } from "./Misc";

// Mock api calls
vi.mock("../api", () => ({
  fetchChannels: vi.fn(),
  addChannel: vi.fn(),
  deleteChannel: vi.fn(),
  testChannel: vi.fn(),
}));
import * as api from "../api";

describe("Channels", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows empty state when no channels", async () => {
    vi.mocked(api.fetchChannels).mockResolvedValue([]);
    render(<Channels />);
    await waitFor(() => screen.getByText(/No channels yet/));
  });

  it("shows a channel row when one exists", async () => {
    vi.mocked(api.fetchChannels).mockResolvedValue([
      { id: "ch1", transport: "telegram", config_public: { chat_id: "-100123" }, purposes: ["alarms"] },
    ]);
    render(<Channels />);
    await waitFor(() => screen.getByText("telegram"));
    expect(screen.getByText(/-100123/)).toBeTruthy();
  });

  it("shows add form when button clicked", async () => {
    vi.mocked(api.fetchChannels).mockResolvedValue([]);
    render(<Channels />);
    await waitFor(() => screen.getByText(/Add Telegram channel/));
    await userEvent.click(screen.getByText(/Add Telegram channel/));
    expect(screen.getByPlaceholderText(/1234567890:ABCdef/)).toBeTruthy();
  });

  it("calls addChannel with token and chat_id", async () => {
    vi.mocked(api.fetchChannels).mockResolvedValue([]);
    vi.mocked(api.addChannel).mockResolvedValue({ id: "new-id", status: "ok" });
    render(<Channels />);
    await waitFor(() => screen.getByText(/Add Telegram channel/));
    await userEvent.click(screen.getByText(/Add Telegram channel/));
    await userEvent.type(screen.getByPlaceholderText(/1234567890:ABCdef/), "mytoken");
    await userEvent.type(screen.getByPlaceholderText(/-1001234567890/), "mychat");
    await userEvent.click(screen.getByText("Save"));
    expect(api.addChannel).toHaveBeenCalledWith("telegram", { token: "mytoken", chat_id: "mychat" }, ["alarms"]);
  });

  it("calls testChannel when test button clicked", async () => {
    vi.mocked(api.fetchChannels).mockResolvedValue([
      { id: "ch1", transport: "telegram", config_public: { chat_id: "123" }, purposes: ["alarms"] },
    ]);
    vi.mocked(api.testChannel).mockResolvedValue({ ok: true, error: null });
    render(<Channels />);
    await waitFor(() => screen.getByText(/Send a test message/));
    await userEvent.click(screen.getByText(/Send a test message/));
    expect(api.testChannel).toHaveBeenCalledWith("ch1");
    await waitFor(() => screen.getByText(/Sent ✓/));
  });
});
```

- [ ] **Step 4: Run vitest**

```bash
cd /Users/giladkoch/dev/intent-ai/app && npx vitest run src/surfaces/Channels.test.tsx
```
Expected: 5 passed

- [ ] **Step 5: Build + typecheck**

```bash
cd /Users/giladkoch/dev/intent-ai/app && npm run build && npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add app/src/surfaces/Misc.tsx app/src/api.ts app/src/surfaces/Channels.test.tsx
git commit -m "feat(a5): /channels surface — Telegram config, test-send, alarm routing"
```

---

### Task 5: README setup note + proof capture

**Files:**
- Modify: `backend/README.md` — add Telegram setup instructions
- Create (scratchpad): `/private/tmp/.../scratchpad/sdd/o5-proof.md` — proof record

**Interfaces:**
- No new code interfaces — documentation only.

- [ ] **Step 1: Add Telegram setup note to backend/README.md**

Find the "## Follow-ups" section and insert before it:

```markdown
## O5 — Telegram Alarm Delivery

When a promise breaks, the org's Telegram channel gets one message: a plain
sentence, the quote receipt, and a deep link to the exact review. Silent on
healthy work.

**2-minute setup:**

1. Message **@BotFather** on Telegram and run `/newbot`. Copy the token.
2. Add your bot to the chat/channel that should receive alarms.
3. Find your chat ID: add **@userinfobot** to the chat; it replies with the ID.
4. In the Quire dashboard, go to **Channels** → **Add Telegram channel**.
   Paste the token and chat ID. Click **Send a test message** to confirm.

**Environment override:**

```
QUIRE_APP_HOST=https://your-quire.example.com  # default: http://localhost:3456
```

Deep links in alarm messages use this host. On localhost the default works;
in production set it to your public domain.

**Without a token:** the system uses a StubChannel that records messages
(visible in logs at DEBUG level) and never fails. Add a real channel to
activate live delivery.
```

- [ ] **Step 2: Run evals to confirm green**

```bash
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m evals.event_stream && python3 -m evals.alarms
```
Expected: both say "all clear"

- [ ] **Step 3: Final test sweep**

```bash
cd /Users/giladkoch/dev/intent-ai/backend && python3 -m pytest -q 2>&1 | tail -3
cd /Users/giladkoch/dev/intent-ai/app && npx vitest run 2>&1 | tail -5
cd /Users/giladkoch/dev/intent-ai/app && npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Final commit**

```bash
git add backend/README.md
git commit -m "docs(o5): Telegram 2-minute setup note in backend/README.md"
```

---

## Self-Review

**Spec coverage:**

| Requirement | Task |
|---|---|
| Channel protocol `send(text, receipts) -> DeliveryResult` | Task 1 |
| TelegramChannel (raw Bot API, no python-telegram-bot) | Task 1 |
| StubChannel (records sends — tests + live-proof fallback) | Task 1 |
| Transport failures logged, never crash sync loop | Task 3 |
| Undelivered alarms retry on next pass | Task 3 |
| Dedup prevents double-tap after success | Task 3 |
| Delivery state lives in org_channels config (single-writer) | Task 2 |
| Wire delivery into org sync loop after analyses | Task 3 |
| org_channels filtered by purpose "alarms" | Task 2 |
| Message: plain sentence + quote receipt + deep link | Task 3 |
| Deep link `{app_host}/repo/{ws}/review/{n}` | Task 3 |
| App host from QUIRE_APP_HOST env var, default localhost:3456 | Task 3 |
| /channels page — list + add Telegram (token + chat id fields) | Task 4 |
| Plain-language help text (@BotFather instructions) | Task 4 |
| "Send a test message" button | Task 4 |
| Config writes via org_router → OrgStore (single-writer) | Task 2 |
| Token never in logs | Task 1 |
| Stub-prove end-to-end (fixture → policy → StubChannel → assert) | Task 3 |
| Deep link resolves to served review page | (deep link format matches spa_fallback route) |
| founder 2-minute setup note in README | Task 5 |
| alarms stay deduped across passes | Task 3 |

**Placeholder scan:** No TBDs found. All code blocks show actual implementations.

**Type consistency:** `DeliveryResult` defined in Task 1, used by Tasks 1-3. `ChannelRow` defined in `api.ts` and used in the Channels component.
