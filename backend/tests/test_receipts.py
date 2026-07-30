"""Slice 2 of the Working Edition: check receipts — one run's complete
chain of observation, addressable by the number every surface cites."""

import pathlib

from fastapi.testclient import TestClient

from quire.analysis.graph import run_analysis
from quire.api import create_app
from quire.canned import fake_for_pr
from quire.store import Store

FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"


def test_receipt_carries_the_chain(refund_workspace, tmp_path):
    store = Store(url=f"sqlite:///{tmp_path}/t.db")
    analysis = run_analysis(
        refund_workspace, 101, llm=fake_for_pr(101), store=store
    )
    client = TestClient(create_app(store=store))
    r = client.get(f"/api/checks/{FIXTURES / 'refund-agent'}/101")
    assert r.status_code == 200
    receipt = r.json()
    assert receipt["check"] == 101
    assert receipt["analysis_id"] == analysis.analysis_id
    assert receipt["commit"] == analysis.head_sha
    assert receipt["analyzer_version"] == analysis.analyzer_version
    assert receipt["verdict"]  # display language, never the raw enum alone
    # Plain language on every public contract: the receipt speaks the
    # founder-ruled words (vocab.label), never the shouty legacy labels.
    from quire import vocab
    assert receipt["verdict"] == vocab.label(receipt["classification"])
    # PR 101 partly keeps its promise — "Partly kept", not "PARTIAL".
    assert receipt["verdict"] == "Partly kept"
    finding = next(f for f in receipt["findings"] if f["promise"] == "OB-101")
    assert finding["statement"].startswith("Premium-tier")
    assert finding["citations"], "a relation-asserting finding cites its evidence"
    assert all("reference" in c for c in finding["citations"])


def test_unknown_check_refuses(refund_workspace, tmp_path):
    client = TestClient(create_app(store=Store(url=f"sqlite:///{tmp_path}/t.db")))
    r = client.get(f"/api/checks/{FIXTURES / 'refund-agent'}/999")
    assert r.status_code == 404
    assert "no check #999" in r.json()["detail"]


def test_obligation_accepts_provenance_quote_alias():
    from quire.models import Obligation

    o = Obligation.model_validate({
        "obligation_id": "OB-1", "workflow_id": "w", "statement": "s",
        "kind": "hard_rule", "source_reference": "prd",
        "provenance_quote": "the exact sentence",
    })
    assert o.source_quote == "the exact sentence"
