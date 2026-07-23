"""Org-level timeline: features as rows, derived marks on a time axis.

Composes over:
  - activity_events (Postgres, via a live SQLAlchemy session) — for activity
    marks and session marks
  - alignment_store (SQLite, quire.store.Store) — for check verdict marks

The return shape is the public /api/timeline contract. It is intentionally
agent-readable: full sentences as labels, ink tokens for colour, deep links
as link values.

Window is bounded at 90 days (cost control). The query uses the timestamp
index on activity_events; no unbounded scans.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

_MAX_WINDOW_DAYS = 90
_VERDICT_INK = {
    # Every value in Classification must be listed here — the test
    # test_verdict_ink_covers_all_classifications enforces this invariant.
    "ALIGNED": "green",
    "PARTIAL": "amber",
    "POSSIBLE_DRIFT": "amber",
    "UNGOVERNED": "blue",
    "UNKNOWN": "gray",
    "OFF_INTENT": "red",          # contradicts intent — loudest signal
    "NO_MATERIAL_IMPACT": "gray", # no product-relevant change — quiet
}


def _now_utc() -> datetime:
    return datetime.now(tz=timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _day_label(ts: str) -> str:
    """Return a short human date like 'Jul 10' from an ISO timestamp."""
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return dt.strftime("%-d %b")
    except Exception:
        return ts[:10]


def compose_org_timeline(
    pg_session,
    alignment_store=None,
    window_days: int = 30,
) -> dict:
    """Build the org timeline payload.

    Args:
        pg_session: open SQLAlchemy session (Postgres journal DB).
        alignment_store: quire.store.Store (SQLite alignment) or None —
            when None, check marks are omitted (degraded state, still useful).
        window_days: rolling window; clamped to _MAX_WINDOW_DAYS.

    Returns the /api/timeline payload (see module docstring for shape).
    Failure-safe: catches all exceptions and returns an empty shape.
    """
    window_days = min(window_days, _MAX_WINDOW_DAYS)
    until = _now_utc()
    since = until - timedelta(days=window_days)

    try:
        return _build(pg_session, alignment_store, since, until, window_days)
    except Exception:
        return _empty_shape(window_days, since, until)


def _build(pg_session, alignment_store, since, until, window_days) -> dict:
    # 1. Fetch features + their project names (the rows).
    feature_rows = pg_session.execute(
        text(
            """
            SELECT f.id, f.name, p.name AS project_name, p.id AS project_id
            FROM features f
            JOIN projects p ON p.id = f.project_id
            ORDER BY p.name, f.name
            """
        )
    ).mappings().all()

    if not feature_rows:
        return _empty_shape(window_days, since, until)

    # Cast to str: features.id is uuid, activity_events.feature_id is text.
    # Postgres rejects text = uuid without an explicit cast, so we stringify here.
    feature_ids = [str(r["id"]) for r in feature_rows]

    # 2. Fetch activity_events in window, grouped by feature_id.
    # Two paths mirror feed.py:334-343:
    #   a) direct: ae.feature_id already set (the fast path)
    #   b) indirect: ae.feature_id IS NULL but the session was tagged to a
    #      feature via feature_sessions — a session-level association added by
    #      the UI (drag-to-feature) or by the pipeline. Without this second
    #      path the majority of events are invisible to the timeline.
    ae_rows = pg_session.execute(
        text(
            """
            SELECT
                ae.feature_id,
                ae.id,
                ae.timestamp,
                ae.category,
                ae.summary,
                ae.session_id,
                ae.source_type
            FROM activity_events ae
            WHERE ae.feature_id = ANY(:fids)
              AND ae.timestamp >= :since
              AND ae.timestamp < :until
            UNION ALL
            SELECT
                fs.feature_id::text AS feature_id,
                ae.id,
                ae.timestamp,
                ae.category,
                ae.summary,
                ae.session_id,
                ae.source_type
            FROM activity_events ae
            JOIN feature_sessions fs ON fs.session_id = ae.session_id
            WHERE ae.feature_id IS NULL
              AND fs.feature_id::text = ANY(:fids)
              AND ae.timestamp >= :since
              AND ae.timestamp < :until
            ORDER BY feature_id, timestamp
            """
        ),
        {"fids": feature_ids, "since": since, "until": until},
    ).mappings().all()

    # 3. Group events by feature.
    events_by_feature: dict[str, list] = defaultdict(list)
    for ae in ae_rows:
        fid_key = ae["feature_id"]
        if fid_key:
            events_by_feature[fid_key].append(ae)

    # 4. Build check marks from alignment store (per workspace/project).
    # Map checks to features via project-name slug matching.
    check_marks_by_feature: dict[str, list] = defaultdict(list)
    if alignment_store is not None:
        try:
            analyses = alignment_store.list_analyses()
            for a in analyses:
                ts = a.created_at
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                if not (since <= ts < until):
                    continue
                ink = _VERDICT_INK.get(a.classification.value, "gray")
                verdict_label = _verdict_plain(a.classification.value)
                ts_label = ts.strftime("%-d %b")
                # Compute repo_slug before the mark dict so the link is clean.
                # a.repository may be "org/repo"; strip the org prefix so the
                # route /repo/<ws>/review/<n> doesn't contain a literal slash.
                repo_slug = (
                    a.repository.split("/")[-1] if "/" in a.repository else a.repository
                )
                mark = {
                    "kind": "check",
                    "ts": _iso(ts),
                    "label": f"Check on PR #{a.pr_number}: {verdict_label} — {ts_label}",
                    "ink": ink,
                    "link": f"/repo/{repo_slug}/review/{a.pr_number}",
                    "detail": (
                        a.behavioral_delta.summary[:140]
                        if a.behavioral_delta and a.behavioral_delta.summary
                        else ""
                    ),
                }
                # Attach to features in the matching project (by path slug match).
                matched = [
                    r
                    for r in feature_rows
                    if repo_slug.lower() in r["project_name"].lower()
                    or r["project_name"].lower() in repo_slug.lower()
                ]
                for feat_row in matched:
                    check_marks_by_feature[str(feat_row["id"])].append(mark)
                # If no match, omit — don't spray marks on unrelated features.
        except Exception:
            pass  # alignment store degraded; check marks skipped

    # 5. Build session marks (session_id present on the event).
    # seen_sessions is scoped per-feature so that a session spanning two features
    # produces a session mark on each, not just the first one iterated.
    session_marks_by_feature: dict[str, list] = defaultdict(list)
    for feature_id, aes in events_by_feature.items():
        seen_sessions: set = set()
        for ae in aes:
            if ae["session_id"] and ae["session_id"] not in seen_sessions:
                seen_sessions.add(ae["session_id"])
                ts_str = _iso(ae["timestamp"])
                ts_label = _day_label(ts_str) if ts_str else ""
                session_marks_by_feature[feature_id].append({
                    "kind": "session",
                    "ts": ts_str,
                    "label": f"Session reasoned about this feature — {ts_label}",
                    "ink": "blue",
                    "link": f"/session/{ae['session_id']}",
                    "detail": ae["summary"] or "",
                })

    # 6. Build rows (only features with marks or activity in window).
    rows = []
    for feat_row in feature_rows:
        # feature.id may be a UUID object; stringify to match activity_events.feature_id (text).
        fid = str(feat_row["id"])
        aes = events_by_feature.get(fid, [])
        checks = check_marks_by_feature.get(fid, [])
        sessions = session_marks_by_feature.get(fid, [])

        # Skip features with no data in window.
        if not aes and not checks and not sessions:
            continue

        # Activity marks: one mark per unique day.
        activity_marks: list[dict] = []
        seen_days: set = set()
        for ae in aes:
            ts_str = _iso(ae["timestamp"])
            day = ts_str[:10] if ts_str else None
            if day and day not in seen_days:
                seen_days.add(day)
                ts_label = _day_label(ts_str)
                activity_marks.append({
                    "kind": "activity",
                    "ts": ts_str,
                    "label": f"Work on this feature — {ts_label}",
                    "ink": "blue",
                    "link": f"/feature/{fid}",
                    "detail": ae["summary"] or "",
                })

        all_marks = activity_marks + checks + sessions
        all_marks.sort(key=lambda m: m["ts"] or "")

        ts_vals = [ae["timestamp"] for ae in aes if ae["timestamp"]]
        first_ts = min(ts_vals, default=None)
        last_ts = max(ts_vals, default=None)

        # Slugify repo_workspace to match the /repo/:ws route convention
        # (lower-case, spaces → hyphens). "repo" keeps the display name.
        _ws_slug = feat_row["project_name"].lower().replace(" ", "-")
        rows.append({
            "feature_id": fid,
            "feature_name": feat_row["name"],
            "repo": feat_row["project_name"],
            "repo_workspace": _ws_slug,
            "first_activity": _iso(first_ts),
            "last_activity": _iso(last_ts),
            "event_count": len(aes),
            "marks": all_marks,
        })

    # Sort rows: most recently active first.
    rows.sort(key=lambda r: r["last_activity"] or "", reverse=True)

    return {
        "window": {
            "days": window_days,
            "since": _iso(since),
            "until": _iso(until),
        },
        "rows": rows,
        "empty": len(rows) == 0,
    }


def _empty_shape(window_days, since, until) -> dict:
    return {
        "window": {
            "days": window_days,
            "since": _iso(since),
            "until": _iso(until),
        },
        "rows": [],
        "empty": True,
    }


def _verdict_plain(classification: str) -> str:
    return {
        "ALIGNED": "Kept all promises",
        "PARTIAL": "Partially kept",
        "POSSIBLE_DRIFT": "Possible drift",
        "UNGOVERNED": "No promise covers this",
        "UNKNOWN": "Unknown",
    }.get(classification, classification)
