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

        # Build the full message: main text + receipt block. Plain text only —
        # a promise quote in the body can contain unbalanced Markdown (_ * ` [),
        # which Telegram's Markdown parser rejects with a 400, silently dropping
        # the alarm forever. The content is a plain sentence, so send it plain.
        from quire import vocab

        body = text
        if receipts:
            lines = ["\n\nReceipts:"]
            for r in receipts:
                label = vocab.receipt_label(r.get("kind"))  # plain, never a raw enum
                ref = r.get("ref", "")
                note = r.get("note", "")
                note_str = f" — {note}" if note else ""
                lines.append(f"  • {label}: {ref}{note_str}")
            body += "\n".join(lines)

        url = self._API.format(token=self._token)
        payload = {
            "chat_id": self._chat_id,
            "text": body,
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
