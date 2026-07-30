"""Seed the entity graph: LLM proposals that consolidate the derived areas.

PRD v1.0 §5 — "the LLM's first proposals consolidate the existing derived
areas of the live workspaces into entities — day one starts with real
questions." The LLM reasons; it never writes: its output becomes open
GraphDiff proposals, and only a human approval mutates the map.

Same trust mechanics as contract drafting (propose.py): every proposed
entity must quote the org's own words VERBATIM — quotes are validated
against the obligation statements they claim to come from, and an entity
whose quotes all fail is dropped, not rendered (rule 3).
"""

from __future__ import annotations

import pathlib

from pydantic import BaseModel, Field

from quire.entity_graph import (
    Attach,
    CreateEntity,
    EvidenceQuote,
    GraphDiff,
    Relate,
    append_proposals,
    graph_state,
    load_diffs,
    resolve_entity,
    slug_entity_id,
)
from quire.llm_retry import invoke_with_retry
from quire.propose import _normalize_quote
from quire.text import plural, tokenize


class EntityQuote(BaseModel):
    obligation_id: str
    quote: str = Field(description="copied VERBATIM from that promise's statement")


class EntityCandidate(BaseModel):
    name: str = Field(description="the name the ORG would use — product language")
    identity_sentence: str = Field(
        description="one sentence a PM could read aloud: what this thing IS"
    )
    aliases: list[str] = Field(default_factory=list)
    member_obligation_ids: list[str] = Field(default_factory=list)
    quotes: list[EntityQuote] = Field(default_factory=list)
    part_of: str = Field(
        default="", description="name of a broader entity in THIS list, or empty"
    )
    reasoning: str = Field(
        default="",
        description="your thinking, kept verbatim on the proposal: what "
        "you noticed, what you weighed, what you rejected and why — "
        "humans read it on the card and the map embeds it",
    )


class EntityCandidates(BaseModel):
    entities: list[EntityCandidate] = Field(default_factory=list)


class EntityProposerLLM:
    """Sonnet-backed; swap with FakeEntityProposer offline."""

    def __init__(self, model: str = "claude-sonnet-4-6") -> None:
        from langchain_anthropic import ChatAnthropic

        base = ChatAnthropic(model=model, temperature=0, max_tokens=8192)
        self._model = base.with_structured_output(EntityCandidates)

    def propose(
        self, areas_block: str, promises_block: str, workspace_id: str = ""
    ) -> EntityCandidates:
        return invoke_with_retry(
            self._model,
            "You maintain an organization's semantic map. Below are its "
            "approved promises and the mechanically derived areas that "
            "currently group them. Consolidate these into durable ENTITIES "
            "— the nouns this organization would actually say out loud "
            "(products, capabilities, flows), not cluster labels.\n\n"
            "Rules:\n"
            "- Each entity: a product-language name, one identity sentence "
            "a PM could read aloud, the promise ids that belong to it.\n"
            "- SCALE: an entity must be smaller than the map. Never use the "
            "product's or workspace's own name"
            + (f" (here: “{workspace_id}”)" if workspace_id else "")
            + ", and never a name whose words describe most of the promises "
            "— that name is at the wrong scale and a human will reject "
            "it.\n"
            "- COVERAGE: place every promise in the entity where the org "
            "would look for it. A promise you leave out becomes a visible "
            "gap on the map — leave one out only when it genuinely belongs "
            "to none of your entities.\n"
            "- Every entity needs at least one quote copied VERBATIM from a "
            "member promise's statement — quotes are validated mechanically "
            "and a candidate with no valid quote is discarded.\n"
            "- Merge areas that are one thing; keep apart what the org "
            "keeps apart. Do not invent entities no promise supports.\n"
            "- aliases: other words the org uses for the same thing.\n"
            "- part_of: only when one entity is clearly inside another in "
            "this same list.\n"
            "- reasoning: record your actual thinking per entity — it is "
            "kept on the proposal verbatim, shown to the human who "
            "decides, and embedded into the map's memory.\n\n"
            f"## Derived areas (mechanical, advisory)\n{areas_block}\n\n"
            f"## Approved promises\n{promises_block}",
        )


class FakeEntityProposer:
    def __init__(self, canned: EntityCandidates) -> None:
        self._canned = canned

    def propose(
        self, areas_block: str, promises_block: str, workspace_id: str = ""
    ) -> EntityCandidates:
        return self._canned


def haiku_doc_complement_judge(name: str, identity: str, path: str) -> bool:
    """LLM-heuristic tier (like graph_heuristics): does this document
    contradict the entity's identity by DEFINITION — a register of the
    deferred attached to an entity about the current, a source artifact
    attached to an entity defined by not holding sources? Lexical
    similarity co-locates complements; only a reader catches the inversion.
    (Phrased independently of the eval judge in evals/seed_quality.py —
    the eval must not trivially mirror the mechanism it grades.)"""
    from langchain_anthropic import ChatAnthropic
    from pydantic import BaseModel, Field

    class Verdict(BaseModel):
        reasoning: str = ""
        contradicts_identity: bool = Field(
            description="True only when attaching this document to this "
            "entity would contradict the entity's own identity sentence — "
            "not when it is merely related"
        )

    model = ChatAnthropic(
        model="claude-haiku-4-5", temperature=0, max_tokens=256
    ).with_structured_output(Verdict)
    verdict = invoke_with_retry(
        model,
        f"Entity: “{name}”. Its identity: {identity or '(none given)'}\n"
        f"Document to attach: {path}\n\n"
        "Would attaching this document CONTRADICT the entity's identity "
        "by definition (opposite register, excluded material)? Mere "
        "relatedness is not contradiction.",
    )
    return bool(verdict.contradicts_identity)


def _validated(
    candidates: EntityCandidates, obligations_by_id: dict[str, str]
) -> tuple[list[EntityCandidate], list[str]]:
    """Mechanical validation: member ids must exist; quotes must be
    verbatim in the promise they cite. Violations drop, with notes."""
    kept, notes = [], []
    seen_names: set[str] = set()
    for candidate in candidates.entities:
        members = [m for m in candidate.member_obligation_ids if m in obligations_by_id]
        dropped_members = set(candidate.member_obligation_ids) - set(members)
        if dropped_members:
            notes.append(
                f"{candidate.name}: dropped unknown promises "
                f"{', '.join(sorted(dropped_members))}"
            )
        quotes = []
        for q in candidate.quotes:
            statement = obligations_by_id.get(q.obligation_id, "")
            if _normalize_quote(q.quote) and _normalize_quote(q.quote) in _normalize_quote(
                statement
            ):
                quotes.append(q)
            else:
                notes.append(
                    f"{candidate.name}: quote failed verbatim validation "
                    f"against {q.obligation_id}"
                )
        if not members or not quotes:
            notes.append(
                f"{candidate.name}: discarded — no "
                f"{'members' if not members else 'valid quotes'} (no quote, "
                f"no render)"
            )
            continue
        if candidate.name.lower() in seen_names:
            notes.append(f"{candidate.name}: duplicate name, discarded")
            continue
        seen_names.add(candidate.name.lower())
        candidate.member_obligation_ids = members
        candidate.quotes = quotes
        kept.append(candidate)
    return kept, notes


def _token_set(text: str) -> set[str]:
    """The scale guard's vocabulary. The scope_honesty eval deliberately
    re-implements the guard (mechanism and eval stay independent); only
    the tokenizer rules are shared, via quire.text."""
    return set(tokenize(text, min_len=3, keep_digits=True))


# A name whose words touch this share of ALL promises names the corpus,
# not a thing in it. Calibration: "Brain" 1.0 (kill), "Strict Mode" 0.44
# (a human's call — 18 of 41 promises is a broad capability, not the map).
_CORPUS_NAME_SHARE = 0.6


def _wrong_scale(
    name: str,
    statements_by_id: dict[str, str],
    workspace_id: str,
) -> str | None:
    """Deterministic scale guard (the 'Brain' rule, learned from the first
    live session): an entity must be smaller than the map. The
    names-most-of-the-corpus rule, recalibrated on the pydantic scale run —
    the old 2x-membership ratio discarded 'Strict Mode' five rounds running.
    Same rule as the scope_honesty eval (independently re-implemented there)
    — this is enforcement of a hard rule over an LLM finding, like quote
    validation."""
    name_tokens = _token_set(name)
    if not name_tokens:
        return None
    if name_tokens <= _token_set(workspace_id):
        return "the name is the workspace itself — an entity must be smaller than the map"
    total = len(statements_by_id)
    corpus_hits = sum(
        1
        for statement in statements_by_id.values()
        if name_tokens & _token_set(statement)
    )
    if total and corpus_hits / total >= _CORPUS_NAME_SHARE:
        return (
            f"name at the wrong scale — its words touch {corpus_hits} of "
            f"{total} promises; it names most of the corpus, not a thing in it"
        )
    return None

_DOC_SUFFIXES = (".md", ".rst", ".txt")


def _is_doc_path(path: str) -> bool:
    """Structural classification (not semantic): prose artifacts are docs,
    everything else bound to a promise is a code location."""
    lowered = path.lower()
    return lowered.endswith(_DOC_SUFFIXES) or lowered.startswith("docs/")


def _question(name: str, promises: int, code: int, docs: int) -> str:
    parts = [plural(promises, "promise")]
    if code:
        parts.append(plural(code, "code location"))
    if docs:
        parts.append(plural(docs, "document"))
    if len(parts) > 1:
        listed = ", ".join(parts[:-1]) + f" and {parts[-1]}"
    else:
        listed = parts[0]
    if promises + code + docs == 1:
        return f"This {listed} describes one thing — call it {name}?"
    return f"These {listed} describe one thing — call it {name}?"


def seed_proposals(
    workspace_dir: pathlib.Path,
    adapter,
    proposer,
    now: str,
    doc_judge=None,
) -> dict:
    """Areas + promises → validated entity proposals, appended to the diff
    log (which enforces the open cap and rejected-shape suppression)."""
    from quire.ask import load_group_state

    state = load_group_state(workspace_dir, adapter)
    obligations = list(adapter.obligations())
    obligations_by_id = {o.obligation_id: o.statement for o in obligations}
    # Where each promise comes from — the card shows the org's own address
    # for a quote ("prd #mcp-surface"), not just an internal id.
    source_of = {
        o.obligation_id: " ".join(
            part
            for part in (
                getattr(o, "source_reference", ""),
                getattr(o, "source_section", ""),
            )
            if part
        )
        for o in obligations
    }
    graph = graph_state(load_diffs(workspace_dir))

    areas_block = "\n".join(
        f"- {g['label']}: promises {', '.join(g['obligation_ids'])}; "
        f"code {', '.join(g['files'][:6])}"
        for g in state["groups"]
    )
    promises_block = "\n".join(
        f"- {ob_id}: {statement}" for ob_id, statement in obligations_by_id.items()
    )
    candidates = proposer.propose(
        areas_block, promises_block, workspace_id=workspace_dir.name
    )
    kept, notes = _validated(candidates, obligations_by_id)

    # Paths come exclusively from the approved bindings — and each carries
    # WHICH promise bound it, so the card can show the chain instead of
    # asking the human to approve bindings on faith.
    files_by_obligation: dict[str, list[str]] = {}
    bound_by: dict[str, set[str]] = {}
    cp_by_id = {cp.control_point_id: cp for cp in adapter.control_points()}
    for binding in adapter.bindings():
        if binding.control_point_id in cp_by_id:
            path = cp_by_id[binding.control_point_id].path
            files_by_obligation.setdefault(binding.obligation_id, []).append(path)
            bound_by.setdefault(path, set()).add(binding.obligation_id)

    taken = set(graph["entities"])
    built: list[tuple[EntityCandidate, GraphDiff, str]] = []
    for candidate in kept:
        if resolve_entity(graph, candidate.name):
            notes.append(
                f"{candidate.name}: an entity already answers to this name — skipped"
            )
            continue
        scale_error = _wrong_scale(
            candidate.name, obligations_by_id, workspace_dir.name,
        )
        if scale_error:
            notes.append(f"{candidate.name}: discarded — {scale_error}")
            continue
        entity_id = slug_entity_id(candidate.name, taken)
        taken.add(entity_id)
        bound_paths = sorted(
            {
                path
                for ob_id in candidate.member_obligation_ids
                for path in files_by_obligation.get(ob_id, [])
            }
        )
        # Documents are a different holding kind from code locations
        # (PRD §1–2) — a spec bound to a promise is evidence, not an
        # enforcement site, and the card must not count it as one.
        code_paths = [p for p in bound_paths if not _is_doc_path(p)]
        doc_paths = [p for p in bound_paths if _is_doc_path(p)]
        if doc_judge is not None:
            kept_docs = []
            for path in doc_paths:
                if doc_judge(candidate.name, candidate.identity_sentence, path):
                    notes.append(
                        f"{candidate.name}: not attaching {path} — it "
                        f"contradicts the entity's identity (a complement, "
                        f"not a member; co-mention put it here)"
                    )
                else:
                    kept_docs.append(path)
            doc_paths = kept_docs
        operations = [
            CreateEntity(
                entity_id=entity_id,
                name=candidate.name,
                identity_sentence=candidate.identity_sentence,
                aliases=candidate.aliases,
            ),
            *[
                Attach(entity_id=entity_id, kind="promise", ref=ob_id)
                for ob_id in candidate.member_obligation_ids
            ],
            *[
                Attach(
                    entity_id=entity_id,
                    kind="doc" if _is_doc_path(path) else "code",
                    ref=path,
                    note="bound to " + ", ".join(sorted(bound_by.get(path, []))),
                )
                for path in code_paths + doc_paths
            ],
        ]
        built.append((candidate, GraphDiff(
                diff_id="",  # minted by append_proposals
                question=_question(candidate.name, len(candidate.member_obligation_ids),
                                   len(code_paths), len(doc_paths)),
                proposed_by="llm",
                reasoning=candidate.reasoning,
                evidence=[
                    EvidenceQuote(
                        quote=q.quote,
                        source=f"{q.obligation_id} · "
                        + (source_of.get(q.obligation_id) or "approved promise"),
                    )
                    for q in candidate.quotes
                ],
                operations=operations,
                mechanics_note=(
                    "the file attachments come from approved code links, "
                    "not from reasoning — each is individually removable in Edit"
                ),
            ), entity_id))

    # part_of only to entities ALREADY on the map: a relation to a
    # sibling proposal would make one approval depend on another's — and
    # diffs must be approvable in any order. Within-batch containment
    # arrives as a follow-up proposal once both entities exist.
    for candidate, proposal, entity_id in built:
        if not candidate.part_of:
            continue
        container = resolve_entity(graph, candidate.part_of)
        if container and container["entity"]:
            proposal.operations.append(
                Relate(
                    entity_id=entity_id,
                    relation="part_of",
                    other_id=container["entity"]["entity_id"],
                )
            )
        else:
            notes.append(
                f"{candidate.name}: part_of '{candidate.part_of}' deferred — "
                f"the container is not on the map yet"
            )

    report = append_proposals(workspace_dir, [p for _, p, _ in built], now)

    # Conservation: every approved promise is placed, already housed, or
    # NAMED here. A promise silently missing from the seed was the worst
    # defect of the first live session — the mirror must say what it is
    # not showing.
    housed = {
        h["ref"]
        for e in graph["entities"].values()
        if e["status"] == "active"
        for h in e["holdings"]
        if h["kind"] == "promise"
    }
    # Only proposals that actually LANDED count as placed — a proposal
    # deferred by the open-cap has no card, so its promises are unplaced
    # until it returns (append_proposals mints diff ids only on add).
    placed = {
        op.ref
        for _, p, _ in built
        if p.diff_id
        for op in p.operations
        if op.op == "attach" and op.kind == "promise"
    }
    unplaced = sorted(set(obligations_by_id) - placed - housed)
    return {
        **report,
        "notes": notes,
        "candidates": len(candidates.entities),
        "unplaced": unplaced,
    }
