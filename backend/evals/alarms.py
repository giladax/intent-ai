"""Alarm evals: does the proactive layer page the RIGHT person about the
RIGHT fire — and stay silent on everything that is fine?

A proactive channel lives or dies on its false-positive rate. The headline
assertion is a control: across four independent orgs, exactly TWO fires are
loud enough to wake the CEO (the two silent-drifts), and every `aligned`
entity is silent. If the detector pages on healthy work, the exec mutes it
and the product is dead — so the controls here matter as much as the hits.

Ground truths live only in the checks below. Run: python3 -m evals.alarms
"""

from __future__ import annotations

import pathlib
import sys

from quire.adapters.fixture import FixtureWorkspace
from quire.alarms import alarms_for

FIXTURES = pathlib.Path(__file__).resolve().parents[1] / "fixtures"
ORGS = ["acme-stream", "helios", "nomad", "vela"]

# (org, entity, signal, severity) — the alarm each area warrants.
HITS = [
    ("acme-stream", "ent-payments", "drift-in-context", "high"),
    ("acme-stream", "ent-checkout", "all-talk-gap", "medium"),
    ("acme-stream", "ent-notifications", "silent-build-risk", "medium"),
    ("helios", "ent-reporting", "silent-build-risk", "medium"),
    ("helios", "ent-ledger", "recovered", "info"),
    ("nomad", "ent-cli", "silent-drift", "critical"),
    ("nomad", "ent-config", "silent-build-risk", "medium"),
    ("vela", "ent-consent", "silent-drift", "critical"),
]

# Entities that are ALIGNED/quiet — a page here is a false positive that
# would get the whole channel muted. These MUST stay silent.
CONTROLS = [
    ("acme-stream", "ent-risk"),        # omar built + maya specced — aligned
    ("helios", "ent-reconciliation"),   # calmly built what was decided
    ("nomad", "ent-plugins"),           # aligned
    ("vela", "ent-alerts"),             # loud incident, but it HELD — aligned
    ("vela", "ent-delivery"),           # aligned
]


def _by_entity(org: str) -> dict:
    ws = FIXTURES / org
    al = alarms_for(ws, FixtureWorkspace(ws), None, window_days=14)
    return {a.entity_id: a for a in al}


def run() -> int:
    failures = 0
    cache: dict[str, dict] = {}

    for org, eid, signal, severity in HITS:
        a = cache.setdefault(org, _by_entity(org)).get(eid)
        ok = a and a.signal == signal and a.severity == severity and a.receipts
        failures += 0 if ok else 1
        got = f"{a.signal}/{a.severity}" if a else "(no alarm)"
        print(f"  {'PASS' if ok else 'FAIL'} {org}/{eid.replace('ent-','')}: "
              f"want {signal}/{severity}, got {got}")

    print()
    for org, eid in CONTROLS:
        a = cache.setdefault(org, _by_entity(org)).get(eid)
        ok = a is None
        failures += 0 if ok else 1
        print(f"  {'PASS' if ok else 'FAIL'} {org}/{eid.replace('ent-','')} "
              f"silent (control): {'no page' if ok else 'FALSE PAGE ' + a.severity}")

    # The exec-load control: only genuine silent-drift wakes the CEO. Two
    # across the whole suite — no more, no fewer.
    criticals = [a for org in ORGS for a in cache.setdefault(org, _by_entity(org)).values()
                 if a.severity == "critical"]
    exec_ok = len(criticals) == 2 and all("stakeholder" in a.audience for a in criticals)
    failures += 0 if exec_ok else 1
    print(f"\n  {'PASS' if exec_ok else 'FAIL'} exec-load: {len(criticals)} critical "
          f"page(s) suite-wide (want 2), all routed to the stakeholder")

    print(f"\n{'all clear — pages the fire, silent on the healthy' if not failures else str(failures) + ' failing'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(run())
