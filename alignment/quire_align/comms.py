"""Comms ingestion: Slack / Telegram messages as observed events.

Same trust discipline as sessions (docs/2026-07-20-comms-timeline-plan.md):
messages are OBSERVED and NOISY. They never sign. They relate to an
entity only when the tie can be QUOTED — a channel a human mapped to an
area, or the entity's own words appearing in the text. A message that
can't quote what tied it does not relate; that quote-or-drop rung is the
noise filter that keeps the timeline from becoming spam.

Source of record is the export (slack.yaml / telegram.yaml in the
workspace); we read it, we do not fetch. Live Slack (Events API) is a
post-raise fast-follow behind this same shape.
"""

from __future__ import annotations

import pathlib

import yaml

from quire_align.text import tokenize


def load_messages(workspace_dir: pathlib.Path) -> list[dict]:
    out = []
    for name, source in (("slack.yaml", "slack"), ("telegram.yaml", "telegram")):
        path = workspace_dir / name
        if path.exists():
            for m in yaml.safe_load(path.read_text()) or []:
                out.append({**m, "source": source})
    return out


def _channel_map(workspace_dir: pathlib.Path) -> dict[str, str]:
    """Human-taught channel → entity id (a signed alias, e.g.
    '#payments-eng' → ent-payments). Lives in channels.yaml; the teaching
    loop confirms these — code never invents them."""
    path = workspace_dir / "channels.yaml"
    return (yaml.safe_load(path.read_text()) or {}) if path.exists() else {}


def relate_message(msg: dict, entities: dict, channels: dict) -> list[dict]:
    """Which entities a message touches, each with the QUOTE that tied it.
    Rung 1: a human-mapped channel. Rung 2: the entity's name/alias words
    appearing verbatim in the text. No tie, no relation."""
    ties: list[dict] = []
    ch = msg.get("channel", "")
    if ch in channels and channels[ch] in entities:
        ties.append({"entity_id": channels[ch], "why": f"posted in {ch}"})
    text = msg.get("text", "")
    text_tokens = set(tokenize(text, min_len=3, keep_digits=True))
    for eid, e in entities.items():
        if any(t["entity_id"] == eid for t in ties):
            continue
        vocab = [e["name"], *e.get("aliases", [])]
        for phrase in vocab:
            ptoks = set(tokenize(phrase, min_len=3, keep_digits=True))
            if not (ptoks and ptoks <= text_tokens):
                continue
            # A single short generic word is not a strong tie — "Risk"
            # matching inside "high-risk refunds" is noise, not a relation.
            # Require a multi-word name or a specific (>=5 char) token.
            if len(ptoks) == 1 and max(len(t) for t in ptoks) < 5:
                continue
            ties.append({"entity_id": eid, "why": f"names “{phrase}”"})
            break
    return ties


def messages_as_events(workspace_dir: pathlib.Path, entities: dict) -> list:
    """Messages → ActivityEvents, related and quote-backed. A message that
    ties to nothing is still an event (it happened) but touches no entity
    — it simply won't appear on any entity's timeline."""
    from quire_align.events import ActivityEvent

    channels = _channel_map(workspace_dir)
    events = []
    for m in load_messages(workspace_dir):
        ties = relate_message(m, entities, channels)
        kind = m.get("kind", "message")  # message | thread | decision
        events.append(ActivityEvent(
            source=m["source"], kind=kind, ts=str(m.get("ts", "")),
            actor=m.get("actor", ""), text=m.get("text", ""),
            channel=m.get("channel", ""),
            entities=sorted({t["entity_id"] for t in ties}),
            ref=m.get("id", ""),
        ))
    return events
