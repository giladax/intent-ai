"""The working mind: the map thinking out loud.

The signed record is deliberately small and ceremonial — that is what
makes it trustworthy. This layer is deliberately neither: the machine
freely mints nodes of ANY kind — concepts, tensions, questions, themes,
boundaries, bets, whatever shape helps define and reason about the
organization — with no cap, no suppression, no signing ceremony. Nodes
here are thinking tools, clearly marked unsigned; a node that earns
belief gets promoted through the existing proposal path, and one that
doesn't just evaporates on the next sweep.

The one discipline kept is not-lying: every connection must point at
something real (a promise, an entity, a check, a decision, a document).
Unresolvable connections drop; a node whose connections all drop was
about nothing and drops with them. That isn't a rule for ceremony's
sake — it's what keeps the mind attached to the world.

Derived, disposable, regenerated when the world changes. Never read by
the fold; never requires anyone's signature to exist.
"""

from __future__ import annotations

import hashlib
import pathlib

import yaml
from pydantic import BaseModel, Field

from quire_align.entity_graph import graph_state, load_diffs
from quire_align.llm_retry import invoke_with_retry

MIND_MODEL = "claude-sonnet-4-6"


class Connection(BaseModel):
    ref: str = Field(description="a real id or path: entity id, promise id, GD-N, check number, or a document/code path")
    why: str = Field(default="", description="one line: why this connects")


class ConceptNode(BaseModel):
    kind: str = Field(description="freeform — concept, tension, question, theme, boundary, bet, smell, whatever fits")
    name: str
    gloss: str = Field(description="one sentence a person reads and gets it")
    reasoning: str = Field(
        default="",
        description="the thinking that led here — kept on the node "
        "verbatim, shown to humans, embedded into the map's memory",
    )
    connects: list[Connection] = Field(default_factory=list)


class Mind(BaseModel):
    nodes: list[ConceptNode] = Field(default_factory=list)


class MindLLM:
    def __init__(self, model: str = MIND_MODEL) -> None:
        from langchain_anthropic import ChatAnthropic

        self._model = ChatAnthropic(
            model=model, temperature=0.4, max_tokens=4096
        ).with_structured_output(Mind)

    def sweep(self, corpus: str) -> Mind:
        # An empty mind is a known structured-output failure mode (the
        # model calls the tool with no nodes); one nudged retry recovers
        # it — thinking is the job, not optional.
        first = self._sweep(corpus)
        if first.nodes:
            return first
        return self._sweep(
            corpus
            + "\n\n(Your previous attempt returned ZERO nodes — that is a "
            "failure to think, not restraint. Produce the nodes now.)"
        )

    def _sweep(self, corpus: str) -> Mind:
        return invoke_with_retry(
            self._model,
            "You are the working mind of an organization's map. Below is "
            "everything the map knows. Think out loud by CREATING NODES — "
            "as many as genuinely help define and reason about this "
            "organization. There is no cap and no ceremony: these are "
            "thinking tools, not decisions.\n\n"
            "Make nodes of any kind you find useful — a concept two "
            "records share but nobody named; a tension between two "
            "promises; an open question the evidence raises; a boundary "
            "the org keeps circling; a theme in what keeps breaking; a "
            "bet the org seems to be making. Name the kind freely.\n\n"
            "Each node: a short name in the org's language, one honest "
            "gloss sentence, and its connections — every connection MUST "
            "use a real id or path from the corpus (they are checked "
            "mechanically; a connection to nothing is dropped) with one "
            "line of why. Prefer nodes that connect ACROSS records — the "
            "map already knows what sits inside one.\n\n"
            "Record your reasoning on every node — the actual thinking "
            "that led you there, verbatim. It stays on the node: humans "
            "read it, and the map embeds it as memory.\n\n"
            "Produce the nodes NOW, in the structured output — a corpus "
            "this size should yield at least five; an empty mind is a "
            "failure to think, not restraint.\n\n"
            f"## The corpus\n{corpus}",
        )


class FakeMind:
    def __init__(self, canned: Mind) -> None:
        self._canned = canned

    def sweep(self, corpus: str) -> Mind:
        return self._canned


def _corpus_and_universe(workspace_dir, adapter, store) -> tuple[str, set[str]]:
    from quire_align.atoms import atoms_for

    diffs = load_diffs(workspace_dir)
    state = graph_state(diffs)
    universe: set[str] = set()
    lines: list[str] = []
    for entity in state["entities"].values():
        universe.add(entity["entity_id"])
        lines.append(
            f"- entity {entity['entity_id']} “{entity['name']}”: "
            f"{entity['identity_sentence']}"
        )
        for h in entity["holdings"]:
            universe.add(h["ref"])
            if h["kind"] != "promise":
                lines.append(f"  - {h['kind']}: {h['ref']}")
    for o in adapter.obligations():
        universe.add(o.obligation_id)
        lines.append(f"- promise {o.obligation_id}: {o.statement}")
    for d in diffs:
        universe.add(d.diff_id)
    for a in store.list_analyses(repository=adapter.repository()):
        universe.add(str(a.pr_number))
        universe.add(f"check #{a.pr_number}")
    lines += [
        f"- event: {a['text']} ({', '.join(c['ref'] for c in a['cites'])})"
        for a in atoms_for(workspace_dir, adapter, store)
    ]
    return "\n".join(lines), universe


def validate_mind(mind: Mind, universe: set[str]) -> tuple[list[ConceptNode], int]:
    """Not-lying, mechanically: connections must point at something real.
    Everything else — kind, count, shape — is free."""
    kept, dropped_connections = [], 0
    for node in mind.nodes:
        resolved = [c for c in node.connects if c.ref in universe]
        dropped_connections += len(node.connects) - len(resolved)
        if resolved:
            kept.append(ConceptNode(
                kind=node.kind, name=node.name, gloss=node.gloss,
                reasoning=node.reasoning, connects=resolved,
            ))
    return kept, dropped_connections


def _mind_file(workspace_dir: pathlib.Path) -> pathlib.Path:
    return workspace_dir / "mind.yaml"


def get_mind(
    workspace_dir: pathlib.Path, adapter, store, thinker=None, now: str = ""
) -> dict | None:
    """The current working mind — cached, reswept when the world changes.
    thinker=None → cache only."""
    corpus, universe = _corpus_and_universe(workspace_dir, adapter, store)
    input_hash = hashlib.sha256(corpus.encode()).hexdigest()[:16]
    path = _mind_file(workspace_dir)
    cached = None
    if path.exists():
        cached = yaml.safe_load(path.read_text()) or None
    if cached and cached.get("input_hash") == input_hash:
        return cached
    if thinker is None:
        return cached  # a stale mind still helps; None when never swept
    mind = thinker.sweep(corpus)
    nodes, dropped = validate_mind(mind, universe)
    entry = {
        "input_hash": input_hash,
        "nodes": [n.model_dump() for n in nodes],
        "dropped_connections": dropped,
        "swept_at": now,
        "model": MIND_MODEL,
    }
    import os
    import tempfile

    payload = (
        "# The working mind — unsigned thinking tools; disposable;\n"
        "# never read by the fold; regenerated when the world changes.\n"
        + yaml.safe_dump(entry, sort_keys=False, allow_unicode=True)
    )
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    with os.fdopen(fd, "w") as handle:
        handle.write(payload)
    os.replace(tmp, path)
    return entry
