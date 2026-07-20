"""Event-stream evals: does the machinery correlate a MULTI-SOURCE,
MULTI-USER org stream (PRs/checks, coding sessions, Slack messages) and
surface the cross-source patterns — without being told to look?

Fixture: fixtures/acme-stream — a fictional commerce org with four
areas, five people, and a stream carrying embedded ground truths. Per
the blind-subagent-eval playbook, the truths live only in the checks
below; controls catch over-flagging. Deterministic collision detection
is checked directly; the narrative layer (does the story SEE the arc?)
is judged.

    python3 -m evals.event_stream

The embedded patterns (ground truth — NOT told to the machinery):
- Payments: a promise decided in Slack (#payments-eng, dana),
  reasoned in a session (sam), drifted in a PR, caught by check #201 →
  attention AND dev, broken → 'drift-in-context'.
- Checkout: much discussed (#product), nothing built → 'all-talk-gap'.
- Notifications: shipped (session + check), zero discussion →
  'silent-build-risk'.
- Risk: a bare word ('high-risk') must NOT strongly relate messages to
  the fraud entity — a noise control.
- Controls: no database migration, no security incident happened.
"""

from __future__ import annotations

import pathlib
import sys

from quire_align.adapters.fixture import FixtureWorkspace
from quire_align.events import collisions, events_for

WS = pathlib.Path(__file__).resolve().parents[1] / "fixtures" / "acme-stream"


def _collisions() -> dict:
    adapter = FixtureWorkspace(WS)
    return {c["entity_id"]: c for c in collisions(events_for(WS, adapter, None))}


# Deterministic ground-truth checks on the collision signals.
DETERMINISTIC = [
    ("payments-drift-in-context", "ent-payments", "drift-in-context",
     "a promise discussed in Slack, drifted in code, caught by a check"),
    ("checkout-all-talk-gap", "ent-checkout", "all-talk-gap",
     "discussed at length, nothing shipped"),
    ("notifications-silent-build", "ent-notifications", "silent-build-risk",
     "shipped with zero discussion"),
    ("risk-not-over-related", "ent-risk", ("quiet", "(absent)"),
     "a bare word ('high-risk') must not raise a false signal on Risk — "
     "no attention, so absent from the activity list is correct"),
]


def _multi_source_multi_user() -> tuple[bool, str]:
    evs = events_for(WS, FixtureWorkspace(WS), None)
    sources = {e.source for e in evs}
    users = {e.actor for e in evs if e.actor}
    ok = len(sources) >= 3 and len(users) >= 4
    return ok, f"sources={sorted(sources)} users={sorted(users)}"


def run() -> int:
    signals = _collisions()
    failures = 0

    ok, detail = _multi_source_multi_user()
    print(f"  {'PASS' if ok else 'FAIL'} multi-source-multi-user: {detail}")
    failures += 0 if ok else 1

    for cid, eid, want, why in DETERMINISTIC:
        got = signals.get(eid, {}).get("signal", "(absent)")
        wants = (want,) if isinstance(want, str) else want
        ok = got in wants
        failures += 0 if ok else 1
        print(f"  {'PASS' if ok else 'FAIL'} {cid}: want {wants}, got '{got}' — {why}")

    # controls: the stream must not manufacture events that never happened
    evs = events_for(WS, FixtureWorkspace(WS), None)
    corpus = " ".join(e.text.lower() for e in evs)
    for term, label in (("migrat", "a database migration"),
                        ("breach", "a security incident"),
                        ("incident", "a security incident")):
        present = term in corpus
        print(f"  {'PASS' if not present else 'FAIL'} control-no-{label.split()[-1]}: "
              f"'{term}' absent")
        failures += 1 if present else 0

    print(f"\n{'all clear' if not failures else str(failures) + ' failing'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(run())
