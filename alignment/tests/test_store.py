import pytest

from quire_align.analysis.graph import run_analysis
from quire_align.models import Classification, ReviewState
from quire_align.store import Store

from quire_align.canned import fake_for_pr


@pytest.fixture
def store(tmp_path):
    return Store(url=f"sqlite:///{tmp_path}/test.db")


def test_analysis_roundtrip_and_idempotent_upsert(refund_workspace, store):
    analysis = run_analysis(refund_workspace, 101, llm=fake_for_pr(101), store=store)
    loaded = store.get_analysis(analysis.analysis_id)
    assert loaded is not None
    assert loaded.classification == Classification.PARTIAL
    assert loaded.comment_markdown == analysis.comment_markdown

    store.save_analysis(analysis)  # same identity again — upsert, not duplicate
    assert len(store.list_analyses(repository="company/refund-agent", pr_number=101)) == 1


def test_second_run_returns_cached_without_llm_calls(refund_workspace, store):
    first = run_analysis(refund_workspace, 101, llm=fake_for_pr(101), store=store)
    fake = fake_for_pr(101)
    second = run_analysis(refund_workspace, 101, llm=fake, store=store)
    assert second.analysis_id == first.analysis_id
    assert fake.calls == []  # cache hit — no inference re-run


def test_force_reruns_despite_cache(refund_workspace, store):
    run_analysis(refund_workspace, 101, llm=fake_for_pr(101), store=store)
    fake = fake_for_pr(101)
    run_analysis(refund_workspace, 101, llm=fake, store=store, force=True)
    assert "infer_delta" in fake.calls


def test_snapshots_and_contract_persisted(refund_workspace, store):
    analysis = run_analysis(refund_workspace, 101, llm=fake_for_pr(101), store=store)
    for snapshot_id in analysis.artifact_snapshot_ids:
        assert store.get_snapshot(snapshot_id) is not None


def test_review_state_persists(refund_workspace, store):
    analysis = run_analysis(refund_workspace, 101, llm=fake_for_pr(101), store=store)
    assert analysis.review_state == ReviewState.PENDING

    store.update_review(analysis.analysis_id, ReviewState.APPROVED, "gilad", "guard PR follows")
    loaded = store.get_analysis(analysis.analysis_id)
    assert loaded.review_state == ReviewState.APPROVED
    assert loaded.reviewer == "gilad"
    assert loaded.review_note == "guard PR follows"

    with pytest.raises(KeyError):
        store.update_review("nope", ReviewState.APPROVED, "gilad")
