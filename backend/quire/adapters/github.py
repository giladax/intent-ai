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

from quire.adapters.fixture import FixtureWorkspace
from quire.models import Issue, PullRequest

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

    def _get_paginated(self, path: str) -> list[dict]:
        """Collect every page of a list endpoint — GitHub caps a page at
        100 items, and stopping there silently truncates large PRs."""
        items: list[dict] = []
        page = 1
        while True:
            batch = self._get(path, params={"per_page": 100, "page": page}).json()
            items.extend(batch)
            if len(batch) < 100:
                return items
            page += 1

    def list_prs(
        self,
        state: str = "all",
        per_page: int = 100,
        max_pages: int = 5,
    ) -> list[dict]:
        """List PRs for this repository.

        Returns raw GitHub PR summary dicts (number, title, state, head/base
        sha, author login, created_at, html_url). Callers that need full
        PullRequest objects should call get_pr(n) per number.

        Args:
            state: "open" | "closed" | "all" (GitHub default).
            per_page: Items per page (GitHub max 100).
            max_pages: Hard cap on pages fetched to bound token spend.
                       A shallow listing for the demo only needs the
                       first few pages; set higher for sync jobs.
        Returns:
            List of dicts with keys: number, title, state, head_sha,
            base_sha, author, created_at, html_url.
        """
        items: list[dict] = []
        page = 1
        while page <= max_pages:
            batch = self._get(
                f"/repos/{self.repo}/pulls",
                params={"state": state, "per_page": per_page, "page": page, "sort": "created", "direction": "desc"},
            ).json()
            for pr in batch:
                items.append({
                    "number": pr["number"],
                    "title": pr.get("title", ""),
                    "state": pr.get("state", ""),
                    "head_sha": (pr.get("head") or {}).get("sha", ""),
                    "base_sha": (pr.get("base") or {}).get("sha", ""),
                    "author": (pr.get("user") or {}).get("login", ""),
                    "created_at": pr.get("created_at", ""),
                    "html_url": pr.get("html_url", ""),
                })
            if len(batch) < per_page:
                break
            page += 1
        return items

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
        return self._get_paginated(f"/repos/{self.repo}/pulls/{pr_number}/files")

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
        if data.get("truncated"):
            # A truncated tree would make coverage / control-point existence
            # checks silently wrong — fail loudly instead.
            raise RuntimeError(
                f"GitHub tree listing for {self.repo}@{sha[:12]} is truncated "
                "(repo too large for the recursive trees API); refusing to "
                "analyze against an incomplete file listing"
            )
        return sorted(
            entry["path"] for entry in data.get("tree", []) if entry["type"] == "blob"
        )

    # -- publishing --------------------------------------------------------------

    def publish_comment(self, pr: PullRequest, body: str, marker: str) -> str:
        """Upsert the alignment comment on the PR: update our existing
        marker-tagged comment in place, or create one. Returns the comment URL."""
        existing = self._get_paginated(f"/repos/{self.repo}/issues/{pr.number}/comments")
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
