"""Tests for quire.channels — Channel protocol, StubChannel, TelegramChannel.

All offline. No real HTTP calls. No Postgres.
"""
from __future__ import annotations

from quire.channels import StubChannel, DeliveryResult, channel_from_config, TelegramChannel


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


def test_stub_channel_empty_receipts():
    ch = StubChannel()
    result = ch.send("test", receipts=[])
    assert result["ok"] is True
    assert ch.sent[0]["receipts"] == []


def test_telegram_channel_bad_token_returns_error(monkeypatch):
    """TelegramChannel with invalid token returns ok=False, does not raise."""
    import httpx

    class _BadResponse:
        status_code = 401

        def json(self):
            return {"ok": False, "description": "Unauthorized"}

        def raise_for_status(self):
            raise httpx.HTTPStatusError(
                "401", request=None, response=self  # type: ignore[arg-type]
            )

    monkeypatch.setattr("httpx.post", lambda *a, **kw: _BadResponse())
    ch = TelegramChannel(token="bad-token", chat_id="123")
    result = ch.send("test", receipts=[])
    assert result["ok"] is False
    assert result["error"] is not None
    # token MUST NOT appear in error string
    assert "bad-token" not in (result["error"] or "")


def test_telegram_channel_network_error_returns_ok_false(monkeypatch):
    """Network error (httpx raises) → ok=False, never raises."""

    def _raise(*a, **kw):
        raise ConnectionError("network down")

    monkeypatch.setattr("httpx.post", _raise)
    ch = TelegramChannel(token="mytoken", chat_id="123")
    result = ch.send("test", receipts=[])
    assert result["ok"] is False
    assert "mytoken" not in (result["error"] or "")


def test_telegram_channel_success(monkeypatch):
    """Happy-path: Telegram API returns ok=true → message_id returned."""

    class _OkResponse:
        status_code = 200

        def json(self):
            return {"ok": True, "result": {"message_id": 42}}

        def raise_for_status(self):
            pass

    monkeypatch.setattr("httpx.post", lambda *a, **kw: _OkResponse())
    ch = TelegramChannel(token="realtoken", chat_id="mychat")
    result = ch.send("Hello from Quire", receipts=[{"kind": "check", "ref": "PR 99"}])
    assert result["ok"] is True
    assert result["message_id"] == 42
    assert result["error"] is None


def test_channel_from_config_telegram():
    ch = channel_from_config({"transport": "telegram", "token": "t", "chat_id": "c"})
    assert isinstance(ch, TelegramChannel)


def test_channel_from_config_telegram_missing_fields_returns_stub():
    """Telegram config without token/chat_id → StubChannel fallback."""
    ch = channel_from_config({"transport": "telegram"})
    assert isinstance(ch, StubChannel)


def test_channel_from_config_unknown_returns_stub():
    ch = channel_from_config({"transport": "pigeon"})
    assert isinstance(ch, StubChannel)


def test_channel_from_config_empty_returns_stub():
    ch = channel_from_config({})
    assert isinstance(ch, StubChannel)
