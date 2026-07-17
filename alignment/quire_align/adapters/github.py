"""Live GitHub adapter.

Product-side truth (manifest, requirements, obligations, bindings, issues)
stays in the local workspace directory — GitHub is not an authority on
approved intent. PR-side material (metadata, changed files, contents, diff,
tree) comes from the GitHub REST API when GITHUB_TOKEN is available.

Usage:
    workspace = GitHubWorkspace("fixtures/refund-agent", repository="org/repo")
    run_analysis(workspace, pr_number=123, ...)
"""

from __future__ import annotations

import base64
import os
import re

import requests

from quire_align.adapters.fixture import FixtureWorkspace
from quire_align.models import Issue, PullRequest

_API = "https://api.github.com"


class GitHubWorkspace:
    def __init__(
        self,
        workspace_dir: str,
        repository: str | None = None,
        token: str | None = None,
        session: requests.Session | None = None,
    ) -> None:
        self.local = FixtureWorkspace(workspace_dir)
        self.repo = repository or self.local.repository()
        self.session = session or requests.Session()
        token = token or os.environ.get("GITHUB_TOKEN", "")
        self.session.headers.update(
            {
                "Accept": "application/vnd.github+json",
                **({"Authorization": f"Bearer {token}"} if token else {}),
            }
        )
        self._issue_pattern = None
        manifest = self.local.manifest()
        if manifest.work_tracking is not None:
            self._issue_pattern = re.compile(
                rf"\b({re.escape(manifest.work_tracking.project)}-\d+)\b"
            )

    # -- product side: delegate to the local canonical workspace -------------

    def manifest(self):
        return self.local.manifest()

    def repository(self) -> str:
        return self.repo

    def requirement_artifacts(self):
        return self.local.requirement_artifacts()

    def issue(self, key: str) -> Issue | None:
        return self.local.issue(key)

    def obligations(self):
        return self.local.obligations()

    def control_points(self):
        return self.local.control_points()

    def bindings(self):
        return self.local.bindings()

    # -- PR side: GitHub REST -------------------------------------------------

    def _get(self, path: str, **kwargs):
        response = self.session.get(f"{_API}{path}", **kwargs)
        response.raise_for_status()
        return response

    def get_pr(self, pr_number: int) -> PullRequest:
        data = self._get(f"/repos/{self.repo}/pulls/{pr_number}").json()
        body = data.get("body") or ""
        issue_key = ""
        if self._issue_pattern:
            match = self._issue_pattern.search(f"{data['title']}\n{body}")
            issue_key = match.group(1) if match else ""
        deleted = [
            f["filename"] for f in self._files(pr_number) if f["status"] == "removed"
        ]
        return PullRequest(
            number=pr_number,
            title=data["title"],
            body=body,
            author=(data.get("user") or {}).get("login", ""),
            base_sha=data["base"]["sha"],
            head_sha=data["head"]["sha"],
            issue_key=issue_key,
            deleted_files=deleted,
        )

    def _files(self, pr_number: int) -> list[dict]:
        return self._get(
            f"/repos/{self.repo}/pulls/{pr_number}/files", params={"per_page": 100}
        ).json()

    def changed_files(self, pr: PullRequest) -> list[str]:
        return sorted(f["filename"] for f in self._files(pr.number))

    def file_content(self, pr: PullRequest, path: str, ref: str) -> str | None:
        sha = pr.base_sha if ref == "base" else pr.head_sha
        if ref == "head" and path in pr.deleted_files:
            return None
        response = self.session.get(
            f"{_API}/repos/{self.repo}/contents/{path}", params={"ref": sha}
        )
        if response.status_code == 404:
            return None
        response.raise_for_status()
        data = response.json()
        return base64.b64decode(data["content"]).decode("utf-8")

    def diff(self, pr: PullRequest) -> str:
        return self._get(
            f"/repos/{self.repo}/pulls/{pr.number}",
            headers={"Accept": "application/vnd.github.v3.diff"},
        ).text

    def list_paths(self, pr: PullRequest, ref: str) -> list[str]:
        sha = pr.base_sha if ref == "base" else pr.head_sha
        data = self._get(
            f"/repos/{self.repo}/git/trees/{sha}", params={"recursive": "1"}
        ).json()
        return sorted(
            entry["path"] for entry in data.get("tree", []) if entry["type"] == "blob"
        )

    # -- publishing --------------------------------------------------------------

    def publish_comment(self, pr: PullRequest, body: str, marker: str) -> str:
        """Upsert the alignment comment on the PR: update our existing
        marker-tagged comment in place, or create one. Returns the comment URL."""
        existing = self._get(
            f"/repos/{self.repo}/issues/{pr.number}/comments",
            params={"per_page": 100},
        ).json()
        ours = next((c for c in existing if marker in (c.get("body") or "")), None)
        if ours is not None:
            response = self.session.patch(
                f"{_API}/repos/{self.repo}/issues/comments/{ours['id']}",
                json={"body": body},
            )
        else:
            response = self.session.post(
                f"{_API}/repos/{self.repo}/issues/{pr.number}/comments",
                json={"body": body},
            )
        response.raise_for_status()
        return response.json().get("html_url", "")
