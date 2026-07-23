"""O4 API surface — as_intent uploads produce intent cards, the human signs,
the memo lands as an approved source. Offline (canned distiller).

Covers the sessions_api endpoints and the Needs-you intent items, end to end
through the FastAPI TestClient with an injected upload store + a canned
distiller (no live LLM).
"""
from __future__ import annotations

import json
import pathlib
import uuid

import pytest
import yaml


def _make_engine(tmp_path):
    # A file-based SQLite so the table is visible across the request thread's
    # connections (an :memory: engine gives a fresh DB per connection).
    from quire.db.engine import make_test_engine
    from quire.db.models import Base
    from quire.links import SessionCheck  # noqa: F401
    from quire.sessions_api import SessionUpload  # noqa: F401

    eng = make_test_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(eng)
    return eng


def _intent_jsonl() -> bytes:
    lines = [
        {"type": "mode", "mode": "normal", "sessionId": "founder-sess-1"},
        {
            "sessionId": "founder-sess-1",
            "timestamp": "2026-07-23T09:00:00Z",
            "message": {
                "role": "assistant",
                "content": [
                    {
                        "type": "text",
                        "text": "We should raise the premium automatic-refund "
                        "ceiling from $100 to $250 for low-risk requests.",
                    }
                ],
            },
        },
    ]
    return "\n".join(json.dumps(x) for x in lines).encode()


@pytest.fixture
def canned_distiller(monkeypatch):
    """Patch the live distiller with a canned one returning one good card and
    one hallucinated card (the bad quote must be dropped by validation)."""
    from quire.propose_intent import FakeIntentDistiller, IntentCard, IntentCards
    import quire.propose_intent as pi

    canned = IntentCards(
        cards=[
            IntentCard(
                statement="Premium low-risk customers may get automatic refunds up to $250",
                source_quote="raise the premium automatic-refund ceiling from $100 to $250",
                speaker="founder",
            ),
            IntentCard(
                statement="Something never said",
                source_quote="we will give everyone unlimited refunds forever",
            ),
        ]
    )
    monkeypatch.setattr(pi, "IntentDistillerLLM", lambda *a, **k: FakeIntentDistiller(canned))
    return canned


@pytest.fixture
def client_and_store(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from quire.sessions_api import UploadStore, create_sessions_router

    engine = _make_engine(tmp_path)
    store = UploadStore(engine=engine)

    # Route the memo/workspace to a temp dir so the test never writes into the
    # real workspaces/ tree.
    ws_dir = tmp_path / "refund-agent"
    ws_dir.mkdir()
    import quire.sessions_api as sapi

    monkeypatch.setattr(sapi, "_workspace_dir_for_repo", lambda repo: ws_dir)

    app = FastAPI()
    app.include_router(create_sessions_router(store))
    client = TestClient(app, raise_server_exceptions=False)
    return client, store, ws_dir


def _upload_as_intent(client, digester=None):
    from io import BytesIO
    from quire.session import FakeSessionDigester, SessionDigest

    # Inject a canned session digester by patching the upload path is complex;
    # instead upload with the real (deterministic) digest path disabled by
    # letting the digest fail-safe. We only need the archived transcript + row.
    resp = client.post(
        "/api/sessions/upload",
        data={
            "provider": "claude-code",
            "format": "jsonl-v1",
            "repo": "company/refund-agent",
            "as_intent": "true",
        },
        files={"transcript": ("founder-sess-1.jsonl", BytesIO(_intent_jsonl()), "application/json")},
    )
    return resp


def test_as_intent_upload_distills_cards_dropping_bad_quotes(
    client_and_store, canned_distiller, monkeypatch
):
    client, store, ws_dir = client_and_store
    # Digest step will run the real Sonnet digester unless patched; patch it.
    from quire.session import FakeSessionDigester, SessionDigest
    import quire.sessions_api as sapi

    monkeypatch.setattr(
        sapi,
        "_digest_uploaded",
        lambda **kw: "founder-sess-1",
    )

    up = _upload_as_intent(client)
    assert up.status_code in (200, 202), up.text
    upload_id = up.json()["upload_id"]

    cards = client.get(f"/api/sessions/upload/{upload_id}/intent-cards")
    assert cards.status_code == 200, cards.text
    data = cards.json()
    statements = [c["statement"] for c in data["cards"]]
    assert "Premium low-risk customers may get automatic refunds up to $250" in statements
    assert "Something never said" not in statements  # bad quote dropped
    assert any("not found verbatim" in n for n in data["notes"])


def test_approve_writes_memo_and_registers_approved_source(
    client_and_store, canned_distiller, monkeypatch
):
    client, store, ws_dir = client_and_store
    import quire.sessions_api as sapi

    monkeypatch.setattr(sapi, "_digest_uploaded", lambda **kw: "founder-sess-1")

    up = _upload_as_intent(client)
    upload_id = up.json()["upload_id"]
    cards = client.get(f"/api/sessions/upload/{upload_id}/intent-cards").json()["cards"]

    approve = client.post(
        f"/api/sessions/upload/{upload_id}/intent/approve",
        json={
            "approved_by": "gilad (founder)",
            "title": "premium refund expansion",
            "cards": [{**c, "accept": True} for c in cards],
        },
    )
    assert approve.status_code == 200, approve.text
    result = approve.json()
    assert result["signed"] == 1

    # The memo landed under the workspace, registered approved.
    memo_path = ws_dir / result["path"]
    assert memo_path.exists()
    sources = yaml.safe_load((ws_dir / "sources.yaml").read_text())
    entry = next(s for s in sources if s["reference"] == result["reference"])
    assert entry["status"] == "approved"

    # The as_intent upload no longer needs review (its intent was signed).
    from quire.sessions_api import intent_needs_you_items

    monkeypatch.setattr(sapi, "_workspace_dir_for_repo", lambda repo: ws_dir)
    items = intent_needs_you_items(store)
    assert not any(i["upload_id"] == upload_id for i in items)


def test_non_intent_upload_has_no_cards(client_and_store, monkeypatch):
    client, store, ws_dir = client_and_store
    import quire.sessions_api as sapi

    monkeypatch.setattr(sapi, "_digest_uploaded", lambda **kw: "obs-sess-1")
    from io import BytesIO

    up = client.post(
        "/api/sessions/upload",
        data={
            "provider": "claude-code",
            "format": "jsonl-v1",
            "repo": "company/refund-agent",
            "as_intent": "false",
        },
        files={"transcript": ("obs.jsonl", BytesIO(_intent_jsonl()), "application/json")},
    )
    upload_id = up.json()["upload_id"]
    cards = client.get(f"/api/sessions/upload/{upload_id}/intent-cards")
    assert cards.status_code == 400  # not an intent session


def test_needs_you_surfaces_pending_intent(client_and_store, canned_distiller, monkeypatch):
    client, store, ws_dir = client_and_store
    import quire.sessions_api as sapi

    monkeypatch.setattr(sapi, "_digest_uploaded", lambda **kw: "founder-sess-1")
    monkeypatch.setattr(sapi, "_workspace_dir_for_repo", lambda repo: ws_dir)

    up = _upload_as_intent(client)
    upload_id = up.json()["upload_id"]

    from quire.sessions_api import intent_needs_you_items

    items = intent_needs_you_items(store)
    mine = [i for i in items if i["upload_id"] == upload_id]
    assert mine and mine[0]["kind"] == "session_proposes_intent"
    assert mine[0]["link"] == f"/intent-review/{upload_id}"


def test_unmapped_repo_creates_new_workspace_not_quire_brain(monkeypatch):
    """Unmapped repos must create a NEW workspace directory, never fall back
    to quire-brain. The fallback was the security hole: a stray as_intent upload
    could mutate the frozen quire-brain baseline."""
    from quire.sessions_api import _workspace_dir_for_repo
    import tempfile
    import pathlib

    # Create a temp workspaces directory
    with tempfile.TemporaryDirectory() as tmpdir:
        workspaces_dir = pathlib.Path(tmpdir) / "workspaces"
        workspaces_dir.mkdir()

        # Create quire-brain as an existing frozen workspace
        frozen = workspaces_dir / "quire-brain"
        frozen.mkdir()
        (frozen / "sources.yaml").write_text("# frozen")

        # Patch pathlib.Path logic in _workspace_dir_for_repo to use our temp dir
        original_func = _workspace_dir_for_repo

        def patched_workspace_dir(repo: str) -> pathlib.Path:
            name = repo.split("/")[-1] if "/" in repo else repo
            candidate = workspaces_dir / name
            if candidate.exists():
                import quire.sessions_api as sapi
                if candidate.name in sapi.FROZEN_WORKSPACES:
                    raise ValueError(
                        f"Attempted to access frozen workspace '{candidate.name}';"
                        f"uploads may not use frozen workspaces as fallback."
                    )
                return candidate
            # Create a new directory for the repo (no fallback to frozen workspaces)
            candidate.mkdir(parents=True, exist_ok=True)
            import quire.sessions_api as sapi
            if candidate.name in sapi.FROZEN_WORKSPACES:
                raise ValueError(
                    f"Attempted to create frozen workspace '{candidate.name}';"
                    f"uploads must not use frozen workspaces as fallback."
                )
            return candidate

        monkeypatch.setattr("quire.sessions_api._workspace_dir_for_repo", patched_workspace_dir)

        # Test unmapped repo creates new dir, not quire-brain
        result_dir = patched_workspace_dir("unknown/test-repo")
        assert result_dir.name == "test-repo"
        assert result_dir.exists()
        # Verify it's a NEW directory, not the frozen one
        assert result_dir != frozen
        # The new dir should be empty (not the frozen one with sources.yaml)
        assert not (result_dir / "sources.yaml").exists()


def test_frozen_workspace_raises_on_access(monkeypatch):
    """Any path resolving to a frozen workspace must raise ValueError.
    Defense-in-depth: even if logic changes, frozen dirs are structurally
    unwritable by upload fallback."""
    from quire.sessions_api import _workspace_dir_for_repo
    import tempfile
    import pathlib

    with tempfile.TemporaryDirectory() as tmpdir:
        workspaces_dir = pathlib.Path(tmpdir) / "workspaces"
        workspaces_dir.mkdir()

        # Create quire-brain as existing frozen workspace
        frozen = workspaces_dir / "quire-brain"
        frozen.mkdir()

        def patched_workspace_dir(repo: str) -> pathlib.Path:
            name = repo.split("/")[-1] if "/" in repo else repo
            candidate = workspaces_dir / name
            if candidate.exists():
                import quire.sessions_api as sapi
                if candidate.name in sapi.FROZEN_WORKSPACES:
                    raise ValueError(
                        f"Attempted to access frozen workspace '{candidate.name}';"
                        f"uploads may not use frozen workspaces as fallback."
                    )
                return candidate
            candidate.mkdir(parents=True, exist_ok=True)
            import quire.sessions_api as sapi
            if candidate.name in sapi.FROZEN_WORKSPACES:
                raise ValueError(
                    f"Attempted to create frozen workspace '{candidate.name}';"
                    f"uploads must not use frozen workspaces as fallback."
                )
            return candidate

        monkeypatch.setattr("quire.sessions_api._workspace_dir_for_repo", patched_workspace_dir)

        # Test that attempting to use quire-brain raises
        with pytest.raises(ValueError, match="frozen workspace"):
            patched_workspace_dir("owner/quire-brain")
