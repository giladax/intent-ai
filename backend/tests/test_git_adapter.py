"""GitWorkspace against a throwaway git repository."""

import subprocess

import pytest

from quire.adapters.git import GitWorkspace
from quire.models import Authority


def _git(repo, *args):
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)


@pytest.fixture
def git_workspace(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "t@t")
    _git(repo, "config", "user.name", "t")
    (repo / "policy.py").write_text("LIMIT = 50\n")
    (repo / "docs").mkdir()
    (repo / "docs" / "prd.md").write_text("# PRD\nApproved limit is $100.\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "base")
    base = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True
    ).stdout.strip()
    (repo / "policy.py").write_text("LIMIT = 100\n")
    _git(repo, "commit", "-aqm", "raise limit to 100\n\nper PRD")
    head = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True
    ).stdout.strip()

    ws = tmp_path / "ws"
    (ws / "issues").mkdir(parents=True)
    (ws / "workflow.yaml").write_text(
        "workflow_id: t\n"
        "requirements: {provider: git, reference: prd}\n"
        "repositories:\n  - {provider: git, repository: t, path: ../repo}\n"
        "eval_sources: []\n"
    )
    (ws / "requirements_index.yaml").write_text(
        "- {reference: prd, path: docs/prd.md, status: approved, version: '1'}\n"
    )
    (ws / "obligations.yaml").write_text(
        "obligations:\n"
        "  - {obligation_id: OB-1, kind: permission, statement: limit is $100,\n"
        "     source_reference: prd, revision: '1'}\n"
    )
    (ws / "bindings.yaml").write_text(
        "control_points:\n"
        "  - {control_point_id: CP-1, role: decision, path: policy.py}\n"
        "bindings:\n"
        "  - {obligation_id: OB-1, control_point_id: CP-1, relation: decides}\n"
    )
    (ws / "prs.yaml").write_text(f"1: {{base: {base}, head: {head}}}\n")
    return GitWorkspace(ws)


def test_pr_from_commit_range(git_workspace):
    pr = git_workspace.get_pr(1)
    assert pr.title == "raise limit to 100"
    assert pr.body == "per PRD"
    assert len(pr.head_sha) == 40 and pr.head_sha != pr.base_sha
    assert git_workspace.changed_files(pr) == ["policy.py"]


def test_content_and_diff_from_git(git_workspace):
    pr = git_workspace.get_pr(1)
    assert git_workspace.file_content(pr, "policy.py", "base") == "LIMIT = 50\n"
    assert git_workspace.file_content(pr, "policy.py", "head") == "LIMIT = 100\n"
    assert git_workspace.file_content(pr, "nope.py", "head") is None
    diff = git_workspace.diff(pr)
    assert "-LIMIT = 50" in diff and "+LIMIT = 100" in diff
    assert "policy.py" in git_workspace.list_paths(pr, "head")


def test_requirements_from_index(git_workspace):
    artifacts = git_workspace.requirement_artifacts()
    assert artifacts[0].reference == "prd"
    assert artifacts[0].authority == Authority.APPROVED
    assert "Approved limit is $100" in artifacts[0].content
    obligations = git_workspace.obligations()
    assert obligations[0].source_content_hash == artifacts[0].content_hash


def test_workspace_relative_source_resolves(git_workspace):
    """Authored sources saved into <workspace>/intent/ (the O4.5 authoring
    door) resolve via the workspace-relative fallback."""
    ws = git_workspace.root
    (ws / "intent").mkdir()
    (ws / "intent" / "authored.md").write_text("# Authored\nUsers must sign.\n")
    (ws / "requirements_index.yaml").write_text(
        "- {reference: prd, path: docs/prd.md, status: approved, version: '1'}\n"
        "- {reference: authored, path: intent/authored.md, status: draft, version: 'a1'}\n"
    )
    artifacts = git_workspace.requirement_artifacts()
    by_ref = {a.reference: a for a in artifacts}
    assert "Users must sign" in by_ref["authored"].content
    assert by_ref["authored"].authority == Authority.DRAFT
    assert by_ref["prd"].authority == Authority.APPROVED


def test_unresolvable_source_is_skipped_not_fatal(git_workspace):
    """A dangling sources entry must never take down the whole contract —
    the live bug: one bad path made obligations() raise for the workspace."""
    ws = git_workspace.root
    (ws / "requirements_index.yaml").write_text(
        "- {reference: prd, path: docs/prd.md, status: approved, version: '1'}\n"
        "- {reference: gone, path: nowhere/missing.md, status: draft, version: 'x'}\n"
    )
    artifacts = git_workspace.requirement_artifacts()
    assert [a.reference for a in artifacts] == ["prd"]
    # And the ledger still serves.
    assert git_workspace.obligations()
