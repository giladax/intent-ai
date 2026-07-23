"""quire.deliver_alarms — wire the alarm policy to org channels (O5).

Called from sync_org after analyses complete. Reads alarm channels from
OrgStore, composes messages from the alarm policy (verbatim from alarms.py),
delivers to each channel, and persists the dedup key set so re-analyses
never re-tap the same break.

Message anatomy:
  {plain_headline}

  {deep_link}  →  {app_host}/repo/{workspace}/review/{pr_number}

Receipts are passed separately to channel.send() — the channel formats them
(TelegramChannel formats as a receipt block; StubChannel stores them raw).

The alarm headline is the full plain-language sentence from alarms._narrate —
no raw classification labels, no entity IDs. The message stays comprehensible
to someone who has never seen Quire's internal taxonomy.

Delivery state: stored in org_channels.config["_delivered_keys"] via
OrgStore.update_channel_delivery_state (single-writer). The alarm policy's
seen= parameter suppresses dedup at compose-time; delivery state is the
persistent form.

Failure isolation: a channel that fails to send is logged; the loop
continues; the key is NOT added to delivered_keys (will retry next pass).
Never raises.
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


def _deep_link(app_host: str, workspace: str, pr_number: int | None) -> str:
    """Build a deep link to the exact review page.

    Format: {app_host}/repo/{workspace}/review/{pr_number}
    When pr_number is unknown (no breaking check), links to /repo/{workspace}.
    These URLs are served by the SPA fallback (index.html) in production,
    which hands them to react-router — /repo/<ws>/review/<n> routes to ReviewRoom.
    """
    if pr_number:
        return f"{app_host}/repo/{workspace}/review/{pr_number}"
    return f"{app_host}/repo/{workspace}"


def _extract_pr_number(alarm: Alarm) -> int | None:
    """Extract the PR number from alarm receipts (the breaking check ref).

    The check receipt ref format is "PR 342" — extract the int.
    """
    for r in alarm.receipts:
        if r.kind == "check":
            ref = r.ref.replace("PR", "").strip()
            try:
                return int(ref)
            except ValueError:
                pass
    return None


def _format_message(
    alarm: Alarm, workspace: str, app_host: str
) -> tuple[str, list[dict]]:
    """Compose the tap message: plain headline + deep link.

    Returns (text, receipts) where:
    - text: the alarm's plain-language headline + deep link (no raw labels or
      entity IDs — comprehensible to anyone reading the Telegram notification)
    - receipts: alarm.receipts as dicts (passed to channel.send for formatting
      as the receipt block — quote-backed evidence)
    """
    pr_number = _extract_pr_number(alarm)
    link = _deep_link(app_host, workspace, pr_number)

    # The headline is already plain language (composed by alarms._narrate).
    # Append the deep link on a new line so the tap's one tap takes you straight
    # to the exact annotated review.
    text = f"{alarm.headline}\n\n{link}"

    receipts = [
        {"kind": r.kind, "ref": r.ref, "note": r.note} for r in alarm.receipts
    ]
    return text, receipts


def _build_adapter(ws_path: pathlib.Path):
    """Build a workspace adapter for the alarm policy. Failure-safe."""
    try:
        from quire.adapters.fixture import FixtureWorkspace
        return FixtureWorkspace(ws_path)
    except Exception as exc:
        logger.debug("deliver_alarms: _build_adapter(%s) failed: %s", ws_path, exc)
        return None


def deliver_alarms_for_org(
    org_store,
    workspaces_root: pathlib.Path,
    app_host: str | None = None,
) -> list[dict[str, Any]]:
    """Deliver alarms for all workspaces to org alarm channels.

    For each workspace directory under workspaces_root that exists on disk
    and each alarm-purpose channel in OrgStore:
      1. Run alarms_for (verbatim alarm policy — unchanged).
      2. Compose the message (headline + deep link).
      3. Deliver via the channel.
      4. Persist the newly delivered dedup keys.

    Returns a list of delivery result dicts:
      [{workspace, channel_id, dedup_key, ok, message_id, error}]

    Never raises — all failures are logged. Transport failures do not persist
    the key (will retry next pass). Dedup prevents re-tap after success.
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

        # Build the channel — unknown transports or missing config → StubChannel
        ch = channel_from_config(
            {**ch_cfg.get("config", {}), "transport": ch_cfg["transport"]}
        )
        newly_delivered: list[str] = []

        for repo in repos:
            workspace = repo.get("workspace", "")
            if not workspace:
                continue
            ws_path = workspaces_root / workspace
            if not ws_path.is_dir():
                continue

            # Build adapter — failure-safe
            adapter = _build_adapter(ws_path)
            if adapter is None:
                continue

            # Run alarm policy (verbatim alarms_for — reuse, not reimplemented)
            try:
                alarms = alarms_for(
                    ws_path,
                    adapter,
                    None,  # store — fixture adapter doesn't need it
                    window_days=14,
                    seen=already_delivered,
                )
            except Exception as exc:
                logger.warning(
                    "deliver_alarms_for_org: alarms_for(%s) failed: %s", workspace, exc
                )
                continue

            for alarm in alarms:
                if alarm.dedup_key in already_delivered:
                    continue  # belt+suspenders (alarms_for also filters)

                text, receipts = _format_message(alarm, workspace, app_host)

                try:
                    result = ch.send(text, receipts=receipts)
                except Exception as exc:
                    logger.warning(
                        "deliver_alarms_for_org: channel.send failed for %s / %s: %s",
                        workspace,
                        alarm.dedup_key,
                        exc,
                    )
                    result = {"ok": False, "message_id": None, "error": str(exc)}

                all_results.append(
                    {
                        "workspace": workspace,
                        "channel_id": ch_id,
                        "dedup_key": alarm.dedup_key,
                        "ok": result.get("ok", False),
                        "message_id": result.get("message_id"),
                        "error": result.get("error"),
                    }
                )

                if result.get("ok"):
                    already_delivered.add(alarm.dedup_key)
                    newly_delivered.append(alarm.dedup_key)

        # Persist delivery state for this channel (failure-safe)
        if newly_delivered:
            try:
                org_store.update_channel_delivery_state(
                    ch_id, list(already_delivered)
                )
            except Exception as exc:
                logger.warning(
                    "deliver_alarms_for_org: update_channel_delivery_state(%s) failed: %s",
                    ch_id,
                    exc,
                )

    return all_results
