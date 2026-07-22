"""FastAPI APIRouter with all 33 journal API routes.

Ported from journal/src/web/server.ts. The router is mounted prefix-less
onto the main FastAPI app in quire/api.py so paths are /api/... as the
SPA expects.

Route census (33 routes, 0 dropped):
  Projects     : GET /api/projects, POST /api/projects
  Features     : GET /api/projects/:id/features, POST /api/projects/:id/features
                 GET /api/features/:id, PATCH /api/features/:id
                 GET /api/features/:id/files, POST /api/features/:id/files
                 DELETE /api/features/:id/files/:fileId
                 POST /api/features/:id/sessions, DELETE /api/features/:id/sessions/:sid
  Observations : GET /api/observations/pending, POST /api/observations/:id/approve
                 POST /api/observations/:id/reject, PATCH /api/observations/:id
  Journal      : GET /api/journal
  Sessions     : GET /api/sessions, GET /api/sessions/:id
                 GET /api/sessions/:id/events-with-windows
                 GET /api/sessions/:id/moments/:mid/events
  Archive      : GET /api/archive
  Events       : GET /api/events/:id/provenance
  Stats        : GET /api/stats/overview
  Lens         : GET /api/lens/arrival, GET /api/lens/opening/:featureId
  Notifications: GET /api/notifications
  Feed         : GET /api/feed  (full port — Slice 8b; Sonnet lede + top 2 stories)
  Chat         : POST /api/chat  (SSE, real Anthropic SDK)
  Attention    : PUT /api/attention, GET /api/attention
  Schedule     : GET /api/digest/schedule, PUT /api/digest/schedule
  Brain        : POST /api/brain/discover
                 POST /api/brain/digest  (deprecated SSE stub, Slice 4)
  Meta         : GET /api/meta
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text

from quire.db.engine import get_session as _get_db_session
from quire.journal.helpers import (
    OBSERVATION_CATEGORY_PREFIX,
    build_journal,
    build_lens_opening_turn,
    build_notif_text,
    build_provenance,
    build_review_event,
    build_stats_overview,
    compose_current_understanding,
    compute_window_membership,
    dedup_notifications,
    empty_stats_overview,
    is_uuid_like,
    load_schedule,
    normalize_glob,
    provenance_kind,
    sanitize_lens_label,
    save_schedule,
)
from quire.journal.archive import get_archive_dir, join_archive, read_raw_session_archive
from quire.journal.attention import read_attention, write_attention

# ── Constants ──────────────────────────────────────────────────────────────

SONNET_MODEL = "claude-sonnet-4-6"
OVERLAP = 3  # matches journal/src/pipeline/chunk.ts OVERLAP constant

# ── Pydantic request models ────────────────────────────────────────────────


class CreateProjectRequest(BaseModel):
    name: str
    path: str


class CreateFeatureRequest(BaseModel):
    name: str
    description: str | None = None


class PatchFeatureRequest(BaseModel):
    currentUnderstanding: str | None = None
    constraints: list | None = None
    knownUnknowns: list | None = None


class AddFileRequest(BaseModel):
    glob: str | None = None
    filePath: str | None = None
    file_path: str | None = None


class AddSessionRequest(BaseModel):
    sessionId: str
    role: str


class EditObservationRequest(BaseModel):
    summary: str


class DigestScheduleRequest(BaseModel):
    enabled: bool | None = None
    intervalMinutes: int | None = None
    debounceMinutes: int | None = None


class ChatRequest(BaseModel):
    question: str | None = None
    featureId: str | None = None
    sessionId: str | None = None
    history: list[dict] | None = None
    contextItems: list[dict] | None = None
    lensScope: dict | None = None


class AttentionRequest(BaseModel):
    ts: int | float
    surface: str | None = None
    lens: dict | None = None
    expandedStoryIds: list[str] | None = None
    openSessionId: str | None = None
    pendingApprovalVisible: bool | None = None


class BrainDiscoverRequest(BaseModel):
    repoId: str


class BrainDigestRequest(BaseModel):
    repoId: str


# ── Session-level schedule state ───────────────────────────────────────────

_schedule: dict = load_schedule()
_last_scheduled_run: dict | None = None

# ── Router factory ──────────────────────────────────────────────────────────


def create_journal_router() -> APIRouter:
    router = APIRouter()

    # ── Helpers ──────────────────────────────────────────────────────────

    def _db():
        """Return an open SQLAlchemy session (caller must close)."""
        return _get_db_session()

    def _emit_review_event(action: str, obs: dict) -> None:
        """Emit a review:* activity event. Failure-safe — never raises."""
        try:
            from quire.journal.emit_events import emit_activity_events
            ev = build_review_event(action, obs)
            with _db() as sess:
                sess.execute(
                    text(
                        """
                        INSERT INTO activity_events
                          (id, timestamp, category, tags, actor, summary, metadata, source_type, source_id)
                        VALUES
                          (gen_random_uuid()::text, :ts, :category, :tags::jsonb, :actor,
                           :summary, :metadata::jsonb, :source_type, :source_id)
                        """
                    ),
                    {
                        "ts": ev["timestamp"],
                        "category": ev["category"],
                        "tags": json.dumps(ev.get("tags", [])),
                        "actor": ev["actor"],
                        "summary": ev["summary"],
                        "metadata": json.dumps(ev.get("metadata") or {}),
                        "source_type": ev.get("sourceType"),
                        "source_id": ev.get("sourceId"),
                    },
                )
                sess.commit()
        except Exception:
            pass  # instrumentation never fails the operation

    # ── Projects ──────────────────────────────────────────────────────────

    @router.get("/api/projects")
    def get_projects():
        with _db() as sess:
            rows = sess.execute(
                text("SELECT * FROM projects ORDER BY created_at DESC")
            ).mappings().all()
        return [dict(r) for r in rows]

    @router.post("/api/projects")
    def create_project(req: CreateProjectRequest):
        if not req.name or not req.path:
            raise HTTPException(400, "name and path are required")
        with _db() as sess:
            row = sess.execute(
                text(
                    "INSERT INTO projects (id, name, path, created_at) "
                    "VALUES (gen_random_uuid()::text, :name, :path, now()) RETURNING *"
                ),
                {"name": req.name, "path": req.path},
            ).mappings().fetchone()
            sess.commit()
        return dict(row)

    # ── Features ──────────────────────────────────────────────────────────

    @router.get("/api/projects/{project_id}/features")
    def get_project_features(project_id: str):
        with _db() as sess:
            rows = sess.execute(
                text(
                    """
                    SELECT f.*, COUNT(fs.session_id)::int AS session_count
                    FROM features f
                    LEFT JOIN feature_sessions fs ON fs.feature_id = f.id
                    WHERE f.project_id = :pid
                    GROUP BY f.id
                    ORDER BY f.created_at DESC
                    """
                ),
                {"pid": project_id},
            ).mappings().all()
        return [dict(r) for r in rows]

    @router.post("/api/projects/{project_id}/features")
    def create_feature(project_id: str, req: CreateFeatureRequest):
        if not req.name:
            raise HTTPException(400, "name is required")
        with _db() as sess:
            row = sess.execute(
                text(
                    "INSERT INTO features (id, project_id, name, description, created_at, constraints, known_unknowns) "
                    "VALUES (gen_random_uuid()::text, :pid, :name, :desc, now(), '[]'::jsonb, '[]'::jsonb) RETURNING *"
                ),
                {"pid": project_id, "name": req.name, "desc": req.description or ""},
            ).mappings().fetchone()
            sess.commit()
        return dict(row)

    @router.get("/api/features/{feature_id}")
    def get_feature(feature_id: str):
        with _db() as sess:
            feature_row = sess.execute(
                text("SELECT * FROM features WHERE id = :id"),
                {"id": feature_id},
            ).mappings().fetchone()
            if not feature_row:
                raise HTTPException(404, "feature not found")
            feature = dict(feature_row)

            session_rows = sess.execute(
                text(
                    """
                    SELECT s.*, fs.role, n.summary AS narrative_summary, n.session_shape AS narrative_shape
                    FROM feature_sessions fs
                    JOIN sessions s ON s.id = fs.session_id
                    LEFT JOIN narratives n ON n.session_id = s.id
                    WHERE fs.feature_id = :fid
                    ORDER BY s.started_at ASC NULLS LAST
                    """
                ),
                {"fid": feature_id},
            ).mappings().all()

            moment_counts = sess.execute(
                text(
                    """
                    SELECT m.session_id, COUNT(*)::int AS count
                    FROM moments m
                    JOIN feature_sessions fs ON fs.session_id = m.session_id
                    WHERE fs.feature_id = :fid
                    GROUP BY m.session_id
                    """
                ),
                {"fid": feature_id},
            ).mappings().all()

            count_map = {r["session_id"]: r["count"] for r in moment_counts}

            sessions = [
                {
                    "id": s["id"],
                    "sourceType": s["source_type"],
                    "sourcePath": s["source_path"],
                    "sessionShape": s["session_shape"],
                    "startedAt": s["started_at"].isoformat() if s["started_at"] else None,
                    "endedAt": s["ended_at"].isoformat() if s["ended_at"] else None,
                    "createdAt": s["created_at"].isoformat() if s["created_at"] else None,
                    "role": s["role"],
                    "narrativeSummary": s["narrative_summary"],
                    "narrativeShape": s["narrative_shape"],
                    "momentCount": count_map.get(s["id"], 0),
                }
                for s in session_rows
            ]

            story = "\n\n---\n\n".join(
                s["narrativeSummary"] for s in sessions if s.get("narrativeSummary")
            )

            files_rows = sess.execute(
                text(
                    "SELECT id, glob, file_path, created_at FROM feature_files "
                    "WHERE feature_id = :fid ORDER BY length(glob) DESC, glob ASC"
                ),
                {"fid": feature_id},
            ).mappings().all()
            files = [dict(r) for r in files_rows]

            obs_rows = sess.execute(
                text(
                    """
                    SELECT id, category, summary, review_status, created_at
                    FROM activity_events
                    WHERE feature_id = :fid AND category LIKE :prefix
                    ORDER BY created_at DESC
                    """
                ),
                {"fid": feature_id, "prefix": OBSERVATION_CATEGORY_PREFIX + "%"},
            ).mappings().all()
            observations = [dict(r) for r in obs_rows]

        return {"feature": feature, "sessions": sessions, "story": story, "files": files, "observations": observations}

    @router.patch("/api/features/{feature_id}")
    def patch_feature(feature_id: str, req: PatchFeatureRequest):
        with _db() as sess:
            if req.currentUnderstanding is not None:
                sess.execute(
                    text("UPDATE features SET current_understanding = :cu WHERE id = :id"),
                    {"cu": req.currentUnderstanding, "id": feature_id},
                )
            if req.constraints is not None:
                sess.execute(
                    text("UPDATE features SET constraints = :c::jsonb WHERE id = :id"),
                    {"c": json.dumps(req.constraints), "id": feature_id},
                )
            if req.knownUnknowns is not None:
                sess.execute(
                    text("UPDATE features SET known_unknowns = :ku::jsonb WHERE id = :id"),
                    {"ku": json.dumps(req.knownUnknowns), "id": feature_id},
                )
            sess.commit()
            feature_row = sess.execute(
                text("SELECT * FROM features WHERE id = :id"), {"id": feature_id}
            ).mappings().fetchone()
        return {"feature": dict(feature_row) if feature_row else None}

    # ── Feature↔File Map ─────────────────────────────────────────────────

    @router.get("/api/features/{feature_id}/files")
    def get_feature_files(feature_id: str):
        with _db() as sess:
            rows = sess.execute(
                text(
                    "SELECT id, glob, file_path, created_at FROM feature_files "
                    "WHERE feature_id = :fid ORDER BY length(glob) DESC, glob ASC"
                ),
                {"fid": feature_id},
            ).mappings().all()
        return [dict(r) for r in rows]

    @router.post("/api/features/{feature_id}/files")
    def add_feature_file(feature_id: str, req: AddFileRequest):
        glob = normalize_glob(req.glob)
        if not glob:
            raise HTTPException(400, "glob is required")
        file_path = req.filePath or req.file_path or glob
        with _db() as sess:
            row = sess.execute(
                text(
                    "INSERT INTO feature_files (id, feature_id, glob, file_path, created_at) "
                    "VALUES (gen_random_uuid()::text, :fid, :glob, :fp, now()) "
                    "RETURNING id, glob, file_path, created_at"
                ),
                {"fid": feature_id, "glob": glob, "fp": file_path},
            ).mappings().fetchone()
            sess.commit()
        return dict(row)

    @router.delete("/api/features/{feature_id}/files/{file_id}")
    def delete_feature_file(feature_id: str, file_id: str):
        with _db() as sess:
            sess.execute(
                text("DELETE FROM feature_files WHERE id = :fid AND feature_id = :feat"),
                {"fid": file_id, "feat": feature_id},
            )
            sess.commit()
        return {"ok": True}

    # ── Feature Session Tagging ───────────────────────────────────────────

    @router.post("/api/features/{feature_id}/sessions")
    def add_feature_session(feature_id: str, req: AddSessionRequest):
        if not req.sessionId or not req.role:
            raise HTTPException(400, "sessionId and role are required")
        with _db() as sess:
            sess.execute(
                text(
                    "INSERT INTO feature_sessions (feature_id, session_id, role) "
                    "VALUES (:fid, :sid, :role) ON CONFLICT DO NOTHING"
                ),
                {"fid": feature_id, "sid": req.sessionId, "role": req.role},
            )
            sess.commit()
        return {"ok": True}

    @router.delete("/api/features/{feature_id}/sessions/{session_id}")
    def delete_feature_session(feature_id: str, session_id: str):
        with _db() as sess:
            sess.execute(
                text(
                    "DELETE FROM feature_sessions WHERE feature_id = :fid AND session_id = :sid"
                ),
                {"fid": feature_id, "sid": session_id},
            )
            sess.commit()
        return {"ok": True}

    # ── Observation Review Queue ──────────────────────────────────────────

    @router.get("/api/observations/pending")
    def get_pending_observations(repoId: str | None = Query(None)):
        with _db() as sess:
            if repoId:
                rows = sess.execute(
                    text(
                        """
                        SELECT ae.id, ae.category, ae.summary, ae.feature_id, ae.review_status,
                               ae.created_at, f.name AS feature_name
                        FROM activity_events ae
                        LEFT JOIN features f ON f.id::text = ae.feature_id
                        WHERE ae.review_status = 'pending'
                          AND ae.category LIKE :prefix
                          AND (f.project_id = :rid OR ae.feature_id IS NULL)
                        ORDER BY ae.created_at DESC
                        """
                    ),
                    {"prefix": OBSERVATION_CATEGORY_PREFIX + "%", "rid": repoId},
                ).mappings().all()
            else:
                rows = sess.execute(
                    text(
                        """
                        SELECT ae.id, ae.category, ae.summary, ae.feature_id, ae.review_status,
                               ae.created_at, f.name AS feature_name
                        FROM activity_events ae
                        LEFT JOIN features f ON f.id::text = ae.feature_id
                        WHERE ae.review_status = 'pending'
                          AND ae.category LIKE :prefix
                        ORDER BY ae.created_at DESC
                        """
                    ),
                    {"prefix": OBSERVATION_CATEGORY_PREFIX + "%"},
                ).mappings().all()
        return [dict(r) for r in rows]

    @router.post("/api/observations/{obs_id}/approve")
    def approve_observation(obs_id: str):
        with _db() as sess:
            obs_row = sess.execute(
                text("SELECT id, summary, category, feature_id FROM activity_events WHERE id = :id"),
                {"id": obs_id},
            ).mappings().fetchone()
            if not obs_row:
                raise HTTPException(404, "observation not found")
            obs = dict(obs_row)

            feature_name = None
            if obs.get("feature_id"):
                feat = sess.execute(
                    text("SELECT id, name, current_understanding FROM features WHERE id::text = :fid"),
                    {"fid": obs["feature_id"]},
                ).mappings().fetchone()
                if feat:
                    feature_name = feat["name"]
                    obs["featureName"] = feature_name
                    next_cu = compose_current_understanding(feat["current_understanding"], obs["summary"])
                    sess.execute(
                        text("UPDATE features SET current_understanding = :cu WHERE id = :id"),
                        {"cu": next_cu, "id": feat["id"]},
                    )

            sess.execute(
                text("UPDATE activity_events SET review_status = 'approved' WHERE id = :id"),
                {"id": obs_id},
            )
            sess.commit()

        _emit_review_event("approved", {
            "id": obs["id"], "category": obs.get("category"),
            "featureId": obs.get("feature_id"), "featureName": feature_name,
            "summary": obs["summary"],
        })
        return {"ok": True, "status": "approved"}

    @router.post("/api/observations/{obs_id}/reject")
    def reject_observation(obs_id: str):
        with _db() as sess:
            result = sess.execute(
                text(
                    "UPDATE activity_events SET review_status = 'rejected' "
                    "WHERE id = :id RETURNING id, summary, category, feature_id"
                ),
                {"id": obs_id},
            ).mappings().fetchone()
            if not result:
                raise HTTPException(404, "observation not found")
            row = dict(result)
            sess.commit()

        _emit_review_event("rejected", {
            "id": row["id"], "category": row.get("category"),
            "featureId": row.get("feature_id"), "summary": row["summary"],
        })
        return {"ok": True, "status": "rejected"}

    @router.patch("/api/observations/{obs_id}")
    def edit_observation(obs_id: str, req: EditObservationRequest):
        if not req.summary or not req.summary.strip():
            raise HTTPException(400, "summary is required")
        with _db() as sess:
            result = sess.execute(
                text(
                    "UPDATE activity_events SET summary = :s "
                    "WHERE id = :id RETURNING id, summary, review_status, category, feature_id"
                ),
                {"s": req.summary, "id": obs_id},
            ).mappings().fetchone()
            if not result:
                raise HTTPException(404, "observation not found")
            row = dict(result)
            sess.commit()

        _emit_review_event("edited", {
            "id": row["id"], "category": row.get("category"),
            "featureId": row.get("feature_id"), "summary": row["summary"],
        })
        return {"id": row["id"], "summary": row["summary"], "review_status": row["review_status"]}

    # ── Journal ───────────────────────────────────────────────────────────

    @router.get("/api/journal")
    def get_journal(
        since: str | None = Query(None),
        actor: str | None = Query(None),
        featureId: str | None = Query(None),
        limit: int = Query(200),
    ):
        if limit <= 0:
            limit = 200

        conds = ["TRUE"]
        params: dict = {}
        if since:
            conds.append("timestamp >= :since")
            params["since"] = since
        if actor:
            conds.append("actor = :actor")
            params["actor"] = actor
        if featureId:
            conds.append("feature_id = :feature_id")
            params["feature_id"] = featureId
        params["limit"] = limit

        where = " AND ".join(conds)

        with _db() as sess:
            event_rows = sess.execute(
                text(
                    f"""
                    SELECT id, timestamp, category, tags, actor, summary, metadata,
                           source_type, session_id, feature_id, review_status
                    FROM activity_events
                    WHERE {where}
                    ORDER BY timestamp DESC
                    LIMIT :limit
                    """
                ),
                params,
            ).mappings().all()

            events = [
                {
                    "id": r["id"],
                    "timestamp": r["timestamp"].isoformat() if hasattr(r["timestamp"], "isoformat") else str(r["timestamp"]),
                    "category": r["category"],
                    "tags": r["tags"] or [],
                    "actor": r["actor"],
                    "summary": r["summary"],
                    "metadata": r["metadata"] or {},
                    "sourceType": r["source_type"],
                    "sessionId": r["session_id"],
                    "featureId": r["feature_id"],
                    "reviewStatus": r["review_status"],
                }
                for r in event_rows
            ]

            session_ids = list({e["sessionId"] for e in events if e.get("sessionId")})
            sessions: list[dict] = []
            if session_ids:
                session_rows = sess.execute(
                    text(
                        """
                        SELECT s.id, s.started_at, s.ended_at, s.session_shape,
                               n.summary AS narrative_summary
                        FROM sessions s
                        LEFT JOIN narratives n ON n.session_id = s.id
                        WHERE s.id = ANY(:ids)
                        """
                    ),
                    {"ids": session_ids},
                ).mappings().all()
                sessions = [
                    {
                        "id": r["id"],
                        "startedAt": r["started_at"].isoformat() if r["started_at"] else None,
                        "endedAt": r["ended_at"].isoformat() if r["ended_at"] else None,
                        "sessionShape": r["session_shape"],
                        "narrativeSummary": r["narrative_summary"],
                    }
                    for r in session_rows
                ]

            pending_row = sess.execute(
                text(
                    "SELECT COUNT(*)::int AS count FROM activity_events "
                    "WHERE review_status = 'pending' AND category LIKE :prefix"
                ),
                {"prefix": OBSERVATION_CATEGORY_PREFIX + "%"},
            ).mappings().fetchone()
            pending_review = pending_row["count"] if pending_row else 0

        return build_journal(events, sessions, since, pending_review)

    # ── Sessions ──────────────────────────────────────────────────────────

    @router.get("/api/sessions")
    def get_sessions(repoId: str | None = Query(None)):
        with _db() as sess:
            path_slug = None
            if repoId:
                proj = sess.execute(
                    text("SELECT path FROM projects WHERE id = :id"), {"id": repoId}
                ).mappings().fetchone()
                if proj:
                    path_slug = proj["path"].replace("/", "-")

            if path_slug:
                rows = sess.execute(
                    text(
                        """
                        SELECT s.id, s.source_type, s.source_path, s.session_shape,
                               s.started_at, s.ended_at, s.created_at,
                               n.summary AS narrative_summary,
                               (SELECT COUNT(*)::int FROM moments m WHERE m.session_id = s.id) AS moment_count
                        FROM sessions s
                        LEFT JOIN narratives n ON n.session_id = s.id
                        WHERE s.source_path LIKE :slug
                        ORDER BY s.created_at DESC
                        """
                    ),
                    {"slug": f"%{path_slug}%"},
                ).mappings().all()
            else:
                rows = sess.execute(
                    text(
                        """
                        SELECT s.id, s.source_type, s.source_path, s.session_shape,
                               s.started_at, s.ended_at, s.created_at,
                               n.summary AS narrative_summary,
                               (SELECT COUNT(*)::int FROM moments m WHERE m.session_id = s.id) AS moment_count
                        FROM sessions s
                        LEFT JOIN narratives n ON n.session_id = s.id
                        ORDER BY s.created_at DESC
                        """
                    ),
                ).mappings().all()
        return [dict(r) for r in rows]

    @router.get("/api/sessions/{session_id}")
    def get_session(session_id: str):
        with _db() as sess:
            session_row = sess.execute(
                text("SELECT * FROM sessions WHERE id = :id"), {"id": session_id}
            ).mappings().fetchone()
            narrative_row = sess.execute(
                text(
                    "SELECT id, session_id, session_shape, summary, progression, "
                    "discoveries, stabilized_directions, abandoned_directions "
                    "FROM narratives WHERE session_id = :id LIMIT 1"
                ),
                {"id": session_id},
            ).mappings().fetchone()
            moments_rows = sess.execute(
                text(
                    "SELECT id, type, statement, significance, agency, confidence, "
                    "topic_fingerprint, arc_id, arc_role, occurred_at, verification "
                    "FROM moments WHERE session_id = :id ORDER BY occurred_at ASC NULLS LAST, id"
                ),
                {"id": session_id},
            ).mappings().all()
            transitions_rows = sess.execute(
                text(
                    "SELECT id, from_statement, to_statement, reason, arc_id, confidence "
                    "FROM transitions WHERE session_id = :id"
                ),
                {"id": session_id},
            ).mappings().all()
            outcomes_rows = sess.execute(
                text(
                    "SELECT id, statement, confidence FROM outcomes WHERE session_id = :id"
                ),
                {"id": session_id},
            ).mappings().all()

        return {
            "session": dict(session_row) if session_row else None,
            "narrative": dict(narrative_row) if narrative_row else None,
            "moments": [dict(r) for r in moments_rows],
            "transitions": [dict(r) for r in transitions_rows],
            "outcomes": [dict(r) for r in outcomes_rows],
        }

    @router.get("/api/sessions/{session_id}/events-with-windows")
    def get_session_events_with_windows(session_id: str):
        with _db() as sess:
            event_rows = sess.execute(
                text(
                    "SELECT id, causal_order, category, actor, summary "
                    "FROM normalized_events WHERE session_id = :id ORDER BY causal_order"
                ),
                {"id": session_id},
            ).mappings().all()
            chunk_rows = sess.execute(
                text(
                    "SELECT chunk_index, event_range_start, event_range_end, topic_hint "
                    "FROM chunks WHERE session_id = :id ORDER BY chunk_index"
                ),
                {"id": session_id},
            ).mappings().all()
            sitting_rows = sess.execute(
                text(
                    "SELECT sitting_index, event_range_start, event_range_end, started_at, ended_at "
                    "FROM sittings WHERE session_id = :id ORDER BY sitting_index"
                ),
                {"id": session_id},
            ).mappings().all()

        events_for_membership = [{"causalOrder": r["causal_order"]} for r in event_rows]
        chunks_for_membership = [
            {
                "chunkIndex": r["chunk_index"],
                "eventRangeStart": r["event_range_start"],
                "eventRangeEnd": r["event_range_end"],
            }
            for r in chunk_rows
        ]
        membership = compute_window_membership(events_for_membership, chunks_for_membership, OVERLAP)

        events = [
            {
                "id": r["id"],
                "causalOrder": r["causal_order"],
                "category": r["category"],
                "actor": r["actor"],
                "summary": r["summary"],
                "windows": membership.get(r["causal_order"], []),
            }
            for r in event_rows
        ]
        chunks = [
            {
                "chunkIndex": r["chunk_index"],
                "eventRangeStart": r["event_range_start"],
                "eventRangeEnd": r["event_range_end"],
                "topicHint": r["topic_hint"],
            }
            for r in chunk_rows
        ]
        sittings = [
            {
                "sittingIndex": r["sitting_index"],
                "eventRangeStart": r["event_range_start"],
                "eventRangeEnd": r["event_range_end"],
                "startedAt": r["started_at"].isoformat() if r["started_at"] else None,
                "endedAt": r["ended_at"].isoformat() if r["ended_at"] else None,
            }
            for r in sitting_rows
        ]

        return {"events": events, "chunks": chunks, "sittings": sittings}

    @router.get("/api/sessions/{session_id}/moments/{moment_id}/events")
    def get_moment_events(session_id: str, moment_id: str):
        with _db() as sess:
            moment_row = sess.execute(
                text("SELECT chunk_id FROM moments WHERE id = :id"), {"id": moment_id}
            ).mappings().fetchone()
            if not moment_row or not moment_row["chunk_id"]:
                return []

            chunk_id = moment_row["chunk_id"]
            chunk_row = sess.execute(
                text(
                    "SELECT event_range_start, event_range_end FROM chunks "
                    "WHERE id = :id AND session_id = :sid"
                ),
                {"id": chunk_id, "sid": session_id},
            ).mappings().fetchone()
            if not chunk_row:
                return []

            rows = sess.execute(
                text(
                    """
                    SELECT ne.id, ne.causal_order, ne.category, ne.actor, ne.summary, ne.detail,
                           ne.files_affected
                    FROM normalized_events ne
                    WHERE ne.session_id = :sid
                      AND ne.causal_order >= :start
                      AND ne.causal_order <= :end
                    ORDER BY ne.causal_order
                    """
                ),
                {
                    "sid": session_id,
                    "start": chunk_row["event_range_start"],
                    "end": chunk_row["event_range_end"],
                },
            ).mappings().all()

        return [dict(r) for r in rows]

    # ── Archive ───────────────────────────────────────────────────────────

    @router.get("/api/archive")
    def get_archive():
        dir_ = get_archive_dir()
        files = read_raw_session_archive(dir_)
        sessions: list[dict] = []
        db_available = True
        try:
            with _db() as sess:
                rows = sess.execute(
                    text(
                        "SELECT id, source_hash, started_at FROM sessions WHERE source_hash IS NOT NULL"
                    )
                ).mappings().all()
                sessions = [
                    {
                        "id": r["id"],
                        "sourceHash": r["source_hash"],
                        "startedAt": r["started_at"].isoformat() if r["started_at"] else None,
                    }
                    for r in rows
                ]
        except Exception:
            db_available = False

        return {"dbAvailable": db_available, "entries": join_archive(files, sessions)}

    # ── Events: provenance ────────────────────────────────────────────────

    @router.get("/api/events/{event_id}/provenance")
    def get_event_provenance(event_id: str):
        with _db() as sess:

            def safe(fn):
                try:
                    return fn()
                except Exception:
                    return None

            # (a) root event
            event = None
            if is_uuid_like(event_id):
                row = sess.execute(
                    text("SELECT * FROM activity_events WHERE id = :id"), {"id": event_id}
                ).mappings().fetchone()
                if row:
                    event = dict(row)

            if not event:
                row = sess.execute(
                    text(
                        "SELECT * FROM activity_events WHERE source_id = :id ORDER BY timestamp DESC LIMIT 1"
                    ),
                    {"id": event_id},
                ).mappings().fetchone()
                if row:
                    event = dict(row)

            kind_override = None
            moment_rows: list[dict] = []
            session_id: str | None = (event or {}).get("session_id")

            if not event and is_uuid_like(event_id):
                m_row = sess.execute(
                    text("SELECT * FROM moments WHERE id = :id"), {"id": event_id}
                ).mappings().fetchone()
                if m_row:
                    kind_override = "moment"
                    moment_rows = [dict(m_row)]
                    session_id = m_row["session_id"]

            if not event and not moment_rows:
                raise HTTPException(404, "event not found")

            kind = kind_override or provenance_kind(
                (event or {}).get("source_type"), (event or {}).get("category")
            )
            meta = (event or {}).get("metadata") or {}
            source_id = (event or {}).get("source_id") or ""

            if not moment_rows and session_id:
                if kind == "moment":
                    rows = sess.execute(
                        text(
                            "SELECT * FROM moments WHERE session_id = :sid "
                            "AND (id::text = :src OR statement = :summary) LIMIT 5"
                        ),
                        {"sid": session_id, "src": source_id, "summary": (event or {}).get("summary", "")},
                    ).mappings().all()
                    moment_rows = [dict(r) for r in rows]
                elif kind == "transition":
                    from_ = meta.get("from", "") if isinstance(meta.get("from"), str) else ""
                    to_ = meta.get("to", "") if isinstance(meta.get("to"), str) else ""
                    if from_ or to_:
                        rows = sess.execute(
                            text(
                                """
                                SELECT DISTINCT m.* FROM transitions t
                                JOIN transition_moments tm ON tm.transition_id = t.id
                                JOIN moments m ON m.id = tm.moment_id
                                WHERE t.session_id = :sid
                                  AND (t.id::text = :src OR (t.from_statement = :from AND t.to_statement = :to))
                                """
                            ),
                            {"sid": session_id, "src": source_id, "from": from_, "to": to_},
                        ).mappings().all()
                    else:
                        rows = sess.execute(
                            text(
                                """
                                SELECT DISTINCT m.* FROM transitions t
                                JOIN transition_moments tm ON tm.transition_id = t.id
                                JOIN moments m ON m.id = tm.moment_id
                                WHERE t.session_id = :sid AND t.id::text = :src
                                """
                            ),
                            {"sid": session_id, "src": source_id},
                        ).mappings().all()
                    moment_rows = [dict(r) for r in rows]
                elif kind == "outcome":
                    rows = sess.execute(
                        text(
                            """
                            SELECT DISTINCT m.* FROM outcomes o
                            JOIN outcome_moments om ON om.outcome_id = o.id
                            JOIN moments m ON m.id = om.moment_id
                            WHERE o.session_id = :sid
                              AND (o.id::text = :src OR o.statement = :summary)
                            """
                        ),
                        {"sid": session_id, "src": source_id, "summary": (event or {}).get("summary", "")},
                    ).mappings().all()
                    moment_rows = [dict(r) for r in rows]
                elif kind == "narrative":
                    rows = sess.execute(
                        text(
                            "SELECT * FROM moments WHERE session_id = :sid "
                            "ORDER BY occurred_at ASC NULLS LAST, id LIMIT 40"
                        ),
                        {"sid": session_id},
                    ).mappings().all()
                    moment_rows = [dict(r) for r in rows]

            moment_ids = [m["id"] for m in moment_rows]
            evidence_rows: list[dict] = []
            anchor_rows: list[dict] = []
            if moment_ids:
                ev_rows = sess.execute(
                    text(
                        "SELECT id, moment_id, quote, quote_type, source_type, source_event_id "
                        "FROM moment_evidence WHERE moment_id = ANY(:ids)"
                    ),
                    {"ids": moment_ids},
                ).mappings().all()
                evidence_rows = [dict(r) for r in ev_rows]

                anchor_ids = list({r["source_event_id"] for r in evidence_rows if r.get("source_event_id")})
                if anchor_ids:
                    anc_rows = sess.execute(
                        text(
                            """
                            SELECT ne.id, ne.causal_order, ne.summary, ne.category, ne.actor, re.timestamp
                            FROM normalized_events ne
                            LEFT JOIN raw_events re ON re.id = ne.raw_event_id
                            WHERE ne.id = ANY(:ids)
                            """
                        ),
                        {"ids": anchor_ids},
                    ).mappings().all()
                    anchor_rows = [dict(r) for r in anc_rows]

            session_row = None
            quality_row = None
            trace_rows: list[dict] = []
            if session_id:
                sr = sess.execute(
                    text("SELECT id, session_shape, started_at, ended_at FROM sessions WHERE id = :id"),
                    {"id": session_id},
                ).mappings().fetchone()
                if sr:
                    session_row = dict(sr)
                    session_row["startedAt"] = sr["started_at"].isoformat() if sr["started_at"] else None
                    session_row["endedAt"] = sr["ended_at"].isoformat() if sr["ended_at"] else None

                qr = sess.execute(
                    text(
                        """
                        SELECT COUNT(DISTINCT m.id)::int AS moments,
                               COUNT(e.id)::int AS quotes,
                               COUNT(e.source_event_id)::int AS anchored,
                               COUNT(DISTINCT m.id) FILTER (WHERE m.verification = 'supported')::int AS supported,
                               COUNT(DISTINCT m.id) FILTER (WHERE m.verification = 'contradicted')::int AS contradicted
                        FROM moments m
                        LEFT JOIN moment_evidence e ON e.moment_id = m.id
                        WHERE m.session_id = :sid
                        """
                    ),
                    {"sid": session_id},
                ).mappings().fetchone()
                if qr:
                    quality_row = dict(qr)

                tr_rows = sess.execute(
                    text(
                        "SELECT id, timestamp, category, summary, metadata FROM activity_events "
                        "WHERE session_id = :sid AND source_type = 'agent-trace' "
                        "ORDER BY timestamp ASC LIMIT 40"
                    ),
                    {"sid": session_id},
                ).mappings().all()
                trace_rows = [dict(r) for r in tr_rows]

            feature_id = (event or {}).get("feature_id")
            observation_rows: list[dict] = []
            if session_id or feature_id:
                obs_id = (event or {}).get("id", "00000000-0000-0000-0000-000000000000")
                obs_rows = sess.execute(
                    text(
                        """
                        SELECT id, timestamp, category, summary, review_status, feature_id
                        FROM activity_events
                        WHERE category LIKE :prefix
                          AND ((:sid_cond AND session_id = :sid) OR (:fid_cond AND feature_id = :fid))
                          AND id <> :eid
                        ORDER BY timestamp DESC LIMIT 10
                        """
                    ),
                    {
                        "prefix": OBSERVATION_CATEGORY_PREFIX + "%",
                        "sid_cond": session_id is not None,
                        "sid": session_id or "",
                        "fid_cond": feature_id is not None,
                        "fid": feature_id or "",
                        "eid": obs_id,
                    },
                ).mappings().all()
                observation_rows = [dict(r) for r in obs_rows]

        # Normalize timestamps
        def _iso(v):
            if v is None:
                return None
            if hasattr(v, "isoformat"):
                return v.isoformat()
            return str(v)

        event_out = None
        if event:
            event_out = {
                "id": event["id"],
                "timestamp": _iso(event.get("timestamp")),
                "category": event.get("category"),
                "summary": event.get("summary"),
                "actor": event.get("actor"),
                "tags": event.get("tags") or [],
                "metadata": event.get("metadata") or {},
                "sourceType": event.get("source_type"),
                "sourceId": event.get("source_id"),
                "sessionId": event.get("session_id"),
                "featureId": event.get("feature_id"),
                "reviewStatus": event.get("review_status"),
            }

        moments_out = [
            {
                "id": m["id"], "type": m["type"], "statement": m["statement"],
                "significance": m.get("significance"), "agency": m.get("agency"),
                "confidence": m.get("confidence"), "verification": m.get("verification"),
            }
            for m in moment_rows
        ]
        evidence_out = [
            {
                "id": e["id"], "momentId": e["moment_id"], "quote": e["quote"],
                "quoteType": e.get("quote_type"), "sourceType": e.get("source_type"),
                "sourceEventId": e.get("source_event_id"),
            }
            for e in evidence_rows
        ]
        anchor_out = [
            {
                "id": a["id"], "causalOrder": a["causal_order"], "summary": a["summary"],
                "category": a.get("category"), "actor": a.get("actor"),
                "timestamp": _iso(a.get("timestamp")),
            }
            for a in anchor_rows
        ]
        trace_out = [
            {
                "id": t["id"], "timestamp": _iso(t.get("timestamp")),
                "category": t["category"], "summary": t["summary"],
                "metadata": t.get("metadata") or {},
            }
            for t in trace_rows
        ]
        obs_out = [
            {
                "id": o["id"], "timestamp": _iso(o.get("timestamp")), "category": o["category"],
                "summary": o["summary"], "reviewStatus": o.get("review_status"),
                "featureId": o.get("feature_id"),
            }
            for o in observation_rows
        ]

        return build_provenance(
            event=event_out,
            kind_override=kind_override,
            moments=moments_out,
            evidence=evidence_out,
            anchor_events=anchor_out,
            session=session_row,
            quality=quality_row,
            trace_rows=trace_out,
            observation_rows=obs_out,
        )

    # ── Stats overview ────────────────────────────────────────────────────

    @router.get("/api/stats/overview")
    def get_stats_overview(repoId: str | None = Query(None)):
        window_days = 14
        try:
            with _db() as sess:
                path_slug = None
                if repoId:
                    proj = sess.execute(
                        text("SELECT path FROM projects WHERE id = :id"), {"id": repoId}
                    ).mappings().fetchone()
                    if proj:
                        path_slug = proj["path"].replace("/", "-")

                cadence_rows_raw = sess.execute(
                    text(
                        """
                        SELECT to_char("timestamp", 'YYYY-MM-DD') AS day, COUNT(*)::int AS events
                        FROM activity_events
                        WHERE "timestamp" >= now() - make_interval(days => :days)
                        GROUP BY 1
                        """
                    ),
                    {"days": window_days},
                ).mappings().all()

                if path_slug:
                    quality_rows_raw = sess.execute(
                        text(
                            """
                            SELECT s.id AS session_id,
                                   COUNT(DISTINCT m.id)::int AS moments,
                                   COUNT(e.id)::int AS quotes,
                                   COUNT(e.source_event_id)::int AS anchored,
                                   COUNT(DISTINCT m.id) FILTER (WHERE m.verification = 'supported')::int AS supported,
                                   COUNT(DISTINCT m.id) FILTER (WHERE m.verification = 'contradicted')::int AS contradicted
                            FROM sessions s
                            LEFT JOIN moments m ON m.session_id = s.id
                            LEFT JOIN moment_evidence e ON e.moment_id = m.id
                            WHERE s.source_path LIKE :slug
                            GROUP BY s.id
                            """
                        ),
                        {"slug": f"%{path_slug}%"},
                    ).mappings().all()
                else:
                    quality_rows_raw = sess.execute(
                        text(
                            """
                            SELECT s.id AS session_id,
                                   COUNT(DISTINCT m.id)::int AS moments,
                                   COUNT(e.id)::int AS quotes,
                                   COUNT(e.source_event_id)::int AS anchored,
                                   COUNT(DISTINCT m.id) FILTER (WHERE m.verification = 'supported')::int AS supported,
                                   COUNT(DISTINCT m.id) FILTER (WHERE m.verification = 'contradicted')::int AS contradicted
                            FROM sessions s
                            LEFT JOIN moments m ON m.session_id = s.id
                            LEFT JOIN moment_evidence e ON e.moment_id = m.id
                            GROUP BY s.id
                            """
                        ),
                    ).mappings().all()

                momentum_rows_raw = sess.execute(
                    text(
                        """
                        SELECT feature_id,
                               COUNT(*) FILTER (WHERE "timestamp" >= now() - make_interval(days => :days))::int AS recent_events,
                               COUNT(*) FILTER (WHERE "timestamp" < now() - make_interval(days => :days)
                                            AND "timestamp" >= now() - make_interval(days => :days2))::int AS prior_events,
                               MAX("timestamp") AS last_activity
                        FROM activity_events
                        WHERE feature_id IS NOT NULL
                        GROUP BY feature_id
                        """
                    ),
                    {"days": window_days, "days2": window_days * 2},
                ).mappings().all()

            cadence_rows = [{"day": r["day"], "events": r["events"]} for r in cadence_rows_raw]
            session_rows = [
                {
                    "sessionId": r["session_id"],
                    "moments": r["moments"],
                    "quotes": r["quotes"],
                    "anchored": r["anchored"],
                    "supported": r["supported"],
                    "contradicted": r["contradicted"],
                }
                for r in quality_rows_raw
            ]
            feature_rows = [
                {
                    "featureId": r["feature_id"],
                    "recentEvents": r["recent_events"],
                    "priorEvents": r["prior_events"],
                    "lastActivity": r["last_activity"].isoformat() if r["last_activity"] else None,
                }
                for r in momentum_rows_raw
            ]

            return build_stats_overview(cadence_rows, session_rows, feature_rows, window_days)
        except Exception:
            return empty_stats_overview(window_days)

    # ── Lens arrival ──────────────────────────────────────────────────────

    @router.get("/api/lens/arrival")
    def get_lens_arrival():
        try:
            with _db() as sess:
                pending_row = sess.execute(
                    text(
                        "SELECT COUNT(*)::int AS count FROM activity_events "
                        "WHERE review_status = 'pending' AND category LIKE :prefix"
                    ),
                    {"prefix": OBSERVATION_CATEGORY_PREFIX + "%"},
                ).mappings().fetchone()
                pending_count = pending_row["count"] if pending_row else 0

                cadence_row = sess.execute(
                    text(
                        """
                        SELECT COUNT(*)::int AS recent_events,
                               COUNT(DISTINCT to_char("timestamp", 'YYYY-MM-DD'))::int AS active_days
                        FROM activity_events
                        WHERE "timestamp" >= now() - interval '7 days'
                        """
                    ),
                ).mappings().fetchone()
                recent_events = cadence_row["recent_events"] if cadence_row else 0
                active_days = cadence_row["active_days"] if cadence_row else 0

                totals_row = sess.execute(
                    text(
                        """
                        SELECT (SELECT COUNT(*)::int FROM sessions) AS sessions,
                               (SELECT COUNT(*)::int FROM activity_events) AS events,
                               (SELECT COUNT(*)::int FROM moments) AS moments
                        """
                    ),
                ).mappings().fetchone()

            return {
                "pendingCount": pending_count,
                "recentEvents": recent_events,
                "activeDays": active_days,
                "totals": {
                    "sessions": totals_row["sessions"] if totals_row else 0,
                    "events": totals_row["events"] if totals_row else 0,
                    "moments": totals_row["moments"] if totals_row else 0,
                },
            }
        except Exception:
            return {"pendingCount": 0, "recentEvents": 0, "activeDays": 0, "totals": {"sessions": 0, "events": 0, "moments": 0}}

    # ── Lens opening ──────────────────────────────────────────────────────

    @router.get("/api/lens/opening/{feature_id}")
    def get_lens_opening(feature_id: str):
        try:
            with _db() as sess:
                feat_row = sess.execute(
                    text("SELECT name, current_understanding FROM features WHERE id = :id"),
                    {"id": feature_id},
                ).mappings().fetchone()
                feature_name = feat_row["name"] if feat_row else feature_id
                understanding = feat_row["current_understanding"] if feat_row else None

                recent_insights: list[str] = []
                try:
                    obs_rows = sess.execute(
                        text(
                            """
                            SELECT summary FROM (
                              SELECT ae.summary, ae.timestamp FROM activity_events ae
                              WHERE ae.feature_id = :fid
                                AND ae.category LIKE 'observation:%'
                                AND ae.review_status = 'approved'
                                AND ae.timestamp >= NOW() - INTERVAL '7 days'
                              UNION
                              SELECT ae.summary, ae.timestamp FROM activity_events ae
                              JOIN feature_sessions fs ON fs.session_id = ae.session_id
                              WHERE fs.feature_id = :fid
                                AND ae.feature_id IS NULL
                                AND ae.category LIKE 'observation:%'
                                AND ae.review_status = 'approved'
                                AND ae.timestamp >= NOW() - INTERVAL '7 days'
                            ) sub
                            ORDER BY timestamp DESC LIMIT 3
                            """
                        ),
                        {"fid": feature_id},
                    ).mappings().all()
                    recent_insights = [r["summary"] for r in obs_rows]
                except Exception:
                    pass

                pending_count = 0
                try:
                    p_row = sess.execute(
                        text(
                            """
                            SELECT COUNT(*)::int AS count FROM (
                              SELECT ae.id FROM activity_events ae
                              WHERE ae.feature_id = :fid
                                AND ae.review_status = 'pending'
                                AND ae.category LIKE 'observation:%'
                              UNION
                              SELECT ae.id FROM activity_events ae
                              JOIN feature_sessions fs ON fs.session_id = ae.session_id
                              WHERE fs.feature_id = :fid
                                AND ae.feature_id IS NULL
                                AND ae.review_status = 'pending'
                                AND ae.category LIKE 'observation:%'
                            ) sub
                            """
                        ),
                        {"fid": feature_id},
                    ).mappings().fetchone()
                    pending_count = p_row["count"] if p_row else 0
                except Exception:
                    pass

            turn = build_lens_opening_turn(feature_name, understanding, recent_insights, pending_count)
            return {"turn": turn, "polished": False, "citedSessionIds": []}
        except Exception:
            turn = build_lens_opening_turn(feature_id, None, [], 0)
            return {"turn": turn, "polished": False, "citedSessionIds": []}

    # ── Notifications ──────────────────────────────────────────────────────

    @router.get("/api/notifications")
    def get_notifications(
        lastSeen: str | None = Query(None),
        actor: str | None = Query(None),
    ):
        try:
            notifications: list[dict] = []

            with _db() as sess:
                try:
                    pending_rows = sess.execute(
                        text(
                            """
                            SELECT ae.feature_id, f.name AS feature_name, COUNT(*)::int AS cnt
                            FROM activity_events ae
                            LEFT JOIN features f ON f.id::text = ae.feature_id
                            WHERE ae.review_status = 'pending'
                              AND ae.category LIKE :prefix
                              AND ae.feature_id IS NOT NULL
                            GROUP BY ae.feature_id, f.name
                            ORDER BY cnt DESC LIMIT 5
                            """
                        ),
                        {"prefix": OBSERVATION_CATEGORY_PREFIX + "%"},
                    ).mappings().all()
                    for row in pending_rows:
                        fid = row["feature_id"]
                        fname = row["feature_name"] or fid
                        count = row["cnt"] or 0
                        if count > 0:
                            notifications.append({
                                "type": "pending_gate",
                                "featureId": fid,
                                "featureName": fname,
                                "text": build_notif_text("pending_gate", feature_name=fname, count=count),
                            })
                except Exception:
                    pass

                if lastSeen:
                    try:
                        activity_rows = sess.execute(
                            text(
                                """
                                SELECT sub.fid AS feature_id, f.name AS feature_name,
                                       COUNT(*)::int AS cnt, MAX(sub.ts)::text AS last_ts
                                FROM (
                                  SELECT COALESCE(ae.feature_id, fs.feature_id::text) AS fid, ae.timestamp AS ts
                                  FROM activity_events ae
                                  LEFT JOIN feature_sessions fs ON fs.session_id = ae.session_id
                                  WHERE ae.timestamp > :last_seen
                                ) sub
                                JOIN features f ON f.id::text = sub.fid
                                WHERE sub.fid IS NOT NULL
                                GROUP BY sub.fid, f.name
                                HAVING COUNT(*) > 0
                                ORDER BY cnt DESC LIMIT 5
                                """
                            ),
                            {"last_seen": lastSeen},
                        ).mappings().all()
                        for row in activity_rows:
                            fid = row["feature_id"]
                            fname = row["feature_name"] or fid
                            count = row["cnt"] or 0
                            notifications.append({
                                "type": "area_activity",
                                "featureId": fid,
                                "featureName": fname,
                                "text": build_notif_text("area_activity", feature_name=fname, count=count),
                                "timestamp": row.get("last_ts"),
                            })
                    except Exception:
                        pass

            deduped = dedup_notifications(notifications)
            return {"notifications": deduped, "unreadCount": len(deduped)}
        except Exception:
            return {"notifications": [], "unreadCount": 0}

    # ── Feed ─────────────────────────────────────────────────────────────

    @router.get("/api/feed")
    def get_feed(refresh: str | None = Query(None)):
        """Composed feed — full port of feed-composer.ts (Slice 8b).

        Returns a real composed feed when sessions exist (editionNumber > 0,
        lede from Sonnet, trending stories with heat scores). Falls back to
        the skeleton only when the DB has no sessions at all.
        """
        from quire.journal.feed import build_skeleton_feed, get_feed_or_compose

        force_refresh = refresh == "1"  # TS parity: req.query["refresh"] === "1"
        try:
            with _db() as sess:
                return get_feed_or_compose(sess, force_refresh=force_refresh)
        except Exception:
            return build_skeleton_feed()

    # ── Meta ─────────────────────────────────────────────────────────────

    _meta_cache: dict | None = None

    @router.get("/api/meta")
    def get_meta():
        nonlocal _meta_cache
        if _meta_cache:
            return _meta_cache
        try:
            from pathlib import Path
            cwd = str(Path(__file__).parent.parent.parent.parent)
            branch = subprocess.check_output(
                ["git", "branch", "--show-current"], cwd=cwd, text=True
            ).strip()
            repo = ""
            try:
                remote = subprocess.check_output(
                    ["git", "remote", "get-url", "origin"], cwd=cwd, text=True
                ).strip()
                import re
                m = re.search(r"[:/]([^/]+?)(?:\.git)?$", remote)
                if m:
                    repo = m.group(1)
            except Exception:
                pass
            _meta_cache = {"repo": repo, "branch": branch}
            return _meta_cache
        except Exception:
            return {"repo": "", "branch": ""}

    # ── Chat (SSE streaming) ──────────────────────────────────────────────

    @router.post("/api/chat")
    async def post_chat(req: ChatRequest):
        if not req.question:
            raise HTTPException(400, "question is required")

        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise HTTPException(500, "ANTHROPIC_API_KEY not configured")

        system_prompt = await _build_chat_system_prompt(req)

        async def generate():
            try:
                import anthropic
                client = anthropic.AsyncAnthropic(api_key=api_key)
                messages = []
                if req.history:
                    for h in req.history[-20:]:
                        messages.append({"role": h.get("role"), "content": h.get("content", "")})
                messages.append({"role": "user", "content": req.question})

                async with client.messages.stream(
                    model=SONNET_MODEL,
                    max_tokens=4096,
                    temperature=0,
                    system=system_prompt,
                    messages=messages,
                ) as stream:
                    async for text in stream.text_stream:
                        yield f"data: {json.dumps({'type': 'text', 'content': text})}\n\n"
                yield f"data: {json.dumps({'type': 'done'})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "Connection": "keep-alive"})

    # ── Attention ──────────────────────────────────────────────────────────

    @router.put("/api/attention")
    def put_attention(req: AttentionRequest):
        try:
            state = req.model_dump(exclude_none=False)
            write_attention(state)
            return {"ok": True}
        except Exception:
            return {"ok": True}

    @router.get("/api/attention")
    def get_attention_():
        try:
            result = read_attention()
            return result if result else {"state": None, "stale": True, "updatedAt": None}
        except Exception:
            return {"state": None, "stale": True, "updatedAt": None}

    # ── Digest schedule ────────────────────────────────────────────────────

    @router.get("/api/digest/schedule")
    def get_digest_schedule():
        return {**_schedule, "lastRun": _last_scheduled_run}

    @router.put("/api/digest/schedule")
    def put_digest_schedule(req: DigestScheduleRequest):
        global _schedule
        enabled = bool(req.enabled) if req.enabled is not None else _schedule.get("enabled", False)
        interval = min(24 * 60, max(1, int(req.intervalMinutes or _schedule.get("intervalMinutes", 30))))
        debounce = min(120, max(0, int(req.debounceMinutes or _schedule.get("debounceMinutes", 10))))
        _schedule = {"enabled": enabled, "intervalMinutes": interval, "debounceMinutes": debounce}
        save_schedule(_schedule)
        return {**_schedule, "lastRun": _last_scheduled_run}

    # ── Brain routes ──────────────────────────────────────────────────────

    @router.post("/api/brain/discover")
    def brain_discover(req: BrainDiscoverRequest):
        """Count undigested CC logs for a project."""
        with _db() as sess:
            # Use text cast to avoid InvalidTextRepresentation for non-UUID ids.
            try:
                proj_row = sess.execute(
                    text("SELECT name, path FROM projects WHERE id::text = :id"), {"id": req.repoId}
                ).mappings().fetchone()
            except Exception:
                raise HTTPException(404, "Project not found")
            if not proj_row:
                raise HTTPException(404, "Project not found")

            project_path_slug = proj_row["path"].replace("/", "-")

            source_hash_rows = sess.execute(
                text("SELECT source_hash FROM sessions WHERE source_hash IS NOT NULL")
            ).mappings().all()
            digested_hashes = {r["source_hash"] for r in source_hash_rows}

        # Scan ~/.claude/projects for logs matching the project slug.
        # islice both globs so we stop after 20 matches instead of walking
        # every project on the machine (the recursive fallback could be huge).
        from itertools import islice
        from pathlib import Path
        cc_projects_dir = Path.home() / ".claude" / "projects"
        log_paths = []
        if cc_projects_dir.exists():
            # Claude Code stores logs under ~/.claude/projects/<project-slug>/*.jsonl
            log_paths = [str(p) for p in islice(
                cc_projects_dir.glob(f"*{project_path_slug}*/*.jsonl"), 20)]
            if not log_paths:
                log_paths = [str(p) for p in islice(
                    cc_projects_dir.glob("**/*.jsonl"), 20)]

        undigested = [p for p in log_paths if Path(p).stem not in digested_hashes]

        return {
            "status": "sessions_found" if undigested else "up_to_date",
            "undigestedCount": len(undigested),
        }

    @router.post("/api/brain/digest")
    async def brain_digest(req: BrainDigestRequest):
        """DEPRECATED (Slice 4): TS session digestion moved to Python backend.

        Returns a deprecation notice via SSE so the SPA can surface the message.
        Use: python3 -m quire.cli journal digest <log-path>
        """
        async def generate():
            yield (
                f"data: {json.dumps({'phase': 'error', 'message': 'DEPRECATED (Slice 4): TS session digestion has moved to the Python backend. Use: python3 -m quire.cli journal digest <log-path>'})}\n\n"
            )

        return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "Connection": "keep-alive"})

    return router


# ── Chat system-prompt builder ─────────────────────────────────────────────


async def _build_chat_system_prompt(req: ChatRequest) -> str:
    """Build the system prompt for a chat request (mirrors server.ts logic)."""
    from sqlalchemy import text as _text

    if req.contextItems:
        sections = []
        for item in req.contextItems[:8]:
            try:
                sections.append(await _build_pinned_context_section(item))
            except Exception as e:
                sections.append(f"### {item.get('label', 'pinned item')}\n(unavailable: {e})")
        return (
            "You are Quire — the organizational understanding engine for this repository. "
            "The user is reading the dashboard and has pinned specific elements of the page into this conversation. "
            "Treat the pinned material below as the working context; the conversation is *about* these things.\n\n"
            + "\n\n---\n\n".join(sections)
            + "\n\n## Rules\n- Ground answers in the pinned material and say so when something isn't covered by it.\n"
            "- When attributing decisions, use the agency field where present (developer vs ai vs collaborative).\n"
            "- Connect the dots across pinned items when the user asks how they relate.\n"
            "- Keep responses concise but thorough; quote evidence where available."
        )

    if req.featureId:
        with _get_db_session() as sess:
            feat_row = sess.execute(
                _text("SELECT * FROM features WHERE id = :id"), {"id": req.featureId}
            ).mappings().fetchone()
            feature_name = feat_row["name"] if feat_row else "Unknown Feature"
            session_rows = sess.execute(
                _text(
                    "SELECT s.id FROM feature_sessions fs "
                    "JOIN sessions s ON s.id = fs.session_id "
                    "WHERE fs.feature_id = :fid ORDER BY s.started_at ASC NULLS LAST"
                ),
                {"fid": req.featureId},
            ).mappings().all()
        digests = []
        for row in session_rows:
            try:
                digests.append(await _load_digest_py(row["id"]))
            except Exception:
                pass
        if not digests:
            return f'You are an execution memory assistant for the feature "{feature_name}". No session digests are available yet. Let the user know they need to tag sessions to this feature first.'
        session_contexts = "\n\n---\n\n".join(
            f"### Session {i + 1}\n{_build_system_prompt_py(d)}" for i, d in enumerate(digests)
        )
        return (
            f'You are an execution memory assistant. You have access to detailed digests of {len(digests)} coding sessions related to the feature "{feature_name}". '
            f"Answer questions about what happened across these sessions, how understanding evolved, what decisions were made and why.\n\n{session_contexts}\n\n"
            "## Rules\n- Answer based on the evidence in the digests. Don't speculate beyond what the data shows.\n"
            "- When attributing decisions, use the agency field (developer vs ai vs collaborative).\n"
            "- Quote the developer's actual words when available (from evidence).\n"
            "- If asked about something not covered by the digests, say so.\n"
            "- Keep responses concise but thorough. Use evidence to support your points.\n"
            "- When referencing events, indicate which session they came from."
        )

    if req.sessionId:
        try:
            digest = await _load_digest_py(req.sessionId)
            return _build_system_prompt_py(digest)
        except Exception as e:
            return f"You are an execution memory assistant. The session {req.sessionId} could not be loaded: {e}"

    if req.lensScope and req.lensScope.get("timeRange"):
        time_range = req.lensScope["timeRange"]
        since_ = time_range.get("since")
        until_ = time_range.get("until")
        label = sanitize_lens_label(time_range.get("label"))
        with _get_db_session() as sess:
            recent_rows = sess.execute(
                _text(
                    "SELECT category, summary, actor, timestamp FROM activity_events "
                    "WHERE timestamp >= :since AND timestamp <= :until ORDER BY timestamp DESC LIMIT 60"
                ),
                {"since": since_, "until": until_},
            ).mappings().all()
        if not recent_rows:
            return (
                f'You are Quire — the organizational understanding engine. The user is looking at the Timeline lens scoped to "{label}". '
                "There are no recorded events in this period. Let them know the journal is quiet for this window, and suggest broadening the range."
            )
        ev_summary = "\n".join(
            f"[{r['timestamp'].isoformat() if hasattr(r['timestamp'], 'isoformat') else r['timestamp']}] {r['category']} / {r['actor']}: {r['summary']}"
            for r in recent_rows
        )
        return (
            f'You are Quire — the organizational understanding engine. The user is looking at the Timeline lens scoped to "{label}". '
            f"Here are the recorded events in this window:\n\n{ev_summary}\n\n"
            "## Rules\n- Answer based on this event record.\n- Summarize patterns, pivots, and outcomes when asked.\n- Keep responses concise but grounded in the evidence above."
        )

    if req.lensScope and req.lensScope.get("featureId"):
        fid = req.lensScope["featureId"]
        with _get_db_session() as sess:
            feat_row = sess.execute(
                _text("SELECT * FROM features WHERE id = :id"), {"id": fid}
            ).mappings().fetchone()
            feature_name = feat_row["name"] if feat_row else "Unknown Feature"
            session_rows = sess.execute(
                _text(
                    "SELECT s.id FROM feature_sessions fs "
                    "JOIN sessions s ON s.id = fs.session_id "
                    "WHERE fs.feature_id = :fid ORDER BY s.started_at ASC NULLS LAST"
                ),
                {"fid": fid},
            ).mappings().all()
        digests = []
        for row in session_rows:
            try:
                digests.append(await _load_digest_py(row["id"]))
            except Exception:
                pass
        if not digests:
            return f'You are Quire scoped to the feature "{feature_name}". No session digests are available yet for this feature. The user may need to tag sessions to it first.'
        session_contexts = "\n\n---\n\n".join(
            f"### Session {i + 1}\n{_build_system_prompt_py(d)}" for i, d in enumerate(digests)
        )
        return (
            f'You are Quire scoped to the feature "{feature_name}". You have access to {len(digests)} session digests for this feature.\n\n'
            f"{session_contexts}\n\n## Rules\n- Answer based on the evidence in the digests.\n"
            "- Quote the developer's actual words when available.\n- If asked about something not covered, say so."
        )

    # No scope — ambient attention context
    try:
        attn_result = read_attention()
        if attn_result and not attn_result.get("stale") and attn_result.get("state"):
            attn = attn_result["state"]
            parts = []
            if attn.get("lens") and attn["lens"].get("featureName"):
                parts.append(f"The user is currently looking at the \"{attn['lens']['featureName']}\" feature lens.")
            elif (attn.get("lens") or {}).get("type") == "timeline":
                parts.append("The user is looking at the Timeline lens.")
            elif attn.get("surface") == "feed":
                parts.append("The user is viewing the feed (no specific lens active).")
            if attn.get("openSessionId"):
                parts.append(f"Session {attn['openSessionId'][:8]} is open.")
                try:
                    sess_digest = await _load_digest_py(attn["openSessionId"])
                    prompt_text = _build_system_prompt_py(sess_digest)
                    start = prompt_text.find("## Session Digest")
                    parts.append(prompt_text[start:start + 1500] if start >= 0 else prompt_text[:1500])
                except Exception:
                    pass
            if parts:
                return (
                    "You are Quire — the organizational understanding engine. "
                    + " ".join(parts)
                    + "\n\n## Rules\n- Ground answers in the available context.\n- Keep responses concise.\n"
                    "- Acknowledge what the user appears to be looking at only when it materially scopes your answer — no creepy narration."
                )
    except Exception:
        pass

    return (
        "You are an execution memory assistant for AI-assisted development sessions. "
        "The user hasn't selected a specific feature or session yet. "
        "Help them navigate — suggest they select a feature or session to start exploring."
    )


async def _load_digest_py(session_id: str) -> dict:
    """Load a session digest from the DB (mirrors loadDigest in explore.ts)."""
    from sqlalchemy import text as _text
    with _get_db_session() as sess:
        narrative_row = sess.execute(
            _text(
                "SELECT id, session_id, session_shape, summary, progression, discoveries, "
                "stabilized_directions, abandoned_directions FROM narratives WHERE session_id = :id LIMIT 1"
            ),
            {"id": session_id},
        ).mappings().fetchone()
        if not narrative_row:
            raise ValueError(f"Session {session_id} has no narrative. The digest may be incomplete.")

        moments_rows = sess.execute(
            _text(
                "SELECT m.id, m.type, m.statement, m.significance, m.agency, m.confidence, "
                "m.topic_fingerprint, m.arc_id, m.arc_role, m.verification, m.occurred_at, "
                "COALESCE(json_agg(json_build_object('quote', e.quote, 'sourceType', e.source_type)) "
                "FILTER (WHERE e.id IS NOT NULL), '[]') AS evidence "
                "FROM moments m LEFT JOIN moment_evidence e ON e.moment_id = m.id "
                "WHERE m.session_id = :id "
                "GROUP BY m.id ORDER BY m.occurred_at ASC NULLS LAST, m.id"
            ),
            {"id": session_id},
        ).mappings().all()
        transitions_rows = sess.execute(
            _text(
                "SELECT id, from_statement, to_statement, reason, confidence "
                "FROM transitions WHERE session_id = :id"
            ),
            {"id": session_id},
        ).mappings().all()
        outcomes_rows = sess.execute(
            _text(
                "SELECT o.id, o.statement, o.confidence, "
                "COALESCE(array_agg(of2.file_path) FILTER (WHERE of2.file_path IS NOT NULL), '{}') AS supporting_files "
                "FROM outcomes o LEFT JOIN outcome_files of2 ON of2.outcome_id = o.id "
                "WHERE o.session_id = :id GROUP BY o.id"
            ),
            {"id": session_id},
        ).mappings().all()

        narrative_row2 = sess.execute(
            _text(
                "SELECT na.arc_id, na.title, na.summary, na.resolution "
                "FROM narrative_arcs na "
                "JOIN narratives n ON n.id = na.narrative_id "
                "WHERE n.session_id = :id"
            ),
            {"id": session_id},
        ).mappings().all()

    narrative = dict(narrative_row)
    narrative["arcs"] = [dict(a) for a in narrative_row2]

    return {
        "sessionId": session_id,
        "narrative": narrative,
        "moments": [dict(m) for m in moments_rows],
        "transitions": [dict(t) for t in transitions_rows],
        "outcomes": [dict(o) for o in outcomes_rows],
    }


def _build_system_prompt_py(digest: dict) -> str:
    """Build the explore system prompt from a Python digest dict (mirrors buildSystemPrompt)."""
    narrative = digest.get("narrative") or {}
    moments = digest.get("moments") or []
    transitions = digest.get("transitions") or []
    outcomes = digest.get("outcomes") or []
    arcs = narrative.get("arcs") or []

    arc_section = "\n".join(
        f"- **{a.get('title', '')}** ({a.get('resolution', '')}): {a.get('summary', '')}"
        for a in arcs
    ) or "None"

    moment_section = "\n\n".join(
        f"{i + 1}. [{m.get('type', '')}] {m.get('statement', '')}\n"
        f"   Agency: {m.get('agency', '')} | Significance: {m.get('significance', '')} | Confidence: {m.get('confidence', '')}\n"
        f"   Topic: {m.get('topic_fingerprint', '') or m.get('topicFingerprint', '')}"
        for i, m in enumerate(moments)
    ) or "None"

    transition_section = "\n".join(
        f"- \"{t.get('from_statement', t.get('fromStatement', ''))}\" → \"{t.get('to_statement', t.get('toStatement', ''))}\"\n  Reason: {t.get('reason', '')}"
        for t in transitions
    ) or "None"

    outcome_section = "\n".join(
        f"- {o.get('statement', '')}"
        for o in outcomes
    ) or "None"

    return (
        "You are an execution memory assistant. You have access to a detailed digest of a developer's coding session. "
        "Answer questions about what happened, why decisions were made, who drove which decisions, and how understanding evolved.\n\n"
        "## Session Digest\n\n"
        f"### Summary\n{narrative.get('summary', '')}\n\n"
        f"### Arcs ({len(arcs)})\n{arc_section}\n\n"
        f"### Moments ({len(moments)} total)\n{moment_section}\n\n"
        f"### Transitions ({len(transitions)})\n{transition_section}\n\n"
        f"### Outcomes ({len(outcomes)})\n{outcome_section}\n\n"
        "## Rules\n"
        "- Answer based on the evidence in the digest. Don't speculate beyond what the data shows.\n"
        "- When attributing decisions, use the agency field (developer vs ai vs collaborative).\n"
        "- Quote the developer's actual words when available (from evidence).\n"
        "- If asked about something not covered by the digest, say so.\n"
        "- Keep responses concise but thorough. Use evidence to support your points."
    )


async def _build_pinned_context_section(item: dict) -> str:
    """Build context section for a pinned chat item (mirrors buildPinnedContextSection)."""
    from sqlalchemy import text as _text
    label = item.get("label") or "pinned item"
    kind = item.get("kind") or "note"
    id_ = item.get("id") or ""

    if kind == "episode":
        import re
        m = re.match(r"^(session|event|review|run):(.+)$", id_)
        if m:
            kind = "session" if m.group(1) == "session" else ("run" if m.group(1) == "run" else "event")
            id_ = m.group(2)
        else:
            kind = "event"

    if kind == "feature":
        with _get_db_session() as sess:
            feat = sess.execute(
                _text("SELECT * FROM features WHERE id = :id"), {"id": id_}
            ).mappings().fetchone()
            if not feat:
                return f"### Feature: {label}\n(feature not found)"
            globs = sess.execute(
                _text("SELECT glob FROM feature_files WHERE feature_id = :id ORDER BY length(glob) DESC LIMIT 20"),
                {"id": id_},
            ).mappings().all()
            narratives = sess.execute(
                _text(
                    "SELECT n.summary FROM feature_sessions fs "
                    "JOIN narratives n ON n.session_id = fs.session_id "
                    "WHERE fs.feature_id = :id ORDER BY n.id DESC LIMIT 5"
                ),
                {"id": id_},
            ).mappings().all()
        constraints = feat["constraints"] if isinstance(feat["constraints"], list) else []
        unknowns = feat["known_unknowns"] if isinstance(feat["known_unknowns"], list) else []
        parts = [
            f"### Feature: {feat['name']}",
            feat["description"] or "",
            f"**Current understanding:**\n{feat['current_understanding']}" if feat.get("current_understanding") else "**Current understanding:** (none yet)",
            "**Constraints:**\n" + "\n".join(f"- {c}" for c in constraints) if constraints else "",
            "**Known unknowns:**\n" + "\n".join(f"- {u}" for u in unknowns) if unknowns else "",
            "**File map:** " + ", ".join(g["glob"] for g in globs) if globs else "",
            "**Recent session narratives:**\n" + "\n".join(f"- {n['summary']}" for n in narratives) if narratives else "",
        ]
        return "\n\n".join(p for p in parts if p)

    if kind == "session":
        try:
            digest = await _load_digest_py(id_)
            prompt = _build_system_prompt_py(digest)
            start = prompt.find("## Session Digest")
            return f"### Session {id_[:8]} ({label})\n{prompt[start:] if start >= 0 else prompt}"
        except Exception as e:
            return f"### Session {label}\n(could not load: {e})"

    if kind in ("observation", "event"):
        with _get_db_session() as sess:
            ev = sess.execute(
                _text("SELECT * FROM activity_events WHERE id = :id"), {"id": id_}
            ).mappings().fetchone()
        if not ev:
            return f"### {label}\n{item.get('summary') or '(event not found)'}"
        parts = [
            f"### {'Observation' if kind == 'observation' else 'Activity event'}: {label}",
            ev["summary"],
            f"category: {ev['category']} · actor: {ev['actor']} · at {ev['timestamp']}" + (f" · review: {ev['review_status']}" if ev.get("review_status") else ""),
            f"metadata: {json.dumps(ev['metadata'])}" if ev.get("metadata") and len(ev["metadata"]) > 0 else "",
        ]
        return "\n".join(p for p in parts if p)

    if kind == "run":
        with _get_db_session() as sess:
            events = sess.execute(
                _text(
                    "SELECT summary, category, actor FROM activity_events "
                    "WHERE metadata->>'runId' = :rid ORDER BY timestamp ASC LIMIT 20"
                ),
                {"rid": id_},
            ).mappings().all()
        if not events:
            return f"### Run {label}\n{item.get('summary') or '(no events found)'}"
        return f"### Run: {label}\n" + "\n".join(f"- [{e['category']}] {e['summary']}" for e in events)

    return f"### {label}\n{item.get('summary') or '(no detail — the user pinned this element from the page)'}"
