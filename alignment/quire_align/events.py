"""The org event stream: one time-ordered river across every source.

The comms plan (docs/2026-07-20-comms-timeline-plan.md) made real: a PR
check, a coding session, a signed decision, and a Slack message are all
ActivityEvents on one timeline, related to entities through shared refs
— so "attention" (comms) and "dev" (code) can be correlated per entity
per window. Facts are immutable; interpretation appends.

Sources compose from what the workspace already holds — the diff log
(signings), sessions.yaml, slack.yaml/telegram.yaml (comms), and either
the store's analyses or a checks.yaml (offline fixtures). Nothing here
mutates; the stream is a fold, cheap, recomputed on read.
"""

from __future__ import annotations

import pathlib
from datetime import datetime, timedelta, timezone

import yaml
from pydantic import BaseModel, Field

from quire_align.entity_graph import read_state
from quire_align.models import Classification

# A live analysis speaks the Classification enum; a fixture check speaks a
# human verdict phrase. One vocabulary at the event boundary, so the stream
# reads the same whether it came from the store or a fixture — and so the
# break signal is computed from the classification, never sniffed from text.
_VERDICT_TEXT: dict[Classification, str] = {
    Classification.OFF_INTENT: "contradicts intent",
    Classification.ALIGNED: "satisfies intent",
    Classification.NO_MATERIAL_IMPACT: "no material impact",
    Classification.PARTIAL: "partially satisfies intent",
    Classification.POSSIBLE_DRIFT: "possible drift",
    Classification.UNGOVERNED: "ungoverned change",
    Classification.UNKNOWN: "unclear",
}
# The classifications that mean the promise is currently BROKEN (a
# contradiction). Fixture checks carry the phrase "contradicts intent",
# which maps here too.
_BROKEN_VERDICTS = {Classification.OFF_INTENT}


class ActivityEvent(BaseModel):
    source: str  # slack | telegram | git | quire | docs
    kind: str    # message | thread | decision | doc | commit | check | session | signing
    ts: str
    actor: str = ""
    role: str = ""                        # dev | pm | stakeholder | system
    text: str = ""                        # verbatim, quotable
    entities: list[str] = Field(default_factory=list)   # entity ids it touches
    promises: list[str] = Field(default_factory=list)
    paths: list[str] = Field(default_factory=list)
    ref: str = ""                         # addressable id (session-…, GD-…, #7)
    channel: str = ""
    broken: bool = False                  # a check that found a contradiction


def _load(workspace_dir: pathlib.Path, name: str):
    path = workspace_dir / name
    return yaml.safe_load(path.read_text()) if path.exists() else None


def events_for(workspace_dir: pathlib.Path, adapter=None, store=None) -> list[ActivityEvent]:
    """The whole stream, oldest first. adapter/store optional — offline
    fixtures carry their own checks.yaml instead of a live analyses store."""
    from quire_align.comms import messages_as_events

    diffs, state = read_state(workspace_dir)
    entities = state["entities"]
    # path → entity id, for relating dev events to the map
    path_to_entity: dict[str, str] = {}
    for eid, e in entities.items():
        for h in e["holdings"]:
            if h["kind"] in ("code", "doc"):
                path_to_entity.setdefault(h["ref"], eid)
    promise_to_entity: dict[str, str] = {}
    for eid, e in entities.items():
        for h in e["holdings"]:
            if h["kind"] == "promise":
                promise_to_entity.setdefault(h["ref"], eid)

    events: list[ActivityEvent] = []

    # signings — the map's own decisions
    for d in diffs:
        if d.status == "approved" and d.decision:
            touched = [op.entity_id for op in d.effective_operations()
                       if getattr(op, "entity_id", "") in entities]
            events.append(ActivityEvent(
                source="quire", kind="signing", ts=d.decision.at,
                actor=d.decision.by, text=d.question, ref=d.diff_id,
                entities=sorted(set(touched)),
            ))

    # sessions — reasoning as the work happened
    for s in _load(workspace_dir, "sessions.yaml") or []:
        touched_ents = sorted({
            eid for tp in s.get("touched_paths", [])
            for ref, eid in path_to_entity.items()
            if _suffix_match(tp, ref)
        })
        events.append(ActivityEvent(
            source="git", kind="session",
            ts=s.get("digested_at") or s.get("started_at", ""),
            actor=s.get("actor", ""), text=s.get("summary", ""),
            ref="session-" + s["session_id"][:12],
            entities=touched_ents, paths=s.get("touched_paths", []),
        ))

    # checks — from a fixture file or the live store
    checks = _load(workspace_dir, "checks.yaml")
    if checks is None and adapter is not None and store is not None:
        checks = [
            {"pr": a.pr_number, "ts": a.created_at.isoformat(),
             "verdict": _VERDICT_TEXT.get(a.classification, a.classification.value),
             "broken": a.classification in _BROKEN_VERDICTS,
             "promises": [i.obligation_id for i in a.obligation_impacts
                          if i.relation.value != "unrelated"]}
            for a in store.list_analyses(repository=adapter.repository())
        ]
    for c in checks or []:
        touched_ents = sorted({promise_to_entity[p] for p in c.get("promises", [])
                               if p in promise_to_entity})
        # A fixture check states a verdict phrase; derive its break from that
        # phrase. A live check already carries a structured `broken`. Either
        # way the break is a fact on the event, not a substring guess later.
        broken = c.get("broken")
        if broken is None:
            broken = "contradict" in str(c.get("verdict", "")).lower()
        events.append(ActivityEvent(
            source="git", kind="check", ts=str(c.get("ts", "")),
            actor=c.get("actor", ""), text=c.get("verdict", ""),
            ref=str(c.get("pr", "")), entities=touched_ents,
            promises=c.get("promises", []), broken=bool(broken),
        ))

    # comms — attention
    events += messages_as_events(workspace_dir, entities)

    # authored docs — where PMs and stakeholders STATE intent (a spec, a
    # PRD, a strategy note). Intent authorship, related to the areas it
    # names; it counts as attention (the org articulating a thing).
    from quire_align.comms import _relate_text
    from quire_align.comms import _channel_map
    channels = _channel_map(workspace_dir)
    for d in _load(workspace_dir, "docs.yaml") or []:
        ties = _relate_text(
            (d.get("title", "") + " " + d.get("text", "")), entities, {}, "")
        events.append(ActivityEvent(
            source="docs", kind="doc", ts=str(d.get("ts", "")),
            actor=d.get("author", ""), text=d.get("title") or d.get("text", "")[:120],
            entities=sorted({t["entity_id"] for t in ties}),
            ref=d.get("id", ""),
        ))

    # stamp each event's author role from the org's people map
    roles = _load(workspace_dir, "people.yaml") or {}
    for e in events:
        e.role = roles.get(e.actor, e.role or ("system" if e.source == "quire" else ""))

    return sorted(events, key=lambda e: e.ts or "")


def _suffix_match(a: str, b: str) -> bool:
    import os
    return a == b or a.endswith("/" + b) or b.endswith("/" + a) or (
        os.path.basename(a) == os.path.basename(b) and bool(os.path.basename(a)))


def parse_ts(ts: str) -> datetime | None:
    """Best-effort ISO parse → aware UTC datetime. Returns None for a ts we
    can't place on the clock; callers treat un-placeable events as always
    in-window (we never window OUT what we can't time)."""
    if not ts:
        return None
    try:
        d = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        try:
            d = datetime.fromisoformat(ts[:10])
        except ValueError:
            return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


# -- the collision: attention vs dev, per entity ---------------------------

# Attention = comms. Dev = activity on the CODE (a commit, a check, a
# coding session). A signing is governance — the map deciding, not the
# code changing — so it rides the timeline but is not dev density; else
# every entity's own creation would read as "built".
_COMMS = {"message", "thread", "decision", "doc"}  # doc = intent authorship, org attention
_DEV = {"commit", "check", "session"}


def collisions(events: list[ActivityEvent], window_days: float | None = None,
               now: str | None = None) -> list[dict]:
    """For each entity: how much ATTENTION (comms) vs DEV (code) it drew,
    and the quadrant signal. The plan's four quadrants — aligned /
    all-talk-gap / silent-build-risk / (drift-in-context handled at the
    story layer). Deterministic; no LLM.

    window_days scopes the ATTENTION/DEV density to a recent window ending
    at `now` (default: the newest event's time) — the read a proactive
    alarm needs: "is anyone watching this *now*", not "did anyone ever". It
    deliberately does NOT window the check history: a promise that broke and
    was never re-checked is still broken now, so broken/recovered always
    read the full record. Default (no window) counts all-time, so the
    embedded ground truths are unchanged."""
    cutoff = None
    if window_days is not None:
        stamps = [d for d in (parse_ts(e.ts) for e in events) if d]
        ref = parse_ts(now) if now else (max(stamps) if stamps else None)
        cutoff = ref - timedelta(days=window_days) if ref else None

    by_entity: dict[str, dict] = {}
    for e in events:
        bucket = "attention" if e.kind in _COMMS else "dev" if e.kind in _DEV else None
        # a check contributes to broken-state regardless of the window; only
        # its dev-density contribution respects the window.
        if bucket is None and e.kind != "check":
            continue
        in_window = True
        if cutoff is not None:
            d = parse_ts(e.ts)
            in_window = d is None or d >= cutoff
        for eid in e.entities:
            slot = by_entity.setdefault(eid, {"attention": 0, "dev": 0,
                                              "actors": set(), "checks": []})
            if e.kind == "check":
                slot["checks"].append((e.ts, e.broken))
            if bucket and in_window:
                slot[bucket] += 1
                if e.actor:
                    slot["actors"].add(e.actor)
    out = []
    for eid, s in by_entity.items():
        a, d = s["attention"], s["dev"]
        # broken reflects CURRENT state — the latest check by time, not
        # "ever contradicted" (the old latch made recovery invisible; the
        # Helios recovery fixture exposed it). recovered = broke earlier,
        # holds now.
        checks = sorted(s["checks"])
        broken = bool(checks) and checks[-1][1]
        recovered = (not broken) and any(c[1] for c in checks)
        if broken and a:
            signal = "drift-in-context"   # broke, and the org was discussing it
        elif broken:
            signal = "silent-drift"       # broke, and NOBODY was watching — worst
        elif recovered:
            signal = "recovered"          # broke, then a check confirmed it holds again
        elif a >= 3 and d == 0:
            signal = "all-talk-gap"       # discussed at length, nothing built
        elif d >= 2 and a == 0:
            signal = "silent-build-risk"  # built with no discussion
        elif a and d:
            signal = "aligned"            # building what it's discussing
        else:
            signal = "quiet"
        out.append({
            "entity_id": eid, "attention": a, "dev": d,
            "actors": sorted(s["actors"]), "signal": signal,
            "broken": broken, "recovered": recovered,
            "window_days": window_days,
        })
    return sorted(out, key=lambda x: -(x["attention"] + x["dev"]))
