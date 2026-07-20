"""Proactive alarms: page the fire, carry the story, never spam.

The alarm layer is the tap on the shoulder — it must fire only when it can
cite the receipt (quote-or-drop), page the CEO only for genuine silent
drift, tell the reasoning not the label, and never re-page the same break.
"""

import pathlib

import pytest

from quire_align.adapters.fixture import FixtureWorkspace
from quire_align.alarms import (
    alarms_for,
    render_telegram,
)
from quire_align.events import collisions, events_for

FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"


@pytest.fixture(params=["acme-stream", "helios", "nomad", "vela"])
def org(request):
    return request.param


def _alarms(org: str):
    ws = FIXTURES / org
    return alarms_for(ws, FixtureWorkspace(ws), None, window_days=14)


def test_only_genuine_silent_drift_wakes_the_ceo():
    """Across the suite exactly two fires are critical — the two silent
    drifts — and each is routed to the stakeholder. Paging the exec on
    healthy work is the one failure that mutes the whole channel."""
    criticals = [(o, a) for o in ("acme-stream", "helios", "nomad", "vela")
                 for a in _alarms(o) if a.severity == "critical"]
    assert len(criticals) == 2
    assert {o for o, _ in criticals} == {"nomad", "vela"}
    for _, a in criticals:
        assert a.signal == "silent-drift"
        assert "stakeholder" in a.audience


def test_aligned_entities_never_page(org):
    """An entity that is building what it's discussing is silent — no news
    is the correct behavior, and the control that keeps the channel trusted."""
    aligned = {c["entity_id"] for c in
               collisions(events_for(FIXTURES / org, FixtureWorkspace(FIXTURES / org), None),
                          window_days=14)
               if c["signal"] in ("aligned", "quiet")}
    paged = {a.entity_id for a in _alarms(org)}
    assert not (aligned & paged), f"{org} paged on an aligned/quiet entity"


def test_drift_alarm_is_quote_backed_by_the_breaking_check():
    """A drift alarm must cite the check that broke the promise — no receipt,
    no page (quote-or-drop). The Vela consent fire carries its PR."""
    consent = next(a for a in _alarms("vela") if a.entity_id == "ent-consent")
    kinds = {r.kind for r in consent.receipts}
    assert {"check", "promise", "signing"} <= kinds
    check = next(r for r in consent.receipts if r.kind == "check")
    assert "342" in check.ref  # the actual breaking PR
    # the story propagates the reasoning, not a bare label
    assert "opt-in" in consent.story.lower()
    assert "no one is watching" in consent.headline.lower()


def test_drift_needs_a_break_receipt_or_it_does_not_fire(tmp_path):
    """If collisions reports a drift but no breaking check exists to cite,
    the alarm is dropped — we never page on a state we cannot show."""
    from quire_align import alarms as alarms_mod

    # a synthetic collision claiming silent-drift on an entity with no
    # breaking check in the (empty) event set → must compose to None
    ws = FIXTURES / "vela"
    events = []  # no events → no check to cite
    ent = {"name": "Ghost", "holdings": []}
    out = alarms_mod._compose(
        ws, events, {}, {"entity_id": "ent-ghost", "signal": "silent-drift",
                         "attention": 0, "dev": 2},
        ent, "Ghost", alarms_mod._POLICY["silent-drift"], 14, "2026-07-20")
    assert out is None


def test_the_same_break_does_not_repage():
    """`seen` suppresses an already-delivered break — a proactive channel
    that repeats itself gets muted. A NEW break (new key) still fires."""
    first = _alarms("vela")
    seen = {a.dedup_key for a in first}
    ws = FIXTURES / "vela"
    again = alarms_for(ws, FixtureWorkspace(ws), None, window_days=14, seen=seen)
    assert not any(a.entity_id == "ent-consent" for a in again)


def test_recovered_is_good_news_not_an_alarm_of_fear():
    """Helios ledger broke then held — it surfaces as INFO, so the loop
    closing is on the record without crying wolf."""
    ledger = next(a for a in _alarms("helios") if a.entity_id == "ent-ledger")
    assert ledger.signal == "recovered" and ledger.severity == "info"
    assert "✓" in ledger.headline or "caught" in ledger.headline.lower()


def test_windowing_reads_watching_now_not_ever():
    """The window scopes attention/dev density to the recent past, but a
    break is current-state and always counts. Alerts sheds stale mentions
    under a window yet stays aligned; Consent stays silent-drift."""
    ws = FIXTURES / "vela"
    evs = events_for(ws, FixtureWorkspace(ws), None)
    alltime = {c["entity_id"]: c for c in collisions(evs)}
    windowed = {c["entity_id"]: c for c in collisions(evs, window_days=14)}
    # the window trims stale attention...
    assert windowed["ent-alerts"]["attention"] < alltime["ent-alerts"]["attention"]
    # ...without flipping a healthy signal or hiding a real break
    assert windowed["ent-alerts"]["signal"] == "aligned"
    assert windowed["ent-consent"]["signal"] == "silent-drift"
    assert windowed["ent-consent"]["broken"] is True


def test_render_is_push_ready_with_receipts():
    """The rendered message carries severity, the story, and every receipt —
    a Telegram/Slack push, not a dashboard link."""
    consent = next(a for a in _alarms("vela") if a.entity_id == "ent-consent")
    msg = render_telegram(consent)
    assert "CRITICAL" in msg
    assert "Receipts:" in msg
    assert "OB-CONSENT-1" in msg  # the promise ref is quotable in the push
    assert "to: stakeholder" in msg
