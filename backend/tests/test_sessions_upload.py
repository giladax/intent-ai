"""Tests for quire.sessions_api — session upload standard (O3).

Coverage:
1. Envelope validation (provider, format — 400 on unknown)
2. Persist-first: archive written BEFORE row; row status reflects outcome
3. sha256 dedup: uploading same bytes twice returns existing record, no re-digest
4. Matching precedence: explicit pr → attached; inferred → proposals only
5. Failure isolation: failed digest never loses the transcript
6. session_uploads table — SQLAlchemy model, idempotent schema bootstrap
7. API endpoint (FastAPI TestClient)
8. correlate.py — structural proposals only, sentence evidence, never auto-promoted
9. A2-carry: check:analyzed summary gains "Reasoned in session…" when links exist
10. conftest guard: engine-less UploadStore raises
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import uuid
import warnings
from io import BytesIO

import pytest


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------

def _make_engine():
    """SQLite in-memory engine with all O3 tables bootstrapped."""
    from quire.db.engine import make_test_engine
    from quire.db.models import Base
    from quire.links import SessionCheck  # noqa: F401 — registers table
    from quire.sessions_api import SessionUpload  # noqa: F401 — registers table

    eng = make_test_engine()
    Base.metadata.create_all(eng)
    return eng


def _make_upload_store(engine=None):
    from quire.sessions_api import UploadStore
    return UploadStore(engine=engine or _make_engine())


def _minimal_jsonl(session_id: str = "testsession001") -> bytes:
    lines = [
        {"sessionId": session_id, "timestamp": "2026-07-21T09:00:00Z",
         "message": {"role": "user", "content": "do work"}},
        {"sessionId": session_id, "timestamp": "2026-07-21T09:01:00Z",
         "message": {"role": "assistant", "content": [
             {"type": "text", "text": "reasoned through it"},
             {"type": "tool_use", "name": "Edit",
              "input": {"file_path": "/repo/quire/session.py"}},
         ]}},
    ]
    return "\n".join(json.dumps(ln) for ln in lines).encode()


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _fake_digester(session_id: str = "testsession001"):
    from quire.session import Decision, FakeSessionDigester, SessionDigest
    return FakeSessionDigester(SessionDigest(
        title="test session",
        summary="test upload",
        decisions=[Decision(choice="use fake", why="test", rejected="")],
        reasoning="fake reasoning for test",
    ))


# ---------------------------------------------------------------------------
# 1. Envelope validation
# ---------------------------------------------------------------------------

class TestEnvelopeValidation:
    def test_unknown_provider_raises_400(self, tmp_path):
        from fastapi.testclient import TestClient
        from quire.sessions_api import create_sessions_router
        from fastapi import FastAPI

        engine = _make_engine()
        store = _make_upload_store(engine)
        app = FastAPI()
        app.include_router(create_sessions_router(store))
        client = TestClient(app, raise_server_exceptions=False)

        data = _minimal_jsonl()
        resp = client.post(
            "/api/sessions/upload",
            data={"provider": "codex", "format": "jsonl-v1", "repo": "owner/repo"},
            files={"transcript": ("session.jsonl", BytesIO(data), "application/octet-stream")},
        )
        assert resp.status_code == 400
        assert "codex" in resp.json()["detail"].lower() or "provider" in resp.json()["detail"].lower()

    def test_unknown_format_raises_400(self, tmp_path):
        from fastapi.testclient import TestClient
        from quire.sessions_api import create_sessions_router
        from fastapi import FastAPI

        engine = _make_engine()
        store = _make_upload_store(engine)
        app = FastAPI()
        app.include_router(create_sessions_router(store))
        client = TestClient(app, raise_server_exceptions=False)

        data = _minimal_jsonl()
        resp = client.post(
            "/api/sessions/upload",
            data={"provider": "claude-code", "format": "csv-v99", "repo": "owner/repo"},
            files={"transcript": ("session.jsonl", BytesIO(data), "application/octet-stream")},
        )
        assert resp.status_code == 400
        assert "format" in resp.json()["detail"].lower() or "csv-v99" in resp.json()["detail"].lower()

    def test_known_provider_and_format_accepted(self, tmp_path):
        """claude-code / jsonl-v1 are supported — the request should NOT 400."""
        from quire.sessions_api import SUPPORTED_PROVIDERS, SUPPORTED_FORMATS
        assert "claude-code" in SUPPORTED_PROVIDERS
        assert "jsonl-v1" in SUPPORTED_FORMATS


# ---------------------------------------------------------------------------
# 2. Persist-first (archive + row)
# ---------------------------------------------------------------------------

class TestPersistFirst:
    def test_archive_written_before_row(self, tmp_path):
        """process_upload writes the archive file synchronously before creating the DB row."""
        from quire.sessions_api import process_upload

        engine = _make_engine()
        store = _make_upload_store(engine)
        data = _minimal_jsonl()
        archive_dir = tmp_path / "archive"

        record = process_upload(
            transcript_bytes=data,
            filename="testsession001.jsonl",
            provider="claude-code",
            format="jsonl-v1",
            repo="owner/intent-ai",
            branch=None,
            commits=[],
            pr_number=None,
            actor=None,
            as_intent=False,
            upload_store=store,
            skip_digest=True,
            archive_dir=archive_dir,
        )

        # Archive file must exist on disk
        archive_file = archive_dir / "testsession001.jsonl"
        assert archive_file.exists(), "archive file must exist"
        assert archive_file.read_bytes() == data

        # Row must exist with the correct sha256
        found = store.find_by_sha256(_sha256(data))
        assert found is not None
        assert found.id == record.id

    def test_row_status_is_pending_after_archive(self, tmp_path):
        from quire.sessions_api import process_upload

        engine = _make_engine()
        store = _make_upload_store(engine)
        data = _minimal_jsonl()
        archive_dir = tmp_path / "archive"

        record = process_upload(
            transcript_bytes=data,
            filename="pend.jsonl",
            provider="claude-code",
            format="jsonl-v1",
            repo="owner/repo",
            branch=None,
            commits=[],
            pr_number=None,
            actor=None,
            as_intent=False,
            upload_store=store,
            skip_digest=True,
            archive_dir=archive_dir,
        )
        assert record.status == "pending"

    def test_digest_success_marks_row_digested(self, tmp_path):
        from quire.session import FakeSessionDigester, SessionDigest
        from quire.sessions_api import process_upload

        engine = _make_engine()
        store = _make_upload_store(engine)
        link_engine = _make_engine()
        from quire.links import LinkStore
        link_store = LinkStore(engine=link_engine)

        data = _minimal_jsonl("digsess001")
        archive_dir = tmp_path / "archive"
        ws_dir = tmp_path / "ws"
        ws_dir.mkdir()

        digester = _fake_digester("digsess001")
        record = process_upload(
            transcript_bytes=data,
            filename="digsess001.jsonl",
            provider="claude-code",
            format="jsonl-v1",
            repo="owner/intent-ai",
            branch=None,
            commits=[],
            pr_number=None,
            actor=None,
            as_intent=False,
            upload_store=store,
            link_store=link_store,
            archive_dir=archive_dir,
            digester=digester,
            workspace_dir=ws_dir,
        )
        assert record.status == "digested"
        assert record.session_id == "digsess001"

    def test_digest_failure_marks_row_failed_transcript_safe(self, tmp_path):
        """If the digest raises, the row is marked failed but the archive file survives."""
        from quire.sessions_api import process_upload

        engine = _make_engine()
        store = _make_upload_store(engine)

        class BombDigester:
            def digest(self, raw):
                raise RuntimeError("simulated LLM failure")

        data = _minimal_jsonl("failsess001")
        archive_dir = tmp_path / "archive"
        ws_dir = tmp_path / "ws"
        ws_dir.mkdir()

        record = process_upload(
            transcript_bytes=data,
            filename="failsess001.jsonl",
            provider="claude-code",
            format="jsonl-v1",
            repo="owner/repo",
            branch=None,
            commits=[],
            pr_number=None,
            actor=None,
            as_intent=False,
            upload_store=store,
            archive_dir=archive_dir,
            digester=BombDigester(),
            workspace_dir=ws_dir,
        )
        # Row must be marked failed
        assert record.status == "failed"
        assert record.error is not None
        # Transcript must be safe in the archive
        assert (archive_dir / "failsess001.jsonl").exists()


# ---------------------------------------------------------------------------
# 3. SHA-256 dedup
# ---------------------------------------------------------------------------

class TestSha256Dedup:
    def test_same_bytes_returns_existing_record(self, tmp_path):
        """Uploading identical bytes twice returns the same record without re-processing."""
        from quire.sessions_api import process_upload

        engine = _make_engine()
        store = _make_upload_store(engine)
        data = _minimal_jsonl("dedupsess")
        archive_dir = tmp_path / "archive"
        ws_dir = tmp_path / "ws"
        ws_dir.mkdir()

        r1 = process_upload(
            transcript_bytes=data,
            filename="dedupsess.jsonl",
            provider="claude-code",
            format="jsonl-v1",
            repo="owner/repo",
            branch=None,
            commits=[],
            pr_number=None,
            actor=None,
            as_intent=False,
            upload_store=store,
            skip_digest=True,
            archive_dir=archive_dir,
            workspace_dir=ws_dir,
        )
        r2 = process_upload(
            transcript_bytes=data,   # same bytes
            filename="dedupsess.jsonl",
            provider="claude-code",
            format="jsonl-v1",
            repo="owner/repo",
            branch=None,
            commits=[],
            pr_number=None,
            actor=None,
            as_intent=False,
            upload_store=store,
            skip_digest=True,
            archive_dir=archive_dir,
            workspace_dir=ws_dir,
        )
        assert r1.id == r2.id, "same sha256 must return the same record"
        assert r1.sha256 == r2.sha256

    def test_different_bytes_creates_new_record(self, tmp_path):
        from quire.sessions_api import process_upload

        engine = _make_engine()
        store = _make_upload_store(engine)
        archive_dir = tmp_path / "archive"

        r1 = process_upload(
            transcript_bytes=_minimal_jsonl("sessA"),
            filename="sessA.jsonl",
            provider="claude-code",
            format="jsonl-v1",
            repo="owner/repo",
            branch=None,
            commits=[],
            pr_number=None,
            actor=None,
            as_intent=False,
            upload_store=store,
            skip_digest=True,
            archive_dir=archive_dir,
        )
        r2 = process_upload(
            transcript_bytes=_minimal_jsonl("sessB"),
            filename="sessB.jsonl",
            provider="claude-code",
            format="jsonl-v1",
            repo="owner/repo",
            branch=None,
            commits=[],
            pr_number=None,
            actor=None,
            as_intent=False,
            upload_store=store,
            skip_digest=True,
            archive_dir=archive_dir,
        )
        assert r1.id != r2.id


# ---------------------------------------------------------------------------
# 4. Matching precedence
# ---------------------------------------------------------------------------

class TestMatchingPrecedence:
    def test_explicit_pr_creates_attached_link(self, tmp_path):
        """When pr is given in the envelope, the link kind is 'attached'."""
        from quire.sessions_api import process_upload
        from quire.links import LinkStore

        engine = _make_engine()
        store = _make_upload_store(engine)
        link_store = LinkStore(engine=engine)
        ws_dir = tmp_path / "ws"
        ws_dir.mkdir()
        archive_dir = tmp_path / "archive"

        data = _minimal_jsonl("attachsess")
        record = process_upload(
            transcript_bytes=data,
            filename="attachsess.jsonl",
            provider="claude-code",
            format="jsonl-v1",
            repo="owner/intent-ai",
            branch=None,
            commits=[],
            pr_number=42,
            actor=None,
            as_intent=False,
            upload_store=store,
            link_store=link_store,
            archive_dir=archive_dir,
            digester=_fake_digester("attachsess"),
            workspace_dir=ws_dir,
        )
        assert record.status == "digested"
        # digest_session writes kind=attached via upsert_from_yaml_record
        # Query by session_id (workspace is empty string — digest_session infers it)
        links = link_store.links_for_session("attachsess")
        # At least one attached link must exist for PR 42
        attached = [lnk for lnk in links if lnk.kind == "attached" and lnk.pr_number == 42]
        assert attached, f"expected attached link for PR 42, got: {links}"

    def test_explicit_commits_creates_attached_link(self, tmp_path):
        """When commits are given in the envelope, kind='attached' links are created."""
        from quire.sessions_api import process_upload
        from quire.links import LinkStore

        engine = _make_engine()
        store = _make_upload_store(engine)
        link_store = LinkStore(engine=engine)
        ws_dir = tmp_path / "ws"
        ws_dir.mkdir()
        archive_dir = tmp_path / "archive"

        base = "a" * 40
        head = "b" * 40
        data = _minimal_jsonl("commitsess")
        record = process_upload(
            transcript_bytes=data,
            filename="commitsess.jsonl",
            provider="claude-code",
            format="jsonl-v1",
            repo="owner/repo",
            branch=None,
            commits=[base, head],
            pr_number=None,
            actor=None,
            as_intent=False,
            upload_store=store,
            link_store=link_store,
            archive_dir=archive_dir,
            digester=_fake_digester("commitsess"),
            workspace_dir=ws_dir,
        )
        # The commit-range attached link should be stored
        links = link_store.links_for_session("commitsess")
        commit_links = [lnk for lnk in links if lnk.kind == "attached"
                        and "upload:" in lnk.evidence]
        assert commit_links, f"expected commit-range attached link, got: {links}"
        assert commit_links[0].base_sha == base
        assert commit_links[0].head_sha == head


# ---------------------------------------------------------------------------
# 5. Failure isolation
# ---------------------------------------------------------------------------

class TestFailureIsolation:
    def test_failed_digest_never_loses_transcript(self, tmp_path):
        """transcript must be on disk even when digest fails."""
        from quire.sessions_api import process_upload

        class AlwaysFails:
            def digest(self, _):
                raise ValueError("boom")

        engine = _make_engine()
        store = _make_upload_store(engine)
        data = _minimal_jsonl("safesess")
        archive_dir = tmp_path / "archive"
        ws_dir = tmp_path / "ws"
        ws_dir.mkdir()

        record = process_upload(
            transcript_bytes=data,
            filename="safesess.jsonl",
            provider="claude-code",
            format="jsonl-v1",
            repo="owner/repo",
            branch=None,
            commits=[],
            pr_number=None,
            actor=None,
            as_intent=False,
            upload_store=store,
            archive_dir=archive_dir,
            digester=AlwaysFails(),
            workspace_dir=ws_dir,
        )
        # Row exists
        found = store.find_by_sha256(_sha256(data))
        assert found is not None
        assert found.status == "failed"
        # Transcript is safe
        assert (archive_dir / "safesess.jsonl").exists()

    def test_archive_failure_does_not_create_row(self, tmp_path):
        """If the archive write fails, no DB row must be created."""
        from quire.sessions_api import process_upload
        import unittest.mock as mock

        engine = _make_engine()
        store = _make_upload_store(engine)
        data = _minimal_jsonl("archfailsess")

        # Patch _archive_bytes to raise
        with mock.patch(
            "quire.sessions_api._archive_bytes",
            side_effect=OSError("disk full"),
        ):
            with pytest.raises(OSError):
                process_upload(
                    transcript_bytes=data,
                    filename="archfailsess.jsonl",
                    provider="claude-code",
                    format="jsonl-v1",
                    repo="owner/repo",
                    branch=None,
                    commits=[],
                    pr_number=None,
                    actor=None,
                    as_intent=False,
                    upload_store=store,
                )
        # No row created
        found = store.find_by_sha256(_sha256(data))
        assert found is None, "no row must exist when archive fails"


# ---------------------------------------------------------------------------
# 6. SessionUpload SQLAlchemy model
# ---------------------------------------------------------------------------

class TestSessionUploadModel:
    def test_table_created(self):
        engine = _make_engine()
        from sqlalchemy import inspect
        tables = inspect(engine).get_table_names()
        assert "session_uploads" in tables

    def test_roundtrip(self, tmp_path):
        from datetime import datetime, timezone
        from quire.sessions_api import SessionUpload
        from sqlalchemy.orm import Session as SASession

        engine = _make_engine()
        row_id = str(uuid.uuid4())
        now = datetime.now(tz=timezone.utc)
        with SASession(engine) as s:
            row = SessionUpload(
                id=row_id,
                sha256="a" * 64,
                provider="claude-code",
                format="jsonl-v1",
                repo="owner/repo",
                branch="main",
                commits=json.dumps(["abc123"]),
                pr_number=7,
                actor="gilad",
                as_intent=0,
                archive_path="/archive/x.jsonl",
                status="pending",
                session_id=None,
                error=None,
                uploaded_at=now,
                digested_at=None,
            )
            s.add(row)
            s.commit()

        from sqlalchemy import select
        with SASession(engine) as s:
            loaded = s.execute(
                select(SessionUpload).where(SessionUpload.id == row_id)
            ).scalar_one()
        assert loaded.sha256 == "a" * 64
        assert loaded.pr_number == 7
        assert loaded.status == "pending"

    def test_sha256_unique_constraint(self, tmp_path):
        """Inserting two rows with the same sha256 must raise an integrity error."""
        import datetime
        from quire.sessions_api import SessionUpload
        from sqlalchemy.orm import Session as SASession
        from sqlalchemy.exc import IntegrityError

        engine = _make_engine()
        now = datetime.datetime.now(tz=datetime.timezone.utc)
        with SASession(engine) as s:
            for i in range(2):
                s.add(SessionUpload(
                    id=str(uuid.uuid4()),
                    sha256="b" * 64,
                    provider="claude-code",
                    format="jsonl-v1",
                    repo="owner/repo",
                    branch=None,
                    commits=None,
                    pr_number=None,
                    actor=None,
                    as_intent=0,
                    archive_path=f"/archive/{i}.jsonl",
                    status="pending",
                    session_id=None,
                    error=None,
                    uploaded_at=now,
                    digested_at=None,
                ))
            with pytest.raises(IntegrityError):
                s.commit()


# ---------------------------------------------------------------------------
# 7. API endpoint (FastAPI TestClient)
# ---------------------------------------------------------------------------

class TestApiEndpoint:
    def _engine(self, tmp_path):
        """File-based SQLite engine so API thread and test thread share the DB.

        SQLite in-memory is connection-scoped; TestClient's async transport
        opens a new connection in its own thread context and sees an empty DB.
        A file-based engine uses the same on-disk DB across connections.
        """
        from quire.db.engine import make_test_engine
        from quire.db.models import Base
        from quire.links import SessionCheck  # noqa: F401
        from quire.sessions_api import SessionUpload  # noqa: F401

        db_file = tmp_path / "test_api.db"
        eng = make_test_engine(f"sqlite:///{db_file}")
        Base.metadata.create_all(eng)
        return eng

    def _app(self, engine):
        from fastapi import FastAPI
        from quire.sessions_api import UploadStore, create_sessions_router
        store = UploadStore(engine=engine)
        app = FastAPI()
        app.include_router(create_sessions_router(store))
        return app

    def test_upload_returns_upload_id(self, tmp_path, monkeypatch):
        """A valid POST /api/sessions/upload returns an upload_id and sha256."""
        from fastapi.testclient import TestClient

        import quire.sessions_api as sa_mod
        monkeypatch.setattr(sa_mod, "_archive_dir", lambda: tmp_path / "archive")

        engine = self._engine(tmp_path)
        client = TestClient(self._app(engine), raise_server_exceptions=False)

        data = _minimal_jsonl("apisess001")
        resp = client.post(
            "/api/sessions/upload",
            data={"provider": "claude-code", "format": "jsonl-v1",
                  "repo": "owner/repo"},
            files={"transcript": ("apisess001.jsonl", BytesIO(data), "application/octet-stream")},
        )
        # 200 (digested) or 202 (pending/failed) — not 4xx/5xx
        assert resp.status_code in (200, 202), resp.text[:200]
        body = resp.json()
        assert "upload_id" in body
        assert "sha256" in body
        assert body["sha256"] == _sha256(data)

    def test_upload_dedup_same_sha256(self, tmp_path, monkeypatch):
        """Uploading the same bytes twice returns the same upload_id."""
        from fastapi.testclient import TestClient

        import quire.sessions_api as sa_mod
        monkeypatch.setattr(sa_mod, "_archive_dir", lambda: tmp_path / "archive")

        engine = self._engine(tmp_path)
        client = TestClient(self._app(engine), raise_server_exceptions=False)

        data = _minimal_jsonl("apisess002")
        r1 = client.post(
            "/api/sessions/upload",
            data={"provider": "claude-code", "format": "jsonl-v1", "repo": "owner/repo"},
            files={"transcript": ("apisess002.jsonl", BytesIO(data), "application/octet-stream")},
        )
        r2 = client.post(
            "/api/sessions/upload",
            data={"provider": "claude-code", "format": "jsonl-v1", "repo": "owner/repo"},
            files={"transcript": ("apisess002.jsonl", BytesIO(data), "application/octet-stream")},
        )
        assert r1.status_code in (200, 202), r1.text[:200]
        assert r2.status_code in (200, 202), r2.text[:200]
        assert r1.json()["upload_id"] == r2.json()["upload_id"]

    def test_get_upload_status(self, tmp_path, monkeypatch):
        """GET /api/sessions/upload/{id} returns the upload record."""
        from fastapi.testclient import TestClient

        import quire.sessions_api as sa_mod
        monkeypatch.setattr(sa_mod, "_archive_dir", lambda: tmp_path / "archive")

        engine = self._engine(tmp_path)
        client = TestClient(self._app(engine), raise_server_exceptions=False)

        data = _minimal_jsonl("apisess003")
        post_resp = client.post(
            "/api/sessions/upload",
            data={"provider": "claude-code", "format": "jsonl-v1", "repo": "owner/repo"},
            files={"transcript": ("apisess003.jsonl", BytesIO(data), "application/octet-stream")},
        )
        assert post_resp.status_code in (200, 202), post_resp.text[:200]
        upload_id = post_resp.json()["upload_id"]

        get_resp = client.get(f"/api/sessions/upload/{upload_id}")
        assert get_resp.status_code == 200
        assert get_resp.json()["id"] == upload_id

    def test_get_upload_404(self, tmp_path):
        from fastapi.testclient import TestClient

        engine = self._engine(tmp_path)
        client = TestClient(self._app(engine), raise_server_exceptions=False)

        resp = client.get("/api/sessions/upload/no-such-id")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# 8. correlate.py — structural proposals, sentence evidence
# ---------------------------------------------------------------------------

class TestCorrelate:
    def test_proposals_are_inferred_never_attached(self, tmp_path):
        """propose_couplings always returns kind='inferred' — never auto-promoted."""
        from quire.correlate import propose_couplings
        import yaml

        sessions_dir = tmp_path / "ws"
        sessions_dir.mkdir()
        (sessions_dir / "sessions.yaml").write_text(yaml.safe_dump([{
            "session_id": "corr001",
            "touched_paths": ["quire/session.py", "quire/links.py"],
        }]))

        proposals = propose_couplings(
            session_id="corr001",
            repo="owner/repo",
            branch=None,
            workspace="repo",
            sessions_dir=sessions_dir,
            pr_files={1: ["quire/session.py", "quire/links.py", "quire/api.py"]},
        )
        assert proposals, "expected at least one proposal"
        for p in proposals:
            assert p.kind == "inferred", f"expected inferred, got {p.kind}"
            assert p.confidence < 1.0, "inferred proposals must not have confidence=1.0"

    def test_evidence_reads_as_sentence(self, tmp_path):
        """evidence field is a plain-language sentence with path counts."""
        from quire.correlate import propose_couplings
        import yaml

        sessions_dir = tmp_path / "ws"
        sessions_dir.mkdir()
        (sessions_dir / "sessions.yaml").write_text(yaml.safe_dump([{
            "session_id": "corr002",
            "touched_paths": ["backend/quire/session.py"],
        }]))

        proposals = propose_couplings(
            session_id="corr002",
            repo="owner/repo",
            branch=None,
            workspace="repo",
            sessions_dir=sessions_dir,
            pr_files={5: ["quire/session.py", "quire/api.py"]},
        )
        assert proposals
        evidence = proposals[0].evidence
        # Must read as a sentence naming the session and file counts
        assert "corr002"[:8] in evidence or "Session" in evidence
        assert "edited" in evidence.lower() or "file" in evidence.lower()

    def test_no_overlap_yields_no_proposals(self, tmp_path):
        """Sessions with no path overlap produce no proposals."""
        from quire.correlate import propose_couplings
        import yaml

        sessions_dir = tmp_path / "ws"
        sessions_dir.mkdir()
        (sessions_dir / "sessions.yaml").write_text(yaml.safe_dump([{
            "session_id": "corr003",
            "touched_paths": ["backend/unrelated.py"],
        }]))

        proposals = propose_couplings(
            session_id="corr003",
            repo="owner/repo",
            branch=None,
            workspace="repo",
            sessions_dir=sessions_dir,
            pr_files={9: ["quire/session.py", "tests/test_links.py"]},
        )
        assert proposals == []

    def test_empty_touched_paths_yields_no_proposals(self, tmp_path):
        from quire.correlate import propose_couplings
        import yaml

        sessions_dir = tmp_path / "ws"
        sessions_dir.mkdir()
        (sessions_dir / "sessions.yaml").write_text(yaml.safe_dump([{
            "session_id": "corr004",
            "touched_paths": [],
        }]))

        proposals = propose_couplings(
            session_id="corr004",
            repo="owner/repo",
            branch=None,
            workspace="repo",
            sessions_dir=sessions_dir,
            pr_files={3: ["quire/session.py"]},
        )
        assert proposals == []

    def test_inferred_proposals_stored_in_link_table(self, tmp_path):
        """propose_couplings results can be persisted via link_store.upsert."""
        from quire.correlate import propose_couplings
        from quire.links import LinkStore
        import yaml

        engine = _make_engine()
        ls = LinkStore(engine=engine)

        sessions_dir = tmp_path / "ws"
        sessions_dir.mkdir()
        (sessions_dir / "sessions.yaml").write_text(yaml.safe_dump([{
            "session_id": "corr005",
            "touched_paths": ["src/mcp/server.ts"],
        }]))

        proposals = propose_couplings(
            session_id="corr005",
            repo="owner/repo",
            branch=None,
            workspace="repo",
            sessions_dir=sessions_dir,
            pr_files={7: ["src/mcp/server.ts", "src/mcp/feature.ts"]},
        )
        for p in proposals:
            ls.upsert(p)

        stored = ls.links_for_session("corr005")
        assert stored
        assert all(lnk.kind == "inferred" for lnk in stored)


# ---------------------------------------------------------------------------
# 9. A2-carry / U5 — check:analyzed summary gains coupling line
# ---------------------------------------------------------------------------

class TestCheckAnalyzedSummary:
    def test_coupled_session_ids_added_to_summary(self):
        """_emit_check_analyzed with coupled_session_ids produces 'Reasoned in session…'."""
        from quire.org_sync import _emit_check_analyzed
        import unittest.mock as mock

        captured = {}

        def fake_emit(events, *, db_session, is_pg):
            captured["events"] = events

        with mock.patch("quire.org_sync.emit_activity_events", fake_emit), \
             mock.patch("quire.org_sync.get_session") as mock_get_session:
            # get_session() is used as a context manager
            mock_ctx = mock.MagicMock()
            mock_ctx.__enter__ = mock.Mock(return_value=mock.MagicMock())
            mock_ctx.__exit__ = mock.Mock(return_value=False)
            mock_get_session.return_value = mock_ctx

            _emit_check_analyzed(
                pr_number=1,
                head_sha="abc" * 13 + "a",
                verdict="satisfies_all",
                workspace="intent-ai",
                repository="owner/intent-ai",
                publish_url=None,
                repo="owner/intent-ai",
                branch=None,
                coupled_session_ids=["016cmqJ7aie4Kap4ZsZraMF1"],
            )

        assert "events" in captured
        summary = captured["events"][0]["summary"]
        assert "Reasoned in session" in summary
        assert "016cmqJ7aie4" in summary  # first 12 chars of the session id

    def test_no_coupled_sessions_no_coupling_line(self):
        """When no sessions are coupled, the summary does not mention sessions."""
        from quire.org_sync import _emit_check_analyzed
        import unittest.mock as mock

        captured = {}

        def fake_emit(events, *, db_session, is_pg):
            captured["events"] = events

        with mock.patch("quire.org_sync.emit_activity_events", fake_emit), \
             mock.patch("quire.org_sync.get_session") as mock_get_session:
            mock_ctx = mock.MagicMock()
            mock_ctx.__enter__ = mock.Mock(return_value=mock.MagicMock())
            mock_ctx.__exit__ = mock.Mock(return_value=False)
            mock_get_session.return_value = mock_ctx

            _emit_check_analyzed(
                pr_number=2,
                head_sha="def" * 13 + "d",
                verdict="aligned",
                workspace="intent-ai",
                repository="owner/intent-ai",
                publish_url=None,
                repo="owner/intent-ai",
                branch=None,
                coupled_session_ids=None,
            )

        assert "events" in captured
        summary = captured["events"][0]["summary"]
        assert "Reasoned" not in summary

    def test_metadata_includes_coupled_session_ids(self):
        """coupled_session_ids appears in the event metadata."""
        from quire.org_sync import _emit_check_analyzed
        import unittest.mock as mock

        captured = {}

        def fake_emit(events, *, db_session, is_pg):
            captured["events"] = events

        sids = ["016cmqJ7aie4Kap4ZsZraMF1", "5b31a1bb3f6b4d03b418a6c0"]
        with mock.patch("quire.org_sync.emit_activity_events", fake_emit), \
             mock.patch("quire.org_sync.get_session") as mock_get_session:
            mock_ctx = mock.MagicMock()
            mock_ctx.__enter__ = mock.Mock(return_value=mock.MagicMock())
            mock_ctx.__exit__ = mock.Mock(return_value=False)
            mock_get_session.return_value = mock_ctx

            _emit_check_analyzed(
                pr_number=3,
                head_sha="111" * 13 + "1",
                verdict="satisfies_all",
                workspace="intent-ai",
                repository="owner/intent-ai",
                publish_url=None,
                repo="owner/intent-ai",
                branch=None,
                coupled_session_ids=sids,
            )

        meta = captured["events"][0]["metadata"]
        assert meta["coupled_session_ids"] == sids


# ---------------------------------------------------------------------------
# 10. Conftest guard: engine-less UploadStore raises
# ---------------------------------------------------------------------------

class TestConftestGuard:
    def test_engine_less_upload_store_raises(self):
        """The conftest guard must prevent engine-less UploadStore construction."""
        from quire.sessions_api import UploadStore

        with pytest.raises(RuntimeError, match="no engine"):
            UploadStore()

    def test_explicit_engine_upload_store_works(self):
        """An explicit test engine must bypass the guard."""
        engine = _make_engine()
        store = _make_upload_store(engine)
        assert store is not None
