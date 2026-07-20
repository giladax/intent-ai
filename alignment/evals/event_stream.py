"""Event-stream evals: does the machinery correlate a MULTI-SOURCE,
MULTI-USER org stream (PRs/checks, coding sessions, Slack messages) and
surface the cross-source patterns — without being told to look?

Four fixtures, each INDEPENDENTLY authored by a different "developer"
subagent for a different domain, so the collision detector cannot be
overfit to one hand-made stream (the blind-subagent-eval discipline):
- acme-stream (commerce) — drift-in-context, all-talk-gap, silent-build
- helios (fintech ledger) — recovered (broke then a check confirmed it
  holds), aligned, silent-build
- nomad (dev-tools CLI) — silent-drift (broke, nobody watching)
- vela (health messaging) — the ATTENTION COLLISION: max attention on an
  Alerts incident while Consent silently drifts

The ground truths live only in the checks below; controls catch a
detector that manufactures events. Deterministic collision signals are
checked directly. Run: python3 -m evals.event_stream
"""

from __future__ import annotations

import pathlib
import sys

from quire_align.adapters.fixture import FixtureWorkspace
from quire_align.events import collisions, events_for

FIXTURES = pathlib.Path(__file__).resolve().parents[1] / "fixtures"

# (org, entity, accepted signals, why) — the embedded ground truths.
CASES = [
    ("acme-stream", "ent-payments", ("drift-in-context",),
     "a promise decided in Slack, drifted in code, caught by a check"),
    ("acme-stream", "ent-checkout", ("all-talk-gap",),
     "discussed at length, nothing shipped"),
    ("acme-stream", "ent-notifications", ("silent-build-risk",),
     "shipped with zero discussion"),
    ("acme-stream", "ent-risk", ("quiet", "(absent)"),
     "a bare word ('high-risk') must not raise a false signal"),
    ("helios", "ent-ledger", ("recovered",),
     "broke, then a later check confirmed it holds again"),
    ("helios", "ent-reconciliation", ("aligned",),
     "calmly decided and correctly built"),
    ("helios", "ent-reporting", ("silent-build-risk",),
     "money-path code shipped with no review"),
    ("nomad", "ent-cli", ("silent-drift",),
     "a flag rename broke back-compat and NOBODY was watching"),
    ("vela", "ent-alerts", ("aligned", "drift-in-context"),
     "a loud incident soaked up all the attention"),
    ("vela", "ent-consent", ("silent-drift",),
     "opt-in broke while every eye was on the Alerts incident"),
]

# Per-org sanity: multi-source, multi-user.
ORGS = ["acme-stream", "helios", "nomad", "vela"]


def _signals(org: str) -> dict:
    ws = FIXTURES / org
    return {c["entity_id"]: c for c in collisions(events_for(ws, FixtureWorkspace(ws), None))}


def run() -> int:
    failures = 0
    cache: dict[str, dict] = {}

    for org in ORGS:
        ws = FIXTURES / org
        evs = events_for(ws, FixtureWorkspace(ws), None)
        sources = {e.source for e in evs}
        users = {e.actor for e in evs if e.actor}
        ok = len(sources) >= 3 and len(users) >= 4
        failures += 0 if ok else 1
        print(f"  {'PASS' if ok else 'FAIL'} {org} multi-source/user: "
              f"{len(sources)} sources, {len(users)} users, {len(evs)} events")
        # controls: no manufactured DATABASE migration or SECURITY breach
        # (specific phrases — 'migrate' alone is a legitimate config-schema
        # operation, so a bare-substring control false-positives on it)
        corpus = " ".join(e.text.lower() for e in evs)
        for term in ("database migration", "migrated the database",
                     "security breach", "data breach", "breached"):
            if term in corpus:
                print(f"  FAIL {org} control: manufactured '{term}'")
                failures += 1

    print()
    for org, eid, wants, why in CASES:
        sig = cache.setdefault(org, _signals(org)).get(eid, {}).get("signal", "(absent)")
        ok = sig in wants
        failures += 0 if ok else 1
        print(f"  {'PASS' if ok else 'FAIL'} {org}/{eid.replace('ent-','')}: "
              f"want {wants}, got '{sig}' — {why}")

    print(f"\n{'all clear — one taxonomy, four independent orgs' if not failures else str(failures) + ' failing'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(run())
