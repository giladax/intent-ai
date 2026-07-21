"""Build the Vela org event-stream fixture's entity graph.

Runs the same signed path the product uses — append_proposals + decide — so
graph/diffs.yaml is real signing history, not hand-authored state. Three areas:
Alerts, Consent, Delivery. Each is proposed by the LLM clerk and approved by a
teammate, dated inside the collision window's lead-up.

    python fixtures/vela/build.py

Idempotent-ish: it refuses to double-create (append_proposals suppresses the
duplicate shape), so re-running is safe but a from-scratch build wants a fresh
graph/diffs.yaml. We start clean here.
"""

from __future__ import annotations

import pathlib

from quire.entity_graph import (
    Attach,
    CreateEntity,
    GraphDiff,
    append_proposals,
    decide,
    read_state,
)

HERE = pathlib.Path(__file__).resolve().parent


def _proposal(entity_id, name, identity, aliases, promises, codepaths):
    ops = [CreateEntity(entity_id=entity_id, name=name,
                        identity_sentence=identity, aliases=aliases)]
    ops += [Attach(entity_id=entity_id, kind="promise", ref=p) for p in promises]
    ops += [Attach(entity_id=entity_id, kind="code", ref=c) for c in codepaths]
    return GraphDiff(diff_id="", question=f"Create {name}?", proposed_by="llm",
                     operations=ops)


# (proposal, signer, signed_at) — dates precede the incident window.
AREAS = [
    (_proposal(
        "ent-alerts", "Alerts",
        "Time-critical pages to the on-call clinician when a patient threshold trips.",
        ["on-call", "paging"],
        ["OB-ALERTS-1", "OB-ALERTS-2"],
        ["repo/alerts/dispatch.py", "repo/alerts/audit.py"],
     ), "ben", "2026-07-02T10:00:00+00:00"),
    (_proposal(
        "ent-consent", "Consent",
        "The recorded permission that gates whether a recipient may be messaged at all.",
        ["opt-in", "permission gate"],
        ["OB-CONSENT-1", "OB-CONSENT-2", "OB-CONSENT-3"],
        ["repo/consent/gate.py", "repo/messaging/send.py"],
     ), "aisha", "2026-07-02T11:00:00+00:00"),
    (_proposal(
        "ent-delivery", "Delivery",
        "The send pipeline that gets a message out, retries failures, and keeps PHI out of logs.",
        ["send pipeline", "retry"],
        ["OB-DELIVERY-1", "OB-DELIVERY-2", "OB-DELIVERY-3"],
        ["repo/delivery/retry.py"],
     ), "tomas", "2026-07-03T09:00:00+00:00"),
]


def main() -> None:
    diffs_path = HERE / "graph" / "diffs.yaml"
    diffs_path.parent.mkdir(parents=True, exist_ok=True)
    if diffs_path.exists():
        diffs_path.unlink()  # from-scratch build

    for proposal, signer, when in AREAS:
        res = append_proposals(HERE, [proposal], now=when)
        if not res["added"]:
            raise SystemExit(f"proposal not added: {proposal.question} -> {res}")
        diff_id = res["added"][0]
        decide(HERE, diff_id, "approved", by=signer, now=when)
        print(f"signed {diff_id}: {proposal.question} by {signer} @ {when}")

    _, state = read_state(HERE)
    print("\nentities:", sorted(state["entities"]))
    for eid, e in sorted(state["entities"].items()):
        promises = [h["ref"] for h in e["holdings"] if h["kind"] == "promise"]
        code = [h["ref"] for h in e["holdings"] if h["kind"] == "code"]
        print(f"  {eid}: {len(promises)} promises, {len(code)} code paths")


if __name__ == "__main__":
    main()
