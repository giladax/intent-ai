"""Pure logic helpers ported from journal/src/web/*.ts.

All functions here are dependency-free (no DB, no LLM) and mirror the
TypeScript originals so the FastAPI router can call them with plain dicts.

Ported from:
  - journal.ts   — buildJournal, groupEpisodes, buildPulse
  - stats.ts     — buildStatsOverview, emptyStatsOverview, helpers
  - provenance.ts — buildProvenance, provenanceKind, isUuidLike, helpers
  - observations.ts — composeCurrentUnderstanding, normalizeGlob, buildReviewEvent
  - notifications.ts — buildNotifText, dedupNotifications
  - lens-opening-composer.ts — buildLensOpeningTurn, truncateToEssence
  - lens-chat-utils.ts — sanitizeLensLabel
  - window-membership.ts — computeWindowMembership
  - archive.ts — joinArchive, readRawSessionArchive
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

OBSERVATION_CATEGORY_PREFIX = "observation:"
TEN_MINUTES_MS = 10 * 60 * 1000  # milliseconds

# ─────────────────────────────────────────────────────────────────────────────
# Journal helpers (from journal.ts)
# ─────────────────────────────────────────────────────────────────────────────

def _ms(iso: str) -> float:
    """Parse ISO timestamp to milliseconds epoch."""
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.timestamp() * 1000
    except Exception:
        return 0.0


def _is_mcp_category(category: str | None) -> bool:
    return isinstance(category, str) and category.startswith("mcp:")


def _is_observation_category(category: str | None) -> bool:
    return isinstance(category, str) and category.startswith("observation:")


def _is_review_category(category: str | None) -> bool:
    return isinstance(category, str) and category.startswith("review:")


def _is_consult_miss(row: dict) -> bool:
    return _is_mcp_category(row.get("category")) and (row.get("metadata") or {}).get("outcome") == "miss"


def _is_moment_beat(row: dict) -> bool:
    return row.get("sourceType") == "moment"


def _run_id_of(row: dict) -> str | None:
    rid = (row.get("metadata") or {}).get("runId")
    return rid if isinstance(rid, str) and rid else None


def _causal_key(row: dict) -> float:
    m = row.get("metadata") or {}
    for k in ("causalOrder", "causal_order", "order", "seq"):
        v = m.get(k)
        if isinstance(v, (int, float)):
            return float(v)
    return float("inf")


def _sort_beats_ascending(rows: list[dict]) -> list[dict]:
    return sorted(rows, key=lambda r: (_ms(r.get("timestamp", "")), _causal_key(r)))


def _to_beat(row: dict) -> dict:
    return {
        "id": row["id"],
        "timestamp": row["timestamp"],
        "category": row["category"],
        "summary": row["summary"],
        "actor": row["actor"],
        "metadata": row.get("metadata") or {},
    }


def _count_beats(rows: list[dict]) -> dict:
    return {
        "beats": len(rows),
        "consults": sum(1 for r in rows if _is_mcp_category(r.get("category"))),
        "consultMisses": sum(1 for r in rows if _is_consult_miss(r)),
        "observations": sum(1 for r in rows if _is_observation_category(r.get("category"))),
        "moments": sum(1 for r in rows if _is_moment_beat(r)),
    }


def _collect_feature_ids(rows: list[dict]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for r in rows:
        fid = r.get("featureId")
        if fid and fid not in seen:
            seen.add(fid)
            out.append(fid)
    return out


def _collect_pending(rows: list[dict]) -> list[dict]:
    return [
        {"id": r["id"], "summary": r["summary"], "featureId": r.get("featureId"), "category": r["category"]}
        for r in rows
        if _is_observation_category(r.get("category")) and r.get("reviewStatus") == "pending"
    ]


def _pick_actor(rows: list[dict]) -> str:
    for r in rows:
        if isinstance(r.get("actor"), str) and r["actor"].startswith("agent:"):
            return r["actor"]
    from collections import Counter
    if not rows:
        return "system:pipeline"
    counts = Counter(r.get("actor", "") for r in rows)
    return counts.most_common(1)[0][0] or "system:pipeline"


def _short_id(id_: str) -> str:
    return id_[:8]


def _capitalize(s: str) -> str:
    return s[0].upper() + s[1:] if s else s


def _build_session_episode(session_id: str, rows: list[dict], session: dict | None) -> dict:
    ordered = _sort_beats_ascending(rows)
    counts = _count_beats(ordered)
    first_ts = ordered[0]["timestamp"] if ordered else None
    last_ts = ordered[-1]["timestamp"] if ordered else None
    started_at = (session or {}).get("startedAt") or first_ts or datetime(1970, 1, 1, tzinfo=timezone.utc).isoformat()
    ended_at = (session or {}).get("endedAt") or last_ts
    narrative = ((session or {}).get("narrativeSummary") or "").strip()
    title = narrative if narrative else f"Session {_short_id(session_id)} — {counts['moments']} moments, {counts['consults']} brain lookups"
    return {
        "id": f"session:{session_id}",
        "kind": "session",
        "title": title,
        "actor": _pick_actor(ordered),
        "startedAt": started_at,
        "endedAt": ended_at,
        "featureIds": _collect_feature_ids(ordered),
        "counts": counts,
        "pending": _collect_pending(ordered),
        "beats": [_to_beat(r) for r in ordered],
    }


def _build_run_episode(run_id: str, rows: list[dict]) -> dict:
    ordered = _sort_beats_ascending(rows)
    counts = _count_beats(ordered)
    started_at = ordered[0]["timestamp"] if ordered else datetime(1970, 1, 1, tzinfo=timezone.utc).isoformat()
    ended_at = ordered[-1]["timestamp"] if ordered else None
    return {
        "id": f"run:{run_id}",
        "kind": "run",
        "title": f"Run {_short_id(run_id)} — {counts['beats']} events",
        "actor": _pick_actor(ordered),
        "startedAt": started_at,
        "endedAt": ended_at,
        "featureIds": _collect_feature_ids(ordered),
        "counts": counts,
        "pending": _collect_pending(ordered),
        "beats": [_to_beat(r) for r in ordered],
    }


def _review_action_label(rows: list[dict]) -> str:
    n = len(rows)
    plural = "" if n == 1 else "s"
    actions = {r["category"][len("review:"):] for r in rows}
    if len(actions) == 1:
        action = next(iter(actions))
        return f"{_capitalize(action)} {n} observation{plural}"
    return f"Reviewed {n} observation{plural}"


def _build_review_batch_episode(rows: list[dict]) -> dict:
    ordered = _sort_beats_ascending(rows)
    first = ordered[0]
    started_at = first["timestamp"]
    ended_at = ordered[-1]["timestamp"] if ordered else None
    return {
        "id": f"review:{first['id']}",
        "kind": "review-batch",
        "title": _review_action_label(ordered),
        "actor": first["actor"],
        "startedAt": started_at,
        "endedAt": ended_at,
        "featureIds": _collect_feature_ids(ordered),
        "counts": _count_beats(ordered),
        "pending": _collect_pending(ordered),
        "beats": [_to_beat(r) for r in ordered],
    }


def _build_singleton_episode(row: dict) -> dict:
    kind = "observation" if _is_observation_category(row.get("category")) else "event"
    return {
        "id": f"event:{row['id']}",
        "kind": kind,
        "title": row["summary"],
        "actor": row["actor"],
        "startedAt": row["timestamp"],
        "endedAt": None,
        "featureIds": _collect_feature_ids([row]),
        "counts": _count_beats([row]),
        "pending": _collect_pending([row]),
        "beats": [_to_beat(row)],
    }


def _build_review_batches(rows: list[dict]) -> list[dict]:
    """Cluster review beats by actor, splitting on >10 min gaps."""
    from collections import defaultdict
    by_actor: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_actor[r.get("actor", "")].append(r)

    episodes = []
    for actor_rows in by_actor.values():
        sorted_rows = sorted(actor_rows, key=lambda r: _ms(r.get("timestamp", "")))
        batch: list[dict] = []

        def flush():
            nonlocal batch
            if batch:
                episodes.append(_build_review_batch_episode(batch))
            batch = []

        for e in sorted_rows:
            prev = batch[-1] if batch else None
            if prev and _ms(e.get("timestamp", "")) - _ms(prev.get("timestamp", "")) > TEN_MINUTES_MS:
                flush()
            batch.append(e)
        flush()
    return episodes


def group_episodes(events: list[dict], sessions: list[dict] | None = None) -> list[dict]:
    """Group activity events into display episodes (mirrors groupEpisodes in journal.ts)."""
    session_by_id: dict[str, dict] = {s["id"]: s for s in (sessions or [])}

    session_groups: dict[str, list[dict]] = {}
    run_groups: dict[str, list[dict]] = {}
    review_pool: list[dict] = []
    singletons: list[dict] = []

    for e in events:
        if e.get("sessionId"):
            sid = e["sessionId"]
            session_groups.setdefault(sid, []).append(e)
            continue
        run_id = _run_id_of(e)
        if run_id:
            run_groups.setdefault(run_id, []).append(e)
            continue
        if _is_review_category(e.get("category")):
            review_pool.append(e)
            continue
        singletons.append(e)

    episodes: list[dict] = []
    for session_id, rows in session_groups.items():
        episodes.append(_build_session_episode(session_id, rows, session_by_id.get(session_id)))
    for run_id, rows in run_groups.items():
        episodes.append(_build_run_episode(run_id, rows))
    episodes.extend(_build_review_batches(review_pool))
    for row in singletons:
        episodes.append(_build_singleton_episode(row))

    # Newest first
    episodes.sort(key=lambda ep: _ms(ep.get("startedAt", "")), reverse=True)
    return episodes


def build_pulse(events: list[dict], since: str | None, pending_review: int) -> dict:
    session_ids: set[str] = set()
    consults = consult_misses = observations_noticed = review_actions = learnings = 0

    for e in events:
        if e.get("sessionId"):
            session_ids.add(e["sessionId"])
        if _is_mcp_category(e.get("category")):
            consults += 1
            if _is_consult_miss(e):
                consult_misses += 1
        if _is_observation_category(e.get("category")):
            observations_noticed += 1
        if _is_review_category(e.get("category")):
            review_actions += 1
            if e.get("category") == "review:approved":
                learnings += 1

    return {
        "since": since,
        "sessionsDigested": len(session_ids),
        "consults": consults,
        "consultMisses": consult_misses,
        "observationsNoticed": observations_noticed,
        "pendingReview": pending_review,
        "reviewActions": review_actions,
        "learnings": learnings,
    }


def build_journal(events: list[dict], sessions: list[dict] | None, since: str | None, pending_review: int) -> dict:
    """Top-level journal assembler (mirrors buildJournal in journal.ts)."""
    return {
        "pulse": build_pulse(events, since, pending_review),
        "episodes": group_episodes(events, sessions),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Stats helpers (from stats.ts)
# ─────────────────────────────────────────────────────────────────────────────

def _local_day_key(d: datetime) -> str:
    return d.strftime("%Y-%m-%d")


def fill_cadence(rows: list[dict], window_days: int, now: datetime | None = None) -> list[dict]:
    """Densify sparse per-day rows into exactly window_days entries (oldest first)."""
    if now is None:
        now = datetime.now()
    by_day = {r["day"]: r["events"] for r in rows}
    out = []
    for i in range(window_days - 1, -1, -1):
        from datetime import timedelta
        d = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=i)
        key = _local_day_key(d)
        out.append({"day": key, "events": by_day.get(key, 0)})
    return out


def cadence_summary(cadence: list[dict]) -> dict:
    total_events = sum(d["events"] for d in cadence)
    active_days = sum(1 for d in cadence if d["events"] > 0)
    i = len(cadence) - 1
    if i >= 0 and cadence[i]["events"] == 0:
        i -= 1
    streak = 0
    while i >= 0 and cadence[i]["events"] > 0:
        streak += 1
        i -= 1
    return {"totalEvents": total_events, "activeDays": active_days, "streak": streak}


def anchored_pct(anchored: int, quotes: int) -> int | None:
    if quotes <= 0:
        return None
    return round((anchored / quotes) * 100)


def classify_momentum(recent_events: int, prior_events: int) -> str:
    if recent_events <= 0 and prior_events <= 0:
        return "quiet"
    if prior_events <= 0:
        return "rising"
    if recent_events >= prior_events * 1.25:
        return "rising"
    if recent_events <= prior_events * 0.75:
        return "cooling"
    return "steady"


def build_stats_overview(
    cadence_rows: list[dict],
    session_rows: list[dict],
    feature_rows: list[dict],
    window_days: int = 14,
    now: datetime | None = None,
) -> dict:
    cadence = fill_cadence(cadence_rows, window_days, now)
    sessions = [
        {**r, "anchoredPct": anchored_pct(r.get("anchored", 0), r.get("quotes", 0))}
        for r in session_rows
    ]
    total_quotes = sum(r.get("quotes", 0) for r in session_rows)
    total_anchored = sum(r.get("anchored", 0) for r in session_rows)
    return {
        "cadence": cadence,
        "cadenceSummary": cadence_summary(cadence),
        "sessions": sessions,
        "record": {
            "sessions": len(session_rows),
            "moments": sum(r.get("moments", 0) for r in session_rows),
            "quotes": total_quotes,
            "anchored": total_anchored,
            "anchoredPct": anchored_pct(total_anchored, total_quotes),
            "supported": sum(r.get("supported", 0) for r in session_rows),
            "contradicted": sum(r.get("contradicted", 0) for r in session_rows),
        },
        "features": [
            {**r, "trend": classify_momentum(r.get("recentEvents", 0), r.get("priorEvents", 0))}
            for r in feature_rows
        ],
    }


def empty_stats_overview(window_days: int = 14, now: datetime | None = None) -> dict:
    cadence = fill_cadence([], window_days, now)
    return {
        "cadence": cadence,
        "cadenceSummary": cadence_summary(cadence),
        "sessions": [],
        "record": {
            "sessions": 0, "moments": 0, "quotes": 0, "anchored": 0,
            "anchoredPct": None, "supported": 0, "contradicted": 0,
        },
        "features": [],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Provenance helpers (from provenance.ts)
# ─────────────────────────────────────────────────────────────────────────────

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)


def is_uuid_like(s: Any) -> bool:
    return isinstance(s, str) and bool(UUID_RE.match(s))


def confidence_pct(confidence: str | None) -> int | None:
    c = (confidence or "").strip().lower()
    if c == "high":
        return 90
    if c == "medium":
        return 65
    if c == "low":
        return 40
    return None


def provenance_kind(source_type: str | None, category: str | None) -> str:
    st = source_type or ""
    mapping = {
        "moment": "moment",
        "narrative": "narrative",
        "transition": "transition",
        "outcome": "outcome",
        "agent-trace": "agent-trace",
        "mcp": "consult",
    }
    if st in mapping:
        return mapping[st]
    c = (category or "").lower()
    if c.startswith("observation:"):
        return "observation"
    if c.startswith("mcp:"):
        return "consult"
    if c.startswith("agent:"):
        return "agent-trace"
    return "event"


def verification_verdict(supported: int, contradicted: int) -> str:
    if supported > 0 and contradicted > 0:
        return "mixed"
    if contradicted > 0:
        return "contradicted"
    if supported > 0:
        return "supported"
    return "unverified"


def split_agent_trace(rows: list[dict]) -> dict | None:
    if not rows:
        return None
    run_row = next((r for r in rows if r.get("category") == "agent:run"), None)
    tool_calls = []
    for r in rows:
        if r.get("category") == "agent:tool-call":
            m = r.get("metadata") or {}
            tool_calls.append({
                "name": m.get("toolName") if isinstance(m.get("toolName"), str) else (r["summary"].split("(")[0] or "tool"),
                "ms": m.get("ms") if isinstance(m.get("ms"), (int, float)) else None,
                "argsSummary": m.get("argsSummary") if isinstance(m.get("argsSummary"), str) else "",
                "summary": r["summary"],
            })
    return {
        "run": {"summary": run_row["summary"], "metadata": run_row.get("metadata") or {}} if run_row else None,
        "toolCalls": tool_calls,
    }


def build_provenance(
    event: dict | None,
    kind_override: str | None,
    moments: list[dict],
    evidence: list[dict],
    anchor_events: list[dict],
    session: dict | None,
    quality: dict | None,
    trace_rows: list[dict],
    observation_rows: list[dict],
) -> dict:
    """Assemble the provenance chain (mirrors buildProvenance in provenance.ts)."""
    kind = kind_override or provenance_kind(
        (event or {}).get("sourceType"),
        (event or {}).get("category"),
    )

    anchor_by_id = {a["id"]: a for a in anchor_events}
    evidence_by_moment: dict[str, list[dict]] = {}
    for e in evidence:
        evidence_by_moment.setdefault(e["momentId"], []).append(e)

    prov_moments = []
    for m in moments:
        ev_list = evidence_by_moment.get(m["id"], [])
        evs = []
        for e in ev_list:
            anchor = anchor_by_id.get(e.get("sourceEventId")) if e.get("sourceEventId") else None
            evs.append({
                "id": e["id"],
                "quote": e["quote"],
                "quoteType": e.get("quoteType"),
                "sourceType": e.get("sourceType"),
                "anchored": anchor is not None,
                "event": anchor,
            })
        prov_moments.append({
            "id": m["id"],
            "type": m["type"],
            "statement": m["statement"],
            "significance": m.get("significance"),
            "agency": m.get("agency"),
            "confidence": m.get("confidence"),
            "confidencePct": confidence_pct(m.get("confidence")),
            "verification": m.get("verification"),
            "evidence": evs,
        })

    all_evidence = [e for pm in prov_moments for e in pm["evidence"]]
    quotes = len(all_evidence)
    anchored = sum(1 for e in all_evidence if e["anchored"])
    transcript_events = len({e["event"]["id"] for e in all_evidence if e.get("event")})
    supported = sum(1 for pm in prov_moments if pm.get("verification") == "supported")
    contradicted = sum(1 for pm in prov_moments if pm.get("verification") == "contradicted")
    unverified = len(prov_moments) - supported - contradicted

    pcts = [pm["confidencePct"] for pm in prov_moments if pm["confidencePct"] is not None]
    if len(prov_moments) == 1:
        chain_confidence = prov_moments[0]["confidencePct"]
    elif pcts:
        chain_confidence = round(sum(pcts) / len(pcts))
    else:
        chain_confidence = None

    return {
        "event": event,
        "kind": kind,
        "verdict": {
            "confidencePct": chain_confidence,
            "verification": verification_verdict(supported, contradicted),
            "supported": supported,
            "contradicted": contradicted,
            "unverified": unverified,
            "moments": len(prov_moments),
            "quotes": quotes,
            "anchored": anchored,
            "anchoredPct": anchored_pct(anchored, quotes),
            "transcriptEvents": transcript_events,
        },
        "moments": prov_moments,
        "session": {
            "id": session["id"],
            "shape": session.get("sessionShape"),
            "startedAt": session.get("startedAt"),
            "endedAt": session.get("endedAt"),
        } if session else None,
        "digest": {**quality, "anchoredPct": anchored_pct(quality.get("anchored", 0), quality.get("quotes", 0))} if quality else None,
        "agentTrace": split_agent_trace(trace_rows),
        "observations": [
            {
                "id": o["id"],
                "timestamp": o["timestamp"],
                "category": o["category"],
                "summary": o["summary"],
                "reviewStatus": o.get("reviewStatus"),
                "featureId": o.get("featureId"),
            }
            for o in observation_rows
        ],
        "understandingDelta": None,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Observation helpers (from observations.ts)
# ─────────────────────────────────────────────────────────────────────────────

def compose_current_understanding(existing: str | None, observation_text: str) -> str:
    """Promote an approved observation into a feature's current understanding."""
    obs = (observation_text or "").strip()
    base = (existing or "").strip()
    if not obs:
        return base

    def normalize(s: str) -> str:
        return re.sub(r"\s+", " ", s).strip().lower()

    target = normalize(obs)
    for line in base.split("\n"):
        stripped = re.sub(r"^[-*]\s+", "", line)
        if normalize(stripped) == target:
            return base

    bullet = obs if obs.startswith("- ") else f"- {obs}"
    return f"{base}\n{bullet}" if base else bullet


def normalize_glob(input_: str | None) -> str | None:
    g = (input_ or "").strip()
    return g if g else None


def build_review_event(action: str, obs: dict, actor: str = "human:local") -> dict:
    """Build a review:* activity event (mirrors buildReviewEvent in observations.ts)."""
    category = obs.get("category") or ""
    kind = category[len(OBSERVATION_CATEGORY_PREFIX):] if category.startswith(OBSERVATION_CATEGORY_PREFIX) else "observation"
    target = f' on "{obs["featureName"]}"' if obs.get("featureName") else ""
    text = obs["summary"][:117] + "..." if len(obs["summary"]) > 120 else obs["summary"]
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "category": f"review:{action}",
        "tags": ["review", kind],
        "actor": actor,
        "summary": f"{_capitalize(action)} a {kind}{target}: {text}",
        "sourceType": "review",
        "sourceId": obs["id"],
        "metadata": {
            "observationId": obs["id"],
            "featureId": obs.get("featureId"),
            "kind": kind,
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# Notifications (from notifications.ts)
# ─────────────────────────────────────────────────────────────────────────────

def build_notif_text(type_: str, feature_name: str | None = None, actor_name: str | None = None,
                     count: int | None = None, moment_summary: str | None = None) -> str:
    name = feature_name or "a feature"
    if type_ == "pending_gate":
        return f"{name} has 1 thing waiting for your review." if count == 1 else f"{name} has {count or 0} things waiting for your review."
    if type_ == "area_activity":
        if actor_name and count:
            return f"{actor_name} made {count} update{'s' if count != 1 else ''} in {name}."
        if actor_name:
            return f"{actor_name} was active in {name}."
        return f"New activity in {name}."
    if type_ == "contradicted":
        return f'A finding in {name} contradicts an earlier assessment: "{moment_summary}".' if moment_summary else f"A finding in {name} contradicts an earlier decision."
    if type_ == "hot_streak":
        return f"{name} is moving fast — {count or 0} events in the last hour."
    return f"Update in {name}."


def dedup_notifications(notifs: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out = []
    for n in notifs:
        key = f"{n['type']}::{n['featureId']}"
        if key not in seen:
            seen.add(key)
            out.append(n)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Lens opening (from lens-opening-composer.ts)
# ─────────────────────────────────────────────────────────────────────────────

def truncate_to_essence(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    sub = text[:max_chars]
    last_end = max(sub.rfind(". "), sub.rfind("! "), sub.rfind("? "))
    if last_end > max_chars * 0.4:
        return text[:last_end + 1].strip() + "…"
    return sub.strip() + "…"


def build_lens_opening_turn(feature_name: str, understanding: str | None,
                             recent_insights: list[str], pending_count: int) -> str:
    parts: list[str] = []
    if understanding and understanding.strip():
        parts.append(truncate_to_essence(understanding.strip(), 600))
    else:
        parts.append(f"{feature_name} is tracked here. No deep understanding built yet — start a session to add to it.")
    if recent_insights:
        parts.append("Recent: " + " · ".join(recent_insights[:3]))
    if pending_count > 0:
        parts.append(f"{pending_count} thing{'s' if pending_count != 1 else ''} waiting for your approval.")
    return "\n\n".join(parts)


# ─────────────────────────────────────────────────────────────────────────────
# Lens chat utils (from lens-chat-utils.ts)
# ─────────────────────────────────────────────────────────────────────────────

_LABEL_ALLOWLIST = {"today", "this week"}
_MAX_LABEL_LEN = 32


def sanitize_lens_label(raw: str | None) -> str:
    if not raw:
        return "selected period"
    lower = raw.lower().strip()
    if lower in _LABEL_ALLOWLIST:
        return lower
    sanitized = re.sub(r"[^a-z0-9 \-]", "", raw, flags=re.IGNORECASE)[:_MAX_LABEL_LEN].strip()
    return sanitized or "selected period"


# ─────────────────────────────────────────────────────────────────────────────
# Window membership (from window-membership.ts)
# ─────────────────────────────────────────────────────────────────────────────

def compute_window_membership(events: list[dict], chunks: list[dict], overlap: int) -> dict[int, list[int]]:
    """Map causalOrder → list of chunkIndex memberships (mirrors computeWindowMembership)."""
    if not chunks or not events:
        return {}
    sorted_chunks = sorted(chunks, key=lambda c: c["chunkIndex"])
    next_chunk: dict[int, dict] = {sorted_chunks[i]["chunkIndex"]: sorted_chunks[i + 1] for i in range(len(sorted_chunks) - 1)}

    result: dict[int, list[int]] = {}
    for event in events:
        co = event["causalOrder"]
        memberships: list[int] = []
        for chunk in sorted_chunks:
            if chunk["eventRangeStart"] <= co <= chunk["eventRangeEnd"]:
                memberships.append(chunk["chunkIndex"])
                overlap_threshold = chunk["eventRangeEnd"] - overlap + 1
                if co >= overlap_threshold and chunk["chunkIndex"] in next_chunk:
                    memberships.append(next_chunk[chunk["chunkIndex"]]["chunkIndex"])
                break
        if memberships:
            result[co] = memberships
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Digest schedule (from server.ts loadSchedule/saveSchedule)
# ─────────────────────────────────────────────────────────────────────────────

import json

_DEFAULT_SCHEDULE = {"enabled": False, "intervalMinutes": 30, "debounceMinutes": 10}


def _schedule_path() -> Path:
    return Path(__file__).parent.parent.parent / ".intent" / "digest-schedule.json"


def load_schedule() -> dict:
    try:
        raw = json.loads(_schedule_path().read_text())
        return {
            "enabled": bool(raw.get("enabled")),
            "intervalMinutes": max(1, int(raw.get("intervalMinutes") or _DEFAULT_SCHEDULE["intervalMinutes"])),
            "debounceMinutes": max(0, int(raw.get("debounceMinutes") or _DEFAULT_SCHEDULE["debounceMinutes"])),
        }
    except Exception:
        return dict(_DEFAULT_SCHEDULE)


def save_schedule(s: dict) -> None:
    path = _schedule_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(s, indent=2))
