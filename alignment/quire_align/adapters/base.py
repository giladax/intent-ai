"""Provider adapter contract.

Adapters supply raw material (manifest, PRs, files, requirements, issues,
obligations, bindings); all analysis logic lives in `quire_align.analysis`
and must not know which provider it is talking to.
"""

from __future__ import annotations

from typing import Protocol

from quire_align.manifest import WorkflowManifest
from quire_align.models import (
    ArtifactSnapshot,
    Binding,
    ControlPoint,
    Issue,
    Obligation,
    PullRequest,
)


class WorkspaceAdapter(Protocol):
    """Everything the analyzer needs about one onboarded workflow."""

    def manifest(self) -> WorkflowManifest: ...

    def repository(self) -> str: ...

    def get_pr(self, pr_number: int) -> PullRequest: ...

    def changed_files(self, pr: PullRequest) -> list[str]:
        """Paths touched by the PR (modified, added, or deleted)."""
        ...

    def file_content(self, pr: PullRequest, path: str, ref: str) -> str | None:
        """Content of `path` at `ref` ("base" | "head"); None if absent."""
        ...

    def diff(self, pr: PullRequest) -> str:
        """Unified diff of the PR."""
        ...

    def requirement_artifacts(self) -> list[ArtifactSnapshot]:
        """All requirement artifacts within the workflow's configured scope,
        with provider-asserted authority (approved/draft/stale)."""
        ...

    def issue(self, key: str) -> Issue | None: ...

    def obligations(self) -> list[Obligation]: ...

    def control_points(self) -> list[ControlPoint]: ...

    def bindings(self) -> list[Binding]: ...

    def list_paths(self, pr: PullRequest, ref: str) -> list[str]:
        """Repo file listing at `ref` — used only for eval-source glob
        matching and control-point existence checks, never for indexing."""
        ...
