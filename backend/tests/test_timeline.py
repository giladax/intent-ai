from quire.analysis.graph import run_analysis
from quire.canned import fake_for_pr
from quire.store import Store
from quire.timeline import UNOBSERVED, build_timeline


def _analyses(refund_workspace, store, pr_numbers):
    out = []
    for n in pr_numbers:
        out.append(run_analysis(refund_workspace, n, llm=fake_for_pr(n), store=store))
    return out


def test_timeline_folds_state_and_marks_changes(refund_workspace, tmp_path):
    store = Store(url=f"sqlite:///{tmp_path}/t.db")
    analyses = _analyses(refund_workspace, store, [101, 102, 111])
    timeline = build_timeline(refund_workspace, analyses)

    assert timeline["workflow_id"] == "refund-agent"
    assert len(timeline["events"]) == 3
    e1, e2, e3 = timeline["events"]

    # event 1: demo PARTIAL — OB-101 unobserved → partially_satisfies
    assert e1["verdict"] == "PARTIAL"
    assert {"obligation_id": "OB-101", "from": UNOBSERVED}.items() <= {
        k: v for k, v in e1["changes"][0].items() if k in ("obligation_id", "from")
    }.items()
    assert e1["state_after"]["OB-101"]["status"] == "partially_satisfies"

    # event 2: aligned — OB-101 flips to satisfies; the change is recorded
    flipped = {c["obligation_id"]: (c["from"], c["to"]) for c in e2["changes"]}
    assert flipped["OB-101"] == ("partially_satisfies", "satisfies")
    assert e2["state_after"]["OB-101"]["status"] == "satisfies"
    assert e2["state_after"]["OB-101"]["since"] == 102

    # event 3: ungoverned — no intent-state change, but an open finding
    assert e3["verdict"] == "UNGOVERNED"
    assert e3["changes"] == []
    assert any(f["pr_number"] == 111 for f in e3["open_findings"])

    # untouched obligations stay unobserved throughout
    assert e3["state_after"]["OB-107"]["status"] == UNOBSERVED

    # contract stable across the three → no revision markers
    assert not any(e["contract_changed"] for e in timeline["events"])
    assert len(timeline["contract_versions"]) == 1

    # top-down: obligations carry their bound control points
    ob101 = next(o for o in timeline["obligations"] if o["obligation_id"] == "OB-101")
    assert any(cp["relation"] == "verifies" for cp in ob101["control_points"])


def test_cached_timeline_reflects_review_of_an_older_check(refund_workspace, tmp_path):
    """The analyses fingerprint must catch update_review — the one
    in-place mutation the store allows keeps both the row count and every
    created_at, so a (count, max created_at) signature kept serving the
    pre-review timeline after a human reviewed any non-newest check."""
    from quire.models import ReviewState
    from quire.timeline import cached_timeline

    store = Store(url=f"sqlite:///{tmp_path}/t.db")
    _analyses(refund_workspace, store, [101, 111])
    analyses = store.list_analyses(repository=refund_workspace.repository())
    cached_timeline(refund_workspace, analyses)  # warm the cache

    older = min(analyses, key=lambda a: a.created_at)
    store.update_review(older.analysis_id, ReviewState.APPROVED, reviewer="gilad")
    refreshed = store.list_analyses(repository=refund_workspace.repository())
    events = cached_timeline(refund_workspace, refreshed)["events"]
    reviewed = next(e for e in events if e["analysis_id"] == older.analysis_id)
    assert reviewed["review_state"] == "approved"
