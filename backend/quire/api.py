"""Minimal HTTP API to run analyses and retrieve results."""

from __future__ import annotations

import logging
import pathlib

from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from quire import workspace as workspace_mod
from quire.models import ReviewState
from quire.store import Store

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


class TeachRequest(BaseModel):
    term: str
    action: Literal["alias", "create"]
    by: str
    entity_id: str = ""  # required for alias
    note: str = ""


class CorrectRequest(BaseModel):
    entity_id: str
    verb: Literal["rename", "part_of", "detach", "alias"]
    by: str
    name: str = ""
    other_id: str = ""
    kind: str = ""
    ref: str = ""
    terms: list[str] = Field(default_factory=list)
    note: str = ""


class DismissRequest(BaseModel):
    name: str
    by: str
    why: str = ""


class DecisionRequest(BaseModel):
    action: Literal["approved", "rejected"]  # anything else fails at the edge
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
        from quire.analysis.graph import run_analysis

        if request.offline:
            from quire.canned import fake_for_pr, known_pr_numbers

            try:
                llm = fake_for_pr(request.pr_number)
            except KeyError:
                raise HTTPException(
                    400,
                    f"offline=true uses canned model outputs, and PR "
                    f"{request.pr_number} has none (known: {known_pr_numbers()})",
                )
        else:
            from quire.analysis.llm import AnthropicAlignmentLLM

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
        from quire.onboard import recent_commits, scan_intent_sources

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
        from quire.propose import (
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
        for doc_index, doc_rel in enumerate(request.docs, start=1):
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
            # Draft ids restart per doc (each LLM call numbers from 1) —
            # namespace them by doc before pooling, or two docs' OB-DRAFT-001s
            # collapse in the approval id_map and bindings land on the wrong
            # promise (found live in the pydantic scale run).
            def _ns(draft_id: str) -> str:
                return f"D{doc_index}-{draft_id}"
            for o in obligations:
                all_obligations.append({
                    **o.model_dump(),
                    "obligation_id": _ns(o.obligation_id),
                    "source_reference": reference,
                })
            all_bindings.extend(
                {**b.model_dump(), "obligation_id": _ns(b.obligation_id)}
                for b in bindings
            )
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
        from quire.grouping import GroupingConstraints, group_contract

        return group_contract(
            request.obligations,
            request.bindings,
            constraints=GroupingConstraints.model_validate(request.constraints or {}),
        )

    @app.post("/api/onboard/create")
    def onboard_create(request: OnboardCreateRequest):
        from quire.onboard import write_workspace

        repo = pathlib.Path(request.repo).expanduser().resolve()
        try:
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
        except ValueError as error:
            # e.g. duplicate draft obligation ids — the operator's mistake,
            # said plainly, not a 500
            raise HTTPException(400, str(error))
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
        from quire.ask import load_group_state
        from quire.mirror import build_mirror

        adapter = _adapter(workspace)
        state = load_group_state(_workspace_dir(workspace), adapter)
        return build_mirror(adapter, app.state.store, state)

    @app.get("/mirror/{workspace}")
    def mirror_page(workspace: str):
        # The mirror's uniques (status answers, recent checks) folded into
        # the map overview (2026-07-19 UX pass); the old page contradicted
        # the Working Edition, so the door forwards rather than forks.
        from fastapi.responses import RedirectResponse

        _workspace_dir(workspace)  # junk 404s instead of redirecting
        return RedirectResponse(f"/app/{workspace}", status_code=307)

    @app.post("/api/ask/{workspace:path}/alias")
    def confirm_alias(workspace: str, request: AliasRequest):
        from quire.ask import save_alias

        save_alias(_workspace_dir(workspace), request.term, request.anchor)
        return {"saved": {request.term: request.anchor}}

    # (registered after its /alias sub-route — :path matches greedily)
    @app.get("/api/ask/{workspace:path}")
    def ask(workspace: str, q: str, llm: bool = True):
        from quire.ask import (
            community_card,
            haiku_pick,
            load_group_state,
            resolve_term,
        )
        from quire.mirror import (
            build_mirror,
            classify_question,
            route_status_question,
        )

        adapter = _adapter(workspace)
        state = load_group_state(_workspace_dir(workspace), adapter)

        # A SIGNED NAME outranks question-routing: the human-approved
        # vocabulary is deterministic ground truth, and a router guess
        # must never eclipse it (stakeholder round 1, defect 2 — the
        # exact name 'current understanding' was routed to a status dump).
        from quire.entity_graph import graph_state, load_diffs, resolve_entity

        ws_dir = _workspace_dir(workspace)
        from quire.entity_graph import read_state

        entity_state = read_state(ws_dir)[1]
        entity_hit = resolve_entity(entity_state, q)
        if entity_hit and entity_hit["entity"]:
            return {
                "query": q,
                "resolution": {
                    "method": "entity-forwarded"
                    if entity_hit["forwarded_from"]
                    else "entity",
                    "confidence": 1.0,
                },
                "entity": entity_hit["entity"],
                "forwarded_from": entity_hit["forwarded_from"],
                "card": None,
            }

        # Status-shaped questions get situation answers, never a single
        # force-resolved area card (PM interrogation failure #1/#3).
        router = None
        if llm:
            try:
                from quire.graph_heuristics import GraphHeuristics

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

        # Semantic rung: resolve by MEANING over each node's connection
        # content — the org's dialect no longer needs an exact-match
        # alias to land. A match that can't show its wording refuses.
        from quire.relevance import node_documents, resolve_semantic

        semantic = resolve_semantic(
            q, node_documents(ws_dir, adapter, app.state.store)
        )
        near_by_meaning = []
        if semantic and semantic.get("refused"):
            near_by_meaning = semantic["near"]  # honest refusal, named
        elif semantic:
            return {
                "query": q,
                "resolution": {
                    "method": "semantic",
                    "confidence": semantic["score"],
                    "matched_terms": semantic["matched_terms"],
                    "alternatives": semantic["alternatives"],
                },
                "entity": entity_state["entities"][semantic["entity_id"]],
                "forwarded_from": None,
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
        # a refusal names its neighbors in HUMAN names — never internal ids
        labels = {g["group_id"]: g["label"] for g in state.get("groups", [])}
        return {
            "query": q,
            "resolution": {
                **resolution,
                "group": resolution["group"]["group_id"] if resolution["group"] else None,
                "anchor": resolution["group"]["anchor"] if resolution["group"] else None,
                "near_by_meaning": near_by_meaning,
                "alternatives_named": [
                    labels[g] for g in resolution.get("alternatives", [])
                    if g in labels
                ],
            },
            "card": card,
        }

    # -- entity graph: proposals in, approved diffs fold to the map ---------
    # (PRD v1.0 — rule 5: these endpoints are the ONLY mutation path.)

    def _now() -> str:
        from quire.entity_graph import now_iso

        return now_iso()

    def _detail(error: KeyError) -> str:
        # str(KeyError) wraps the message in repr quotes — unwrap it so the
        # 404 detail reads as a sentence, not a Python artifact.
        return str(error.args[0]) if error.args else "not found"

    # NOTE: the bare /api/graph/{workspace} route is registered LAST — its
    # greedy :path converter (workspaces are sometimes absolute dirs) would
    # otherwise swallow the more specific routes below.

    @app.get("/api/graph/{workspace:path}/proposals")
    def graph_proposals(workspace: str):
        from quire.entity_graph import (
            decided_proposals,
            graph_state,
            load_diffs,
            open_proposals,
            stakes_label,
        )

        diffs = load_diffs(_workspace_dir(workspace))
        state = graph_state(diffs)
        opened = open_proposals(diffs)

        # A mirror must say what it is NOT showing: every approved promise
        # is housed, proposed (in an open card), or homeless — and the
        # homeless ones are named, not implied.
        held: dict[str, list[str]] = {}
        for entity in state["entities"].values():
            if entity["status"] != "active":
                continue
            for holding in entity["holdings"]:
                if holding["kind"] == "promise":
                    held.setdefault(holding["ref"], []).append(entity["name"])
        proposed = {
            op.ref
            for d in opened
            for op in d.operations
            if op.op == "attach" and op.kind == "promise"
        }
        adapter = _adapter(workspace)
        obligations = list(adapter.obligations())
        all_promises = [o.obligation_id for o in obligations]
        # ids mean nothing to a human — the page renders the STATEMENTS
        promise_statements = {o.obligation_id: o.statement for o in obligations}
        coverage = {
            "total": len(all_promises),
            "housed": sorted(p for p in all_promises if p in held),
            "proposed": sorted(
                p for p in all_promises if p not in held and p in proposed
            ),
            "homeless": sorted(
                p for p in all_promises if p not in held and p not in proposed
            ),
        }

        # same decision-instant clock as the fold — a lexical sort would
        # misorder legitimately-signed non-UTC offsets
        decided = decided_proposals(diffs)
        return {
            # open_proposals orders by the same stakes number the label is
            # derived from — position and label agree by construction
            "open": [
                {
                    **d.model_dump(),
                    "stakes_label": stakes_label(d.stakes),
                    # a promise this card wants that ALREADY lives on
                    # another entity — decision-relevant, so disclosed
                    "already_held": {
                        op.ref: held[op.ref]
                        for op in d.operations
                        if op.op == "attach" and op.kind == "promise"
                        and op.ref in held
                    },
                }
                for d in opened
            ],
            "coverage": coverage,
            "promise_statements": promise_statements,
            # history reads in decision order, or it isn't history
            "decided": [
                {
                    "diff_id": d.diff_id,
                    "question": d.question,
                    "status": d.status,
                    "decision": d.decision.model_dump() if d.decision else None,
                }
                for d in decided
            ],
        }

    @app.post("/api/graph/{workspace:path}/proposals/{diff_id}/decision")
    def graph_decide(workspace: str, diff_id: str, request: DecisionRequest):
        from quire.entity_graph import GraphIntegrityError, decide

        # request.action is a Literal — anything else already failed
        # validation at the edge (422); decide() re-checks for non-HTTP
        # callers.
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
        from quire.entity_propose import (
            EntityProposerLLM,
            haiku_doc_complement_judge,
            seed_proposals,
        )

        adapter = _adapter(workspace)
        try:
            return seed_proposals(
                _workspace_dir(workspace), adapter, EntityProposerLLM(), _now(),
                doc_judge=haiku_doc_complement_judge,
            )
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(
                502, f"entity proposal failed against an upstream dependency: {error}"
            )

    @app.post("/api/graph/{workspace:path}/teach")
    def graph_teach(workspace: str, request: TeachRequest):
        from quire.entity_graph import GraphIntegrityError
        from quire.teach import teach_alias, teach_create

        ws_dir = _workspace_dir(workspace)
        try:
            if request.action == "alias":
                if not request.entity_id:
                    raise HTTPException(400, "teaching an alias needs entity_id")
                return teach_alias(
                    ws_dir, request.term, request.entity_id, request.by, _now()
                )
            return teach_create(
                ws_dir, request.term, request.by, _now(), note=request.note
            )
        except KeyError as error:
            raise HTTPException(404, _detail(error))
        except GraphIntegrityError as error:
            raise HTTPException(409, str(error))

    @app.post("/api/graph/{workspace:path}/correct")
    def graph_correct(workspace: str, request: CorrectRequest):
        from quire.entity_graph import GraphIntegrityError
        from quire.teach import correct

        try:
            return correct(
                _workspace_dir(workspace),
                request.entity_id,
                request.verb,
                request.by,
                _now(),
                name=request.name,
                other_id=request.other_id,
                kind=request.kind,
                ref=request.ref,
                terms=request.terms,
                note=request.note,
            )
        except KeyError as error:
            raise HTTPException(404, _detail(error))
        except GraphIntegrityError as error:
            raise HTTPException(409, str(error))

    @app.get("/api/story/{workspace:path}/entity/{entity_id}")
    def story_entity(workspace: str, entity_id: str, llm: bool = True):
        return _story(workspace, "entity", llm, entity_id=entity_id)

    @app.get("/api/story/{workspace:path}/org")
    def story_org(workspace: str, llm: bool = True):
        return _story(workspace, "org", llm)

    def _story(workspace: str, scope: str, llm: bool, entity_id: str = ""):
        from quire.story import StorytellerLLM, get_story

        ws_dir = _workspace_dir(workspace)
        adapter = _adapter(workspace)
        if scope == "entity":
            from quire.entity_graph import graph_state, load_diffs

            from quire.entity_graph import read_state

            if entity_id not in read_state(ws_dir)[1]["entities"]:
                raise HTTPException(404, f"no entity '{entity_id}'")
        teller = None
        judge = None
        if llm:
            try:
                from quire.story import faithfulness_judge

                teller = StorytellerLLM()
                judge = faithfulness_judge
            except Exception as error:
                logger.warning(
                    "storyteller unavailable (%s: %s) — serving the cached "
                    "story, or none: a missing story is honest",
                    type(error).__name__,
                    error,
                )
        try:
            entry = get_story(
                ws_dir, adapter, app.state.store, scope,
                teller=teller, entity_id=entity_id, now=_now(), judge=judge,
            )
        except Exception as error:
            logger.warning(
                "story synthesis failed (%s: %s) — serving the cached story",
                type(error).__name__,
                error,
            )
            from quire.story import _load_cache

            entry = _load_cache(ws_dir).get(
                f"entity:{entity_id}" if scope == "entity" else "org"
            )
        return {"story": entry}

    @app.get("/api/model/{workspace:path}/around/{ref}")
    def model_around(workspace: str, ref: str):
        """The shared brain's read surface: any ref → focus card + typed
        neighborhood with the reasoning on every edge. The navigator
        renders this; the MCP surface wraps it (quire_around) — one
        brain, two clients. Read-only; no LLM at view time."""
        from quire.model import around

        result = around(
            _workspace_dir(workspace), _adapter(workspace),
            app.state.store, ref,
        )
        if result is None:
            raise HTTPException(404, f"nothing in the brain answers to '{ref}'")
        return result

    @app.get("/api/mind/{workspace:path}")
    def mind(workspace: str, llm: bool = True):
        """The working mind — the machine's unsigned thinking nodes, any
        kind, no cap. Resweep happens only when the world changed."""
        from quire.mind import MindLLM, get_mind

        ws_dir = _workspace_dir(workspace)
        adapter = _adapter(workspace)
        thinker = None
        if llm:
            try:
                thinker = MindLLM()
            except Exception as error:
                logger.warning(
                    "mind unavailable (%s: %s) — serving cache",
                    type(error).__name__,
                    error,
                )
        try:
            entry = get_mind(ws_dir, adapter, app.state.store, thinker=thinker, now=_now())
        except Exception as error:
            logger.warning(
                "mind sweep failed (%s: %s) — serving cache",
                type(error).__name__,
                error,
            )
            from quire.mind import read_mind_cache

            entry = read_mind_cache(ws_dir) or None
        return {"mind": entry}

    @app.post("/api/mind/{workspace:path}/dismiss")
    def mind_dismiss(workspace: str, request: DismissRequest):
        """Human-validated trash: the signed half of triage. The thought
        stays dead across sweeps unless the evidence is new."""
        from quire.mind import dismiss_thought

        return {
            "dismissed": request.name,
            "mind": dismiss_thought(
                _workspace_dir(workspace), request.name, request.by,
                _now(), why=request.why,
            ),
        }

    @app.get("/api/tree/{workspace:path}")
    def tree(workspace: str):
        """The constant ring: the project card and its seven shelves —
        grammar constant, membership dynamic (the derived tree lives
        inside 'What we build' and only there)."""
        from quire.hierarchy import derive_ring

        return derive_ring(
            _workspace_dir(workspace), _adapter(workspace), app.state.store
        )

    @app.get("/api/checks/{workspace:path}/{check_number}")
    def check_receipt(workspace: str, check_number: int):
        """The check's receipt — a monospace slip of everything one run
        observed: commit, analyzer, per-promise findings with their
        verbatim citations, and who (if anyone) signed off. A check
        number is the check's PR number — the same number every surface
        already cites as 'check #N'."""
        from quire.analysis.render import DISPLAY_LABELS

        adapter = _adapter(workspace)
        analyses = app.state.store.list_analyses(
            repository=adapter.repository(), pr_number=check_number
        )
        if not analyses:
            raise HTTPException(404, f"no check #{check_number} on record")
        latest = max(analyses, key=lambda a: a.created_at)
        statements = {o.obligation_id: o.statement for o in adapter.obligations()}
        return {
            "check": check_number,
            "analysis_id": latest.analysis_id,
            "observed_at": latest.created_at.isoformat(timespec="seconds"),
            "commit": latest.head_sha,
            "base": latest.base_sha,
            "analyzer_version": latest.analyzer_version,
            "contract": latest.contract_snapshot_id,
            "classification": latest.classification.value,
            "verdict": DISPLAY_LABELS[latest.classification],
            "review": {
                "state": latest.review_state.value,
                "reviewer": latest.reviewer,
                "note": latest.review_note,
            },
            "findings": [
                {
                    "promise": impact.obligation_id,
                    "statement": statements.get(impact.obligation_id, ""),
                    "relation": impact.relation.value,
                    "confidence": impact.confidence,
                    "reasoning": impact.reasoning,
                    "citations": [
                        {
                            "reference": e.reference,
                            "lines": [e.start_line, e.end_line],
                            "excerpt": e.excerpt,
                            "valid": e.valid,
                        }
                        for e in impact.evidence
                    ],
                }
                for impact in latest.obligation_impacts
            ],
            "missing_evidence": latest.missing_evidence,
            "dropped_citations": latest.dropped_citations,
        }

    @app.get("/app/{workspace:path}")
    def app_page(workspace: str):
        import json

        from fastapi.responses import HTMLResponse

        _workspace_dir(workspace)
        html = (STATIC / "app.html").read_text()
        return HTMLResponse(html.replace("__WORKSPACE_JSON__", json.dumps(workspace)))

    @app.get("/inbox/{workspace:path}")
    def inbox_page(workspace: str):
        import json

        from fastapi.responses import HTMLResponse

        # Resolve first (junk 404s instead of reflecting), then inject as
        # a JSON literal — the raw path param inside a JS string was a
        # reflected-XSS gadget.
        _workspace_dir(workspace)
        html = (STATIC / "inbox.html").read_text()
        return HTMLResponse(html.replace("__WORKSPACE_JSON__", json.dumps(workspace)))

    def _promise_health(adapter):
        """Current health per promise from the latest check state — the
        glyph vocabulary is exactly ✖ contradicted · ◐ partial · ✔ kept ·
        '·' unexercised (rule 4: unexercised is never counted as kept)."""
        from quire.timeline import cached_timeline

        analyses = app.state.store.list_analyses(repository=adapter.repository())
        events = cached_timeline(adapter, analyses)["events"]
        current = events[-1]["state_after"] if events else {}
        buckets = {
            "contradicts": "contradicted",
            "partially_satisfies": "partial",
            "satisfies": "kept",
        }

        def health(ref: str) -> dict:
            entry = current.get(ref) or {}
            return {
                "state": buckets.get(entry.get("status"), "unexercised"),
                "since_check": entry.get("since"),
            }

        return health

    @app.get("/api/graph/{workspace:path}/entity/{entity_id}")
    def graph_entity(workspace: str, entity_id: str):
        from quire.entity_graph import (
            graph_state,
            load_diffs,
            open_proposals,
            stakes_label,
        )

        diffs = load_diffs(_workspace_dir(workspace))
        state = graph_state(diffs)
        entity = state["entities"].get(entity_id)
        if entity is None:
            raise HTTPException(404, f"no entity '{entity_id}'")
        adapter = _adapter(workspace)
        statements = {o.obligation_id: o.statement for o in adapter.obligations()}
        health = _promise_health(adapter)
        promises = [
            {
                **h,
                "statement": statements.get(h["ref"], h["ref"]),
                **health(h["ref"]),
            }
            for h in entity["holdings"]
            if h["kind"] == "promise"
        ]
        names = {eid: e["name"] for eid, e in state["entities"].items()}
        relations = [
            {**r, "name": names.get(r["other_id"], r["other_id"])}
            for r in entity["relations"]
        ]
        relations += [
            {"relation": r["relation"], "other_id": eid, "name": e["name"],
             "inverse": True}
            for eid, e in state["entities"].items()
            for r in e["relations"]
            if r["other_id"] == entity_id
        ]
        pending = [
            {
                "diff_id": d.diff_id,
                "question": d.question,
                "stakes_label": stakes_label(d.stakes),
                "proposed_by": d.proposed_by,
                "reasoning": d.reasoning,
            }
            for d in open_proposals(diffs)
            if any(
                entity_id in (getattr(op, "entity_id", ""), getattr(op, "other_id", ""),
                              getattr(op, "successor_id", ""))
                for op in d.operations
            )
        ]
        return {
            **entity,
            "promises": promises,
            "code": [h for h in entity["holdings"] if h["kind"] == "code"],
            "docs": [h for h in entity["holdings"] if h["kind"] == "doc"],
            "other_holdings": [
                h for h in entity["holdings"]
                if h["kind"] not in ("promise", "code", "doc")
            ],
            "relations": relations,
            "pending": pending,
        }

    @app.get("/api/graph/{workspace:path}")
    def graph(workspace: str):
        from quire.entity_graph import graph_state, load_diffs, open_proposals

        diffs = load_diffs(_workspace_dir(workspace))
        state = graph_state(diffs)
        try:
            health = _promise_health(_adapter(workspace))
        except HTTPException:
            health = lambda ref: {"state": "unexercised", "since_check": None}  # noqa: E731
        entities = []
        for entity in sorted(
            state["entities"].values(), key=lambda e: e["name"].lower()
        ):
            rollup = {"contradicted": 0, "partial": 0, "kept": 0, "unexercised": 0}
            for h in entity["holdings"]:
                if h["kind"] == "promise":
                    rollup[health(h["ref"])["state"]] += 1
            entities.append({**entity, "rollup": rollup})
        return {
            "entities": entities,
            "awaiting": len(open_proposals(diffs)),
        }

    # -- intent timeline (demo surface) -----------------------------------

    @app.get("/api/intent/{workspace}/timeline")
    def intent_timeline(workspace: str):
        from quire.timeline import build_timeline

        adapter = _adapter(workspace)
        analyses = app.state.store.list_analyses(repository=adapter.repository())
        return build_timeline(adapter, analyses)

    @app.get("/intent/{workspace}")
    def intent_page(workspace: str):
        from fastapi.responses import HTMLResponse

        _workspace_dir(workspace)  # junk 404s instead of reflecting
        html = (STATIC / "intent.html").read_text()
        return HTMLResponse(html.replace("__WORKSPACE__", workspace))

    return app
