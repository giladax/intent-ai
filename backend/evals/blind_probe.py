"""Assemble a blind probe brief for one fixture PR.

Produces the exact job an analysis model would receive — the verbatim node
instructions from `analysis/prompts.py` plus the same diff/code-context the
graph serves — packaged as one staged brief (shared materials included once
for token economy; production sends them per call).

    python3 evals/blind_probe.py 101 > /tmp/blind_brief_101.md
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from quire.adapters.fixture import FixtureWorkspace
from quire.analysis.config import AnalyzerConfig
from quire.analysis.graph import build_analysis_graph
from quire.analysis.llm import FakeAlignmentLLM
from quire.analysis.prompts import (
    build_delta_prompt,
    build_impact_prompt,
    build_intent_prompt,
    render_code_context,
)
from quire.models import BehavioralDelta, DeclaredIntent

FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"

INTENT_SCHEMA = """{"summary": "<one sentence>", "claims": ["<claim>", ...], "references_issue": <bool>}"""
DELTA_SCHEMA = (
    '{"material": <bool>, "summary": "<overall behavioral summary>", "changes": ['
    '{"description": "<observable change>", "direction": "added|removed|relaxed|tightened|reconfigured", '
    '"control_point_paths": ["<file>"], "declared": <bool>, '
    '"evidence": [{"type": "diff_hunk|file_lines", "reference": "<file>", "excerpt": "<verbatim line(s)>"}]}], '
    '"gaps": ["<coupled control point left stale by this change>", ...]}'
)
IMPACT_SCHEMA = (
    '{"relation": "satisfies|partially_satisfies|contradicts|unrelated", '
    '"confidence": <0..1>, "reasoning": "<why>", '
    '"evidence": [{"type": "diff_hunk|file_lines", "reference": "<file>", "excerpt": "<verbatim>"}], '
    '"missing_evidence": ["<absent test/eval/guard>", ...]}'
)


def _instructions_only(prompt: str) -> str:
    """Drop the trailing shared-materials block from a built prompt."""
    return prompt.split("## Diff")[0].rstrip()


def build_brief(pr_number: int, obligation_ids: list[str]) -> str:
    workspace = FixtureWorkspace(FIXTURES / "refund-agent")
    config = AnalyzerConfig()

    # Run the deterministic part of the real graph to get exactly the
    # materials the LLM nodes would be served.
    graph = build_analysis_graph(workspace, FakeAlignmentLLM(), store=None, config=config)
    state = graph.invoke({"pr_number": pr_number})
    pr, issue = state["pr"], state["issue"]
    diff, code_context = state["diff"], state["code_context"]
    obligations = {o.obligation_id: o for o in state["obligations"]}
    artifacts_by_ref = {a.reference: a for a in state["artifacts"]}
    bindings, control_points = state["bindings"], state["control_points"]
    changed = set(state["changed_files"])

    intent_prompt = build_intent_prompt(pr, issue)
    delta_prompt = _instructions_only(
        build_delta_prompt(
            pr,
            diff,
            DeclaredIntent(
                summary="(use your Stage 1 summary)", claims=["(use your Stage 1 claims)"]
            ),
            code_context,
        )
    )

    impact_sections = []
    for ob_id in obligation_ids:
        obligation = obligations[ob_id]
        verifying_paths = [
            cp.path
            for cp in control_points
            for b in bindings
            if b.obligation_id == ob_id
            and b.relation.value == "verifies"
            and b.control_point_id == cp.control_point_id
        ]
        touched = [p for p in verifying_paths if p in changed]
        coverage_note = (
            f"Bound verifications: {verifying_paths or 'none'}; "
            f"updated by this PR: {touched or 'none'}."
        )
        source = artifacts_by_ref.get(obligation.source_reference)
        source_excerpt = source.content if source else ""
        prompt = _instructions_only(
            build_impact_prompt(
                obligation,
                BehavioralDelta(changes=[]),
                diff,
                code_context,
                coverage_note,
                source_excerpt,
            )
        ).replace(
            "## Behavioral changes introduced by this PR\n- none",
            "## Behavioral changes introduced by this PR\n(use your Stage 2 findings)",
        ).replace(
            "## Coupled control points reported stale\n- none reported",
            "## Coupled control points reported stale\n(use your Stage 2 gaps)",
        )
        impact_sections.append(
            f"### Stage 3 job — obligation {ob_id}\n\n{prompt}\n\n"
            f"Respond for {ob_id} with JSON: {IMPACT_SCHEMA}"
        )

    return f"""# Analysis job {pr.number} — {workspace.repository()}

You are the analysis model inside a PR alignment service for production
agents. Work ONLY from the materials in this brief — they are the complete
job input. Complete the three stages in order and return one fenced JSON
block per stage, labeled STAGE1, STAGE2, STAGE3 ({", ".join(obligation_ids)}
— one JSON object each, keyed by obligation id).

## Stage 1 job — declared intent

{intent_prompt}

Respond with JSON: {INTENT_SCHEMA}

## Stage 2 job — behavioral delta

{delta_prompt}

Respond with JSON: {DELTA_SCHEMA}

## Stage 3 jobs — obligation comparison

{chr(10).join(impact_sections)}

## Shared materials

### PR metadata
- repository: {workspace.repository()}
- PR #{pr.number}: {pr.title}
- base: {pr.base_sha}  head: {pr.head_sha}

### Diff
```diff
{diff}
```

### Relevant code (head revision)
{render_code_context(code_context)}
"""


if __name__ == "__main__":
    pr_number = int(sys.argv[1]) if len(sys.argv) > 1 else 101
    obligation_ids = sys.argv[2].split(",") if len(sys.argv) > 2 else ["OB-101", "OB-102", "OB-103"]
    print(build_brief(pr_number, obligation_ids))
