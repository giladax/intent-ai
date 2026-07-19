"""The working mind: the map thinking out loud.

The signed record is deliberately small and ceremonial — that is what
makes it trustworthy. This layer is deliberately neither: the machine
freely mints nodes of ANY kind — concepts, tensions, questions, themes,
boundaries, bets, whatever shape helps define and reason about the
organization — with no cap, no suppression, no signing ceremony. Nodes
here are thinking tools, clearly marked unsigned; a node that earns
belief gets promoted through the existing proposal path.

Sweeps EVOLVE the mind rather than restart it (get_mind feeds the prior
nodes back in): a thought that still holds keeps its birthday, one the
mind drops is recorded retired with a why (or as "faded" when it simply
wasn't re-derived), and a human dismissal is a signed verdict that stays
dead across future sweeps unless the evidence is genuinely new.

The one discipline kept is not-lying: every connection must point at
something real (a promise, an entity, a check, a decision, a document).
Unresolvable connections drop; a node whose connections all drop was
about nothing and drops with them. That isn't a rule for ceremony's
sake — it's what keeps the mind attached to the world.

Derived, never read by the fold, never requires anyone's signature to
exist. The nodes regenerate when the world changes; the dismissed list
is the one part that is a signed human record, not derivation.
"""

from __future__ import annotations

import hashlib
import pathlib

import yaml
from pydantic import BaseModel, Field

from quire_align.entity_graph import graph_state, load_diffs
from quire_align.fs import atomic_write_text
from quire_align.llm_retry import invoke_with_retry

MIND_MODEL = "claude-sonnet-4-6"
# retirements are a bounded trail, not an archive — enough to answer
# "what did it used to think?", never an unbounded append-only log
_RETIRED_KEPT = 40


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
    salience: str = Field(
        default="ambiguous",
        description="your own triage of this thought: 'important' (a "
        "human should see this), 'ambiguous' (real but unresolved — "
        "worth holding), or 'probably-noise' (kept only until someone "
        "confirms it's trash). Be honest — triage IS part of the work.",
    )
    connects: list[Connection] = Field(default_factory=list)


class RetiredNode(BaseModel):
    name: str
    why: str = Field(default="", description="why this thought no longer holds")


class Mind(BaseModel):
    nodes: list[ConceptNode] = Field(default_factory=list)
    retired: list[RetiredNode] = Field(
        default_factory=list,
        description="previous nodes that no longer hold, each with why",
    )


class MindLLM:
    """Two-phase, per the owner's directive and the SOTA findings: the
    goal is maximum understanding, so THINKING RUNS FREE (plain prose,
    no schema to strangle or truncate it) and STRUCTURE HAPPENS AT THE
    EDGE (a second pass extracts nodes from the mind's own notes). The
    empty-tool-call and silent-truncation failures were both symptoms of
    forcing structure onto thought."""

    def __init__(self, model: str = MIND_MODEL) -> None:
        from langchain_anthropic import ChatAnthropic

        self._thinker = ChatAnthropic(
            model=model, temperature=0.6, max_tokens=8192
        )
        self._structurer = ChatAnthropic(
            model=model, temperature=0, max_tokens=16384
        ).with_structured_output(Mind)

    def sweep(self, corpus: str, previous: str = "") -> Mind:
        notes = self._thinker.invoke(
            "You are the working mind of an organization's map. Below is "
            "everything the map knows. THINK, in plain prose — no format, "
            "no schema, no restraint. Notice what helps define and reason "
            "about this organization: concepts two records share but "
            "nobody named; tensions between promises; open questions the "
            "evidence raises; boundaries the org keeps circling; themes "
            "in what keeps breaking; bets the org seems to be making; "
            "reversals of its own doctrine; anything else. Ground every "
            "observation in the real ids and paths you see — name them "
            "as you think.\n"
            + (
                "\n## Your previous sweep's nodes\nEvolve your own mind, "
                "don't restart it: keep what still holds (sharpen it if "
                "the evidence moved), retire what no longer holds and say "
                "why, and add what is new since.\n" + previous + "\n"
                if previous
                else ""
            )
            + f"\n## The corpus\n{corpus}"
        ).content
        mind = invoke_with_retry(
            self._structurer,
            "Below are YOUR OWN thinking notes about an organization. "
            "Extract every distinct thought as a node — kind (freeform), "
            "name, one-sentence gloss, the reasoning verbatim from your "
            "notes, and its connections (the real ids/paths your notes "
            "cite; they are checked mechanically). If the notes retire "
            "any previous node, list it under retired with the why. Lose "
            "NOTHING that the notes contain.\n\n"
            f"## The notes\n{notes}",
        )
        if mind.nodes:
            return mind
        # structure-extraction refused despite notes existing — one retry
        return invoke_with_retry(
            self._structurer,
            "Extract EVERY distinct thought from these notes as nodes — "
            "an empty extraction of non-empty notes is a failure.\n\n"
            f"## The notes\n{notes}",
        )


class FakeMind:
    def __init__(self, canned: Mind) -> None:
        self._canned = canned
        self.last_previous = ""

    def sweep(self, corpus: str, previous: str = "") -> Mind:
        self.last_previous = previous
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
                reasoning=node.reasoning, salience=node.salience,
                connects=resolved,
            ))
    return kept, dropped_connections


def _mind_file(workspace_dir: pathlib.Path) -> pathlib.Path:
    return workspace_dir / "mind.yaml"


def _write_mind(workspace_dir: pathlib.Path, data: dict) -> None:
    atomic_write_text(
        _mind_file(workspace_dir),
        "# The working mind — unsigned thinking tools; never read by the\n"
        "# fold. Nodes regenerate when the world changes; the dismissed\n"
        "# list is a signed human record and survives resweeps.\n"
        + yaml.safe_dump(data, sort_keys=False, allow_unicode=True),
    )


def _previous_block(cached: dict | None) -> str:
    """The mind's own prior nodes plus human-dismissed thoughts, rendered
    for the evolve pass. Evolution over regeneration (A-MEM/Mem0): keep,
    sharpen, retire with reasons — never restart cold. A human dismissal
    is validated trash: it stays dead unless the evidence is NEW."""
    if not cached:
        return ""
    lines = [
        f"- [{n['kind']} · {n.get('salience', 'ambiguous')}] {n['name']}: "
        f"{n['gloss']} (first seen {n.get('first_seen', '?')[:10]})"
        for n in cached.get("nodes", [])
    ]
    for d in cached.get("dismissed", []):
        lines.append(
            f"- DISMISSED BY {d.get('by', 'a human')}: “{d['name']}”"
            + (f" — {d['why']}" if d.get("why") else "")
            + " (do not re-mint unless the evidence is genuinely new)"
        )
    return "\n".join(lines)


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
    mind = thinker.sweep(corpus, previous=_previous_block(cached))
    nodes, dropped = validate_mind(mind, universe)
    # continuity: a re-derived thought keeps its birthday; one that
    # vanished without a declared retirement is recorded as faded
    prior = {n["name"].lower(): n for n in (cached or {}).get("nodes", [])}
    node_dumps = []
    for n in nodes:
        dump = n.model_dump()
        dump["first_seen"] = prior.get(n.name.lower(), {}).get("first_seen", now)
        node_dumps.append(dump)
    current_names = {n.name.lower() for n in nodes}
    retired = [r.model_dump() | {"at": now} for r in mind.retired]
    declared = {r["name"].lower() for r in retired}
    retired += [
        {"name": p["name"], "why": "faded — not re-derived", "at": now}
        for name, p in prior.items()
        if name not in current_names and name not in declared
    ]
    entry = {
        "input_hash": input_hash,
        "nodes": node_dumps,
        "retired": ((cached or {}).get("retired", []) + retired)[-_RETIRED_KEPT:],
        "dismissed": (cached or {}).get("dismissed", []),
        "dropped_connections": dropped,
        "swept_at": now,
        "model": MIND_MODEL,
    }
    _write_mind(workspace_dir, entry)
    return entry


def dismiss_thought(
    workspace_dir: pathlib.Path, name: str, by: str, now: str, why: str = ""
) -> dict:
    """Human-validated trash: a signed dismissal. The thought leaves the
    mind and stays dead across future sweeps unless evidence is new —
    triage IS part of the work, and this half of it is the human's."""
    path = _mind_file(workspace_dir)
    cached = (yaml.safe_load(path.read_text()) or {}) if path.exists() else {}
    lowered = name.lower()
    cached["nodes"] = [
        n for n in cached.get("nodes", []) if n["name"].lower() != lowered
    ]
    cached.setdefault("dismissed", []).append(
        {"name": name, "by": by, "at": now, "why": why}
    )
    _write_mind(workspace_dir, cached)
    return cached
