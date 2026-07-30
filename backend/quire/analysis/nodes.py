"""LangGraph node functions.

Built by a factory over (adapter, llm, store, config) so topology stays a
thin wiring concern in `graph.py` and every node is independently testable
and swappable. Deterministic nodes never call the LLM; LLM nodes never
decide the final classification.
"""

from __future__ import annotations

from quire import ANALYZER_VERSION
from quire.analysis.classify import classify
from quire.analysis.config import AnalyzerConfig
from quire.analysis.context import resolve_context
from quire.analysis.coverage import inspect_coverage
from quire.analysis.evidence import validate_evidence
from quire.analysis.matching import (
    detect_removed_enforcement,
    match_control_points,
)
from quire.analysis.render import render_comment
from quire.analysis.state import AnalysisState
from quire.models import (
    Classification,
    ContractSnapshot,
    ImpactRelation,
    ObligationImpact,
    PRAnalysis,
    ReviewState,
    analysis_key,
)


def build_nodes(adapter, llm, store, config: AnalyzerConfig) -> dict:
    def load_inputs(state: AnalysisState) -> dict:
        pr = adapter.get_pr(state.pr_number)
        issue = adapter.issue(pr.issue_key) if pr.issue_key else None
        return {
            "pr": pr,
            "issue": issue,
            "changed_files": adapter.changed_files(pr),
        }

    def snapshot_artifacts(state: AnalysisState) -> dict:
        return {"artifacts": adapter.requirement_artifacts()}

    def resolve_product_context(state: AnalysisState) -> dict:
        obligations = adapter.obligations()
        control_points = adapter.control_points()
        bindings = adapter.bindings()
        matched = match_control_points(state.changed_files, control_points)
        context = resolve_context(
            state.pr,
            state.issue,
            adapter.manifest(),
            state.artifacts,
            obligations,
            matched,
            bindings,
            min_overlap=config.retrieval_min_overlap,
        )
        return {
            "context": context,
            "obligations": obligations,
            "control_points": control_points,
            "bindings": bindings,
        }

    def load_obligations(state: AnalysisState) -> dict:
        contract = ContractSnapshot(
            workflow_id=adapter.manifest().workflow_id,
            obligation_pins=[o.pin for o in state.obligations],
        )
        update: dict = {"contract": contract}
        if store is not None and not state.force:
            key = analysis_key(
                adapter.repository(),
                state.pr.number,
                state.pr.head_sha,
                contract.contract_snapshot_id,
                ANALYZER_VERSION,
            )
            existing = store.get_analysis(key)
            if existing is not None:
                update.update({"analysis": existing, "cached": True})
        return update

    def parse_intent(state: AnalysisState) -> dict:
        return {"declared": llm.parse_intent(state.pr, state.issue)}

    def collect_diff(state: AnalysisState) -> dict:
        return {"diff": adapter.diff(state.pr)}

    def match_points(state: AnalysisState) -> dict:
        matched = match_control_points(state.changed_files, state.control_points)
        removed = detect_removed_enforcement(
            state.pr, adapter, state.control_points, state.changed_files, state.diff
        )
        if config.obligation_scope == "all":
            candidates = list(state.obligations)
        else:
            matched_ids = {cp.control_point_id for cp in matched}
            bound = {
                b.obligation_id
                for b in state.bindings
                if b.control_point_id in matched_ids
            }
            resolved_refs = set(
                state.context.resolved_references if state.context else []
            )
            candidates = [
                o
                for o in state.obligations
                if o.obligation_id in bound or o.source_reference in resolved_refs
            ]
        return {
            "matched_control_points": matched,
            "removed_enforcement": removed,
            "candidate_obligations": candidates,
        }

    def gather_code_context(state: AnalysisState) -> dict:
        candidate_ids = {o.obligation_id for o in state.candidate_obligations}
        bound_cp_ids = {
            b.control_point_id
            for b in state.bindings
            if b.obligation_id in candidate_ids
        }
        paths: list[str] = list(state.changed_files)
        for cp in state.control_points:
            if cp.control_point_id in bound_cp_ids and cp.path not in paths:
                paths.append(cp.path)
        context: dict[str, str] = {}
        for path in paths[: config.max_context_files]:
            content = adapter.file_content(state.pr, path, "head")
            if content is not None:
                context[path] = content
        return {"code_context": context}

    def infer_delta(state: AnalysisState) -> dict:
        delta = llm.infer_delta(state.pr, state.diff, state.declared, state.code_context)
        return {"delta": delta}

    def compare_obligations(state: AnalysisState) -> dict:
        changed = set(state.changed_files)
        artifacts_by_ref = {a.reference: a for a in state.artifacts}
        impacts = []
        cp_by_id = {cp.control_point_id: cp for cp in state.control_points}
        for obligation in state.candidate_obligations:
            bound = [
                (cp_by_id[b.control_point_id], b.relation.value)
                for b in state.bindings
                if b.obligation_id == obligation.obligation_id
                and b.control_point_id in cp_by_id
            ]
            if config.strict_binding_gate and bound and not any(
                cp.path in changed for cp, _ in bound
            ):
                # Registry-first: none of this obligation's registered
                # control points changed — deterministically unrelated, no
                # inference spent. Changes outside the registry are the
                # drift path's job.
                impacts.append(
                    ObligationImpact(
                        obligation_id=obligation.obligation_id,
                        relation=ImpactRelation.UNRELATED,
                        confidence=1.0,
                        reasoning=(
                            "binding gate: none of this obligation's "
                            "registered control points were changed by this PR"
                        ),
                    )
                )
                continue
            binding_lines = "\n".join(
                f"- {cp.path} ({relation})"
                + (" — CHANGED by this PR" if cp.path in changed else " — untouched")
                for cp, relation in bound
            ) or "- none registered"
            verifying_paths = [cp.path for cp, rel in bound if rel == "verifies"]
            touched = [p for p in verifying_paths if p in changed]
            coverage_note = (
                f"## This obligation's registered control points\n{binding_lines}\n\n"
                f"Bound verifications: {verifying_paths or 'none'}; "
                f"updated by this PR: {touched or 'none'}."
            )
            # Serve the whole approved artifact, not just the obligation's
            # section — sections reference values defined in siblings (e.g.
            # "the approved premium limit"), and a narrow excerpt lets the
            # model guess those values from the code instead of the source.
            source = artifacts_by_ref.get(obligation.source_reference)
            source_excerpt = source.content if source else ""
            impacts.append(
                llm.assess_obligation(
                    obligation,
                    state.delta,
                    state.diff,
                    state.code_context,
                    coverage_note,
                    source_excerpt,
                )
            )
        return {"impacts": impacts}

    def inspect_tests(state: AnalysisState) -> dict:
        coverage = inspect_coverage(
            state.pr,
            adapter,
            state.impacts,
            state.bindings,
            state.control_points,
            state.changed_files,
            eval_globs=[
                glob
                for source in adapter.manifest().eval_sources
                for glob in source.paths
            ],
        )
        return {"coverage": coverage}

    def validate(state: AnalysisState) -> dict:
        ok, dropped = validate_evidence(
            state.impacts,
            pr=state.pr,
            adapter=adapter,
            diff=state.diff,
            artifacts=state.artifacts,
        )
        return {
            "evidence_valid": ok,
            "dropped_citations": dropped,
            "impacts": state.impacts,
        }

    def classify_alignment(state: AnalysisState) -> dict:
        classification, reasons, missing = classify(
            context=state.context,
            delta=state.delta,
            impacts=state.impacts,
            obligations=state.obligations,
            bindings=state.bindings,
            control_points=state.control_points,
            coverage=state.coverage,
            removed_enforcement=state.removed_enforcement,
            evidence_valid=state.evidence_valid,
            matched_control_points=state.matched_control_points,
            low_confidence=config.low_confidence,
        )
        return {
            "classification": classification,
            "review_reasons": reasons,
            "missing_evidence": missing,
        }

    def persist(state: AnalysisState) -> dict:
        review_required = bool(state.review_reasons)
        analysis = PRAnalysis(
            analysis_id=analysis_key(
                adapter.repository(),
                state.pr.number,
                state.pr.head_sha,
                state.contract.contract_snapshot_id,
                ANALYZER_VERSION,
            ),
            workflow_id=adapter.manifest().workflow_id,
            repository=adapter.repository(),
            pr_number=state.pr.number,
            base_sha=state.pr.base_sha,
            head_sha=state.pr.head_sha,
            contract_snapshot_id=state.contract.contract_snapshot_id,
            analyzer_version=ANALYZER_VERSION,
            classification=state.classification,
            declared_intent=state.declared,
            behavioral_delta=state.delta,
            obligation_impacts=state.impacts,
            coverage=state.coverage,
            context=state.context,
            matched_control_points=[
                cp.control_point_id for cp in state.matched_control_points
            ],
            missing_evidence=state.missing_evidence,
            evidence_valid=state.evidence_valid,
            dropped_citations=state.dropped_citations,
            human_review_required=review_required,
            review_reasons=state.review_reasons,
            review_state=ReviewState.PENDING if review_required else ReviewState.NOT_REQUIRED,
            artifact_snapshot_ids=[a.snapshot_id for a in state.artifacts],
        )
        analysis.comment_markdown = render_comment(
            analysis,
            statements_by_id={o.obligation_id: o.statement for o in state.obligations},
        )
        if store is not None:
            store.save_snapshots(state.artifacts)
            store.save_contract(state.contract)
            store.save_analysis(analysis)
        return {"analysis": analysis}

    def publish(state: AnalysisState) -> dict:
        # The comment is the publishable surface; a delivery integration
        # (GitHub comment post) would hang off here.
        return {"analysis": state.analysis}

    return {
        "load_inputs": load_inputs,
        "snapshot_artifacts": snapshot_artifacts,
        "resolve_product_context": resolve_product_context,
        "load_obligations": load_obligations,
        "parse_intent": parse_intent,
        "collect_diff": collect_diff,
        "match_points": match_points,
        "gather_code_context": gather_code_context,
        "infer_delta": infer_delta,
        "compare_obligations": compare_obligations,
        "inspect_tests": inspect_tests,
        "validate": validate,
        "classify_alignment": classify_alignment,
        "persist": persist,
        "publish": publish,
    }
