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

import yaml
from pydantic import BaseModel, Field

from quire_align.entity_graph import read_state


class ActivityEvent(BaseModel):
    source: str  # slack | telegram | git | quire
    kind: str    # message | thread | decision | commit | check | session | signing
    ts: str
    actor: str = ""
    text: str = ""                        # verbatim, quotable
    entities: list[str] = Field(default_factory=list)   # entity ids it touches
    promises: list[str] = Field(default_factory=list)
    paths: list[str] = Field(default_factory=list)
    ref: str = ""                         # addressable id (session-…, GD-…, #7)
    channel: str = ""


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
             "verdict": a.classification.value,
             "promises": [i.obligation_id for i in a.obligation_impacts
                          if i.relation.value != "unrelated"]}
            for a in store.list_analyses(repository=adapter.repository())
        ]
    for c in checks or []:
        touched_ents = sorted({promise_to_entity[p] for p in c.get("promises", [])
                               if p in promise_to_entity})
        events.append(ActivityEvent(
            source="git", kind="check", ts=str(c.get("ts", "")),
            actor=c.get("actor", ""), text=c.get("verdict", ""),
            ref=str(c.get("pr", "")), entities=touched_ents,
            promises=c.get("promises", []),
        ))

    # comms — attention
    events += messages_as_events(workspace_dir, entities)

    return sorted(events, key=lambda e: e.ts or "")


def _suffix_match(a: str, b: str) -> bool:
    import os
    return a == b or a.endswith("/" + b) or b.endswith("/" + a) or (
        os.path.basename(a) == os.path.basename(b) and bool(os.path.basename(a)))


# -- the collision: attention vs dev, per entity ---------------------------

# Attention = comms. Dev = activity on the CODE (a commit, a check, a
# coding session). A signing is governance — the map deciding, not the
# code changing — so it rides the timeline but is not dev density; else
# every entity's own creation would read as "built".
_COMMS = {"message", "thread", "decision"}
_DEV = {"commit", "check", "session"}


def collisions(events: list[ActivityEvent]) -> list[dict]:
    """For each entity: how much ATTENTION (comms) vs DEV (code) it drew,
    and the quadrant signal. The plan's four quadrants — aligned /
    all-talk-gap / silent-build-risk / (drift-in-context handled at the
    story layer). Deterministic; no LLM."""
    by_entity: dict[str, dict] = {}
    for e in events:
        bucket = "attention" if e.kind in _COMMS else "dev" if e.kind in _DEV else None
        if bucket is None:
            continue
        for eid in e.entities:
            slot = by_entity.setdefault(eid, {"attention": 0, "dev": 0,
                                              "actors": set(), "checks": []})
            slot[bucket] += 1
            if e.actor:
                slot["actors"].add(e.actor)
            if e.kind == "check":
                slot["checks"].append((e.ts, "contradict" in (e.text or "").lower()))
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
            "recovered": recovered,
        })
    return sorted(out, key=lambda x: -(x["attention"] + x["dev"]))
