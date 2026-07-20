"""The org event stream: multi-source, multi-user fold + the collision
signals, over the committed acme-stream fixture."""

import pathlib

from quire_align.adapters.fixture import FixtureWorkspace
from quire_align.comms import relate_message
from quire_align.events import collisions, events_for

WS = pathlib.Path(__file__).parent.parent / "fixtures" / "acme-stream"


def _adapter():
    return FixtureWorkspace(WS)


def test_stream_is_multi_source_and_multi_user():
    evs = events_for(WS, _adapter(), None)
    assert {e.source for e in evs} >= {"slack", "git", "quire"}
    assert {e.actor for e in evs if e.actor} >= {"dana", "sam", "rui", "lee"}
    assert any(e.kind == "decision" for e in evs)  # a Slack decision
    assert any(e.kind == "session" for e in evs)   # a coding session
    assert any(e.kind == "check" for e in evs)     # a PR check


def test_collision_signals_match_embedded_patterns():
    sig = {c["entity_id"]: c["signal"] for c in collisions(events_for(WS, _adapter(), None))}
    assert sig["ent-payments"] == "drift-in-context"   # discussed + drifted + caught
    assert sig["ent-checkout"] == "all-talk-gap"       # talked, not built
    assert sig["ent-notifications"] == "silent-build-risk"  # built, not talked
    assert sig.get("ent-risk") in (None, "quiet")      # no false relation


def test_recovery_reads_current_state_not_ever_broken():
    """The Helios fixture: Ledger broke (check 301) then a later check
    (302) found it holds — the collision must read 'recovered', not latch
    on the past contradiction (the bug the recovery fixture exposed)."""
    ws = pathlib.Path(__file__).parent.parent / "fixtures" / "helios"
    sig = {c["entity_id"]: c for c in collisions(events_for(ws, FixtureWorkspace(ws), None))}
    assert sig["ent-ledger"]["signal"] == "recovered"
    assert sig["ent-ledger"]["recovered"] is True


def test_four_independent_orgs_span_the_taxonomy():
    """One collision detector, four independently-authored fixtures —
    every signal represented (anti-overfit)."""
    seen = set()
    for org in ("acme-stream", "helios", "nomad", "vela"):
        ws = pathlib.Path(__file__).parent.parent / "fixtures" / org
        for c in collisions(events_for(ws, FixtureWorkspace(ws), None)):
            seen.add(c["signal"])
    assert {"drift-in-context", "silent-drift", "all-talk-gap",
            "silent-build-risk", "aligned", "recovered"} <= seen


def test_comms_relation_is_quote_backed_and_noise_filtered():
    entities = {
        "ent-payments": {"name": "Payments", "aliases": ["refunds"], "holdings": []},
        "ent-risk": {"name": "Risk", "aliases": [], "holdings": []},
    }
    # a channel a human mapped is the strong rung
    ties = relate_message(
        {"channel": "#payments-eng", "text": "anything"}, entities,
        {"#payments-eng": "ent-payments"})
    assert ties[0]["entity_id"] == "ent-payments" and "#payments-eng" in ties[0]["why"]
    # a bare short word inside a compound must NOT relate (noise filter)
    ties = relate_message(
        {"channel": "", "text": "high-risk refunds need approval"}, entities, {})
    assert not any(t["entity_id"] == "ent-risk" for t in ties)
    # a specific word does relate
    ties = relate_message(
        {"channel": "", "text": "the refunds path is slow"}, entities, {})
    assert any(t["entity_id"] == "ent-payments" for t in ties)
