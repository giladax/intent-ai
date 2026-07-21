"""DB queries for the Python MCP brain tools.

All queries use SQLAlchemy (text() for complex queries with correlated
subqueries; ORM for simple inserts). No raw psycopg calls. No TS imports.

Convention: each function opens its own session via get_session() so tools
are fully independent and never share session state.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text

from quire.db.engine import get_session
from quire.mcp.feature import (
    FeatureContextData,
    FeatureFileRow,
    FeatureMomentRow,
    FeatureObservation,
    FeatureRecord,
    MomentEvidenceItem,
    RelatedSession,
    SessionNarrativeSummary,
)


# ── Helpers ─────────────────────────────────────────────────────────────

def _to_str_list(value) -> list[str]:
    if isinstance(value, list):
        return [str(v) for v in value]
    if isinstance(value, str):
        import json as _json
        try:
            parsed = _json.loads(value)
            if isinstance(parsed, list):
                return [str(v) for v in parsed]
        except Exception:
            pass
    return []


def _row_to_feature(row) -> FeatureRecord:
    return FeatureRecord(
        id=str(row["id"]),
        name=row["name"],
        description=row["description"] or "",
        current_understanding=row["current_understanding"],
        constraints=_to_str_list(row["constraints"]),
        known_unknowns=_to_str_list(row["known_unknowns"]),
    )


# ── Read queries ─────────────────────────────────────────────────────────

def get_default_project_id() -> Optional[str]:
    with get_session() as session:
        row = session.execute(
            text("SELECT id FROM projects ORDER BY created_at LIMIT 1")
        ).mappings().first()
        return str(row["id"]) if row else None


def list_features(project_id: Optional[str] = None) -> list[FeatureRecord]:
    with get_session() as session:
        if project_id:
            rows = session.execute(
                text("SELECT * FROM features WHERE project_id = :pid ORDER BY name"),
                {"pid": project_id},
            ).mappings().all()
        else:
            rows = session.execute(
                text("SELECT * FROM features ORDER BY name")
            ).mappings().all()
        return [_row_to_feature(r) for r in rows]


def get_feature_by_id(feature_id: str) -> Optional[FeatureRecord]:
    with get_session() as session:
        row = session.execute(
            text("SELECT * FROM features WHERE id = :fid LIMIT 1"),
            {"fid": feature_id},
        ).mappings().first()
        return _row_to_feature(row) if row else None


def get_feature_file_rows(project_id: Optional[str] = None) -> list[FeatureFileRow]:
    with get_session() as session:
        if project_id:
            rows = session.execute(
                text("""
                    SELECT ff.feature_id, ff.glob, ff.file_path
                    FROM feature_files ff
                    JOIN features f ON f.id = ff.feature_id
                    WHERE f.project_id = :pid
                """),
                {"pid": project_id},
            ).mappings().all()
        else:
            rows = session.execute(
                text("SELECT feature_id, glob, file_path FROM feature_files")
            ).mappings().all()
        return [
            FeatureFileRow(
                feature_id=str(r["feature_id"]),
                glob=r["glob"],
                file_path=r["file_path"],
            )
            for r in rows
        ]


def get_feature_sessions(feature_id: str) -> list[RelatedSession]:
    with get_session() as session:
        rows = session.execute(
            text("""
                SELECT s.id, s.session_shape, s.started_at, fs.role, n.summary
                FROM feature_sessions fs
                JOIN sessions s ON s.id = fs.session_id
                LEFT JOIN narratives n ON n.session_id = s.id
                WHERE fs.feature_id = :fid
                ORDER BY s.started_at DESC NULLS LAST
            """),
            {"fid": feature_id},
        ).mappings().all()
        return [
            RelatedSession(
                id=str(r["id"]),
                shape=r["session_shape"],
                summary=r["summary"] or "(no narrative)",
                role=r["role"] or "evidence",
                started_at=r["started_at"],
            )
            for r in rows
        ]


def get_feature_moments(feature_id: str, cap: int = 300) -> list[FeatureMomentRow]:
    with get_session() as session:
        rows = session.execute(
            text("""
                SELECT m.id, m.session_id, m.statement, m.type, m.confidence,
                       m.verification, m.occurred_at, c.files_in_scope,
                       (SELECT me.quote FROM moment_evidence me
                         WHERE me.moment_id = m.id
                         ORDER BY (me.source_event_id IS NULL), me.id
                         LIMIT 1) AS quote
                FROM moments m
                JOIN feature_sessions fs
                  ON fs.session_id = m.session_id AND fs.feature_id = :fid
                LEFT JOIN chunks c ON c.id = m.chunk_id
                WHERE m.confidence IN ('high', 'medium')
                ORDER BY m.occurred_at DESC NULLS LAST
                LIMIT :cap
            """),
            {"fid": feature_id, "cap": cap},
        ).mappings().all()
        return [
            FeatureMomentRow(
                id=str(r["id"]),
                session_id=str(r["session_id"]),
                statement=r["statement"],
                type=r["type"],
                confidence=r["confidence"],
                verification=r["verification"],
                occurred_at=r["occurred_at"],
                quote=r["quote"],
                files=_to_str_list(r["files_in_scope"]),
            )
            for r in rows
        ]


def get_moment_by_id(moment_id: str):
    with get_session() as session:
        row = session.execute(
            text("""
                SELECT m.id, m.session_id, m.statement, m.confidence, m.verification,
                       m.occurred_at,
                       (SELECT me.quote FROM moment_evidence me
                         WHERE me.moment_id = m.id
                         ORDER BY (me.source_event_id IS NULL), me.id
                         LIMIT 1) AS quote
                FROM moments m WHERE m.id = :mid LIMIT 1
            """),
            {"mid": moment_id},
        ).mappings().first()
        if not row:
            return None
        return {
            "id": str(row["id"]),
            "session_id": str(row["session_id"]),
            "statement": row["statement"],
            "confidence": row["confidence"],
            "verification": row["verification"],
            "occurred_at": row["occurred_at"],
            "quote": row["quote"],
        }


def get_moment_evidence(moment_id: str) -> list[MomentEvidenceItem]:
    with get_session() as session:
        rows = session.execute(
            text("""
                SELECT id, quote, source_type, quote_type, source_event_id
                FROM moment_evidence
                WHERE moment_id = :mid
                ORDER BY (source_event_id IS NULL), id
            """),
            {"mid": moment_id},
        ).mappings().all()
        return [
            MomentEvidenceItem(
                quote=r["quote"] or "",
                source_type=r["source_type"] or "unknown",
                quote_type=r["quote_type"],
                source_event_id=str(r["source_event_id"]) if r["source_event_id"] else None,
            )
            for r in rows
        ]


def get_feature_observations(
    feature_id: str,
    review_status: Optional[str] = None,
) -> list[FeatureObservation]:
    with get_session() as session:
        if review_status:
            rows = session.execute(
                text("""
                    SELECT id, category, summary, review_status, timestamp
                    FROM activity_events
                    WHERE feature_id = :fid
                      AND category LIKE 'observation:%'
                      AND review_status = :rs
                    ORDER BY timestamp DESC
                """),
                {"fid": feature_id, "rs": review_status},
            ).mappings().all()
        else:
            rows = session.execute(
                text("""
                    SELECT id, category, summary, review_status, timestamp
                    FROM activity_events
                    WHERE feature_id = :fid AND category LIKE 'observation:%'
                    ORDER BY timestamp DESC
                """),
                {"fid": feature_id},
            ).mappings().all()
        return [
            FeatureObservation(
                id=str(r["id"]),
                category=r["category"],
                summary=r["summary"],
                review_status=r["review_status"] or "pending",
                timestamp=r["timestamp"],
            )
            for r in rows
        ]


def load_feature_context(feature_id: str) -> Optional[FeatureContextData]:
    feature = get_feature_by_id(feature_id)
    if not feature:
        return None

    with get_session() as session:
        file_rows = session.execute(
            text("SELECT glob, file_path FROM feature_files WHERE feature_id = :fid"),
            {"fid": feature_id},
        ).mappings().all()
    relevant_files = [
        r["glob"] or r["file_path"]
        for r in file_rows
        if r["glob"] or r["file_path"]
    ]

    related_sessions = get_feature_sessions(feature_id)
    approved_observations = get_feature_observations(feature_id, "approved")
    pending_observations = get_feature_observations(feature_id)
    reported_unknowns = [
        o for o in pending_observations if o.category == "observation:unknown"
    ]
    moment_candidates = get_feature_moments(feature_id)

    return FeatureContextData(
        feature=feature,
        relevant_files=relevant_files,
        related_sessions=related_sessions,
        approved_observations=approved_observations,
        reported_unknowns=reported_unknowns,
        moment_candidates=moment_candidates,
    )


def get_session_narrative(session_id: str) -> Optional[SessionNarrativeSummary]:
    with get_session() as session:
        row = session.execute(
            text("""
                SELECT n.session_id, s.session_shape, n.summary, n.progression, n.discoveries
                FROM narratives n
                JOIN sessions s ON s.id = n.session_id
                WHERE n.session_id = :sid LIMIT 1
            """),
            {"sid": session_id},
        ).mappings().first()
        if not row:
            return None
        return SessionNarrativeSummary(
            session_id=str(row["session_id"]),
            session_shape=row["session_shape"] or "session",
            summary=row["summary"],
            progression=_to_str_list(row["progression"]),
            discoveries=_to_str_list(row["discoveries"]),
        )


def read_attention() -> Optional[dict]:
    """Return {state, updated_at, stale} or None."""
    with get_session() as session:
        row = session.execute(
            text("SELECT state, updated_at FROM attention_state WHERE id = 'current'")
        ).mappings().first()
        if not row:
            return None
        state = row["state"]
        updated_at = row["updated_at"]
        # Stale = older than 10 minutes
        stale = False
        if updated_at:
            now = datetime.now(timezone.utc)
            if hasattr(updated_at, "tzinfo") and updated_at.tzinfo is None:
                from datetime import timezone as tz
                updated_at = updated_at.replace(tzinfo=tz.utc)
            diff = (now - updated_at).total_seconds()
            stale = diff > 600
        return {"state": state, "updated_at": updated_at, "stale": stale}


# ── Write queries ────────────────────────────────────────────────────────

def insert_observation(
    kind: str,
    summary: str,
    feature_id: Optional[str] = None,
    actor: str = "agent:mcp-client",
    session_id: Optional[str] = None,
    repo: Optional[str] = None,
    branch: Optional[str] = None,
    tags: Optional[list[str]] = None,
    files: Optional[list[str]] = None,
    metadata: Optional[dict] = None,
) -> str:
    import json
    event_id = str(uuid.uuid4())
    category = f"observation:{kind}"
    now = datetime.now(timezone.utc)
    meta_json = json.dumps(metadata or {})
    tags_list = tags or []
    files_list = files or []

    with get_session() as session:
        session.execute(
            text("""
                INSERT INTO activity_events (
                    id, timestamp, category, tags, actor, summary, metadata,
                    source_type, session_id, repo, branch, files,
                    feature_id, review_status
                ) VALUES (
                    :id, :ts, :category, :tags, :actor, :summary, CAST(:metadata AS jsonb),
                    :source_type, :session_id, :repo, :branch, :files,
                    :feature_id, :review_status
                )
            """),
            {
                "id": event_id,
                "ts": now,
                "category": category,
                "tags": tags_list,
                "actor": actor,
                "summary": summary,
                "metadata": meta_json,
                "source_type": "mcp",
                "session_id": session_id,
                "repo": repo,
                "branch": branch,
                "files": files_list,
                "feature_id": feature_id,
                "review_status": "pending",
            },
        )
        session.commit()
    return event_id


def emit_mcp_read_event(
    tool: str,
    outcome: str,
    summary: str,
    latency_ms: int,
    actor: str = "agent:mcp-client",
    repo: Optional[str] = None,
    branch: Optional[str] = None,
    session_id: Optional[str] = None,
    feature_id: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> None:
    """Emit an mcp:<tool> activity_event. Failure-safe — never raises."""
    import json
    try:
        event_id = str(uuid.uuid4())
        category = f"mcp:{tool}"
        now = datetime.now(timezone.utc)
        # TS parity (instrument.ts buildMcpReadEvent): featureId is ALWAYS
        # present in metadata — null when absent — so consumers can rely on
        # the key. We additionally write the feature_id COLUMN below, an
        # improvement over TS (which kept the feature key only inside the
        # metadata JSON): the column makes mcp:* events joinable/indexable
        # by feature without JSON extraction.
        meta = {"tool": tool, "outcome": outcome, "latencyMs": latency_ms, **(metadata or {})}
        meta["featureId"] = feature_id
        meta_json = json.dumps(meta)

        with get_session() as db_session:
            db_session.execute(
                text("""
                    INSERT INTO activity_events (
                        id, timestamp, category, tags, actor, summary, metadata,
                        source_type, session_id, repo, branch,
                        feature_id, review_status, files, topic_ids
                    ) VALUES (
                        :id, :ts, :category, :tags, :actor, :summary, CAST(:metadata AS jsonb),
                        :source_type, :session_id, :repo, :branch,
                        :feature_id, :review_status, :files, :topic_ids
                    )
                """),
                {
                    "id": event_id,
                    "ts": now,
                    "category": category,
                    "tags": ["mcp", outcome],
                    "actor": actor,
                    "summary": summary,
                    "metadata": meta_json,
                    "source_type": "mcp",
                    "session_id": session_id,
                    "repo": repo,
                    "branch": branch,
                    "feature_id": feature_id,
                    "review_status": None,
                    "files": [],
                    "topic_ids": [],
                },
            )
            db_session.commit()
    except Exception:
        pass  # instrumentation is always failure-safe
