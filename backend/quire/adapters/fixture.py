"""Fixture-backed workspace adapter.

Workspace directory layout:

    workflow.yaml
    obligations.yaml
    bindings.yaml
    requirements/*.md        (YAML frontmatter: reference, version, status)
    issues/<KEY>.yaml
    repo/base/**             full tree at the base SHA
    repo/prs/<n>/pr.yaml     PR metadata
    repo/prs/<n>/head/**     changed files at the head SHA (overrides base)
"""

from __future__ import annotations

import difflib
import pathlib

import yaml

from quire.manifest import WorkflowManifest, load_manifest
from quire.models import (
    ArtifactKind,
    ArtifactSnapshot,
    Authority,
    Binding,
    ControlPoint,
    Issue,
    Obligation,
    PullRequest,
)

_AUTHORITY_BY_STATUS = {
    "approved": Authority.APPROVED,
    "draft": Authority.DRAFT,
    "stale": Authority.STALE,
}

_IGNORED_PARTS = {"__pycache__", ".DS_Store", ".git"}


def _ignored(relpath: str) -> bool:
    return any(part in _IGNORED_PARTS for part in relpath.split("/"))


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """Split a markdown document into (frontmatter dict, body).

    Limitation: naive ``---`` split — a ``---`` inside the frontmatter block
    itself (e.g. a YAML document separator or a value containing the string)
    truncates the frontmatter early. Fine for the simple
    reference/version/status headers this MVP uses.
    """
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) == 3:
            return yaml.safe_load(parts[1]) or {}, parts[2].lstrip("\n")
    return {}, text


class FixtureWorkspace:
    def __init__(self, root: str | pathlib.Path) -> None:
        self.root = pathlib.Path(root)
        self._manifest = load_manifest(self.root / "workflow.yaml")

    # -- manifest / identity ------------------------------------------------

    def manifest(self) -> WorkflowManifest:
        return self._manifest

    def repository(self) -> str:
        return self._manifest.repositories[0].repository

    # -- pull requests -------------------------------------------------------

    def _pr_dir(self, pr_number: int) -> pathlib.Path:
        pr_dir = self.root / "repo" / "prs" / str(pr_number)
        if not pr_dir.exists():
            raise FileNotFoundError(f"no fixture PR #{pr_number} under {pr_dir}")
        return pr_dir

    def get_pr(self, pr_number: int) -> PullRequest:
        data = yaml.safe_load((self._pr_dir(pr_number) / "pr.yaml").read_text())
        return PullRequest(
            number=data["number"],
            title=data["title"],
            body=data.get("body", ""),
            author=data.get("author", ""),
            base_sha=data["base_sha"],
            head_sha=data["head_sha"],
            issue_key=data.get("issue", "") or "",
            deleted_files=data.get("deleted_files", []) or [],
        )

    def changed_files(self, pr: PullRequest) -> list[str]:
        head_dir = self._pr_dir(pr.number) / "head"
        changed = set(pr.deleted_files)
        if head_dir.exists():
            for path in head_dir.rglob("*"):
                rel = str(path.relative_to(head_dir))
                if path.is_file() and not _ignored(rel):
                    changed.add(rel)
        return sorted(changed)

    def file_content(self, pr: PullRequest, path: str, ref: str) -> str | None:
        base_file = self.root / "repo" / "base" / path
        if ref == "base":
            return base_file.read_text() if base_file.exists() else None
        if path in pr.deleted_files:
            return None
        head_file = self._pr_dir(pr.number) / "head" / path
        if head_file.exists():
            return head_file.read_text()
        return base_file.read_text() if base_file.exists() else None

    def diff(self, pr: PullRequest) -> str:
        chunks: list[str] = []
        for path in self.changed_files(pr):
            base = self.file_content(pr, path, "base")
            head = self.file_content(pr, path, "head")
            base_lines = base.splitlines(keepends=True) if base else []
            head_lines = head.splitlines(keepends=True) if head else []
            chunk = "".join(
                difflib.unified_diff(
                    base_lines,
                    head_lines,
                    fromfile=f"a/{path}" if base is not None else "/dev/null",
                    tofile=f"b/{path}" if head is not None else "/dev/null",
                )
            )
            if chunk:
                chunks.append(chunk)
        return "\n".join(chunks)

    def list_paths(self, pr: PullRequest, ref: str) -> list[str]:
        base_dir = self.root / "repo" / "base"
        paths = {
            str(p.relative_to(base_dir))
            for p in base_dir.rglob("*")
            if p.is_file() and not _ignored(str(p.relative_to(base_dir)))
        }
        if ref == "head":
            paths -= set(pr.deleted_files)
            head_dir = self._pr_dir(pr.number) / "head"
            if head_dir.exists():
                paths |= {
                    str(p.relative_to(head_dir))
                    for p in head_dir.rglob("*")
                    if p.is_file() and not _ignored(str(p.relative_to(head_dir)))
                }
        return sorted(paths)

    # -- product artifacts ----------------------------------------------------

    def requirement_artifacts(self) -> list[ArtifactSnapshot]:
        artifacts = []
        for path in sorted((self.root / "requirements").glob("*.md")):
            text = path.read_text()
            meta, _body = parse_frontmatter(text)
            artifacts.append(
                ArtifactSnapshot(
                    provider=self._manifest.requirements.provider,
                    reference=meta.get("reference", path.stem),
                    kind=ArtifactKind.REQUIREMENT,
                    uri=str(path),
                    content=text,
                    revision=str(meta.get("version", "")),
                    authority=_AUTHORITY_BY_STATUS.get(
                        str(meta.get("status", "")).lower(), Authority.UNKNOWN
                    ),
                )
            )
        return artifacts

    def issue(self, key: str) -> Issue | None:
        path = self.root / "issues" / f"{key}.yaml"
        if not path.exists():
            return None
        data = yaml.safe_load(path.read_text())
        return Issue(
            key=data["key"],
            title=data.get("title", ""),
            body=data.get("body", ""),
            requirements=data.get("requirements", []) or [],
        )

    # -- approved contract ------------------------------------------------------

    def obligations(self) -> list[Obligation]:
        data = yaml.safe_load((self.root / "obligations.yaml").read_text())
        artifacts = {a.reference: a for a in self.requirement_artifacts()}
        obligations = []
        for entry in data["obligations"]:
            source = artifacts.get(entry["source_reference"])
            obligations.append(
                Obligation(
                    workflow_id=self._manifest.workflow_id,
                    source_content_hash=source.content_hash if source else "",
                    **entry,
                )
            )
        return obligations

    def control_points(self) -> list[ControlPoint]:
        data = yaml.safe_load((self.root / "bindings.yaml").read_text())
        return [
            ControlPoint(workflow_id=self._manifest.workflow_id, **entry)
            for entry in data["control_points"]
        ]

    def bindings(self) -> list[Binding]:
        data = yaml.safe_load((self.root / "bindings.yaml").read_text())
        return [Binding(**entry) for entry in data["bindings"]]
