"""Audit trail for refund decisions. Every decision emits an event."""

import json
import pathlib
import time

AUDIT_LOG = pathlib.Path("audit/refund_decisions.ndjson")


def emit_refund_decision(request, decision) -> None:
    AUDIT_LOG.parent.mkdir(parents=True, exist_ok=True)
    event = {
        "ts": time.time(),
        "customer_id": request.customer_id,
        "tier": request.tier,
        "risk": request.risk,
        "amount": request.amount,
        "approved": decision.approved,
        "requires_human_approval": decision.requires_human_approval,
        "reason": decision.reason,
    }
    with AUDIT_LOG.open("a") as fh:
        fh.write(json.dumps(event) + "\n")
