"""Minimal HTTP API to run analyses and retrieve results."""

from __future__ import annotations

import logging
import pathlib

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from quire_align import workspace as workspace_mod
from quire_align.models import ReviewState
from quire_align.store import Store

WORKSPACES = workspace_mod.WORKSPACES
STATIC = pathlib.Path(__file__).parent / "static"

logger = logging.getLogger(__name__)


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


class OnboardScanRequest(BaseModel):
    repo: str


class OnboardDraftRequest(BaseModel):
    repo: str
    docs: list[str]


class RegroupRequest(BaseModel):
    obligations: list[dict]
    bindings: list[dict]
    constraints: dict | None = None


class OnboardCreateRequest(BaseModel):
    repo: str
    workflow_id: str
    sources: list[dict]
    obligations: list[dict]
    control_points: list[dict]
    bindings: list[dict]
    sweep_commits: list[dict] = Field(default_factory=list)
    grouping_constraints: dict | None = None


class AliasRequest(BaseModel):
    term: str
    anchor: str


class DecisionRequest(BaseModel):
    action: str  # approved | rejected
    by: str
    reason_code: str = ""
    reason_text: str = ""
    operations: list[dict] | None = None  # present → edited approval (human-amended)


def create_app(store: Store | None = None) -> FastAPI:
    workspace_mod.load_env()
    app = FastAPI(title="Quire Align", version="0.1.0")
    app.state.store = store or Store()

    def _adapter(workspace: str):
        try:
            return workspace_mod.build_adapter(workspace)
        except FileNotFoundError as error:
            raise HTTPException(400, str(error))

    def _workspace_dir(workspace: str) -> pathlib.Path:
        try:
            return workspace_mod.resolve_workspace_dir(workspace)
        except FileNotFoundError as error:
            raise HTTPException(400, str(error))

    @app.post("/analyses")
    def run(request: AnalyzeRequest):
        from quire_align.analysis.graph import run_analysis

        if request.offline:
            from quire_align.canned import fake_for_pr, known_pr_numbers

            try:
                llm = fake_for_pr(request.pr_number)
            except KeyError:
                raise HTTPException(
                    400,
                    f"offline=true uses canned model outputs, and PR "
                    f"{request.pr_number} has none (known: {known_pr_numbers()})",
                )
        else:
            from quire_align.analysis.llm import AnthropicAlignmentLLM

            llm = AnthropicAlignmentLLM()
        adapter = _adapter(request.workspace)
        try:
            analysis = run_analysis(
                adapter,
                request.pr_number,
                llm=llm,
                store=app.state.store,
                variant=request.variant,
                force=request.force,
            )
        except HTTPException:
            raise
        except Exception as error:
            # Adapter (git/GitHub) or LLM failure — an upstream problem,
            # not a bad request: surface it as a gateway-style error.
            raise HTTPException(
                502, f"analysis failed against an upstream dependency: {error}"
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
    def onboard_scan(request: OnboardScanRequest):
        # Trust note: the repo path is taken as-is from the request. This is
        # a local, operator-facing tool (bound to 127.0.0.1 by default) —
        # exposing it beyond localhost would let callers point the scanner
        # at arbitrary filesystem paths.
        from quire_align.onboard import recent_commits, scan_intent_sources

        repo = pathlib.Path(request.repo).expanduser().resolve()
        if not repo.exists():
            raise HTTPException(400, f"no such repo: {repo}")
        return {
            "repo": str(repo),
            "suggested_workflow_id": repo.name,
            "sources": scan_intent_sources(repo),
            "commits": recent_commits(repo),
        }

    @app.post("/api/onboard/draft")
    def onboard_draft(request: OnboardDraftRequest):
        from quire_align.propose import (
            CandidateBinding,
            CandidateObligation,
            ProposerLLM,
            extract_doc_paths,
            group_candidates,
            mint_control_point_id,
            repo_tree,
            scope_from_doc_paths,
            select_context_files,
            validate_candidates,
        )

        repo = pathlib.Path(request.repo).expanduser().resolve()
        llm = ProposerLLM()
        all_obligations, all_bindings, notes = [], [], []
        for doc_rel in request.docs:
            doc = (repo / doc_rel).read_text()
            reference = pathlib.Path(doc_rel).stem
            candidates = llm.extract_obligations(doc)
            tree = repo_tree(repo)
            doc_paths = extract_doc_paths(doc, tree)
            scoped_tree = scope_from_doc_paths(doc_paths, tree)
            contents = select_context_files(repo, scoped_tree, candidates.candidates)
            binding_candidates = llm.propose_bindings(
                candidates.candidates, scoped_tree, contents, doc_paths=doc_paths
            )
            obligations, bindings, doc_notes = validate_candidates(
                candidates, binding_candidates, doc, scoped_tree
            )
            for o in obligations:
                all_obligations.append({**o.model_dump(), "source_reference": reference})
            all_bindings.extend(b.model_dump() for b in bindings)
            notes.extend(doc_notes)

        # Control-point ids are minted HERE, server-side, from the full path
        # — clients consume these ids and must never derive their own (the
        # old client-side stem derivation diverged and collided).
        control_points: dict[str, dict] = {}
        for binding in all_bindings:
            cp_id = mint_control_point_id(binding["path"])
            binding["control_point_id"] = cp_id
            control_points.setdefault(
                cp_id,
                {
                    "control_point_id": cp_id,
                    "role": binding["role"],
                    "path": binding["path"],
                    **({"symbol": binding["symbol"]} if binding.get("symbol") else {}),
                    "description": binding["why"],
                },
            )

        grouped = group_candidates(
            [
                CandidateObligation(
                    **{k: v for k, v in o.items() if k != "source_reference"}
                )
                for o in all_obligations
            ],
            [
                CandidateBinding(
                    **{k: v for k, v in b.items() if k != "control_point_id"}
                )
                for b in all_bindings
            ],
        )
        return {
            "obligations": all_obligations,
            "bindings": all_bindings,
            "control_points": list(control_points.values()),
            "notes": notes,
            **grouped,
        }

    @app.post("/api/onboard/regroup")
    def onboard_regroup(request: RegroupRequest):
        """Re-run grouping with the human's accumulated constraints
        (rename/merge/split edits). Stateless: constraints live client-side
        until create persists them with the workspace."""
        from quire_align.grouping import GroupingConstraints, group_contract

        return group_contract(
            request.obligations,
            request.bindings,
            constraints=GroupingConstraints.model_validate(request.constraints or {}),
        )

    @app.post("/api/onboard/create")
    def onboard_create(request: OnboardCreateRequest):
        from quire_align.onboard import write_workspace

        repo = pathlib.Path(request.repo).expanduser().resolve()
        out, id_map = write_workspace(
            WORKSPACES,
            request.workflow_id,
            repo,
            request.sources,
            request.obligations,
            request.control_points,
            request.bindings,
            request.sweep_commits,
        )
        if request.grouping_constraints:
            import yaml as _yaml

            # The human's grouping edits are training signal — persist them
            # with the workspace. Approval re-mints obligation ids, so every
            # id-keyed constraint must be remapped or it silently orphans.
            raw = request.grouping_constraints
            remapped = {
                "labels": {
                    id_map.get(anchor, anchor): label
                    for anchor, label in (raw.get("labels") or {}).items()
                },
                "must_link": [
                    [id_map.get(a, a), id_map.get(b, b)]
                    for a, b in (raw.get("must_link") or [])
                ],
                "cannot_link": [
                    [id_map.get(a, a), id_map.get(b, b)]
                    for a, b in (raw.get("cannot_link") or [])
                ],
            }
            (out / "groups.yaml").write_text(
                _yaml.safe_dump({"constraints": remapped}, sort_keys=False)
            )
        return {
            "workspace": request.workflow_id,
            "path": str(out),
            "sweep_prs": list(range(1, len(request.sweep_commits) + 1)),
        }

    @app.get("/onboard")
    def onboard_page():
        from fastapi.responses import HTMLResponse

        return HTMLResponse((STATIC / "onboard.html").read_text())

    # -- community card: their word → everything we know --------------------

    @app.get("/api/mirror/{workspace}")
    def mirror(workspace: str):
        from quire_align.ask import load_group_state
        from quire_align.mirror import build_mirror

        adapter = _adapter(workspace)
        state = load_group_state(_workspace_dir(workspace), adapter)
        return build_mirror(adapter, app.state.store, state)

    @app.get("/mirror/{workspace}")
    def mirror_page(workspace: str):
        from fastapi.responses import HTMLResponse

        html = (STATIC / "mirror.html").read_text()
        return HTMLResponse(html.replace("__WORKSPACE__", workspace))

    @app.get("/api/ask/{workspace}")
    def ask(workspace: str, q: str, llm: bool = True):
        from quire_align.ask import (
            community_card,
            haiku_pick,
            load_group_state,
            resolve_term,
        )
        from quire_align.mirror import (
            build_mirror,
            classify_question,
            route_status_question,
        )

        adapter = _adapter(workspace)
        state = load_group_state(_workspace_dir(workspace), adapter)

        # Status-shaped questions get situation answers, never a single
        # force-resolved area card (PM interrogation failure #1/#3).
        router = None
        if llm:
            try:
                from quire_align.graph_heuristics import GraphHeuristics

                router = GraphHeuristics().route_question
            except Exception as error:
                # Degrading to the regex fallback is the intended offline
                # behavior — but never silently: a typo'd import or bad
                # config would otherwise look identical to "no API key".
                logger.warning(
                    "LLM question router unavailable (%s: %s) — "
                    "falling back to regex routing",
                    type(error).__name__,
                    error,
                )
        route = classify_question(q, router=router)
        if route is not None:
            mirror_data = build_mirror(adapter, app.state.store, state)
            return {
                "query": q,
                "resolution": {"method": "status", "route": route, "confidence": 1.0},
                "status_answer": route_status_question(route, mirror_data),
                "card": None,
            }
        obligations = [
            {"obligation_id": o.obligation_id, "statement": o.statement}
            for o in adapter.obligations()
        ]
        resolution = resolve_term(
            q, state, obligations, llm_pick=haiku_pick if llm else None
        )
        card = (
            community_card(adapter, app.state.store, resolution["group"], state)
            if resolution["group"]
            else None
        )
        return {
            "query": q,
            "resolution": {
                **resolution,
                "group": resolution["group"]["group_id"] if resolution["group"] else None,
                "anchor": resolution["group"]["anchor"] if resolution["group"] else None,
            },
            "card": card,
        }

    @app.post("/api/ask/{workspace}/alias")
    def confirm_alias(workspace: str, request: AliasRequest):
        from quire_align.ask import save_alias

        save_alias(_workspace_dir(workspace), request.term, request.anchor)
        return {"saved": {request.term: request.anchor}}

    # -- entity graph: proposals in, approved diffs fold to the map ---------
    # (PRD v1.0 — rule 5: these endpoints are the ONLY mutation path.)

    def _now() -> str:
        from datetime import datetime, timezone

        return datetime.now(timezone.utc).isoformat(timespec="seconds")

    # NOTE: the bare /api/graph/{workspace} route is registered LAST — its
    # greedy :path converter (workspaces are sometimes absolute dirs) would
    # otherwise swallow the more specific routes below.

    @app.get("/api/graph/{workspace:path}/proposals")
    def graph_proposals(workspace: str):
        from quire_align.entity_graph import load_diffs, open_proposals, stakes_label

        diffs = load_diffs(_workspace_dir(workspace))
        return {
            # open_proposals orders by the same stakes number the label is
            # derived from — position and label agree by construction
            "open": [
                {**d.model_dump(), "stakes_label": stakes_label(d.stakes)}
                for d in open_proposals(diffs)
            ],
            "decided": [
                {
                    "diff_id": d.diff_id,
                    "question": d.question,
                    "status": d.status,
                    "decision": d.decision.model_dump() if d.decision else None,
                }
                for d in diffs
                if d.status != "open"
            ],
        }

    @app.post("/api/graph/{workspace:path}/proposals/{diff_id}/decision")
    def graph_decide(workspace: str, diff_id: str, request: DecisionRequest):
        from quire_align.entity_graph import GraphIntegrityError, decide

        if request.action not in ("approved", "rejected"):
            raise HTTPException(400, "action must be 'approved' or 'rejected'")
        try:
            decided = decide(
                _workspace_dir(workspace),
                diff_id,
                request.action,
                by=request.by,
                now=_now(),
                reason_code=request.reason_code,
                reason_text=request.reason_text,
                operations=request.operations,
            )
        except KeyError:
            raise HTTPException(404, f"no proposal '{diff_id}'")
        except GraphIntegrityError as error:
            raise HTTPException(409, str(error))
        return decided

    @app.post("/api/graph/{workspace:path}/propose")
    def graph_propose(workspace: str):
        from quire_align.entity_propose import EntityProposerLLM, seed_proposals

        adapter = _adapter(workspace)
        try:
            return seed_proposals(
                _workspace_dir(workspace), adapter, EntityProposerLLM(), _now()
            )
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(
                502, f"entity proposal failed against an upstream dependency: {error}"
            )

    @app.get("/inbox/{workspace:path}")
    def inbox_page(workspace: str):
        from fastapi.responses import HTMLResponse

        html = (STATIC / "inbox.html").read_text()
        return HTMLResponse(html.replace("__WORKSPACE__", workspace))

    @app.get("/api/graph/{workspace:path}")
    def graph(workspace: str):
        from quire_align.entity_graph import graph_state, load_diffs

        state = graph_state(load_diffs(_workspace_dir(workspace)))
        return {
            "entities": sorted(
                state["entities"].values(), key=lambda e: e["name"].lower()
            )
        }

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
