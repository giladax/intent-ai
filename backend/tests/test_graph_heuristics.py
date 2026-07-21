"""LLM heuristic layer: naming precedence, pair hints, enum routing."""

import pathlib
import subprocess

import yaml

from quire.graph_heuristics import (
    FakeGraphHeuristics,
    adjudicate_borderline_pairs,
    enrich_workspace,
)
from quire.grouping import GroupingConstraints, group_contract
from quire.mirror import classify_question


def _ob(i, statement):
    return {"obligation_id": f"OB-{i}", "statement": statement}


def _b(ob, path):
    return {"obligation_id": ob, "path": path, "relation": "decides"}


def test_label_precedence_human_over_llm_over_tfidf():
    obligations = [_ob(1, "refund ceiling premium policy limit")]
    bindings = [_b("OB-1", "a/policy.py")]
    tfidf = group_contract(obligations, bindings)["groups"][0]["label"]
    assert "/" in tfidf  # auto label is term salad

    llm = group_contract(obligations, bindings, llm_labels={"OB-1": "Refund Limits"})
    assert llm["groups"][0]["label"] == "Refund Limits"

    human = group_contract(
        obligations,
        bindings,
        constraints=GroupingConstraints(labels={"OB-1": "Payments"}),
        llm_labels={"OB-1": "Refund Limits"},
    )
    assert human["groups"][0]["label"] == "Payments"  # human always wins


def test_pair_hints_shape_the_graph_softly():
    obligations = [
        _ob(1, "alpha widgets render dashboards quickly"),
        _ob(2, "beta billing charges customers monthly"),
    ]
    bindings = [_b("OB-1", "a/x.py"), _b("OB-2", "b/y.py")]
    apart = group_contract(obligations, bindings)
    assert len(apart["groups"]) == 2

    together = group_contract(
        obligations, bindings, pair_hints={"OB-1|OB-2": "same"}
    )
    assert len(together["groups"]) == 1  # adjudicated together

    # human cannot-link outranks an LLM "same" hint
    vetoed = group_contract(
        obligations,
        bindings,
        constraints=GroupingConstraints(cannot_link=[["OB-1", "OB-2"]]),
        pair_hints={"OB-1|OB-2": "same"},
    )
    assert len(vetoed["groups"]) == 2


def test_adjudication_only_in_borderline_window_and_cached():
    obligations = [
        _ob(1, "premium refund ceiling policy"),
        _ob(2, "premium refund ceiling guard"),   # high cosine → no call
        _ob(3, "notification email preferences"),  # low cosine → no call
        _ob(4, "refund notification emails for premium customers"),  # borderline
    ]
    calls = []

    class Spy(FakeGraphHeuristics):
        def judge_pair(self, a, b):
            calls.append((a[:20], b[:20]))
            return super().judge_pair(a, b)

    hints = adjudicate_borderline_pairs(obligations, {}, Spy())
    assert calls, "borderline pairs should be consulted"
    cached = adjudicate_borderline_pairs(obligations, hints, Spy())
    assert cached == hints  # second run: fully cached, no growth needed


def test_routing_closed_enum_and_collision_safety():
    # term_lookup from the router falls through to term resolution — a
    # question about an area literally named "Coverage" is not hijacked.
    router = FakeGraphHeuristics(
        routes={"is anything broken": "whats_broken", "coverage rules": "term_lookup"}
    ).route_question
    assert classify_question("is anything broken", router=router) == "whats_broken"
    assert classify_question("coverage rules", router=router) is None
    # offline fallback still routes obvious status phrasings
    assert classify_question("is anything violating a promise") == "whats_broken"


def test_enrich_workspace_names_and_persists(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "-C", str(repo), "init", "-q"], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.email", "t@t"], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.name", "t"], check=True)
    (repo / "policy.md").write_text("# P\nRefunds must never exceed the limit.\n")
    (repo / "app.py").write_text("LIMIT = 50\n")
    subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-qm", "base"], check=True)

    from quire.onboard import write_workspace

    ws, _ = write_workspace(
        tmp_path / "wss", "acme", repo,
        sources=[{"reference": "policy", "path": "policy.md", "version": "1"}],
        obligations=[{
            "obligation_id": "OB-1", "kind": "hard_rule",
            "statement": "Refunds must never exceed the limit.",
            "source_reference": "policy", "source_section": "", "revision": "1",
        }],
        control_points=[{"control_point_id": "CP-app", "role": "decision",
                         "path": "app.py", "description": "d"}],
        bindings=[{"obligation_id": "OB-1", "control_point_id": "CP-app",
                   "relation": "decides"}],
        sweep_commits=[],
    )
    from quire.adapters.git import GitWorkspace

    adapter = GitWorkspace(ws)
    out = enrich_workspace(
        ws, adapter, FakeGraphHeuristics(names={"ACME-001": "Refund Limits"})
    )
    assert out["groups"][0]["label"] == "Refund Limits"
    assert out["new_pair_hints"] == 0  # single promise → nothing to adjudicate
    assert out["named"] == {"ACME-001": "Refund Limits"}
    persisted = yaml.safe_load((ws / "groups.yaml").read_text())
    assert persisted["llm_labels"]["ACME-001"] == "Refund Limits"


def test_router_runtime_failure_falls_back_to_regex():
    def broken_router(q):
        raise RuntimeError("model unreachable mid-request")

    # A router blowing up must degrade to regex routing, not propagate.
    assert classify_question("is anything broken", router=broken_router) == "whats_broken"
    assert classify_question("what is coverage", router=broken_router) is None
