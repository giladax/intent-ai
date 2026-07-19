"""The situation mirror — the whole org picture in one answer.

Built directly against the PM interrogation's three failures
(docs/reviews/2026-07-17-pm-interrogation.md):

1. "What are the areas / is anything red?" must return the MAP and a
   cross-area health rollup — never a single force-resolved area card.
2. One verdict vocabulary everywhere: this module attaches the same
   display labels the CLI uses to every JSON payload.
3. Status-shaped questions ("what's uncovered lately?") route HERE, not
   to term→area matching.
"""

from __future__ import annotations

import logging
import re

from quire_align.analysis.render import DISPLAY_LABELS
from quire_align.models import Classification
from quire_align.text import plural as _plural
from quire_align.timeline import UNOBSERVED, build_timeline

logger = logging.getLogger(__name__)

# Promise health speaks the map's language (The Hush): kept / partly
# kept / broken / not yet exercised. Check VERDICTS keep their own frozen
# vocabulary (DISPLAY_LABELS) — a check's judgment and a promise's
# standing are different things and read differently on purpose.
HEALTH_LABELS = {
    "satisfies": "kept",
    "partially_satisfies": "partly kept",
    "contradicts": "broken",
    UNOBSERVED: "not yet exercised",
}

# OFFLINE FALLBACK ONLY. Semantic routing belongs to the closed-enum LLM
# classifier (graph_heuristics.RouteDecision) per the repo's no-regex-for-
# semantics rule; these patterns serve when no model is available and are
# known to keyword-collide (e.g. an area literally named "Coverage").
_STATUS_PATTERNS: list[tuple[str, str]] = [
    (r"\b(violat|contradict|broken|breach|red\b|failing)", "whats_broken"),
    (r"\b(uncover|not cover|no (intent|contract|promise)|ungoverned|unwatched)", "whats_uncovered"),
    (r"\b(area|topic|map|overview|structure)s?\b", "overview"),
    (r"\b(recent|lately|changed|last week|this week|what happened)", "whats_changed"),
]


def classify_question(q: str, router=None) -> str | None:
    """Route a question: closed-enum LLM classifier when available (it can
    pick among fixed routes, never invent one), regex fallback offline.
    Returns a status-route name, or None → term resolution."""
    if router is not None:
        try:
            route = router(q)
            return None if route == "term_lookup" else route
        except Exception:
            # A mid-request model failure must not 500 the question —
            # degrade to the same regex fallback used when no key exists.
            logger.warning(
                "question router failed — falling back to regex routing",
                exc_info=True,
            )
    text = q.lower()
    for pattern, route in _STATUS_PATTERNS:
        if re.search(pattern, text):
            return route
    return None


def build_mirror(adapter, store, state: dict) -> dict:
    """One payload answering: what are the areas, what's red, what's
    unwatched, what changed. `state` is ask.load_group_state output."""
    analyses = store.list_analyses(repository=adapter.repository())
    timeline = build_timeline(adapter, analyses)
    events = timeline["events"]
    current = events[-1]["state_after"] if events else {}
    statements = {
        o["obligation_id"]: o["statement"] for o in timeline["obligations"]
    }

    areas = []
    red_flags = []
    for group in state["groups"]:
        rollup = {label: 0 for label in HEALTH_LABELS.values()}
        reds = []
        for ob_id in group["obligation_ids"]:
            status = current.get(ob_id, {}).get("status", UNOBSERVED)
            label = HEALTH_LABELS.get(status, status)
            rollup[label] = rollup.get(label, 0) + 1
            if status in ("contradicts", "partially_satisfies"):
                entry = {
                    "obligation_id": ob_id,
                    "statement": statements.get(ob_id, ""),
                    "health": label,
                    "since_check": current.get(ob_id, {}).get("since"),
                    "area": group["label"],
                }
                reds.append(entry)
                red_flags.append(entry)
        areas.append(
            {
                "group_id": group["group_id"],
                "label": group["label"],
                "promises": len(group["obligation_ids"]),
                "rollup": rollup,
                "red": reds,
            }
        )

    uncovered = [
        {
            "pr_number": e["pr_number"],
            "title": e["title"],
            "ts": e["ts"],
            "verdict_display": DISPLAY_LABELS[Classification.UNGOVERNED],
        }
        for e in events
        if e["verdict"] == "UNGOVERNED"
    ]
    open_findings = events[-1]["open_findings"] if events else []

    return {
        "workspace": timeline["workflow_id"],
        "repository": timeline["repository"],
        "areas": areas,
        "red_flags": red_flags,
        "all_clear": not red_flags,
        "uncovered_changes": uncovered,
        "open_findings": open_findings,
        "checks_total": len(events),
        "recent_checks": [
            {
                "pr_number": e["pr_number"],
                "title": e["title"],
                "ts": e["ts"],
                "verdict": e["verdict"],
                "verdict_display": DISPLAY_LABELS.get(
                    Classification(e["verdict"]), e["verdict"]
                ),
                "intent_changes": len(e["changes"]),
            }
            for e in events[-8:]
        ],
        "coverage_sentence": _coverage_sentence(areas, uncovered),
    }


def _coverage_sentence(areas: list[dict], uncovered: list[dict]) -> str:
    if not uncovered:
        return "Every recent change touched surface the contract covers."
    latest = uncovered[-1]
    return (
        f"{_plural(len(uncovered), 'recent change')} touched surface no "
        f"promise covers — most recently \"{latest['title'][:60]}\" (check "
        f"#{latest['pr_number']}). Worth registering intent for that area?"
    )


def route_status_question(route: str, mirror: dict) -> dict:
    """A direct answer for a status-shaped question, from mirror data."""
    if route == "whats_broken":
        if mirror["all_clear"]:
            summary = "Nothing is broken or partly kept — every exercised promise is holding."
        else:
            # "Worst" must mean worst: a contradiction outranks a partial
            # delivery regardless of area iteration order.
            worst = next(
                (f for f in mirror["red_flags"] if f["health"] == HEALTH_LABELS["contradicts"]),
                mirror["red_flags"][0],
            )
            n = len(mirror["red_flags"])
            summary = (
                f"Yes — {_plural(n, 'promise')} need{'s' if n == 1 else ''} "
                f"attention. Worst: {worst['statement'][:90]} ({worst['health']}, "
                f"in {worst['area']}, since check #{worst['since_check']})."
            )
        return {"answer": summary, "red_flags": mirror["red_flags"]}
    if route == "whats_uncovered":
        return {
            "answer": mirror["coverage_sentence"],
            "uncovered_changes": mirror["uncovered_changes"],
        }
    if route == "whats_changed":
        recent = [
            c
            for c in mirror["recent_checks"]
            if c["intent_changes"]
            or c["verdict"] != Classification.NO_MATERIAL_IMPACT.value
        ]
        summary = (
            f"{_plural(len(mirror['recent_checks']), 'recent check')}; "
            f"{len(recent)} moved a promise's status or need attention."
        )
        return {"answer": summary, "recent_checks": mirror["recent_checks"]}
    # overview
    listing = "; ".join(
        f"{a['label']} ({_plural(a['promises'], 'promise')})" for a in mirror["areas"]
    )
    return {
        "answer": f"{_plural(len(mirror['areas']), 'product area')}: {listing}.",
        "areas": mirror["areas"],
    }
