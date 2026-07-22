"""quire.vocab — the single source of truth for verdict vocabulary.

A PR analysis carries a `classification` enum (OFF_INTENT, PARTIAL, …). Those
strings are internal. Every human surface — the app's cards, tree dots,
"Needs you" rows, the daily home, the phone tap — reads its plain-language
label, its short verb, its ink (verdict colour), and its stakes (severity)
from HERE and nowhere else.

Founder ruling (2026-07-22): plain language everywhere, first-read clear for
a non-native speaker. "Breaks a promise" (not CONTRADICTS_INTENT),
"No promise covers it" (not UNGOVERNED / POSSIBLE_DRIFT). Classification
enums stay internal; this module translates them once.

Ink semantics (carried from the journal era): green = kept, red = broken,
amber = drift / partial, blue = not-covered (a call to draw a promise),
gray = unknown (uncertainty stays gray, never colourful).

Exposed to the app AND to agents via GET /api/vocab — the same public
contract, so no surface re-implements the mapping (F2: one place).
"""
from __future__ import annotations

from typing import Any

# One row per Classification enum value. Order = worst-first (reads as a
# stakes ranking). `ink` is a token name the frontend maps to a colour; the
# hex never lives here so design owns the palette.
#
# label   — the badge / headline noun-phrase ("Breaks a promise")
# verb    — the terse tree/inline form ("broke a promise")
# ink     — verdict colour token: red | amber | blue | gray | green
# severity— stakes for ranking the docket: critical | high | medium | info
_VERDICTS: dict[str, dict[str, str]] = {
    "OFF_INTENT": {
        "label": "Breaks a promise",
        "verb": "broke a promise",
        "ink": "red",
        "severity": "critical",
    },
    "PARTIAL": {
        "label": "Partly kept",
        "verb": "partly kept a promise",
        "ink": "amber",
        "severity": "high",
    },
    "POSSIBLE_DRIFT": {
        "label": "May be drifting",
        "verb": "may be drifting from a promise",
        "ink": "amber",
        "severity": "high",
    },
    "UNGOVERNED": {
        "label": "No promise covers it",
        "verb": "no promise covers it",
        "ink": "blue",
        "severity": "medium",
    },
    "UNKNOWN": {
        "label": "Needs your review",
        "verb": "needs your review",
        "ink": "gray",
        "severity": "medium",
    },
    "NO_MATERIAL_IMPACT": {
        "label": "No product impact",
        "verb": "no product impact",
        "ink": "gray",
        "severity": "info",
    },
    "ALIGNED": {
        "label": "Keeps its promises",
        "verb": "kept its promises",
        "ink": "green",
        "severity": "info",
    },
}

# Fallback for an unknown / future enum — never a silent crash, never colourful.
_UNKNOWN = {
    "label": "Needs your review",
    "verb": "needs your review",
    "ink": "gray",
    "severity": "medium",
}

# Docket ranking: loudest first. Shared with alarms._RANK so the page, the
# tap, and the phone agree on order.
SEVERITY_RANK = {"critical": 0, "high": 1, "medium": 2, "info": 3}


def verdict(classification: str | None) -> dict[str, str]:
    """Return the full vocab row for a classification enum (or the safe
    unknown fallback). Never raises."""
    if classification is None:
        return dict(_UNKNOWN)
    return dict(_VERDICTS.get(classification, _UNKNOWN))


def label(classification: str | None) -> str:
    return verdict(classification)["label"]


def ink(classification: str | None) -> str:
    return verdict(classification)["ink"]


def severity(classification: str | None) -> str:
    return verdict(classification)["severity"]


def as_vocab_payload() -> dict[str, Any]:
    """The public /api/vocab body — the whole map plus the ranking, so any
    client (app or agent) can translate verdicts without re-deriving them."""
    return {
        "verdicts": _VERDICTS,
        "unknown": _UNKNOWN,
        "severityRank": SEVERITY_RANK,
    }
