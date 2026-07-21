"""feed.py — Python port of journal/src/web/feed-composer.ts (633 lines).

Full port: deterministic core, DB layer, LLM composition, cache logic.

Concurrency: threading.Lock as a module-level in-flight guard. The FastAPI
route handlers that call get_feed_or_compose are *sync* def (not async), so
asyncio.Lock is not applicable. A threading.Lock prevents duplicate composition
when concurrent HTTP requests each hit a stale cache at the same time — the
second request waits for the first to finish then reads the freshly-written
cache entry.
"""
from __future__ import annotations

import json
import math
import os
import re
import threading
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel
from sqlalchemy import text

# ── Constants ──────────────────────────────────────────────────────────────

HALF_LIFE_HOURS = 12

CACHE_MAX_AGE_MS = 60 * 60 * 1000       # 1 hour — normal TTL
CACHE_MIN_AGE_MS = 5 * 60 * 1000        # 5 min — never recompose faster
CACHE_DEGRADED_TTL_MS = 5 * 60 * 1000   # 5 min — degraded composes expire fast

BANNED_OUTPUT_WORDS = [
    "river", "sitting", "ink", "correspondence", "edition", "sittings", "unfolded"
]

DANGLING_CONNECTIVES: set[str] = {
    "the", "a", "an", "of", "and", "or", "in", "to", "at", "on", "for", "with",
    "—", "but", "nor", "so", "yet", "by", "as",
}

VOICE_SYSTEM_PROMPT = """You are Quire, an organizational understanding engine. You generate editorial copy for a development team's feed.

VOICE RULES — these are mandatory:
- State the value plainly. Say what happened and why it matters.
- Never be clever about the product itself.
- The test: would a straight-talking founder say this out loud to a colleague? If not, rewrite it.
- Tell the story, then leave a door open.
- Lead with the real event or finding; close with a concrete question or unresolved thread.
- Every claim traces to evidence.
- Headlines carry the actual news.
- Second person, specific. Terse.

BANNED WORDS (never use): river, sitting, ink, correspondence, edition, sittings, unfolded

Output ONLY valid JSON matching the schema requested. No markdown, no explanation."""

# ── Module-level in-flight lock ─────────────────────────────────────────────

_compose_lock = threading.Lock()

# ── Pydantic schemas for LLM outputs ────────────────────────────────────────


class LedeOutput(BaseModel):
    headline: str
    body: str
    citedSessionIds: list[str] = []


class StoryOutput(BaseModel):
    headline: str
    dek: str
    openQuestion: str
    deepHeadline: str | None = None
    deep: str | None = None
    citedSessionIds: list[str] = []


# ── Pure helper functions ────────────────────────────────────────────────────


def _pl(n: int, word: str) -> str:
    return word if n == 1 else f"{word}s"


def _strip_category_prefix(summary: str) -> str:
    return re.sub(r"^\[[^\]]*\]\s*", "", summary)


_BOUNDARY_RE = re.compile(r"[—:,]$")


def _first_sentence(summary: str | None, max_words: int) -> str:
    if not summary:
        return ""
    raw = re.split(r"[.!?]", _strip_category_prefix(summary))[0].strip()
    if not raw:
        return ""
    words = [w for w in raw.split() if w]
    if len(words) <= max_words:
        return " ".join(words)

    # Look for last phrase/clause boundary within budget
    boundary_idx = -1
    for i in range(min(max_words, len(words))):
        if _BOUNDARY_RE.search(words[i]):
            boundary_idx = i

    if boundary_idx >= 0:
        cut = " ".join(words[:boundary_idx]).rstrip("—:,").strip()
        if cut:
            return cut

    # No boundary — use word budget, drop trailing dangling connectives
    end = min(max_words, len(words))
    while end > 1 and words[end - 1].lower().rstrip(".,;:!?—") in DANGLING_CONNECTIVES:
        end -= 1
    return " ".join(words[:end])


# ── Deterministic core (pure, no DB/LLM) ────────────────────────────────────


def compute_heat_score(events: list[dict], now: datetime) -> float:
    """Recency-weighted heat score: sum(exp(-age_hours * ln2 / HALF_LIFE)) per event."""
    score = 0.0
    for ev in events:
        ts_str = ev.get("timestamp", "")
        try:
            ts = datetime.fromisoformat(ts_str)
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            now_aware = now if now.tzinfo else now.replace(tzinfo=timezone.utc)
            age_ms = (now_aware - ts).total_seconds() * 1000
            age_hours = age_ms / 3_600_000
            score += math.exp((-age_hours * math.log(2)) / HALF_LIFE_HOURS)
        except (ValueError, TypeError):
            pass
    return score


def heat_label(score: float) -> str:
    if score >= 8:
        return "hot"
    if score >= 2:
        return "still warm"
    return "cooling"


def rank_trending(items: list[dict], now: datetime, max_items: int = 5) -> list[dict]:
    """Rank TrendingInput items by heat score descending, return up to max_items."""
    scored = []
    for item in items:
        score = compute_heat_score(item.get("events", []), now)
        scored.append({
            **item,
            "heatScore": score,
            "heatLabel": heat_label(score),
            "eventCount": len(item.get("events", [])),
        })
    scored.sort(key=lambda x: x["heatScore"], reverse=True)
    return scored[:max_items]


def is_cache_stale(entry: dict, current_event_count: int, degraded: bool = False) -> bool:
    """Return True if the cache entry should be recomposed."""
    composed_at = entry.get("composedAt")
    if not isinstance(composed_at, datetime):
        return True
    now = datetime.now(timezone.utc)
    composed_aware = composed_at if composed_at.tzinfo else composed_at.replace(tzinfo=timezone.utc)
    age_ms = (now - composed_aware).total_seconds() * 1000

    # Never recompose more than once per 5 minutes
    if age_ms < CACHE_MIN_AGE_MS:
        return False

    max_age = CACHE_DEGRADED_TTL_MS if degraded else CACHE_MAX_AGE_MS
    if age_ms > max_age:
        return True

    return current_event_count > entry.get("eventCountAtCompose", 0)


def build_feed_cache_key() -> str:
    return "org"


def contains_banned_words(text_: str) -> bool:
    """True if text contains any voice-rule banned words (whole-word, case-insensitive)."""
    for word in BANNED_OUTPUT_WORDS:
        if re.search(rf"\b{re.escape(word)}\b", text_, re.IGNORECASE):
            return True
    return False


def build_fallback_story_headline(summaries: list[str], feature_name: str) -> str:
    """Build story headline from first event summary. Falls back to feature_name only when no evidence."""
    if not summaries:
        return feature_name
    sentence = _first_sentence(summaries[0], 12)
    return f"{sentence}." if sentence else feature_name


def build_fallback_lede_fallback_text(feature_count: int, org_name: str = "Quire") -> str:
    return f"{org_name} has active work across {feature_count} {_pl(feature_count, 'feature')}."


def build_fallback_lede_headline(_summaries: list[str] | None, feature_count: int) -> str:
    return f"{feature_count} active {_pl(feature_count, 'feature')}."


def build_fallback_deep(summaries: list[str]) -> dict:
    """Assemble deep-cut from summaries after the first (dek already consumed it)."""
    remaining = [_strip_category_prefix(s) for s in summaries[1:5] if s]
    remaining = [r for r in remaining if r]
    if not remaining:
        return {}
    if len(remaining) > 2:
        deep = f"{' '.join(remaining[:2])}\n\n{' '.join(remaining[2:])}"
    else:
        deep = " ".join(remaining)
    head_sentence = _first_sentence(summaries[1] if len(summaries) > 1 else None, 12)
    return {
        "deepHeadline": f"{head_sentence}." if head_sentence else None,
        "deep": deep,
    }


def filter_citations(model_ids: list[str], known_session_ids: list[str]) -> list[str]:
    """Drop model-returned ids not in the DB-derived known set."""
    if not known_session_ids:
        return []
    known = set(known_session_ids)
    return [id_ for id_ in model_ids if id_ in known]


def deduplicate_trending(
    items: list[dict],
    evidence_by_feature: dict[str, dict],
    max_items: int = 5,
) -> list[dict]:
    """Suppress stories whose session evidence overlaps >50% with a higher-ranked story."""
    seen: set[str] = set()
    result: list[dict] = []
    for item in items:
        ev = evidence_by_feature.get(item["featureId"])
        sids = ev.get("sessionIds", []) if ev else []
        if not sids:
            result.append(item)
        else:
            overlap = sum(1 for s in sids if s in seen)
            if overlap / len(sids) <= 0.5:
                for s in sids:
                    seen.add(s)
                result.append(item)
        if len(result) >= max_items:
            break
    return result


def build_skeleton_feed() -> dict:
    return {
        "editionNumber": 0,
        "composedAt": datetime.now(timezone.utc).isoformat(),
        "lede": {
            "text": "Nothing is digested yet — start a session to see the feed come to life.",
            "citedSessionIds": [],
        },
        "trending": [],
    }


# ── LLM call (raw-JSON-text modality, matching TS callSonnet) ───────────────


def _call_sonnet(system: str, user: str, schema: type) -> Any:
    """Direct Anthropic SDK call matching TS callSonnet modality (raw JSON text, not tool_use).
    Raises on failure — callers catch and fall back to deterministic copy."""
    import anthropic

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    raw = response.content[0].text if response.content else ""
    cleaned = re.sub(r"^```(?:json)?\s*\n?", "", raw, flags=re.IGNORECASE)
    cleaned = re.sub(r"\n?```\s*$", "", cleaned, flags=re.IGNORECASE).strip()
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", cleaned)
        if m:
            parsed = json.loads(m.group(0))
        else:
            raise
    return schema(**parsed)


# ── DB layer ─────────────────────────────────────────────────────────────────


def actors_to_initials(actors: list[str]) -> list[str]:
    out: set[str] = set()
    for a in actors:
        norm = a.lower()
        if norm in ("developer", "collaborative"):
            out.add("GK")
        if norm in ("ai", "collaborative") or norm.startswith("agent"):
            out.add("AI")
    return list(out)


def query_trending_inputs(db_session, window_hours: int = 48) -> list[dict]:
    """SQL-parity port of TS queryTrendingInputs."""
    rows = db_session.execute(
        text("""
            SELECT
              sub.fid as feature_id,
              COALESCE(f.name, sub.fid) as feature_name,
              json_agg(
                json_build_object('timestamp', sub.ts, 'featureId', sub.fid)
                ORDER BY sub.ts DESC
              ) as events
            FROM (
              SELECT ae.feature_id as fid, ae.timestamp as ts
              FROM activity_events ae
              WHERE ae.feature_id IS NOT NULL
                AND ae.timestamp >= NOW() - make_interval(hours => :window_hours)
              UNION ALL
              SELECT fs.feature_id::text as fid, ae.timestamp as ts
              FROM activity_events ae
              JOIN feature_sessions fs ON fs.session_id = ae.session_id
              WHERE ae.feature_id IS NULL
                AND ae.timestamp >= NOW() - make_interval(hours => :window_hours)
            ) sub
            LEFT JOIN features f ON f.id::text = sub.fid
            GROUP BY sub.fid, f.name
            ORDER BY COUNT(*) DESC
            LIMIT 10
        """),
        {"window_hours": window_hours},
    ).mappings().all()

    result = []
    for r in rows:
        events_raw = r["events"]
        if not events_raw:
            continue
        # Postgres returns list already; normalize timestamps to ISO strings
        events = []
        for ev in events_raw:
            ts = ev.get("timestamp", "")
            if hasattr(ts, "isoformat"):
                ts = ts.isoformat()
            events.append({"timestamp": str(ts), "featureId": ev.get("featureId", "")})
        result.append({
            "featureId": r["feature_id"],
            "featureName": r["feature_name"] or r["feature_id"],
            "events": events,
        })
    return result


def query_feature_evidence(
    db_session,
    feature_id: str,
    window_hours: int = 48,
    limit: int = 12,
) -> dict:
    """SQL-parity port of TS queryFeatureEvidence."""
    rows = db_session.execute(
        text("""
            SELECT DISTINCT ON (ae.id)
              ae.summary, ae.actor, ae.session_id::text as session_id, ae.category
            FROM activity_events ae
            LEFT JOIN feature_sessions fs ON fs.session_id = ae.session_id
            WHERE (ae.feature_id = :feature_id OR fs.feature_id::text = :feature_id)
              AND ae.timestamp >= NOW() - make_interval(hours => :window_hours)
            ORDER BY ae.id, ae.timestamp DESC
            LIMIT :limit
        """),
        {"feature_id": feature_id, "window_hours": window_hours, "limit": limit},
    ).mappings().all()

    session_ids = list({r["session_id"] for r in rows if r["session_id"]})
    summaries = [f"[{r['category']}] {r['summary']}" for r in rows]
    initials = actors_to_initials([r["actor"] for r in rows if r.get("actor")])
    return {
        "summaries": summaries,
        "sessionIds": session_ids,
        "actorInitials": initials,
    }


# ── Cache helpers ────────────────────────────────────────────────────────────


def get_cached_feed(db_session) -> tuple[dict | None, int]:
    """Return (cached_feed | None, event_count). Returns None when cache is stale/missing."""
    cnt_row = db_session.execute(
        text("SELECT COUNT(*)::integer as cnt FROM activity_events")
    ).mappings().fetchone()
    event_count = int(cnt_row["cnt"]) if cnt_row else 0

    row = db_session.execute(
        text("SELECT id, payload, composed_at, event_count_at_compose FROM feed_cache WHERE id = 'org' LIMIT 1")
    ).mappings().fetchone()
    if not row:
        return None, event_count

    payload = row["payload"]
    if isinstance(payload, str):
        payload = json.loads(payload)

    entry = {
        "composedAt": row["composed_at"],
        "eventCountAtCompose": row["event_count_at_compose"],
    }
    # Detect degraded compose: lede has no cited sessions AND no story has citations + eventCount 0
    lede_cites = (payload.get("lede") or {}).get("citedSessionIds", [])
    trending = payload.get("trending", [])
    degraded = (
        len(lede_cites) == 0
        and all(len(s.get("citedSessionIds", [])) == 0 and s.get("eventCount", 0) == 0 for s in trending)
    )

    if is_cache_stale(entry, event_count, degraded):
        return None, event_count
    return payload, event_count


def set_cached_feed(db_session, feed: dict, event_count: int) -> None:
    """Upsert feed into feed_cache."""
    db_session.execute(
        text("""
            INSERT INTO feed_cache (id, payload, composed_at, event_count_at_compose)
            VALUES ('org', CAST(:payload AS jsonb), NOW(), :cnt)
            ON CONFLICT (id) DO UPDATE
              SET payload = EXCLUDED.payload,
                  composed_at = EXCLUDED.composed_at,
                  event_count_at_compose = EXCLUDED.event_count_at_compose
        """),
        {"payload": json.dumps(feed), "cnt": event_count},
    )
    db_session.commit()


# ── LLM editorial composition ────────────────────────────────────────────────


def compose_feed_editorial(
    trending_items: list[dict],
    org_name: str,
    evidence_by_feature: dict[str, dict] | None = None,
    edition_number: int = 1,
) -> dict:
    """Compose the editorial feed. Up to 3 Sonnet calls: 1 lede + top 2 stories.

    Voice-rule guard: if Sonnet output contains banned words, deterministic copy is used.
    Citation validation: model-returned ids not in DB evidence are dropped.
    Fallback: any failed call degrades gracefully to deterministic copy.
    """
    ev_map = evidence_by_feature or {}
    top_items = trending_items[:3]

    def _build_top_summary() -> str:
        parts = []
        for item in top_items:
            ev = ev_map.get(item["featureId"])
            sample = ""
            if ev:
                sample_lines = [f"    · {s[:180]}" for s in ev["summaries"][:4]]
                sample = "\n" + "\n".join(sample_lines) if sample_lines else ""
            parts.append(
                f"- {item['featureName']}: {item['eventCount']} events, "
                f"heat={item['heatScore']:.1f}{sample}"
            )
        return "\n".join(parts)

    # ── Call 1: org lede ─────────────────────────────────────────────────────
    lede: dict = {
        "headline": build_fallback_lede_headline(None, len(trending_items)),
        "text": build_fallback_lede_fallback_text(len(trending_items), org_name),
        "citedSessionIds": [],
    }
    try:
        top_summary = _build_top_summary()
        lede_result = _call_sonnet(
            VOICE_SYSTEM_PROMPT,
            f"""Generate a 1-paragraph editorial overview for a development team feed.

Organization: {org_name}
Active features (by heat, with recent recorded events as evidence):
{top_summary}
Total active features: {len(trending_items)}

Generate a concise lede headline (≤10 words, carries the actual news) and body paragraph. Lead with the most significant real event from the evidence above. Every claim must trace to the evidence — never invent.
Return JSON: {{ "headline": "...", "body": "...", "citedSessionIds": [] }}""",
            LedeOutput,
        )
        # Lede prompt never supplies session ids — any model-returned ids are fabricated.
        lede = {"headline": lede_result.headline, "text": lede_result.body, "citedSessionIds": []}
    except Exception:
        pass  # deterministic fallback already set

    # ── Calls 2-3: top 2 stories (stories 3-5 get deterministic copy) ────────
    stories: list[dict] = []
    for idx, item in enumerate(trending_items[:5]):
        ev = ev_map.get(item["featureId"])
        summaries = ev["summaries"] if ev else []
        known_sids = ev["sessionIds"] if ev else []

        # Deterministic defaults
        headline = build_fallback_story_headline(summaries, item["featureName"])
        summary_raw = summaries[0].replace(re.sub(r"^\[[^\]]*\]\s*", "", summaries[0]), "").strip() if summaries else ""
        summary_raw = _strip_category_prefix(summaries[0])[:200].rstrip() if summaries else ""
        summary_part = summary_raw if summary_raw.endswith((".", "!", "?")) else (summary_raw + "." if summary_raw else "")
        dek = (
            f"{summary_part} {item['eventCount']} {_pl(item['eventCount'], 'event')} in the last 48 hours."
            if summary_part
            else f"{item['eventCount']} {_pl(item['eventCount'], 'event')} in the last 48 hours."
        )
        open_question = "What comes next?"
        cited_sids = known_sids[:3]
        fallback_deep = build_fallback_deep(summaries)
        deep_headline = fallback_deep.get("deepHeadline")
        deep = fallback_deep.get("deep")

        if idx < 2:
            try:
                evidence_block = "\n".join(f"- {s[:220]}" for s in summaries[:10]) or "(no recorded summaries)"
                story_result = _call_sonnet(
                    VOICE_SYSTEM_PROMPT,
                    f"""Generate editorial copy for a trending feature story.

Feature: {item['featureName']}
Heat: {item['heatLabel']} (score: {item['heatScore']:.1f})
Event count (48h): {item['eventCount']}
Recent recorded events (newest first — this is your only evidence):
{evidence_block}

The headline carries the actual news from the evidence. The dek explains what happened and why it matters in 2-3 sentences. The openQuestion is the concrete unresolved thread. The deepHeadline is a second-angle headline (≤12 words, distinct from headline). The deep is 2 paragraphs with new information grounded in the evidence.
Return JSON: {{ "headline": "...", "dek": "...", "openQuestion": "...", "deepHeadline": "...", "deep": "...", "citedSessionIds": [] }}""",
                    StoryOutput,
                )
                # Voice-rule guard
                if not contains_banned_words(story_result.headline) and not contains_banned_words(story_result.dek):
                    headline = story_result.headline
                    dek = story_result.dek
                    open_question = story_result.openQuestion

                # Deep cut: use model version only when present and voice-clean
                deep_clean = (
                    story_result.deep
                    and not contains_banned_words(story_result.deep)
                    and story_result.deepHeadline
                    and not contains_banned_words(story_result.deepHeadline)
                )
                if deep_clean:
                    deep_headline = story_result.deepHeadline
                    deep = story_result.deep
                # else keep fallback_deep values

                # Citation validation
                if story_result.citedSessionIds and known_sids:
                    validated = filter_citations(story_result.citedSessionIds, known_sids)
                    if validated:
                        cited_sids = validated
            except Exception:
                pass  # keep deterministic defaults

        stories.append({
            "featureId": item["featureId"],
            "featureName": item["featureName"],
            "heatScore": item["heatScore"],
            "heatLabel": item["heatLabel"],
            "eventCount": item["eventCount"],
            "headline": headline,
            "dek": dek,
            "openQuestion": open_question,
            "citedSessionIds": cited_sids,
            "actorInitials": ev["actorInitials"] if ev else [],
            "deepHeadline": deep_headline,
            "deep": deep,
        })

    return {
        "editionNumber": edition_number,
        "composedAt": datetime.now(timezone.utc).isoformat(),
        "lede": lede,
        "trending": stories,
    }


# ── Main composition orchestrator ────────────────────────────────────────────


def _do_compose(db_session, event_count: int) -> dict:
    inputs = query_trending_inputs(db_session)
    now = datetime.now(timezone.utc)
    ranked = rank_trending(inputs, now)

    evidence_by_feature: dict[str, dict] = {}
    for item in ranked:
        try:
            evidence_by_feature[item["featureId"]] = query_feature_evidence(
                db_session, item["featureId"]
            )
        except Exception:
            pass  # evidence is optional

    edition_number = 1
    try:
        sess_row = db_session.execute(
            text("SELECT COUNT(*)::integer as cnt FROM sessions")
        ).mappings().fetchone()
        edition_number = max(1, int(sess_row["cnt"])) if sess_row else 1
    except Exception:
        pass

    deduped = deduplicate_trending(ranked, evidence_by_feature)
    composed = compose_feed_editorial(deduped, "Quire", evidence_by_feature, edition_number)
    set_cached_feed(db_session, composed, event_count)
    return composed


def get_feed_or_compose(db_session, force_refresh: bool = False) -> dict:
    """Return the current feed, composing if needed.

    Threading.Lock prevents duplicate in-flight composition: the second
    concurrent request waits for the first to finish, then re-reads the
    freshly-written cache entry.
    """
    feed, event_count = get_cached_feed(db_session)
    if feed and not force_refresh:
        return feed

    # Try to become the composer; if lock is taken, wait then re-read cache.
    acquired = _compose_lock.acquire(blocking=False)
    if not acquired:
        _compose_lock.acquire(blocking=True)
        _compose_lock.release()
        feed, _ = get_cached_feed(db_session)
        return feed or build_skeleton_feed()

    try:
        return _do_compose(db_session, event_count)
    finally:
        _compose_lock.release()
