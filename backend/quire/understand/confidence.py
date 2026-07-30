"""derive_confidence — port of understand/derive-confidence.ts.

Deterministic confidence derivation from anchoring + verification. Replaces the
model-emitted confidence (the model emits "high" ~95% regardless of rubric).
"""

from __future__ import annotations

from quire.understand.models import SessionMoment


def derive_confidence(moment: SessionMoment) -> str:
    """Rules (priority order):
    - contradicted → low
    - supported → high
    - ≥1 anchored user evidence → high
    - ≥1 anchored evidence → medium
    - none anchored → low
    """
    if moment.verification == "contradicted":
        return "low"
    if moment.verification == "supported":
        return "high"

    has_anchored_user = any(
        e.anchored and e.source_type == "user" for e in moment.evidence
    )
    if has_anchored_user:
        return "high"

    has_any_anchored = any(e.anchored for e in moment.evidence)
    if has_any_anchored:
        return "medium"

    return "low"


def apply_derived_confidence(moments: list[SessionMoment]) -> list[SessionMoment]:
    """Non-mutating: overwrite confidence on every moment via derive_confidence."""
    result: list[SessionMoment] = []
    for m in moments:
        result.append(m.model_copy(update={"confidence": derive_confidence(m)}))
    return result
