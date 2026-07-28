"""A2 — the review room's assembled contract.

The review room composes a stored PRAnalysis with the diff (re-derived live),
the human PR title (from the workspace registry), verbatim receipts, the
coverage gap, and "why the author did it" — all in plain language, ids as
footnotes. Deterministic: the refund-agent fixture + canned PR 101.
"""
import pathlib
import uuid as _uuid
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from quire.adapters.fixture import FixtureWorkspace
from quire.analysis.graph import run_analysis
from quire.api import create_app
from quire.canned import fake_for_pr
from quire import review
from quire.store import Store

FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"


def _refund_store(tmp_path):
    ws = FixtureWorkspace(FIXTURES / "refund-agent")
    store = Store(url=f"sqlite:///{tmp_path}/t.db")
    run_analysis(ws, 101, llm=fake_for_pr(101), store=store)
    return ws, store


# ── review_detail assembly ───────────────────────────────────────────────

def test_review_detail_reads_in_plain_language(tmp_path):
    ws, store = _refund_store(tmp_path)
    det = review.review_detail(store, ws, "refund-agent", 101)
    assert det is not None
    # Plain label, never the raw enum in the human field.
    assert det["label"] == "Partly kept"
    assert det["verdict"] == "PARTIAL"  # raw enum rides along for agents
    assert "PARTIAL" not in det["verdict_sentence"]
    assert det["verdict_sentence"].startswith("Partly kept")


def test_review_detail_carries_human_title(tmp_path):
    ws, store = _refund_store(tmp_path)
    det = review.review_detail(store, ws, "refund-agent", 101)
    # The human PR title comes from the workspace registry, not "PR #101".
    assert det["title"]
    assert det["title"] != "PR #101"


def test_review_detail_carries_diff_and_files(tmp_path):
    ws, store = _refund_store(tmp_path)
    det = review.review_detail(store, ws, "refund-agent", 101)
    assert det["files"], "the manuscript body shows changed files"
    f = det["files"][0]
    assert set(("path", "additions", "deletions", "patch", "notes")) <= set(f)
    assert f["patch"], "a changed file expands to its diff"


def test_review_detail_promise_cards_carry_receipts(tmp_path):
    ws, store = _refund_store(tmp_path)
    det = review.review_detail(store, ws, "refund-agent", 101)
    assert det["promises"], "the rail shows the promises this change touched"
    p = det["promises"][0]
    assert p["statement"], "a promise card leads with its plain statement"
    assert p["label"] in {
        "Keeps this promise", "Partly keeps this promise", "Breaks this promise",
    }
    # Receipts are verbatim citations; a card without a quote shows none.
    for c in p["citations"]:
        assert c["excerpt"]


def test_review_detail_why_from_declared_intent(tmp_path):
    ws, store = _refund_store(tmp_path)
    det = review.review_detail(store, ws, "refund-agent", 101)
    # The PR carried a declared intent — "why the author did it" is present,
    # with the coupled session honestly absent (no trailer linked one).
    assert det["why"] is not None
    assert det["why"]["summary"]
    assert det["why"]["session"] is None


def test_review_detail_absent_analysis_returns_none(tmp_path):
    ws, store = _refund_store(tmp_path)
    assert review.review_detail(store, ws, "refund-agent", 999) is None


# ── the repo reviews list ────────────────────────────────────────────────

def test_repo_reviews_lists_plain_verdicts(tmp_path):
    ws, store = _refund_store(tmp_path)
    rows = review.repo_reviews(store, ws, "refund-agent")
    assert rows
    row = rows[0]
    assert row["label"] == "Partly kept"
    assert "PARTIAL" not in row["label"]
    assert row["title"] and row["title"] != "PR #101"
    assert row["link"] == "/repo/refund-agent/review/101"


# ── the feature ↔ promises join (bindings paths ∩ feature_files) ──────────

def test_feature_promises_join_is_an_edge_intersection(tmp_path):
    ws, _ = _refund_store(tmp_path)
    # Pick a real control-point path from the fixture's bindings.
    cp_by_id = {cp.control_point_id: cp.path for cp in ws.control_points()}
    a_path = next(
        cp_by_id[b.control_point_id]
        for b in ws.bindings()
        if b.control_point_id in cp_by_id
    )
    res = review.feature_promises(ws, [{"file_path": a_path, "glob": a_path}])
    assert res["promiseCount"] >= 1
    assert any(a_path in p["files"] for p in res["promises"])


def test_feature_promises_empty_when_no_overlap(tmp_path):
    ws, _ = _refund_store(tmp_path)
    res = review.feature_promises(ws, [{"file_path": "no/such/file.py", "glob": None}])
    assert res == {"promises": [], "promiseCount": 0}


def test_feature_promises_empty_files_is_count_zero(tmp_path):
    ws, _ = _refund_store(tmp_path)
    assert review.feature_promises(ws, []) == {"promises": [], "promiseCount": 0}


# ── the endpoints (TestClient) ───────────────────────────────────────────

def test_review_room_endpoint(tmp_path):
    ws, store = _refund_store(tmp_path)
    client = TestClient(create_app(store=store))
    r = client.get(f"/api/reviews/{FIXTURES / 'refund-agent'}/101")
    assert r.status_code == 200
    body = r.json()
    assert body["label"] == "Partly kept"
    assert body["files"]


def test_review_room_endpoint_404(tmp_path):
    ws, store = _refund_store(tmp_path)
    client = TestClient(create_app(store=store))
    r = client.get(f"/api/reviews/{FIXTURES / 'refund-agent'}/999")
    assert r.status_code == 404


def test_repo_reviews_endpoint(tmp_path):
    ws, store = _refund_store(tmp_path)
    client = TestClient(create_app(store=store))
    r = client.get(f"/api/repos/{FIXTURES / 'refund-agent'}/reviews")
    assert r.status_code == 200
    reviews = r.json()["reviews"]
    assert reviews and reviews[0]["label"] == "Partly kept"


def test_files_and_notes_mismatch_returns_unavailable_marker(tmp_path):
    """When get_pr()'s head_sha differs from the stored analysis head_sha
    (prs.yaml was a branch ref that moved), _files_and_notes returns the
    honest 'diff unavailable' marker file instead of a misleading diff."""
    from unittest.mock import patch as _patch
    from quire.models import PullRequest as _PR

    ws, store = _refund_store(tmp_path)
    det = review.review_detail(store, ws, "refund-agent", 101)
    assert det is not None

    # Simulate the workspace ref having moved: patch adapter.get_pr to return
    # a PR with a different head_sha (as if the branch ref advanced).
    stale_pr = ws.get_pr(101)
    moved_pr = _PR(
        number=stale_pr.number,
        title=stale_pr.title,
        body=stale_pr.body,
        author=stale_pr.author,
        base_sha=stale_pr.base_sha,
        head_sha="0000000000000000000000000000000000000000",  # moved
        issue_key=stale_pr.issue_key,
        deleted_files=stale_pr.deleted_files,
    )

    analysis = store.get_analysis(det["analysis_id"])

    with _patch.object(ws, "get_pr", return_value=moved_pr):
        files, notes = review._files_and_notes(ws, analysis, {})

    assert len(files) == 1
    assert "unavailable" in files[0]["path"]
    assert notes == []


def test_feature_promises_endpoint_workspace_name_derivation(tmp_path):
    """GET /api/features/{id}/promises: a project named with a space derives
    its workspace slug as lower().replace(' ', '-'), and the endpoint resolves
    bindings through that slug.

    Seeding: project name 'Refund Agent' -> workspace 'refund-agent' (matches
    the fixture workspace in backend/fixtures/refund-agent/). Uses an in-memory
    SQLite DB with the journal ORM schema — fully offline, no Postgres required.
    """
    from sqlalchemy.orm import sessionmaker as _sm
    from quire.db.engine import make_test_engine
    from quire.db.models import Base, Feature, FeatureFile, Project
    import quire.db.engine as _engine_mod

    # Build a file-based SQLite journal DB so all sessions share the same data.
    # In-memory SQLite creates an isolated DB per connection; a file path avoids
    # that pitfall (seed session and endpoint session see the same tables/rows).
    journal_db = tmp_path / "journal.db"
    test_engine = make_test_engine(url=f"sqlite:///{journal_db}")
    Base.metadata.create_all(test_engine)
    _TestSession = _sm(bind=test_engine, expire_on_commit=False)

    def _test_get_session():
        return _TestSession()

    # Seed: project with a space in the name so workspace = 'refund-agent'
    # after lower().replace(' ', '-').
    ws_fixture = FixtureWorkspace(FIXTURES / "refund-agent")
    cp_by_id = {cp.control_point_id: cp.path for cp in ws_fixture.control_points()}
    a_path = next(
        cp_by_id[b.control_point_id]
        for b in ws_fixture.bindings()
        if b.control_point_id in cp_by_id
    )

    now = datetime.now(timezone.utc)
    project_id = str(_uuid.uuid4())
    feature_id = str(_uuid.uuid4())
    file_id = str(_uuid.uuid4())

    with _TestSession() as sess:
        sess.add(Project(id=project_id, name="Refund Agent", path="/tmp/refund", created_at=now))
        sess.add(Feature(
            id=feature_id, project_id=project_id, name="Test Feature",
            description="", created_at=now,
        ))
        sess.add(FeatureFile(
            id=file_id, feature_id=feature_id,
            glob=a_path, file_path=a_path, created_at=now,
        ))
        sess.commit()

    # Patch get_session at the module level so the endpoint's local import
    # picks up the test session factory.
    orig_get_session = _engine_mod.get_session
    _engine_mod.get_session = _test_get_session
    try:
        align_store = Store(url=f"sqlite:///{tmp_path}/align.db")
        client = TestClient(create_app(store=align_store))
        r = client.get(f"/api/features/{feature_id}/promises")
    finally:
        _engine_mod.get_session = orig_get_session

    assert r.status_code == 200
    body = r.json()
    assert body["promiseCount"] >= 1, (
        f"expected >= 1 promise for path {a_path!r} in 'refund-agent' workspace; got {body}"
    )
    assert any(a_path in p["files"] for p in body["promises"])


# ── verdict-head vocab: raw enum never leaks into a human field ──────────────

def test_review_verdict_head_is_plain_language_never_raw_enum(tmp_path):
    """Every Classification maps to a plain vocab label, and the review
    contract's verdict head (label + verdict_sentence) never carries the raw
    enum string. `verdict` is the ONLY field that may hold the enum (agents
    re-translate it via /api/vocab).

    Guards the founder ruling: plain language on this public contract. If a
    future change routed the head off vocab, the raw enum would leak here.
    """
    from quire import vocab
    from quire.models import Classification, PRAnalysis, ReviewState

    for cls in Classification:
        v = vocab.verdict(cls.value)
        # Every classification maps to a real plain label (not the fallback-by-
        # accident enum, not an empty string).
        assert v["label"], f"{cls.value} has no plain label"
        assert cls.value != v["label"], f"{cls.value} label is the raw enum"

        # Build a minimal analysis carrying this classification and assemble the
        # verdict head exactly as review_detail does.
        a = PRAnalysis(
            analysis_id=str(_uuid.uuid4()),
            workflow_id="wf",
            repository="acme/widgets",
            pr_number=1,
            head_sha="h" * 40,
            base_sha="b" * 40,
            contract_snapshot_id="cs",
            analyzer_version="test",
            classification=cls,
            review_state=ReviewState.PENDING,
        )
        sentence = review._verdict_sentence(a, v)
        # The head reads in plain language; the raw enum appears nowhere in it.
        assert v["label"] in sentence
        assert cls.value not in sentence, (
            f"raw enum {cls.value!r} leaked into the verdict head: {sentence!r}"
        )
