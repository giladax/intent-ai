"""Minimal HTTP API to run analyses and retrieve results."""

from __future__ import annotations

import pathlib

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from quire_align.adapters.fixture import FixtureWorkspace
from quire_align.models import ReviewState
from quire_align.store import Store

FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"
WORKSPACES = pathlib.Path(__file__).parent.parent / "workspaces"
STATIC = pathlib.Path(__file__).parent / "static"


class AnalyzeRequest(BaseModel):
    workspace: str  # workspace dir or fixture name
    pr_number: int
    offline: bool = False
    variant: str = "linear-v1"
    force: bool = False


class ReviewRequest(BaseModel):
    state: ReviewState
    reviewer: str
    note: str = ""


def create_app(store: Store | None = None) -> FastAPI:
    from dotenv import load_dotenv

    load_dotenv(pathlib.Path(__file__).parent.parent.parent / ".env")
    app = FastAPI(title="Quire Align", version="0.1.0")
    app.state.store = store or Store()

    def _adapter(workspace: str):
        path = pathlib.Path(workspace)
        for candidate in (path, FIXTURES / workspace, WORKSPACES / workspace):
            if (candidate / "workflow.yaml").exists():
                path = candidate
                break
        else:
            raise HTTPException(400, f"no workflow.yaml under {workspace}")
        import yaml

        provider = yaml.safe_load((path / "workflow.yaml").read_text())[
            "repositories"
        ][0]["provider"]
        if provider == "git":
            from quire_align.adapters.git import GitWorkspace

            return GitWorkspace(path)
        return FixtureWorkspace(path)

    @app.post("/analyses")
    def run(request: AnalyzeRequest):
        from quire_align.analysis.graph import run_analysis

        if request.offline:
            from quire_align.canned import fake_for_pr

            llm = fake_for_pr(request.pr_number)
        else:
            from quire_align.analysis.llm import AnthropicAlignmentLLM

            llm = AnthropicAlignmentLLM()
        analysis = run_analysis(
            _adapter(request.workspace),
            request.pr_number,
            llm=llm,
            store=app.state.store,
            variant=request.variant,
            force=request.force,
        )
        return analysis

    @app.get("/analyses/{analysis_id}")
    def get(analysis_id: str):
        analysis = app.state.store.get_analysis(analysis_id)
        if analysis is None:
            raise HTTPException(404, "not found")
        return analysis

    @app.get("/analyses")
    def list_analyses(repository: str | None = None, pr_number: int | None = None):
        return app.state.store.list_analyses(repository=repository, pr_number=pr_number)

    @app.get("/analyses/{analysis_id}/comment")
    def comment(analysis_id: str):
        analysis = app.state.store.get_analysis(analysis_id)
        if analysis is None:
            raise HTTPException(404, "not found")
        return {"comment_markdown": analysis.comment_markdown}

    @app.post("/analyses/{analysis_id}/review")
    def review(analysis_id: str, request: ReviewRequest):
        try:
            return app.state.store.update_review(
                analysis_id, request.state, request.reviewer, request.note
            )
        except KeyError:
            raise HTTPException(404, "not found")

    # -- proactive onboarding wizard ----------------------------------------

    @app.post("/api/onboard/scan")
    def onboard_scan(request: dict):
        from quire_align.onboard import recent_commits, scan_intent_sources

        repo = pathlib.Path(request["repo"]).expanduser().resolve()
        if not repo.exists():
            raise HTTPException(400, f"no such repo: {repo}")
        return {
            "repo": str(repo),
            "suggested_workflow_id": repo.name,
            "sources": scan_intent_sources(repo),
            "commits": recent_commits(repo),
        }

    @app.post("/api/onboard/draft")
    def onboard_draft(request: dict):
        from quire_align.propose import (
            ProposerLLM,
            repo_tree,
            select_context_files,
            validate_candidates,
        )

        repo = pathlib.Path(request["repo"]).expanduser().resolve()
        llm = ProposerLLM()
        all_obligations, all_bindings, notes = [], [], []
        for doc_rel in request["docs"]:
            doc = (repo / doc_rel).read_text()
            reference = pathlib.Path(doc_rel).stem
            candidates = llm.extract_obligations(doc)
            tree = repo_tree(repo)
            contents = select_context_files(repo, tree, candidates.candidates)
            binding_candidates = llm.propose_bindings(
                candidates.candidates, tree, contents
            )
            obligations, bindings, doc_notes = validate_candidates(
                candidates, binding_candidates, doc, tree
            )
            for o in obligations:
                all_obligations.append({**o.model_dump(), "source_reference": reference})
            all_bindings.extend(b.model_dump() for b in bindings)
            notes.extend(doc_notes)
        from quire_align.propose import (
            CandidateBinding,
            CandidateObligation,
            group_candidates,
        )

        grouped = group_candidates(
            [CandidateObligation(**{k: v for k, v in o.items() if k != "source_reference"}) for o in all_obligations],
            [CandidateBinding(**b) for b in all_bindings],
        )
        return {
            "obligations": all_obligations,
            "bindings": all_bindings,
            "notes": notes,
            **grouped,
        }

    @app.post("/api/onboard/create")
    def onboard_create(request: dict):
        from quire_align.onboard import write_workspace

        repo = pathlib.Path(request["repo"]).expanduser().resolve()
        out = write_workspace(
            WORKSPACES,
            request["workflow_id"],
            repo,
            request["sources"],
            request["obligations"],
            request["control_points"],
            request["bindings"],
            request.get("sweep_commits", []),
        )
        return {
            "workspace": request["workflow_id"],
            "path": str(out),
            "sweep_prs": list(range(1, len(request.get("sweep_commits", [])) + 1)),
        }

    @app.get("/onboard")
    def onboard_page():
        from fastapi.responses import HTMLResponse

        return HTMLResponse((STATIC / "onboard.html").read_text())

    # -- intent timeline (demo surface) -----------------------------------

    @app.get("/api/intent/{workspace}/timeline")
    def intent_timeline(workspace: str):
        from quire_align.timeline import build_timeline

        adapter = _adapter(workspace)
        analyses = app.state.store.list_analyses(repository=adapter.repository())
        return build_timeline(adapter, analyses)

    @app.get("/intent/{workspace}")
    def intent_page(workspace: str):
        from fastapi.responses import HTMLResponse

        html = (STATIC / "intent.html").read_text()
        return HTMLResponse(html.replace("__WORKSPACE__", workspace))

    return app
