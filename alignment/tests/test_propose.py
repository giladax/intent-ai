"""Contract drafting: provenance-quote and path validation, draft output."""

import pathlib

import yaml

from quire_align.propose import (
    BindingCandidates,
    CandidateBinding,
    CandidateObligation,
    FakeProposer,
    ObligationCandidates,
    propose_contract,
    repo_tree,
    select_context_files,
)

FIXTURE_REPO = pathlib.Path(__file__).parent.parent / "fixtures" / "refund-agent" / "repo" / "base"
FIXTURE_PRD = (
    pathlib.Path(__file__).parent.parent
    / "fixtures"
    / "refund-agent"
    / "requirements"
    / "refund-policy-prd.md"
)


def _candidates():
    return ObligationCandidates(
        candidates=[
            CandidateObligation(
                obligation_id="OB-DRAFT-1",
                kind="hard_rule",
                statement="High-risk refund requests always require human approval.",
                source_quote="Refund requests flagged high-risk **always** require human approval,",
                source_section="High-risk handling",
            ),
            CandidateObligation(
                obligation_id="OB-DRAFT-2",
                kind="permission",
                statement="Premium low-risk customers may receive refunds up to $100.",
                source_quote="THIS QUOTE DOES NOT EXIST IN THE DOCUMENT",
            ),
        ]
    )


def _bindings():
    return BindingCandidates(
        candidates=[
            CandidateBinding(
                obligation_id="OB-DRAFT-1",
                path="refund_agent/policy.py",
                symbol="RefundPolicy.evaluate",
                role="decision",
                relation="decides",
                why="Routes high-risk requests to human approval.",
            ),
            CandidateBinding(
                obligation_id="OB-DRAFT-1",
                path="does/not/exist.py",
                role="enforcement",
                relation="enforces",
                why="hallucinated",
            ),
            CandidateBinding(
                obligation_id="OB-DRAFT-2",
                path="refund_agent/guard.py",
                role="enforcement",
                relation="enforces",
                why="binding to a dropped obligation",
            ),
        ]
    )


def test_propose_validates_provenance_and_paths(tmp_path):
    obligations, bindings, notes = propose_contract(
        FIXTURE_PRD,
        FIXTURE_REPO,
        tmp_path / "draft",
        "refund-policy-prd",
        llm=FakeProposer(_candidates(), _bindings()),
    )
    # fabricated quote dropped; hallucinated path dropped; orphan binding dropped
    assert [o.obligation_id for o in obligations] == ["OB-DRAFT-1"]
    assert [(b.obligation_id, b.path) for b in bindings] == [
        ("OB-DRAFT-1", "refund_agent/policy.py")
    ]
    assert len(notes) == 3

    drafted = yaml.safe_load((tmp_path / "draft" / "obligations.draft.yaml").read_text())
    assert "draft" in drafted["status"]
    assert drafted["obligations"][0]["provenance_quote"].startswith("Refund requests")
    bindings_doc = yaml.safe_load((tmp_path / "draft" / "bindings.draft.yaml").read_text())
    assert bindings_doc["control_points"][0]["path"] == "refund_agent/policy.py"
    assert (tmp_path / "draft" / "proposal-notes.txt").exists()


def test_repo_tree_and_context_selection():
    tree = repo_tree(FIXTURE_REPO)
    assert "refund_agent/policy.py" in tree
    assert not any("__pycache__" in p for p in tree)
    contents = select_context_files(FIXTURE_REPO, tree, _candidates().candidates)
    assert any("policy" in path for path in contents)
    assert len(contents) <= 10
