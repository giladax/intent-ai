"""Community card: resolution ladder, card assembly, alias learning."""

import pathlib

import pytest

from quire_align.analysis.graph import run_analysis
from quire_align.ask import (
    TermPick,
    community_card,
    load_group_state,
    resolve_term,
    save_alias,
)
from quire_align.canned import fake_for_pr
from quire_align.store import Store

FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"


@pytest.fixture
def state(refund_workspace):
    return load_group_state(FIXTURES / "refund-agent", refund_workspace)


@pytest.fixture
def obligations(refund_workspace):
    return [
        {"obligation_id": o.obligation_id, "statement": o.statement}
        for o in refund_workspace.obligations()
    ]


def test_lexical_resolution_no_llm(state, obligations):
    out = resolve_term("refund guard ceiling", state, obligations, llm_pick=None)
    assert out["method"] == "lexical"
    assert out["group"] is not None
    assert any("OB-101" in out["group"]["obligation_ids"] or "OB-103" in out["group"]["obligation_ids"]
               for _ in [0])


def test_unresolvable_term_stays_unresolved_without_llm(state, obligations):
    out = resolve_term("kubernetes ingress", state, obligations, llm_pick=None)
    assert out["group"] is None and out["method"] == "unresolved"


def test_llm_rung_can_only_pick_existing_groups(state, obligations):
    # the model tries to invent an area — resolution must reject it
    out = resolve_term(
        "chargebacks", state, obligations,
        llm_pick=lambda prompt: TermPick(anchor="OB-DOES-NOT-EXIST", confidence=0.9),
    )
    assert out["group"] is None

    # a valid pick resolves with the llm method
    anchor = state["groups"][0]["anchor"]
    out = resolve_term(
        "chargebacks", state, obligations,
        llm_pick=lambda prompt: TermPick(anchor=anchor, confidence=0.7),
    )
    assert out["method"] == "llm" and out["group"]["anchor"] == anchor


def test_alias_confirmed_then_deterministic(tmp_path, refund_workspace, obligations):
    ws = tmp_path / "ws"
    ws.mkdir()
    state = load_group_state(FIXTURES / "refund-agent", refund_workspace)
    anchor = state["groups"][0]["anchor"]
    save_alias(ws, "Payments", anchor)

    state2 = load_group_state(ws, refund_workspace) if (ws / "workflow.yaml").exists() else None
    # groups.yaml written under tmp ws; reload aliases from there directly
    import yaml

    data = yaml.safe_load((ws / "groups.yaml").read_text())
    assert data["aliases"]["payments"] == anchor

    state["aliases"] = data["aliases"]
    out = resolve_term("payments", state, obligations, llm_pick=None)
    assert out["method"] == "alias" and out["confidence"] == 1.0


def test_card_assembles_health_and_findings(refund_workspace, tmp_path, state):
    store = Store(url=f"sqlite:///{tmp_path}/ask.db")
    for n in (101, 111):
        run_analysis(refund_workspace, n, llm=fake_for_pr(n), store=store)
    group = next(g for g in state["groups"] if "OB-101" in g["obligation_ids"])
    card = community_card(refund_workspace, store, group, state)
    ob101 = next(o for o in card["obligations"] if o["obligation_id"] == "OB-101")
    assert ob101["health"]["status"] == "partially_satisfies"
    assert any(e["pr_number"] == 101 for e in card["recent_events"])
    assert card["files"]
