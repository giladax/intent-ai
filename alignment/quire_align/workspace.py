"""Workspace resolution and adapter construction — shared by CLI and API.

One place decides how a workspace name maps to a directory and which
provider adapter serves it (previously copy-pasted four times, and the
``github`` provider was never dispatched at all, making ``--publish``
unreachable).
"""

from __future__ import annotations

import pathlib

import yaml

_ROOT = pathlib.Path(__file__).parent.parent
FIXTURES = _ROOT / "fixtures"
WORKSPACES = _ROOT / "workspaces"

_env_loaded = False


def load_env() -> None:
    """Load credentials once: repo-root .env (ANTHROPIC_API_KEY,
    LANGSMITH_*, GITHUB_TOKEN) then any local .env overrides."""
    global _env_loaded
    if _env_loaded:
        return
    from dotenv import load_dotenv

    load_dotenv(_ROOT.parent / ".env")
    load_dotenv()
    _env_loaded = True


def resolve_workspace_dir(workspace: str | pathlib.Path) -> pathlib.Path:
    """Map a workspace argument (explicit path, fixture name, or
    workspaces/ name) to its directory. Raises FileNotFoundError with the
    searched locations when nothing matches."""
    for candidate in (
        pathlib.Path(workspace),
        FIXTURES / str(workspace),
        WORKSPACES / str(workspace),
    ):
        if (candidate / "workflow.yaml").exists():
            return candidate
    raise FileNotFoundError(
        f"no workflow.yaml under '{workspace}' (searched the given path, "
        f"{FIXTURES}, and {WORKSPACES})"
    )


def build_adapter(workspace: str | pathlib.Path):
    """Resolve the workspace dir and build the adapter its manifest asks
    for: git → GitWorkspace, github → GitHubWorkspace (publishing-capable),
    anything else → FixtureWorkspace."""
    path = resolve_workspace_dir(workspace)
    manifest = yaml.safe_load((path / "workflow.yaml").read_text())
    provider = manifest["repositories"][0]["provider"]
    if provider == "git":
        from quire_align.adapters.git import GitWorkspace

        return GitWorkspace(path)
    if provider == "github":
        from quire_align.adapters.github import GitHubWorkspace

        return GitHubWorkspace(path)
    from quire_align.adapters.fixture import FixtureWorkspace

    return FixtureWorkspace(path)
