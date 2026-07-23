"""A2 — the review room's assembled contract.

The review room composes a stored PRAnalysis with the diff (re-derived live),
the human PR title (from the workspace registry), verbatim receipts, the
coverage gap, and "why the author did it" — all in plain language, ids as
footnotes. Deterministic: the refund-agent fixture + canned PR 101.
"""
import pathlib

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
