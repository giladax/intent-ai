"""Situation mirror — acceptance tests are the PM interrogation's failures.

The PM asked three questions the old front door answered wrongly or not at
all; these tests pin the corrected behavior (offline, canned analyses)."""

import pathlib

import pytest
from fastapi.testclient import TestClient

from quire.api import create_app
from quire.store import Store

FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"


@pytest.fixture
def client(tmp_path):
    store = Store(url=f"sqlite:///{tmp_path}/mirror.db")
    client = TestClient(create_app(store=store))
    # seed: 103 = hard-rule contradiction, 111 = uncovered surface, 102 = aligned
    for n in (103, 111, 102):
        r = client.post(
            "/analyses",
            json={"workspace": "refund-agent", "pr_number": n, "offline": True},
        )
        assert r.status_code == 200, r.text
    return client


def test_pm_q1_overview_returns_the_whole_map(client):
    """'What are the areas?' → the map with per-area health rollups,
    never a single force-resolved card."""
    d = client.get("/api/mirror/refund-agent").json()
    assert len(d["areas"]) >= 2
    assert all({"label", "promises", "rollup"} <= set(a) for a in d["areas"])
    # the same question through ask routes to the overview, not a card
    a = client.get("/api/ask/refund-agent", params={"q": "what are the product areas", "llm": False}).json()
    assert a["resolution"]["method"] == "status"
    assert a["resolution"]["route"] == "overview"
    assert a["card"] is None and "areas" in a["status_answer"]


def test_pm_q3_is_anything_violating_finds_the_contradiction(client):
    """The trust hazard: this question must surface the red promise, not
    imply all-quiet via an unrelated area card."""
    a = client.get("/api/ask/refund-agent", params={"q": "is anything violating a promise", "llm": False}).json()
    assert a["resolution"]["route"] == "whats_broken"
    answer = a["status_answer"]
    assert answer["red_flags"], "the contradiction must be surfaced"
    flagged = {f["obligation_id"] for f in answer["red_flags"]}
    assert "OB-102" in flagged  # the auto-approved high-risk hard rule
    assert "Yes" in answer["answer"]


def test_pm_q4_uncovered_changes_are_first_class(client):
    d = client.get("/api/ask/refund-agent", params={"q": "what happened recently that no intent covers", "llm": False}).json()
    assert d["resolution"]["route"] == "whats_uncovered"
    uncovered = d["status_answer"]["uncovered_changes"]
    assert any(u["pr_number"] == 111 for u in uncovered)
    assert "covers" in d["status_answer"]["answer"]


def test_pm_vocab_display_labels_everywhere(client):
    """One vocabulary: timeline events and cards carry the same display
    labels the CLI prints."""
    t = client.get("/api/intent/refund-agent/timeline").json()
    ungoverned = next(e for e in t["events"] if e["verdict"] == "UNGOVERNED")
    assert ungoverned["verdict_display"] == "NOT COVERED"
    card = client.get("/api/ask/refund-agent", params={"q": "high-risk approval", "llm": False}).json()["card"]
    if card:
        healths = [o["health"] for o in card["obligations"]]
        assert all("display" in h and "since_check" in h for h in healths)


def test_unresolved_suggests_nearest_areas(client):
    d = client.get("/api/ask/refund-agent", params={"q": "kubernetes", "llm": False}).json()
    assert d["resolution"]["method"] == "unresolved"
    assert "Nearest areas" in d["resolution"]["message"]
