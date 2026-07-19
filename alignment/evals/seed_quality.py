"""Seed-proposal quality evals — the layer the first live session proved
defect-prone (docs/reviews/2026-07-19-cpo-inbox-session.md).

Two deterministic metrics plus one Haiku judge for complement hygiene
(grades quality, never decides engine correctness). Runs against a COPY
of the workspace — an eval run must never write into a real diff log.

    python3 -m evals.seed_quality quire-brain            # live proposer
    python3 -m evals.seed_quality quire-brain intent-ai-live

Owner of the metrics: the CPO. Sweep discipline: an eval here that a
unit test already pins is redundancy — remove it. Removed under that
rule (2026-07-19 ownership pass): `conservation` — it passed by
construction (the product's own unplaced formula makes the eval's
accounting a tautology) and the never-silent contract is pinned
deterministically by tests/test_entity_propose.py::
test_proposals_api_reports_coverage_and_already_held.
"""

from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

from quire_align.entity_graph import load_diffs
from quire_align.text import tokenize


def _norm_tokens(text: str) -> set[str]:
    return set(tokenize(text, min_len=3, keep_digits=True))


def eval_scope_honesty(
    proposals, workspace_id: str, statements_by_id: dict[str, str]
) -> dict:
    """The 'Brain' error, mechanically: an entity name must not name the
    whole corpus. Fails when the name matches the workspace id, or its
    lexical footprint across ALL promises exceeds twice its membership."""
    total = len(statements_by_id)
    offenders = []
    for diff in proposals:
        creates = [op for op in diff.operations if op.op == "create_entity"]
        members = {
            op.ref
            for op in diff.operations
            if op.op == "attach" and op.kind == "promise"
        }
        for create in creates:
            name_tokens = _norm_tokens(create.name)
            if not name_tokens:
                continue
            if name_tokens <= _norm_tokens(workspace_id):
                offenders.append(f"{create.name} (names the workspace itself)")
                continue
            corpus_hits = sum(
                1
                for statement in statements_by_id.values()
                if name_tokens & _norm_tokens(statement)
            )
            # names-most-of-the-corpus rule, recalibrated on the pydantic
            # scale run (first observed wrong resolution per the bar):
            # "Brain" 1.0 fails, "Strict Mode" 0.44 is a human's call
            if total and corpus_hits / total >= 0.6:
                offenders.append(
                    f"{create.name} (footprint {corpus_hits}/{total} — "
                    f"names most of the corpus)"
                )
    return {
        "metric": "scope_honesty",
        "score": int(not offenders),
        "comment": f"whole-corpus names: {offenders or 'none'}",
    }


_GENERIC_ADDRESS = "approved promise"


def eval_decision_sufficiency(proposals) -> dict:
    """The card must carry enough to answer its own question: bindings
    carry provenance notes; quotes carry a REAL org address (source
    reference / section). The generic fallback label is the D6 defect
    ('QUIREB-004 · approved promise' told the reviewer nothing), not an
    address — a workspace whose promises lack source metadata fails here
    BEFORE a human meets the weak card."""
    bare_binds, bare_quotes = [], []
    for diff in proposals:
        for op in diff.operations:
            if op.op == "attach" and op.kind != "promise" and not op.note.strip():
                bare_binds.append(f"{diff.diff_id or diff.question[:30]}:{op.ref}")
        for quote in diff.evidence:
            # an org address has more than the bare promise id, and more
            # than the generic genus label
            address = (
                quote.source.split("·", 1)[1].strip() if "·" in quote.source else ""
            )
            if not address or address == _GENERIC_ADDRESS:
                bare_quotes.append(quote.source)
    ok = not bare_binds and not bare_quotes
    return {
        "metric": "decision_sufficiency",
        "score": int(ok),
        "comment": f"bindings without provenance: {bare_binds or 'none'}; "
        f"quotes without org address: {bare_quotes or 'none'}",
    }


def eval_complement_hygiene(proposals, judge=None) -> dict:
    """Haiku judge per doc attachment: does the entity's identity sentence
    EXCLUDE the artifact? (future-knowledge attached to Current
    Understanding — lexical similarity cannot see negation.) Calibration
    (CPO ownership pass, 2026-07-19): the test is a clash with the
    identity sentence's own membership claim, NOT conceptual duality — an
    entity about a boundary/gate/process legitimately holds artifacts
    from either side of it."""
    if judge is None:
        judge = _haiku_complement_judge
    offenders = []
    for diff in proposals:
        create = next((op for op in diff.operations if op.op == "create_entity"), None)
        if create is None:
            continue
        for op in diff.operations:
            if op.op == "attach" and op.kind == "doc":
                verdict = judge(create.name, create.identity_sentence, op.ref)
                if verdict.get("complement"):
                    offenders.append(
                        f"{op.ref} vs {create.name}: {verdict.get('reason', '')}"
                    )
    return {
        "metric": "complement_hygiene",
        "score": int(not offenders),
        "comment": f"complement attachments: {offenders or 'none'}",
    }


def _haiku_complement_judge(name: str, identity: str, path: str) -> dict:
    from langchain_anthropic import ChatAnthropic
    from pydantic import BaseModel, Field

    class Verdict(BaseModel):
        reason: str = ""
        complement: bool = Field(
            description="True ONLY if the entity claims to BE a body/corpus "
            "of material and this artifact is a register of exactly what "
            "that corpus declares itself not to contain (e.g. a "
            "deferred-hypotheses register attached to an entity whose "
            "identity is 'the approved body of knowledge'). False for mere "
            "relatedness. False for duality: an entity whose identity is a "
            "boundary, gate, or review process legitimately holds artifacts "
            "that define, decide, or sit on either side of it. False for "
            "conduct rules: when the identity is a rule about how the "
            "product must treat certain artifacts, the entity's card may "
            "still cite the documents that state or decide that rule — "
            "citing a document on a card is not the act the rule forbids."
        )

    model = ChatAnthropic(
        model="claude-haiku-4-5", temperature=0, max_tokens=256
    ).with_structured_output(Verdict)
    verdict = model.invoke(
        f"Entity: “{name}” — {identity}\n"
        f"Artifact cited on the entity's dossier card: {path}\n\n"
        "Answer in two steps.\n"
        "STEP 1 — What does the identity sentence say the entity IS? If it "
        "is a rule, boundary, constraint, gate, workflow, or capability, "
        "answer complement=false and stop: such an entity may cite "
        "documents that state, decide, or sit on any side of what it "
        "governs — a card citing a document is not the act the rule "
        "governs.\n"
        "STEP 2 — If the entity IS a body/corpus of material (e.g. 'the "
        "approved body of knowledge' — still a corpus even when the "
        "sentence adds gates on how it changes): a card citation presents "
        "the artifact as belonging to that corpus. If the artifact is, by "
        "its evident purpose, a register of exactly what the corpus "
        "excludes (the deferred where the corpus is the approved, drafts "
        "where the corpus is the final), the card misrepresents the corpus "
        "— answer complement=true. Mere relatedness or topical opposition "
        "stays false."
    )
    return verdict.model_dump()


def run_workspace(workspace: str, proposer=None, judge=None) -> list[dict]:
    """Copy the workspace, run the seed proposer, score. Never touches the
    real diff log."""
    from quire_align.adapters.fixture import FixtureWorkspace
    from quire_align.entity_propose import (
        EntityProposerLLM,
        haiku_doc_complement_judge,
        seed_proposals,
    )
    from quire_align.workspace import resolve_workspace_dir

    source = resolve_workspace_dir(workspace)
    live = proposer is None
    with tempfile.TemporaryDirectory() as tmp:
        ws = Path(tmp) / source.name
        shutil.copytree(source, ws)
        adapter = FixtureWorkspace(ws)
        seed_proposals(
            ws, adapter, proposer or EntityProposerLLM(),
            "2026-01-01T00:00:00+00:00",
            doc_judge=haiku_doc_complement_judge if live else None,
        )
        diffs = [d for d in load_diffs(ws) if d.status == "open"]
        statements = {o.obligation_id: o.statement for o in adapter.obligations()}
    workspace_id = source.name
    return [
        eval_scope_honesty(diffs, workspace_id, statements),
        eval_decision_sufficiency(diffs),
        eval_complement_hygiene(diffs, judge=judge),
    ]


def main(argv: list[str]) -> int:
    failures = 0
    for workspace in argv or ["quire-brain"]:
        print(f"== {workspace}")
        for result in run_workspace(workspace):
            mark = "PASS" if result["score"] else "FAIL"
            failures += 1 - result["score"]
            print(f"  {mark} {result['metric']}: {result['comment']}")
    return 1 if failures else 0


if __name__ == "__main__":
    from quire_align.workspace import load_env

    load_env()
    sys.exit(main(sys.argv[1:]))
