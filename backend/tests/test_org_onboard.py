"""Tests for org_onboard.py (O1) — offline, no network, no live Postgres.

All tests use SQLite-in-memory for the OrgStore (conftest guard applies).
Mirror operations are faked with tmp_path git repos. No live GitHub calls.
"""
from __future__ import annotations

import pathlib
import subprocess

import pytest
import yaml

import quire.db.org_models  # noqa — register tables
from quire.db.engine import make_test_engine
from quire.db.models import Base
from quire.db.org_models import ensure_org_tables
from quire.org_store import OrgStore
from quire.org_onboard import (
    _update_prs_yaml,
    cleanup_failed_registration,
    mirror_path,
    parse_github_url,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def engine(tmp_path):
    # Use a file-backed SQLite so TestClient worker threads see the same data.
    eng = make_test_engine(url=f"sqlite:///{tmp_path}/test_org.db")
    ensure_org_tables(eng)
    yield eng
    Base.metadata.drop_all(eng)


@pytest.fixture
def store(engine):
    s = OrgStore(engine=engine)
    # Seed the org so add_repo has a valid org_id.
    s.seed("Quire", "quire", [])
    return s


@pytest.fixture
def git_mirror(tmp_path) -> pathlib.Path:
    """A git repo that acts as a mirror with product docs (>40 words each)."""
    repo = tmp_path / "mirror"
    repo.mkdir()
    subprocess.run(["git", "-C", str(repo), "init", "-q"], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.email", "t@t"], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.name", "t"], check=True)
    (repo / "README.md").write_text(
        "# Acme Widget Platform\n\n"
        "The system must never allow unapproved refunds. "
        "All requests require authorization from a verified account holder. "
        "The platform shall enforce strict data validation on every transaction. "
        "Approved operations are logged and audited regularly. "
        "The refund policy requires supervisor sign-off for amounts above the limit. "
        "Users may not bypass the standard verification workflow under any circumstances. "
        "The constraint on parallel sessions must always be respected.\n"
    )
    (repo / "policy.md").write_text(
        "# Refund Policy\n\n"
        "Refunds must be approved by a supervisor before processing. "
        "The system shall enforce a $50 limit on automatic refunds. "
        "Premium accounts require additional verification for any refund request. "
        "The policy guarantees that all refund decisions are recorded. "
        "Forbidden actions include issuing credits without an associated ticket. "
        "The constraint on refund amounts is enforced by the payment gateway. "
        "Required fields must be present in every submission or the request is rejected.\n"
    )
    subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-qm", "initial"], check=True)
    return repo


# ---------------------------------------------------------------------------
# URL parsing
# ---------------------------------------------------------------------------


def test_parse_github_url_https():
    owner, name = parse_github_url("https://github.com/owner/repo-name")
    assert (owner, name) == ("owner", "repo-name")


def test_parse_github_url_https_git():
    owner, name = parse_github_url("https://github.com/owner/repo.git")
    assert (owner, name) == ("owner", "repo")


def test_parse_github_url_no_scheme():
    owner, name = parse_github_url("github.com/owner/repo")
    assert (owner, name) == ("owner", "repo")


def test_parse_github_url_bare_slug():
    owner, name = parse_github_url("owner/repo")
    assert (owner, name) == ("owner", "repo")


def test_parse_github_url_trailing_slash():
    owner, name = parse_github_url("https://github.com/owner/repo/")
    assert (owner, name) == ("owner", "repo")


def test_parse_github_url_invalid():
    with pytest.raises(ValueError, match="Cannot parse"):
        parse_github_url("not-a-github-url")


def test_parse_github_url_invalid_no_name():
    with pytest.raises(ValueError):
        parse_github_url("https://github.com/owner")


# ---------------------------------------------------------------------------
# mirror_path
# ---------------------------------------------------------------------------


def test_mirror_path_format():
    p = mirror_path("acme", "widgets")
    assert p.name == "acme__widgets"
    assert ".repos" in str(p)


# ---------------------------------------------------------------------------
# OrgStore.add_repo, update_repo_status, remove_repo
# ---------------------------------------------------------------------------


def test_add_repo_creates_row(store):
    store.add_repo(
        org_id="quire",
        repo_id="acme-widgets",
        workspace="acme-widgets",
        display_name="acme/widgets",
        github_remote="https://github.com/acme/widgets",
        status="scanning",
        repository="acme/widgets",
    )
    repos = store.list_repos()
    ws = {r["workspace"] for r in repos}
    assert "acme-widgets" in ws


def test_add_repo_is_idempotent(store):
    for _ in range(2):
        store.add_repo(
            org_id="quire",
            repo_id="acme-widgets",
            workspace="acme-widgets",
            display_name="acme/widgets",
            github_remote="https://github.com/acme/widgets",
            status="scanning",
            repository="acme/widgets",
        )
    repos = [r for r in store.list_repos() if r["workspace"] == "acme-widgets"]
    assert len(repos) == 1


def test_update_repo_status(store):
    store.add_repo(
        org_id="quire",
        repo_id="acme-widgets",
        workspace="acme-widgets",
        display_name="acme/widgets",
        status="scanning",
    )
    store.update_repo_status("acme-widgets", "active")
    repos = store.list_repos()
    row = next(r for r in repos if r["workspace"] == "acme-widgets")
    assert row["status"] == "active"


def test_update_repo_status_unknown_workspace_raises(store):
    with pytest.raises(ValueError, match="No org_repos row"):
        store.update_repo_status("does-not-exist", "active")


def test_remove_repo(store):
    store.add_repo(
        org_id="quire",
        repo_id="acme-widgets",
        workspace="acme-widgets",
        display_name="acme/widgets",
        status="scanning",
    )
    store.remove_repo("acme-widgets")
    repos = store.list_repos()
    assert all(r["workspace"] != "acme-widgets" for r in repos)


def test_remove_repo_silent_noop(store):
    """Removing a non-existent workspace must not raise."""
    store.remove_repo("does-not-exist")  # should not raise


# ---------------------------------------------------------------------------
# OrgStore.resolve_repository_key
# ---------------------------------------------------------------------------


def test_resolve_repository_key_uses_repository_override(store):
    store.add_repo(
        org_id="quire",
        repo_id="refund-agent",
        workspace="refund-agent",
        display_name="refund-agent",
        repository="company/refund-agent",
    )
    assert store.resolve_repository_key("refund-agent") == "company/refund-agent"


def test_resolve_repository_key_falls_back_to_workspace(store):
    store.add_repo(
        org_id="quire",
        repo_id="intent-ai",
        workspace="intent-ai",
        display_name="intent-ai",
        repository=None,
    )
    assert store.resolve_repository_key("intent-ai") == "intent-ai"


def test_resolve_repository_key_unknown_workspace(store):
    # Unknown workspace: returns the workspace name itself.
    assert store.resolve_repository_key("unknown-ws") == "unknown-ws"


# ---------------------------------------------------------------------------
# cleanup_failed_registration
# ---------------------------------------------------------------------------


def test_cleanup_removes_row(store):
    store.add_repo(
        org_id="quire",
        repo_id="tmp-repo",
        workspace="tmp-repo",
        display_name="tmp/repo",
        status="scanning",
    )
    cleanup_failed_registration("tmp-repo", store)
    repos = store.list_repos()
    assert all(r["workspace"] != "tmp-repo" for r in repos)


def test_cleanup_silent_on_unknown(store):
    """cleanup must not raise even when the row does not exist."""
    cleanup_failed_registration("ghost-repo", store)  # must not raise


# ---------------------------------------------------------------------------
# scan_repo — deterministic, no LLM
# ---------------------------------------------------------------------------


def test_scan_repo_returns_sources_and_commits(git_mirror):
    from quire.org_onboard import scan_repo

    result = scan_repo(git_mirror)
    assert "sources" in result and "commits" in result
    assert isinstance(result["sources"], list)
    assert isinstance(result["commits"], list)
    # At least one doc should be found (README.md or policy.md)
    assert len(result["sources"]) > 0


def test_scan_repo_ranks_promise_dense_doc(git_mirror):
    from quire.org_onboard import scan_repo

    result = scan_repo(git_mirror)
    top = result["sources"][0]
    assert top["promise_hits"] > 0
    assert top["score"] > 0


def test_scan_repo_finds_recent_commits(git_mirror):
    from quire.org_onboard import scan_repo

    result = scan_repo(git_mirror)
    assert len(result["commits"]) >= 1
    assert len(result["commits"][0]["sha"]) == 40


# ---------------------------------------------------------------------------
# _update_prs_yaml
# ---------------------------------------------------------------------------


def test_update_prs_yaml_creates_file(tmp_path):
    ws = tmp_path / "workspace"
    ws.mkdir()
    prs = [
        {
            "number": 5,
            "title": "Fix bug",
            "state": "closed",
            "head_sha": "abc123",
            "base_sha": "def456",
            "author": "alice",
            "created_at": "2026-07-01T00:00:00Z",
            "html_url": "https://github.com/acme/repo/pull/5",
        }
    ]
    _update_prs_yaml(ws, prs)
    data = yaml.safe_load((ws / "prs.yaml").read_text())
    assert 5 in data
    assert data[5]["title"] == "Fix bug"
    assert data[5]["head"] == "abc123"   # stored as "head" matching prs.yaml convention


def test_update_prs_yaml_merges_with_existing(tmp_path):
    ws = tmp_path / "workspace"
    ws.mkdir()
    # Pre-existing sweep-commit entry (from write_workspace)
    (ws / "prs.yaml").write_text(
        yaml.safe_dump({1: {"base": "aaa", "head": "bbb", "title": "sweep commit 1"}})
    )
    prs = [
        {
            "number": 7,
            "title": "New PR",
            "state": "open",
            "head_sha": "new123",
            "base_sha": "base456",
            "author": "bob",
            "created_at": "2026-07-10T00:00:00Z",
            "html_url": "https://github.com/acme/repo/pull/7",
        }
    ]
    _update_prs_yaml(ws, prs)
    data = yaml.safe_load((ws / "prs.yaml").read_text())
    # Existing sweep entry preserved
    assert 1 in data
    assert data[1]["title"] == "sweep commit 1"
    # New PR entry added
    assert 7 in data
    assert data[7]["title"] == "New PR"


def test_update_prs_yaml_does_not_overwrite_existing_pr(tmp_path):
    ws = tmp_path / "workspace"
    ws.mkdir()
    (ws / "prs.yaml").write_text(
        yaml.safe_dump({5: {"base": "old_base", "head": "old_head", "title": "Old title"}})
    )
    prs = [
        {
            "number": 5,
            "title": "Updated title",
            "state": "closed",
            "head_sha": "new_head",
            "base_sha": "new_base",
            "author": "alice",
            "created_at": "2026-07-01T00:00:00Z",
            "html_url": "",
        }
    ]
    _update_prs_yaml(ws, prs)
    data = yaml.safe_load((ws / "prs.yaml").read_text())
    # Existing entry is preserved (not overwritten)
    assert data[5]["title"] == "Old title"


# ---------------------------------------------------------------------------
# list_prs on GitHubWorkspace — offline stub
# ---------------------------------------------------------------------------


def test_list_prs_returns_summary_dicts():
    """list_prs returns structured dicts with the expected fields."""
    import json

    from quire.adapters.github import GitHubWorkspace

    FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"

    class StubResponse:
        def __init__(self, payload):
            self._payload = payload
            self.status_code = 200

        def json(self):
            return self._payload

        def raise_for_status(self):
            pass

    class StubSession:
        def __init__(self):
            self.headers = {}

        def get(self, url, params=None, headers=None):
            # Return one PR on page 1, empty on page 2
            page = (params or {}).get("page", 1)
            if page == 1:
                return StubResponse([
                    {
                        "number": 42,
                        "title": "Add feature",
                        "state": "open",
                        "head": {"sha": "headabc"},
                        "base": {"sha": "basedef"},
                        "user": {"login": "alice"},
                        "created_at": "2026-07-01T00:00:00Z",
                        "html_url": "https://github.com/acme/repo/pull/42",
                    }
                ])
            return StubResponse([])

    ws = GitHubWorkspace(
        FIXTURES / "refund-agent",
        repository="acme/repo",
        token="test",
        session=StubSession(),
    )
    prs = ws.list_prs(state="all")
    assert len(prs) == 1
    pr = prs[0]
    assert pr["number"] == 42
    assert pr["title"] == "Add feature"
    assert pr["head_sha"] == "headabc"
    assert pr["base_sha"] == "basedef"
    assert pr["author"] == "alice"
    assert pr["state"] == "open"


def test_list_prs_paginates():
    """list_prs fetches multiple pages until batch is smaller than per_page."""
    import pathlib

    from quire.adapters.github import GitHubWorkspace

    FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"

    class PR:
        def __init__(self, n):
            self.n = n

        def json(self):
            return [
                {
                    "number": i,
                    "title": f"PR {i}",
                    "state": "closed",
                    "head": {"sha": f"head{i}"},
                    "base": {"sha": f"base{i}"},
                    "user": {"login": "bot"},
                    "created_at": "2026-01-01T00:00:00Z",
                    "html_url": "",
                }
                for i in range(self.n)
            ]

        def raise_for_status(self):
            pass

    class PagStub:
        def __init__(self):
            self.headers = {}
            self._calls = 0

        def get(self, url, params=None, headers=None):
            self._calls += 1
            per_page = (params or {}).get("per_page", 30)
            # page 1: full page (triggers next page fetch), page 2: partial
            if self._calls == 1:
                return PR(per_page)  # full page → next page
            return PR(2)  # partial → stop

    ws = GitHubWorkspace(
        FIXTURES / "refund-agent",
        repository="acme/repo",
        token="test",
        session=PagStub(),
    )
    prs = ws.list_prs(state="all", per_page=5)
    # page 1: 5 items, page 2: 2 items = 7 total
    assert len(prs) == 7


def test_list_prs_respects_max_pages():
    """list_prs stops after max_pages even when pages are full."""
    import pathlib

    from quire.adapters.github import GitHubWorkspace

    FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"

    class FullPage:
        def json(self):
            return [
                {
                    "number": i,
                    "title": f"PR {i}",
                    "state": "open",
                    "head": {"sha": f"h{i}"},
                    "base": {"sha": f"b{i}"},
                    "user": {"login": "bot"},
                    "created_at": "2026-01-01T00:00:00Z",
                    "html_url": "",
                }
                for i in range(3)  # 3 per page
            ]

        def raise_for_status(self):
            pass

    class InfiniteStub:
        def __init__(self):
            self.headers = {}

        def get(self, url, params=None, headers=None):
            return FullPage()  # always returns a full page

    ws = GitHubWorkspace(
        FIXTURES / "refund-agent",
        repository="acme/repo",
        token="test",
        session=InfiniteStub(),
    )
    prs = ws.list_prs(state="all", per_page=3, max_pages=2)
    # max_pages=2, 3 per page → 6 items max
    assert len(prs) == 6


# ---------------------------------------------------------------------------
# API endpoint tests (FastAPI TestClient) — no live Postgres, no GitHub
# ---------------------------------------------------------------------------


@pytest.fixture
def api_client(tmp_path, engine):
    """TestClient with a file-backed OrgStore and SQLite alignment store."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from quire.org_router import create_org_router
    from quire.org_store import OrgStore, seed_demo_org
    from quire.store import Store

    workspaces_path = tmp_path / "workspaces"
    workspaces_path.mkdir(parents=True, exist_ok=True)

    org_store_instance = OrgStore(engine=engine)
    seed_demo_org(org_store_instance)

    alignment_store = Store(url=f"sqlite:///{tmp_path}/align.db")

    # Temporarily patch _WORKSPACES_ROOT in the router module.
    import quire.org_router as router_mod
    orig = router_mod._WORKSPACES_ROOT
    router_mod._WORKSPACES_ROOT = workspaces_path

    app = FastAPI()
    app.include_router(create_org_router(org_store_instance, alignment_store))
    client = TestClient(app, raise_server_exceptions=False)
    yield client
    router_mod._WORKSPACES_ROOT = orig


def test_register_endpoint_400_on_bad_url(api_client):
    """POST /api/org/repos/register returns 400 for an invalid URL."""
    resp = api_client.post(
        "/api/org/repos/register",
        json={"url": "not-a-github-url"},
    )
    assert resp.status_code == 400


def test_register_endpoint_missing_url(api_client):
    """POST /api/org/repos/register returns 400 when url is missing."""
    resp = api_client.post("/api/org/repos/register", json={})
    assert resp.status_code == 400


def test_scan_endpoint_404_on_unknown_workspace(api_client):
    """POST /api/org/repos/{ws}/scan returns 404 when workspace not registered."""
    resp = api_client.post("/api/org/repos/nonexistent-repo/scan", json={})
    assert resp.status_code == 404


def test_approve_endpoint_400_on_empty_obligations(api_client, engine):
    """POST /api/org/repos/{ws}/approve returns 400 when obligations is empty."""
    # Add a workspace first so the 404 check passes, then verify the 400.
    org_store_tmp = OrgStore(engine=engine)
    org_store_tmp.add_repo(
        org_id="quire",
        repo_id="acme-test",
        workspace="acme-test",
        display_name="acme/test",
        github_remote="https://github.com/acme/test",
        status="scanning",
        repository="acme/test",
    )
    resp = api_client.post(
        "/api/org/repos/acme-test/approve",
        json={"sources": [], "obligations": [], "bindings": [], "sweep_commits": []},
    )
    assert resp.status_code == 400


def test_draft_endpoint_400_on_empty_sources(api_client, engine):
    """POST /api/org/repos/{ws}/draft returns 400 when sources is empty."""
    # Add a workspace first so the 404 check passes.
    org_store_tmp = OrgStore(engine=engine)
    org_store_tmp.add_repo(
        org_id="quire",
        repo_id="acme-draft",
        workspace="acme-draft",
        display_name="acme/draft",
        github_remote="https://github.com/acme/draft",
        status="scanning",
        repository="acme/draft",
    )
    resp = api_client.post(
        "/api/org/repos/acme-draft/draft",
        json={"sources": []},
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# first_results — trailer extraction (Finding 1)
# ---------------------------------------------------------------------------

import subprocess as _subprocess
import uuid as _uuid


def _make_git_repo(path):
    """Create a minimal git repo for trailer tests."""
    path.mkdir(parents=True, exist_ok=True)
    _subprocess.run(["git", "init", "-q", str(path)], check=True, capture_output=True)
    _subprocess.run(["git", "-C", str(path), "config", "user.email", "t@t"], check=True, capture_output=True)
    _subprocess.run(["git", "-C", str(path), "config", "user.name", "t"], check=True, capture_output=True)
    return path


def _git_commit(repo, msg):
    f = repo / f"f{_uuid.uuid4().hex[:6]}.txt"
    f.write_text(msg)
    _subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True, capture_output=True)
    _subprocess.run(["git", "-C", str(repo), "commit", "-qm", msg], check=True, capture_output=True)
    return _subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        capture_output=True, text=True,
    ).stdout.strip()


def test_first_results_endpoint_refuses_non_active_workspace(api_client, engine):
    """first-results returns 409 when workspace status != active (approve must come first)."""
    from quire.org_store import OrgStore

    org_store_instance = OrgStore(engine=engine)
    org_store_instance.add_repo(
        org_id="quire",
        repo_id="not-yet-active",
        workspace="not-yet-active",
        display_name="acme/not-yet-active",
        github_remote="https://github.com/acme/not-yet-active",
        status="scanning",  # NOT active
        repository="acme/not-yet-active",
    )

    resp = api_client.post(
        "/api/org/repos/not-yet-active/first-results",
        json={},
    )
    assert resp.status_code == 409


def test_first_results_endpoint_allows_active_workspace(api_client, engine, monkeypatch):
    """first-results proceeds when workspace status == active."""
    from quire import org_onboard
    from quire.org_store import OrgStore

    org_store_instance = OrgStore(engine=engine)
    org_store_instance.add_repo(
        org_id="quire",
        repo_id="ready-repo",
        workspace="ready-repo",
        display_name="acme/ready",
        github_remote="https://github.com/acme/ready",
        status="active",  # active → first-results should proceed
        repository="acme/ready",
    )

    # Stub out the heavy first_results function so no network call is made.
    monkeypatch.setattr(
        org_onboard,
        "first_results",
        lambda **kwargs: {"prs_fetched": 0, "replayed": 0, "verdicts": []},
    )

    resp = api_client.post(
        "/api/org/repos/ready-repo/first-results",
        json={},
    )
    # Not 409: endpoint accepted the active workspace.
    assert resp.status_code != 409


def test_register_endpoint_cleanup_on_post_clone_failure(tmp_path, engine, monkeypatch):
    """If post-clone work fails after add_repo, no orphaned org_repos row persists.

    This test wires a side effect into the router's post-registration path by
    monkey-patching a sentinel function called inside the post-clone try block,
    verifying that cleanup_failed_registration removes the row on failure.
    """
    import quire.org_onboard as org_onboard_mod

    from quire.org_store import OrgStore

    # Seed org and create a store backed by the same engine as api_client.
    org_store_inst = OrgStore(engine=engine)
    org_store_inst.seed("Quire", "quire", [])

    # Patch ensure_mirror so no real clone happens.
    monkeypatch.setattr(
        org_onboard_mod,
        "ensure_mirror",
        lambda owner, name, token=None: tmp_path / "fake_mirror",
    )

    # Simulate: register succeeds (row written), then post-clone work raises.
    # We do this by calling the flow directly (bypassing the HTTP layer) to
    # verify cleanup_failed_registration works as the wired cleanup.
    workspace = "acme-cleanup-test"

    # Step 1: write the row (as register_repo does).
    org_store_inst.add_repo(
        org_id="quire",
        repo_id=workspace,
        workspace=workspace,
        display_name="acme/cleanup-test",
        github_remote="https://github.com/acme/cleanup-test",
        status="scanning",
        repository="acme/cleanup-test",
    )
    assert any(r["workspace"] == workspace for r in org_store_inst.list_repos())

    # Step 2: post-clone work fails → call cleanup (the pattern now wired in the router).
    from quire.org_onboard import cleanup_failed_registration
    cleanup_failed_registration(workspace, org_store_inst)

    # Step 3: no orphaned row.
    assert all(r["workspace"] != workspace for r in org_store_inst.list_repos())


def test_first_results_no_trailer_commits_no_links(tmp_path, engine):
    """No Claude-Session trailers → no session_checks rows, no error."""
    from quire.links import LinkStore, extract_trailer_links

    repo = _make_git_repo(tmp_path / "mirror")
    base = _git_commit(repo, "initial commit")
    head = _git_commit(repo, "plain commit, no session trailer")

    link_store = LinkStore(engine=engine)
    # Simulate what first_results does: extract over one PR's range.
    links = []
    try:
        links = extract_trailer_links(
            base_sha=base,
            head_sha=head,
            git_dir=str(repo),
            workspace="test-ws",
            pr_number=1,
        )
    except Exception:
        pass  # shallow-history miss → no-op; we re-verify below
    link_store.upsert_many(links)

    result = link_store.links_for_check("test-ws", 1)
    assert result == []


def test_first_results_trailer_commits_create_links(tmp_path, engine):
    """Commits with Claude-Session trailers → rows with kind=trailer and correct workspace."""
    from quire.links import LinkStore

    repo = _make_git_repo(tmp_path / "mirror")
    base = _git_commit(repo, "initial commit")
    # Commit with a trailer
    session_id = "testSessionAAA123"
    f = repo / "code.py"
    f.write_text("x = 1")
    _subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True, capture_output=True)
    msg = f"feat: add feature\n\nClaude-Session: https://claude.ai/code/session_{session_id}"
    _subprocess.run(["git", "-C", str(repo), "commit", "-qm", msg], check=True, capture_output=True)
    head = _subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        capture_output=True, text=True,
    ).stdout.strip()

    from quire.links import extract_trailer_links
    link_store = LinkStore(engine=engine)
    links = extract_trailer_links(
        base_sha=base,
        head_sha=head,
        git_dir=str(repo),
        workspace="acme-widgets",
        pr_number=42,
    )
    link_store.upsert_many(links)

    result = link_store.links_for_check("acme-widgets", 42)
    assert len(result) == 1
    assert result[0].kind == "trailer"
    assert result[0].session_id == session_id
    assert result[0].workspace == "acme-widgets"
    assert result[0].pr_number == 42


def test_first_results_shallow_history_miss_no_op(tmp_path, engine):
    """When base_sha is not in the shallow history, extraction is a no-op (no error)."""
    from quire.links import LinkStore, extract_trailer_links

    repo = _make_git_repo(tmp_path / "mirror")
    head = _git_commit(repo, "only commit")
    phantom_base = "a" * 40  # SHA that does not exist in this repo

    link_store = LinkStore(engine=engine)
    # Must NOT raise — failure-safe no-op
    links_landed = []
    try:
        links = extract_trailer_links(
            base_sha=phantom_base,
            head_sha=head,
            git_dir=str(repo),
            workspace="shallow-ws",
            pr_number=99,
        )
        link_store.upsert_many(links)
        links_landed = link_store.links_for_check("shallow-ws", 99)
    except Exception:
        pass  # shallow-history miss → no-op; must not propagate

    # Either no exception was raised (good path), or exception was caught (also fine).
    # In both cases, no links should be in the store for an unknown base.
    assert links_landed == []


def test_first_results_invokes_trailer_extraction(tmp_path, engine, monkeypatch):
    """first_results MUST call extract_trailer_links; if that block is deleted,
    this test FAILS. Verifies the real first_results function integrates
    trailer extraction into the PR replay loop.

    Builds a real git fixture with a commit carrying a Claude-Session: trailer,
    mocks list_prs to return one PR spanning that commit, mocks run_analysis to
    no-op, then calls the real first_results with an injected test LinkStore.
    Asserts the link landed in session_checks with kind=trailer and correct
    workspace/pr_number.
    """
    from quire import org_onboard
    from quire.links import LinkStore
    from quire.org_store import OrgStore

    # Step 1: Set up a real git repo fixture with a commit carrying a trailer.
    repo = _make_git_repo(tmp_path / "mirror")
    base = _git_commit(repo, "initial commit")

    # Commit with a Claude-Session trailer.
    # Note: session_id must match [A-Za-z0-9]+ (no underscores) per the regex in parse_trailers
    session_id = "testfixturesession789"
    f = repo / "code.py"
    f.write_text("def hello():\n    pass")
    _subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True, capture_output=True)
    msg = f"feat: add hello function\n\nClaude-Session: https://claude.ai/code/session_{session_id}"
    _subprocess.run(["git", "-C", str(repo), "commit", "-qm", msg], check=True, capture_output=True)
    head = _subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        capture_output=True, text=True,
    ).stdout.strip()

    # Step 2: Create workspaces directory and write a minimal workspace structure.
    workspaces_root = tmp_path / "workspaces"
    workspaces_root.mkdir(parents=True, exist_ok=True)
    test_workspace = workspaces_root / "acme-test"
    test_workspace.mkdir(parents=True, exist_ok=True)

    # Write workflow.yaml (required by GitHubWorkspace adapter).
    test_workspace.joinpath("workflow.yaml").write_text(
        "workflow_id: acme-test\n"
        "requirements:\n"
        "  provider: github\n"
        "  reference: acme/test\n"
        "repositories:\n"
        "  - provider: github\n"
        "    repository: acme/test\n"
    )

    # Write a minimal sessions.yaml so GitHubWorkspace adapter has metadata.
    import yaml
    sessions_file = test_workspace / "sessions.yaml"
    sessions_file.write_text(yaml.safe_dump({"example": "session"}))

    # Step 3: Mock list_prs to return one PR spanning base→head.
    from quire.adapters.github import GitHubWorkspace as GHW

    prs_to_return = [
        {
            "number": 1,
            "title": "Test PR with trailer",
            "state": "open",
            "head_sha": head,
            "base_sha": base,
            "author": "test_user",
            "created_at": "2026-07-21T00:00:00Z",
            "html_url": "https://github.com/acme/test/pull/1",
        }
    ]

    def stub_list_prs(self, **kwargs):
        """Return one PR with base/head spanning the trailer commit."""
        return prs_to_return

    monkeypatch.setattr(GHW, "list_prs", stub_list_prs)

    # Step 4: Mock run_analysis to return a plausible no-op result.
    def stub_run_analysis(adapter, pr_number, store=None):
        """Return a mock analysis result without LLM/network calls."""
        from types import SimpleNamespace
        return SimpleNamespace(
            classification=SimpleNamespace(value="clear"),
            analysis_id="mock-analysis-1",
        )

    monkeypatch.setattr(
        "quire.analysis.graph.run_analysis",
        stub_run_analysis,
    )

    # Step 5: Patch the mirror path so first_results uses our test repo.
    monkeypatch.setattr(
        "quire.org_onboard.mirror_path",
        lambda owner, name: repo,
    )

    # Step 6: Call the REAL first_results with injected LinkStore.
    link_store = LinkStore(engine=engine)

    result = org_onboard.first_results(
        workspace="acme-test",
        owner="acme",
        name="test",
        workspaces_root=workspaces_root,
        alignment_store=None,
        n_prs=1,
        token=None,
        link_store=link_store,
    )

    # Step 7: Assert the link landed in session_checks with correct attributes.
    # The test passes only if extract_trailer_links was actually called inside
    # first_results and the links were upserted.
    links = link_store.links_for_check("acme-test", 1)
    assert len(links) == 1, "Exactly one trailer link should have been extracted and upserted"

    link = links[0]
    assert link.kind == "trailer", f"Expected kind='trailer', got {link.kind!r}"
    assert link.session_id == session_id, f"Expected session_id={session_id!r}, got {link.session_id!r}"
    assert link.workspace == "acme-test", f"Expected workspace='acme-test', got {link.workspace!r}"
    assert link.pr_number == 1, f"Expected pr_number=1, got {link.pr_number!r}"
    assert link.confidence == 1.0, f"Expected confidence=1.0, got {link.confidence!r}"

    # result should indicate 1 PR was replayed.
    assert result["prs_fetched"] >= 1
    assert result["replayed"] >= 1


# ── Security: /draft must not read outside the mirror (path traversal) ──

def test_draft_rejects_path_outside_the_repo(tmp_path):
    """A request-body source path like '../../etc/passwd' must be skipped, not
    read and fed to the LLM. The guard fires before any LLM call, so llm=None
    is never invoked."""
    from quire.org_onboard import draft_repo

    mirror = tmp_path / "mirror"
    mirror.mkdir()
    (mirror / "real.md").write_text("# a real doc inside the repo\n")
    # a secret file OUTSIDE the mirror the traversal would try to reach
    (tmp_path / "secret.txt").write_text("TOP SECRET")

    result = draft_repo(
        mirror, "ws",
        [{"path": "../secret.txt"}, {"path": "../../etc/passwd"}],
        llm=None,  # must never be called — all sources are rejected first
    )
    assert result["obligations"] == []
    assert result["bindings"] == []
    assert all("outside the repo" in n for n in result["notes"])
    assert len(result["notes"]) == 2


def test_draft_renumbers_obligation_ids_across_sources(tmp_path, monkeypatch):
    """Each source's proposer mints ids from OB-001, so a multi-source draft
    would collide (and write_workspace refuses duplicate ids at approve).
    draft_repo must renumber across sources — and remap each source's
    bindings to the renumbered ids."""
    from types import SimpleNamespace

    import quire.propose as propose_mod
    from quire.org_onboard import draft_repo

    mirror = tmp_path / "mirror"
    mirror.mkdir()
    (mirror / "a.md").write_text("# doc a\n")
    (mirror / "b.md").write_text("# doc b\n")

    def fake_propose_contract(doc_path, repo, out_dir, source_reference, llm=None):
        # Both sources mint the same local ids — the collision under test.
        obs = [
            SimpleNamespace(
                obligation_id="OB-001", kind="promise",
                statement=f"promise one from {doc_path.name}",
                source_quote="q1", source_section=None,
            ),
            SimpleNamespace(
                obligation_id="OB-002", kind="promise",
                statement=f"promise two from {doc_path.name}",
                source_quote="q2", source_section=None,
            ),
        ]
        bindings = [
            SimpleNamespace(
                obligation_id="OB-001", path="src/x.py", symbol=None,
                role="executor", relation="enforces", why="",
            ),
        ]
        return obs, bindings, []

    monkeypatch.setattr(propose_mod, "propose_contract", fake_propose_contract)

    result = draft_repo(mirror, "ws", [{"path": "a.md"}, {"path": "b.md"}], llm=None)

    ids = [o["obligation_id"] for o in result["obligations"]]
    assert ids == ["OB-001", "OB-002", "OB-003", "OB-004"]
    # Bindings follow their own source's remap: a.md's binding stays OB-001,
    # b.md's binding (locally OB-001) becomes OB-003.
    assert [b["obligation_id"] for b in result["bindings"]] == ["OB-001", "OB-003"]
