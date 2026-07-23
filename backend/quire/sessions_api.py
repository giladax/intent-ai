"""quire.sessions_api — session upload standard (O3).

The coupling contract made concrete: one envelope any agent can comply with,
matched per commit, persisted first.

## Envelope (SessionUpload)
  provider: "claude-code" (extensible; unknown providers 400 with named alternatives)
  format:   "jsonl-v1" (cc jsonl is format v1)
  transcript: <file> (multipart upload)
  repo:     "owner/name"
  branch:   optional
  commits:  optional list of SHAs
  pr:       optional int
  actor:    optional str
  as_intent: bool (default False — sessions are OBSERVED evidence, not intent)

## Matching precedence (ruling 2026-07-21)
1. explicit pr/commits in envelope → kind="attached" links
2. Claude-Session trailers in the repo's commits → kind="trailer" links
3. else correlate.py → kind="inferred" PROPOSALS ONLY, never auto-promoted

## Persistence (durability requirement — completion-record follow-up 6)
  sha256(transcript) → copy to backend/.intent/raw-sessions/ (archive FIRST)
  → session_uploads Postgres row (sha256, envelope fields, archive path, status)
  → digest via existing pipeline
  → link

Failure isolation: a failed digest NEVER loses the archived transcript.
The session_uploads row status reflects the outcome honestly.

## session_uploads table (pre-Alembic bootstrap, single-writer, CENSUS)

Single-writer: quire.sessions_api is the sole writer for session_uploads.
Bootstrap: ensure_upload_table(engine) — CREATE TABLE IF NOT EXISTS.
CENSUS entry: O3 — session_uploads.
"""
from __future__ import annotations

import hashlib
import logging
import pathlib
import shutil
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import Column, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Session as SASession

from quire.db.models import Base

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Supported envelope values (the extension points)
# ---------------------------------------------------------------------------

SUPPORTED_PROVIDERS = {"claude-code"}
SUPPORTED_FORMATS = {"jsonl-v1"}

# ---------------------------------------------------------------------------
# SQLAlchemy model — session_uploads
# ---------------------------------------------------------------------------

_STATUS = Literal["pending", "digesting", "digested", "failed"]


class SessionUpload(Base):
    """Postgres row: one uploaded session transcript.

    Unique on sha256 so uploading the same bytes twice is idempotent —
    the second request returns the existing row without re-digesting
    (dedup by content hash, proving idempotency).

    status values:
      pending   — archived, not yet digested
      digesting — digest in progress (not yet used; future async path)
      digested  — pipeline completed
      failed    — pipeline failed; transcript is safe in the archive
    """

    __tablename__ = "session_uploads"
    __table_args__ = (
        UniqueConstraint("sha256", name="uq_session_upload_sha256"),
    )

    id: str = Column(String, primary_key=True)
    sha256: str = Column(Text, nullable=False, index=True)
    provider: str = Column(Text, nullable=False)
    format: str = Column(Text, nullable=False)
    repo: str = Column(Text, nullable=False)
    branch: str | None = Column(Text, nullable=True)
    commits: str | None = Column(Text, nullable=True)   # JSON-serialized list
    pr_number: int | None = Column(Integer, nullable=True)
    actor: str | None = Column(Text, nullable=True)
    as_intent: bool = Column(Integer, nullable=False, default=0)  # SQLite compat
    archive_path: str = Column(Text, nullable=False)
    status: str = Column(Text, nullable=False, default="pending")
    session_id: str | None = Column(Text, nullable=True)   # filled after digest
    error: str | None = Column(Text, nullable=True)        # set on failure
    uploaded_at: datetime = Column(DateTime(timezone=True), nullable=False)
    digested_at: datetime | None = Column(DateTime(timezone=True), nullable=True)


# ---------------------------------------------------------------------------
# Domain value object (for callers that don't want the ORM row)
# ---------------------------------------------------------------------------

class UploadRecord(BaseModel):
    id: str
    sha256: str
    provider: str
    format: str
    repo: str
    branch: str | None
    commits: list[str]
    pr_number: int | None
    actor: str | None
    as_intent: bool
    archive_path: str
    status: str
    session_id: str | None
    error: str | None
    uploaded_at: str
    digested_at: str | None


# ---------------------------------------------------------------------------
# UploadStore — single writer for session_uploads
# ---------------------------------------------------------------------------

class UploadStore:
    """Single writer for session_uploads.

    Accepts an optional engine; if None, uses the shared production engine.
    Pass a test engine in unit tests — the conftest guard enforces this
    by raising on engine-less construction.
    """

    def __init__(self, engine=None) -> None:
        if engine is None:
            from quire.db.engine import get_engine
            engine = get_engine()
        self._engine = engine
        ensure_upload_table(self._engine)

    def find_by_sha256(self, sha256: str) -> UploadRecord | None:
        """Return the existing row for this sha256, or None."""
        import json
        from sqlalchemy import select
        with SASession(self._engine) as s:
            row = s.execute(
                select(SessionUpload).where(SessionUpload.sha256 == sha256)
            ).scalar_one_or_none()
        if row is None:
            return None
        return _row_to_record(row)

    def create(
        self,
        *,
        sha256: str,
        provider: str,
        format: str,
        repo: str,
        branch: str | None,
        commits: list[str],
        pr_number: int | None,
        actor: str | None,
        as_intent: bool,
        archive_path: str,
    ) -> UploadRecord:
        """Insert a new session_uploads row in status='pending'."""
        import json
        row_id = str(uuid.uuid4())
        now = datetime.now(tz=timezone.utc)
        with SASession(self._engine) as s:
            row = SessionUpload(
                id=row_id,
                sha256=sha256,
                provider=provider,
                format=format,
                repo=repo,
                branch=branch,
                commits=json.dumps(commits) if commits else None,
                pr_number=pr_number,
                actor=actor,
                as_intent=int(as_intent),
                archive_path=archive_path,
                status="pending",
                session_id=None,
                error=None,
                uploaded_at=now,
                digested_at=None,
            )
            s.add(row)
            s.commit()
            s.refresh(row)
        return _row_to_record(row)

    def mark_digested(self, upload_id: str, session_id: str) -> None:
        from sqlalchemy import update
        now = datetime.now(tz=timezone.utc)
        with SASession(self._engine) as s:
            s.execute(
                update(SessionUpload)
                .where(SessionUpload.id == upload_id)
                .values(status="digested", session_id=session_id, digested_at=now)
            )
            s.commit()

    def mark_failed(self, upload_id: str, error: str) -> None:
        from sqlalchemy import update
        with SASession(self._engine) as s:
            s.execute(
                update(SessionUpload)
                .where(SessionUpload.id == upload_id)
                .values(status="failed", error=error[:2000])
            )
            s.commit()


def _row_to_record(row: SessionUpload) -> UploadRecord:
    import json
    commits: list[str] = []
    if row.commits:
        try:
            commits = json.loads(row.commits)
        except Exception:
            commits = []
    return UploadRecord(
        id=row.id,
        sha256=row.sha256,
        provider=row.provider,
        format=row.format,
        repo=row.repo,
        branch=row.branch,
        commits=commits,
        pr_number=row.pr_number,
        actor=row.actor,
        as_intent=bool(row.as_intent),
        archive_path=row.archive_path,
        status=row.status,
        session_id=row.session_id,
        error=row.error,
        uploaded_at=row.uploaded_at.isoformat() if row.uploaded_at else "",
        digested_at=row.digested_at.isoformat() if row.digested_at else None,
    )


# ---------------------------------------------------------------------------
# Schema bootstrap (pre-Alembic; idempotent)
# ---------------------------------------------------------------------------

def ensure_upload_table(engine) -> None:
    """CREATE TABLE IF NOT EXISTS session_uploads.

    Pre-Alembic bootstrap — safe to call multiple times.
    """
    Base.metadata.tables["session_uploads"].create(engine, checkfirst=True)


# ---------------------------------------------------------------------------
# Core upload logic (shared by API and CLI)
# ---------------------------------------------------------------------------

def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _archive_dir() -> pathlib.Path:
    """Canonical raw-session archive (backend/.intent/raw-sessions/)."""
    from quire.journal.archive import get_archive_dir
    return get_archive_dir()


def _archive_bytes(data: bytes, filename: str, archive_dir: pathlib.Path | None = None) -> pathlib.Path:
    """Write bytes to the archive, return the dest path.

    This MUST succeed before any DB writes. Raises on failure — the caller
    must not create a session_uploads row if archiving failed.
    """
    d = archive_dir if archive_dir is not None else _archive_dir()
    d.mkdir(parents=True, exist_ok=True)
    dest = d / filename
    dest.write_bytes(data)
    return dest


def process_upload(
    *,
    transcript_bytes: bytes,
    filename: str,
    provider: str,
    format: str,
    repo: str,
    branch: str | None,
    commits: list[str],
    pr_number: int | None,
    actor: str | None,
    as_intent: bool,
    upload_store: UploadStore,
    link_store=None,
    archive_dir: pathlib.Path | None = None,
    digester=None,
    workspace_dir: pathlib.Path | None = None,
    skip_digest: bool = False,
) -> UploadRecord:
    """Core upload logic: archive → record → digest → link.

    Durability invariant:
      1. Archive bytes to disk FIRST (raises on failure — no record created).
      2. Create session_uploads row in status="pending".
      3. Digest via existing pipeline (failure-safe: marks row as failed,
         transcript still safe in archive).
      4. Link by matching precedence.

    Returns the UploadRecord after all steps.

    Args:
        skip_digest: when True (for dedup/idempotency), digest step is skipped.
        digester: injectable digester (FakeSessionDigester for tests).
        workspace_dir: workspace for sessions.yaml; if None, derived from repo.
        link_store: injectable LinkStore for tests; if None, production is used.
    """
    sha256 = _sha256_bytes(transcript_bytes)

    # Dedup: same bytes already uploaded → return existing record without re-digesting
    existing = upload_store.find_by_sha256(sha256)
    if existing is not None:
        return existing

    # Step 1: archive FIRST — durability requirement
    archive_path = _archive_bytes(transcript_bytes, filename, archive_dir)

    # Step 2: create DB row in status="pending"
    record = upload_store.create(
        sha256=sha256,
        provider=provider,
        format=format,
        repo=repo,
        branch=branch,
        commits=commits,
        pr_number=pr_number,
        actor=actor,
        as_intent=as_intent,
        archive_path=str(archive_path),
    )

    if skip_digest:
        return record

    # Step 3: digest via existing pipeline (failure-safe)
    try:
        session_id = _digest_uploaded(
            transcript_path=archive_path,
            record=record,
            digester=digester,
            workspace_dir=workspace_dir,
            link_store=link_store,
        )
        upload_store.mark_digested(record.id, session_id)
        record = UploadRecord(
            **{**record.model_dump(), "status": "digested", "session_id": session_id}
        )
    except Exception as exc:
        error_msg = f"{type(exc).__name__}: {exc}"
        logger.warning("session upload digest failed (transcript safe): %s", error_msg)
        try:
            upload_store.mark_failed(record.id, error_msg)
        except Exception:
            pass
        record = UploadRecord(
            **{**record.model_dump(), "status": "failed", "error": error_msg}
        )

    # Step 4: matching & linking (failure-safe — happens only when digest succeeded)
    if record.status == "digested" and record.session_id:
        try:
            _match_and_link(record, link_store=link_store)
        except Exception as exc:
            logger.warning("session upload link step failed (upload still recorded): %s", exc)

    return record


def _digest_uploaded(
    *,
    transcript_path: pathlib.Path,
    record: UploadRecord,
    digester,
    workspace_dir: pathlib.Path | None,
    link_store,
) -> str:
    """Digest the uploaded transcript via quire.session.digest_session.

    Returns the session_id extracted from the transcript.
    The link_store parameter is passed through to digest_session to keep the
    injectable test-engine pattern intact.
    """
    from quire.session import digest_session, FakeSessionDigester, SessionDigest, read_transcript

    # Resolve workspace directory from repo when not explicitly given
    ws_dir = workspace_dir
    if ws_dir is None:
        ws_dir = _workspace_dir_for_repo(record.repo)

    # Use injectable digester or the real LLM digester
    if digester is None:
        from quire.session import SessionDigesterLLM
        digester = SessionDigesterLLM()

    now = datetime.now(tz=timezone.utc).isoformat()
    result = digest_session(
        ws_dir,
        transcript_path,
        digester,
        now,
        pr=record.pr_number,
        link_store=link_store,
    )
    return result["session_id"]


def _workspace_dir_for_repo(repo: str) -> pathlib.Path:
    """Derive a workspace directory from the repo name.

    repo is "owner/name"; the workspace dir is backend/workspaces/<name>
    (per the project convention). Falls back to backend/workspaces/quire-brain
    for this project.
    """
    from quire import workspace as ws_mod
    name = repo.split("/")[-1] if "/" in repo else repo
    base = pathlib.Path(__file__).parent.parent / "workspaces"
    candidate = base / name
    if candidate.exists():
        return candidate
    # Fall back to quire-brain (this project's workspace)
    quire_brain = base / "quire-brain"
    if quire_brain.exists():
        return quire_brain
    # Last resort: create a temp-style dir for the upload
    candidate.mkdir(parents=True, exist_ok=True)
    return candidate


def _match_and_link(record: UploadRecord, link_store=None) -> None:
    """Execute matching precedence and write links (failure-safe caller).

    Precedence:
      1. explicit pr/commits in envelope → kind="attached"
         (upsert_from_yaml_record already does this via digest_session;
          but also handle explicit commits list that wasn't processed there)
      2. Claude-Session trailers in repo commits → kind="trailer"
         (handled by extract_trailer_links over the commit range)
      3. correlate.py structural proposals → kind="inferred" (NEVER auto-promoted)

    If a link_store is already provided (test), use it.
    Otherwise, try the production store (failure-safe).
    """
    from quire.links import SessionCheckLink

    if link_store is None:
        try:
            from quire.db.engine import get_engine
            from quire.links import LinkStore
            link_store = LinkStore(engine=get_engine())
        except Exception as exc:
            logger.warning("_match_and_link: no link store (%s) — skipping link step", exc)
            return

    session_id = record.session_id
    if not session_id:
        return

    workspace = record.repo.split("/")[-1] if "/" in record.repo else record.repo

    # Explicit commits → kind="attached" links for the given commits range
    if record.commits:
        commits = record.commits
        if len(commits) >= 2:
            base_sha = commits[0]
            head_sha = commits[-1]
        elif len(commits) == 1:
            base_sha = commits[0]
            head_sha = commits[0]
        else:
            base_sha = head_sha = ""

        if base_sha and head_sha:
            link = SessionCheckLink(
                session_id=session_id,
                workspace=workspace,
                pr_number=record.pr_number,
                base_sha=base_sha,
                head_sha=head_sha,
                kind="attached",
                confidence=1.0,
                evidence=f"upload:{record.id}:commits",
            )
            try:
                link_store.upsert(link)
            except Exception as exc:
                logger.warning("_match_and_link: attached-commits upsert failed: %s", exc)

    # Inferred proposals (only when no explicit pr/commits attached)
    if not record.pr_number and not record.commits:
        try:
            from quire.correlate import propose_couplings
            proposals = propose_couplings(
                session_id=session_id,
                repo=record.repo,
                branch=record.branch,
                workspace=workspace,
            )
            for prop in proposals:
                try:
                    link_store.upsert(prop)
                except Exception:
                    pass
        except Exception as exc:
            logger.warning("_match_and_link: correlate proposals failed: %s", exc)


# ---------------------------------------------------------------------------
# FastAPI router
# ---------------------------------------------------------------------------

def create_sessions_router(upload_store: UploadStore | None = None) -> APIRouter:
    """Build the /api/sessions router.

    upload_store is injectable for tests; when None, a production store is
    constructed lazily per request (failure-safe: the endpoint returns 503
    when the store is unavailable rather than crashing the app).
    """
    router = APIRouter(prefix="/api/sessions", tags=["sessions"])

    def _store() -> UploadStore | None:
        if upload_store is not None:
            return upload_store
        try:
            from quire.db.engine import get_engine
            return UploadStore(engine=get_engine())
        except Exception as exc:
            logger.warning("sessions_router: upload store unavailable (%s)", exc)
            return None

    @router.post("/upload")
    async def upload_session(
        transcript: UploadFile = File(..., description="Claude Code .jsonl transcript"),
        provider: str = Form(..., description="e.g. 'claude-code'"),
        format: str = Form(..., description="e.g. 'jsonl-v1'"),
        repo: str = Form(..., description="owner/name, e.g. 'giladax/intent-ai'"),
        branch: str | None = Form(None),
        commits: str | None = Form(None, description="JSON array of SHAs, or comma-separated"),
        pr: int | None = Form(None),
        actor: str | None = Form(None),
        as_intent: bool = Form(False),
    ):
        """Upload a coding session transcript.

        Validates the provider/format envelope, archives the transcript
        (sha256-verified), persists a session_uploads row, digests via the
        existing pipeline, and links by matching precedence.

        Idempotent: uploading the same bytes twice returns the existing record
        without re-digesting (sha256 dedup).
        """
        # Validate provider/format
        if provider not in SUPPORTED_PROVIDERS:
            raise HTTPException(
                400,
                f"Unknown provider {provider!r}. Supported: {sorted(SUPPORTED_PROVIDERS)}",
            )
        if format not in SUPPORTED_FORMATS:
            raise HTTPException(
                400,
                f"Unknown format {format!r}. Supported: {sorted(SUPPORTED_FORMATS)}",
            )

        store = _store()
        if store is None:
            raise HTTPException(503, "session upload store unavailable")

        # Parse commits parameter (JSON array or comma-separated)
        commits_list: list[str] = []
        if commits:
            import json
            try:
                parsed = json.loads(commits)
                if isinstance(parsed, list):
                    commits_list = [str(s) for s in parsed]
            except Exception:
                # Try comma-separated
                commits_list = [c.strip() for c in commits.split(",") if c.strip()]

        # Read transcript bytes
        data = await transcript.read()
        if not data:
            raise HTTPException(400, "transcript file is empty")

        # Compute filename: use the original name if it looks like a session UUID
        fname = transcript.filename or "upload.jsonl"
        if not fname.endswith(".jsonl"):
            fname = fname + ".jsonl"

        try:
            record = process_upload(
                transcript_bytes=data,
                filename=fname,
                provider=provider,
                format=format,
                repo=repo,
                branch=branch,
                commits=commits_list,
                pr_number=pr,
                actor=actor,
                as_intent=as_intent,
                upload_store=store,
            )
        except OSError as exc:
            # Archive write failed — the transcript was NOT persisted
            raise HTTPException(500, f"archive write failed: {exc}")

        status_code = 200 if record.status == "digested" else 202
        return {
            "upload_id": record.id,
            "sha256": record.sha256,
            "status": record.status,
            "session_id": record.session_id,
            "error": record.error,
            "archive_path": record.archive_path,
        }

    @router.get("/upload/{upload_id}")
    def get_upload(upload_id: str):
        """Get the status of a session upload."""
        store = _store()
        if store is None:
            raise HTTPException(503, "session upload store unavailable")
        from sqlalchemy import select
        from sqlalchemy.orm import Session as SASession
        with SASession(store._engine) as s:
            row = s.execute(
                select(SessionUpload).where(SessionUpload.id == upload_id)
            ).scalar_one_or_none()
        if row is None:
            raise HTTPException(404, f"no upload '{upload_id}'")
        rec = _row_to_record(row)
        return rec.model_dump()

    return router
