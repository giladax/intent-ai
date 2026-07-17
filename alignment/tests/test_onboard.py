"""Onboarding: proactive source scan and approved-workspace writing."""

import pathlib
import subprocess

import yaml

from quire_align.adapters.git import GitWorkspace
from quire_align.onboard import recent_commits, scan_intent_sources, write_workspace

FIXTURE_REPO = pathlib.Path(__file__).parent.parent / "fixtures" / "refund-agent" / "repo" / "base"
REPO_ROOT = pathlib.Path(__file__).parent.parent.parent


def test_scan_ranks_promise_dense_docs():
    sources = scan_intent_sources(REPO_ROOT / "alignment" / "fixtures" / "refund-agent")
    paths = [s["path"] for s in sources]
    assert any("refund-policy-prd.md" in p for p in paths)
    top = sources[0]
    assert top["promise_hits"] > 0 and top["score"] > 0


def test_recent_commits_reads_git_log():
    commits = recent_commits(REPO_ROOT)
    assert len(commits) == 10
    assert all(len(c["sha"]) == 40 and c["subject"] for c in commits)


def test_write_workspace_produces_loadable_git_workspace(tmp_path):
    # throwaway repo with one doc and two commits
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "-C", str(repo), "init", "-q"], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.email", "t@t"], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.name", "t"], check=True)
    (repo / "policy.md").write_text("# Policy\nRefunds must never exceed the limit.\n")
    (repo / "app.py").write_text("LIMIT = 50\n")
    subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-qm", "base"], check=True)
    (repo / "app.py").write_text("LIMIT = 100\n")
    subprocess.run(["git", "-C", str(repo), "commit", "-aqm", "raise limit"], check=True)
    head = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True
    ).stdout.strip()

    out = write_workspace(
        tmp_path / "workspaces",
        "acme-app",
        repo,
        sources=[{"reference": "policy", "path": "policy.md", "version": "1"}],
        obligations=[
            {
                "obligation_id": "OB-1",
                "kind": "hard_rule",
                "statement": "Refunds must never exceed the limit.",
                "source_reference": "policy",
                "source_section": "",
                "revision": "onboard-1",
            }
        ],
        control_points=[
            {"control_point_id": "CP-app", "role": "decision", "path": "app.py", "description": "limit"}
        ],
        bindings=[{"obligation_id": "OB-1", "control_point_id": "CP-app", "relation": "decides"}],
        sweep_commits=[{"sha": head, "subject": "raise limit"}],
    )

    workspace = GitWorkspace(out)
    assert workspace.repository() == "acme-app"
    assert [o.obligation_id for o in workspace.obligations()] == ["OB-1"]
    artifacts = workspace.requirement_artifacts()
    assert artifacts[0].authority.value == "approved"
    pr = workspace.get_pr(1)
    assert pr.head_sha == head
    assert workspace.changed_files(pr) == ["app.py"]
    prs = yaml.safe_load((out / "prs.yaml").read_text())
    assert prs[1]["title"] == "raise limit"
