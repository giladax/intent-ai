"""Onboarding: proactive source scan and approved-workspace writing."""

import pathlib
import subprocess

import yaml

from quire.adapters.git import GitWorkspace
from quire.onboard import recent_commits, scan_intent_sources, write_workspace

FIXTURE_REPO = pathlib.Path(__file__).parent.parent / "fixtures" / "refund-agent" / "repo" / "base"
REPO_ROOT = pathlib.Path(__file__).parent.parent.parent


def test_scan_ranks_promise_dense_docs():
    sources = scan_intent_sources(REPO_ROOT / "backend" / "fixtures" / "refund-agent")
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

    out, id_map = write_workspace(
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

    assert id_map == {"OB-1": "ACMEAP-001"}  # constraints get remapped with this
    workspace = GitWorkspace(out)
    assert workspace.repository() == "acme-app"
    # draft ids are re-minted at approval time — human-facing, workflow-scoped
    assert [o.obligation_id for o in workspace.obligations()] == ["ACMEAP-001"]
    binding = workspace.bindings()[0]
    assert binding.obligation_id == "ACMEAP-001"
    artifacts = workspace.requirement_artifacts()
    assert artifacts[0].authority.value == "approved"
    pr = workspace.get_pr(1)
    assert pr.head_sha == head
    assert workspace.changed_files(pr) == ["app.py"]
    prs = yaml.safe_load((out / "prs.yaml").read_text())
    assert prs[1]["title"] == "raise limit"


def test_write_workspace_refuses_duplicate_draft_ids(tmp_path):
    """Two docs' OB-DRAFT-001s must never collapse into one ledger id —
    and the refusal happens before anything touches disk."""
    import pytest

    with pytest.raises(ValueError, match="duplicate draft obligation ids"):
        write_workspace(
            tmp_path / "workspaces",
            "acme-app",
            tmp_path,
            sources=[],
            obligations=[
                {"obligation_id": "OB-DRAFT-001"},
                {"obligation_id": "OB-DRAFT-001"},
            ],
            control_points=[],
            bindings=[],
            sweep_commits=[],
        )
    assert not (tmp_path / "workspaces").exists()


def test_duplicate_draft_ids_surface_as_400(tmp_path, monkeypatch):
    """The operator's mistake comes back as a clean 400 with the refusal
    text, never a 500."""
    from fastapi.testclient import TestClient

    import quire.api as api_mod
    from quire.store import Store

    monkeypatch.setattr(api_mod, "WORKSPACES", tmp_path / "workspaces")
    client = TestClient(api_mod.create_app(store=Store(url=f"sqlite:///{tmp_path}/t.db")))
    response = client.post(
        "/api/onboard/create",
        json={
            "repo": str(tmp_path),
            "workflow_id": "acme-app",
            "sources": [],
            "obligations": [
                {"obligation_id": "OB-DRAFT-001"},
                {"obligation_id": "OB-DRAFT-001"},
            ],
            "control_points": [],
            "bindings": [],
        },
    )
    assert response.status_code == 400


def test_write_workspace_provider_parameter(tmp_path):
    """write_workspace writes the provider field from the parameter, not hardcoded."""
    import yaml
    from quire.onboard import write_workspace

    # Minimal repo dir for the relative path helper
    repo = tmp_path / "repo"
    repo.mkdir()
    ws_root = tmp_path / "workspaces"

    out, _id_map = write_workspace(
        workspaces_root=ws_root,
        workflow_id="test-github-ws",
        repo=repo,
        sources=[{"reference": "CONTRIBUTING.md", "path": "CONTRIBUTING.md"}],
        obligations=[{"obligation_id": "OB-DRAFT-1", "statement": "must do X", "kind": "behavioral"}],
        control_points=[],
        bindings=[],
        sweep_commits=[],
        provider="github",
    )

    data = yaml.safe_load((out / "workflow.yaml").read_text())
    assert data["requirements"]["provider"] == "github"
    # repositories block also uses the parameter
    assert data["repositories"][0]["provider"] == "github"


def test_scan_excludes_license_files(tmp_path):
    """scan_intent_sources never ranks LICENSE*, COPYING*, NOTICE*, CODE_OF_CONDUCT* files."""
    repo = tmp_path / "repo"
    repo.mkdir()

    # A dense promise-word LICENSE file that would outscore a real PRD without the filter.
    (repo / "LICENSE.txt").write_text(
        "MIT License\n\nPermission is hereby granted, free of charge, to any person "
        "obtaining a copy of this software and associated documentation files (the "
        '"Software"), to deal in the Software without restriction, including without '
        "limitation the rights to use, copy, modify, merge, publish, distribute, "
        "sublicense, and/or sell copies of the Software, and to permit persons to "
        "whom the Software is furnished to do so, subject to the following conditions:\n\n"
        "The above copyright notice and this permission notice shall be included in all "
        "copies or substantial portions of the Software.\n\n"
        "THE SOFTWARE IS PROVIDED AS IS, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR "
        "IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, "
        "FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT. IN NO EVENT SHALL THE "
        "AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER "
        "LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, "
        "OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN "
        "THE SOFTWARE.\n"
    )

    # A README with some promise words — should be ranked.
    (repo / "README.md").write_text(
        "# Refund Agent\n\n"
        "This service must process refunds within 24 hours. Refunds shall never exceed "
        "the approved limit. The system is required to log every transaction and must "
        "never allow unauthorized access. Approved amounts are enforced at the gateway.\n"
        "Constraints apply to all environments. This policy must be followed at all times.\n"
    )

    sources = scan_intent_sources(repo, extra_skip_parts=set())
    paths = [s["path"] for s in sources]

    assert not any("LICENSE" in p.upper() for p in paths), (
        f"LICENSE file must be excluded from intent sources, but got: {paths}"
    )
    assert any("README" in p.upper() for p in paths), (
        f"README.md should be included in intent sources, but got: {paths}"
    )


def test_scan_excludes_all_license_variants(tmp_path):
    """COPYING.txt, NOTICE.md, CODE_OF_CONDUCT.md are all excluded from intent scan."""
    repo = tmp_path / "repo"
    repo.mkdir()

    boilerplate_text = (
        "This license shall be enforced. You must comply. Required by law. "
        "Approved by the board. Never violate these terms. Always follow them. "
        "Enforcement is guaranteed. This constraint is binding on all parties. "
        "Approval is required. Violations are forbidden. Policy must be followed.\n"
    ) * 5  # repeat to exceed the 40-word minimum

    (repo / "COPYING.txt").write_text(boilerplate_text)
    (repo / "NOTICE.md").write_text(boilerplate_text)
    (repo / "CODE_OF_CONDUCT.md").write_text(boilerplate_text)
    (repo / "README.md").write_text(
        ("# Product\n\nThis product must work. It shall scale. Required features.\n") * 5
    )

    sources = scan_intent_sources(repo, extra_skip_parts=set())
    paths = [s["path"] for s in sources]

    for excluded in ("COPYING", "NOTICE", "CODE_OF_CONDUCT"):
        assert not any(excluded in p.upper() for p in paths), (
            f"{excluded} file must be excluded, but got: {paths}"
        )
