"""Local-git workspace adapter — dogfooding without a GitHub PR.

Any base/head commit range in a local repository becomes an analyzable
"PR". The workspace directory carries the product side (manifest,
obligations, bindings, issues — same YAML layout as fixture workspaces)
plus:

    requirements_index.yaml   which repo files are approved intent sources
                              [{reference, path, status, version}]
    prs.yaml                  pr_number → {base, head, title?, body?, issue?}
                              (title/body default to the head commit message)

Repo location comes from the manifest: repositories[0].path, relative to
the workspace directory.
"""

from __future__ import annotations

import pathlib
import subprocess

import yaml

from quire_align.adapters.fixture import FixtureWorkspace
from quire_align.models import (
    ArtifactKind,
    ArtifactSnapshot,
    Authority,
    PullRequest,
)

_AUTHORITY_BY_STATUS = {
    "approved": Authority.APPROVED,
    "draft": Authority.DRAFT,
    "stale": Authority.STALE,
}


class GitWorkspace(FixtureWorkspace):
    def __init__(self, root: str | pathlib.Path) -> None:
        super().__init__(root)
        repo_ref = self._manifest.repositories[0]
        rel = getattr(repo_ref, "path", ".") or "."
        self.repo_dir = (self.root / rel).resolve()
        if not (self.repo_dir / ".git").exists():
            raise FileNotFoundError(f"{self.repo_dir} is not a git repository")

    def _git(self, *args: str) -> str:
        result = subprocess.run(
            ["git", "-C", str(self.repo_dir), *args],
            capture_output=True,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"git {' '.join(args)}: {result.stderr.decode('utf-8', 'replace').strip()}"
            )
        return result.stdout.decode("utf-8", "replace")

    def _git_text(self, *args: str) -> str | None:
        """Like _git, but returns None for binary content."""
        result = subprocess.run(
            ["git", "-C", str(self.repo_dir), *args], capture_output=True
        )
        if result.returncode != 0:
            return None
        try:
            return result.stdout.decode("utf-8")
        except UnicodeDecodeError:
            return None

    # -- pull requests: commit ranges from prs.yaml ---------------------------

    def get_pr(self, pr_number: int) -> PullRequest:
        entries = yaml.safe_load((self.root / "prs.yaml").read_text()) or {}
        entry = entries.get(pr_number)
        if entry is None:
            raise FileNotFoundError(f"no PR #{pr_number} in {self.root / 'prs.yaml'}")
        head = self._git("rev-parse", entry["head"]).strip()
        base = self._git("rev-parse", entry["base"]).strip()
        subject = self._git("log", "-1", "--format=%s", head).strip()
        body = self._git("log", "-1", "--format=%b", head).strip()
        return PullRequest(
            number=pr_number,
            title=entry.get("title") or subject,
            body=entry.get("body") or body,
            author=self._git("log", "-1", "--format=%an", head).strip(),
            base_sha=base,
            head_sha=head,
            issue_key=entry.get("issue", "") or "",
            deleted_files=[
                line.split("\t", 1)[1]
                for line in self._git(
                    "diff", "--name-status", f"{base}..{head}"
                ).splitlines()
                if line.startswith("D\t")
            ],
        )

    def changed_files(self, pr: PullRequest) -> list[str]:
        out = self._git("diff", "--name-only", f"{pr.base_sha}..{pr.head_sha}")
        return sorted(line for line in out.splitlines() if line)

    def file_content(self, pr: PullRequest, path: str, ref: str) -> str | None:
        sha = pr.base_sha if ref == "base" else pr.head_sha
        return self._git_text("show", f"{sha}:{path}")

    def diff(self, pr: PullRequest) -> str:
        return self._git("diff", f"{pr.base_sha}..{pr.head_sha}")

    def list_paths(self, pr: PullRequest, ref: str) -> list[str]:
        sha = pr.base_sha if ref == "base" else pr.head_sha
        return sorted(
            line
            for line in self._git("ls-tree", "-r", "--name-only", sha).splitlines()
            if line
        )

    # -- approved intent from the requirements index -------------------------

    def requirement_artifacts(self) -> list[ArtifactSnapshot]:
        index_path = self.root / "requirements_index.yaml"
        if not index_path.exists():
            return super().requirement_artifacts()
        artifacts = []
        for entry in yaml.safe_load(index_path.read_text()) or []:
            path = self.repo_dir / entry["path"]
            artifacts.append(
                ArtifactSnapshot(
                    provider="git",
                    reference=entry["reference"],
                    kind=ArtifactKind.REQUIREMENT,
                    uri=str(path),
                    content=path.read_text(),
                    revision=str(entry.get("version", "")),
                    authority=_AUTHORITY_BY_STATUS.get(
                        str(entry.get("status", "")).lower(), Authority.UNKNOWN
                    ),
                )
            )
        return artifacts
