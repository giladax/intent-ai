"""GitHub adapter against a stubbed transport — no network."""

import base64
import json
import pathlib

from quire.adapters.github import GitHubWorkspace

FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"


class StubResponse:
    def __init__(self, payload, status_code=200, text=None):
        self._payload = payload
        self.status_code = status_code
        self.text = text if text is not None else json.dumps(payload)

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class StubSession:
    def __init__(self, routes):
        self.routes = routes
        self.headers = {}
        self.writes = []  # (method, url, json)

    def get(self, url, params=None, headers=None):
        accept = (headers or {}).get("Accept", "")
        for (fragment, accept_match), response in self.routes.items():
            if fragment in url and (not accept_match or accept_match in accept):
                return response
        return StubResponse({}, status_code=404)

    def post(self, url, json=None):
        self.writes.append(("post", url, json))
        return StubResponse({"id": 9001, "html_url": "https://github/comment/9001"})

    def patch(self, url, json=None):
        self.writes.append(("patch", url, json))
        return StubResponse({"id": 9001, "html_url": "https://github/comment/9001"})


def _routes():
    diff_text = (
        "diff --git a/refund_agent/policy.py b/refund_agent/policy.py\n"
        "-    PREMIUM_MAX_AUTO_REFUND = 50.0\n"
        "+    PREMIUM_MAX_AUTO_REFUND = 100.0\n"
    )
    return {
        ("/pulls/7/files", ""): StubResponse(
            [
                {"filename": "refund_agent/policy.py", "status": "modified"},
                {"filename": "refund_agent/legacy_check.py", "status": "removed"},
            ]
        ),
        ("/pulls/7", "diff"): StubResponse({}, text=diff_text),
        ("/pulls/7", ""): StubResponse(
            {
                "title": "Raise premium refund limit (REF-42)",
                "body": "Implements REF-42 per PRD v3.",
                "user": {"login": "dev-alice"},
                "base": {"sha": "basesha123"},
                "head": {"sha": "headsha456"},
            }
        ),
        ("/contents/refund_agent/policy.py", ""): StubResponse(
            {"content": base64.b64encode(b"PREMIUM = 100.0\n").decode()}
        ),
        ("/git/trees/headsha456", ""): StubResponse(
            {
                "tree": [
                    {"path": "refund_agent/policy.py", "type": "blob"},
                    {"path": "refund_agent", "type": "tree"},
                ]
            }
        ),
    }


def make_workspace():
    return GitHubWorkspace(
        FIXTURES / "refund-agent",
        repository="company/refund-agent",
        token="test-token",
        session=StubSession(_routes()),
    )


def test_pr_metadata_issue_link_and_deletions():
    workspace = make_workspace()
    pr = workspace.get_pr(7)
    assert pr.head_sha == "headsha456"
    assert pr.issue_key == "REF-42"  # extracted via work-tracking project prefix
    assert pr.deleted_files == ["refund_agent/legacy_check.py"]
    assert workspace.changed_files(pr) == [
        "refund_agent/legacy_check.py",
        "refund_agent/policy.py",
    ]


def test_contents_diff_and_tree():
    workspace = make_workspace()
    pr = workspace.get_pr(7)
    assert workspace.file_content(pr, "refund_agent/policy.py", "head") == "PREMIUM = 100.0\n"
    assert workspace.file_content(pr, "refund_agent/legacy_check.py", "head") is None
    assert "+    PREMIUM_MAX_AUTO_REFUND = 100.0" in workspace.diff(pr)
    assert workspace.list_paths(pr, "head") == ["refund_agent/policy.py"]


def test_product_side_stays_local():
    workspace = make_workspace()
    assert len(workspace.obligations()) == 6
    references = {a.reference for a in workspace.requirement_artifacts()}
    assert "refund-policy-prd" in references


def test_publish_comment_creates_then_updates():
    marker = "<!-- quire-align -->"
    routes = _routes()
    routes[("/issues/7/comments", "")] = StubResponse([])  # none yet -> POST
    workspace = GitHubWorkspace(
        FIXTURES / "refund-agent",
        repository="company/refund-agent",
        token="t",
        session=StubSession(routes),
    )
    pr = workspace.get_pr(7)
    url = workspace.publish_comment(pr, f"{marker}\nhello", marker)
    method, target, payload = workspace.session.writes[-1]
    assert (method, url) == ("post", "https://github/comment/9001")
    assert "/issues/7/comments" in target and marker in payload["body"]

    # An existing marker-tagged comment gets PATCHed in place.
    routes[("/issues/7/comments", "")] = StubResponse(
        [{"id": 42, "body": f"{marker}\nold verdict"}]
    )
    workspace = GitHubWorkspace(
        FIXTURES / "refund-agent",
        repository="company/refund-agent",
        token="t",
        session=StubSession(routes),
    )
    workspace.publish_comment(pr, f"{marker}\nupdated", marker)
    method, target, _ = workspace.session.writes[-1]
    assert method == "patch" and "/issues/comments/42" in target
