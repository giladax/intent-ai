"""The community card: free text in the org's dialect → everything we know.

Query resolution ladder (same trust philosophy as the authority ladder —
the LLM translates, it never decides):

1. **Alias / label hit** — deterministic. The term matches a confirmed
   alias, a group label, an obligation id, or a file path segment.
2. **Lexical scoring** — deterministic. TF-IDF overlap between the query
   and each community's accumulated vocabulary (labels, obligation
   statements, file path tokens). A clear winner resolves.
3. **LLM translation** — heuristic, only on ambiguity or zero-hit. One
   Haiku call may pick among EXISTING groups; it cannot invent one.

The query word is never stored. A resolution becomes durable only when a
human confirms it — then it's persisted as an alias in the workspace's
groups.yaml, and rung 1 answers instantly forever after. The dialect is
learned from confirmed use.

Groups are derived on demand from the approved contract + persisted
constraints (deterministic, instant at contract scale) — never stale.
The card itself is pure assembly over data the store already holds.
"""

from __future__ import annotations

import pathlib

import yaml
from pydantic import BaseModel, Field

from quire_align.grouping import GroupingConstraints, group_contract
from quire_align.text import tokenize
from quire_align.timeline import build_timeline

# Roughly "one in five query terms found in the community's vocabulary".
# Below this, lexical overlap is noise and rung 3 (LLM translation) is
# worth its call; above it, the deterministic answer stands on its own.
_LEXICAL_RESOLVE_MIN = 0.18
# The top community must beat the runner-up by this factor — a near-tie
# means the term is genuinely ambiguous, so we fall through to the LLM
# rung (or return unresolved) rather than guess between neighbors.
_LEXICAL_MARGIN = 1.5


class TermPick(BaseModel):
    """Structured output for the LLM translation rung."""

    anchor: str = Field(
        description="anchor obligation id of the best-matching group, or empty if none fits"
    )
    confidence: float = Field(ge=0.0, le=1.0, default=0.5)
    reasoning: str = ""


def load_group_state(workspace_dir: pathlib.Path, adapter) -> dict:
    """Derive current groups from the approved contract + saved constraints."""
    constraints, aliases = GroupingConstraints(), {}
    groups_file = workspace_dir / "groups.yaml"
    if groups_file.exists():
        data = yaml.safe_load(groups_file.read_text()) or {}
        constraints = GroupingConstraints.model_validate(data.get("constraints") or {})
        aliases = data.get("aliases") or {}
    obligations = [
        {
            "obligation_id": o.obligation_id,
            "statement": o.statement,
            "source_section": o.source_section,
        }
        for o in adapter.obligations()
    ]
    cp_by_id = {cp.control_point_id: cp for cp in adapter.control_points()}
    bindings = [
        {
            "obligation_id": b.obligation_id,
            "path": cp_by_id[b.control_point_id].path,
            "relation": b.relation.value,
        }
        for b in adapter.bindings()
        if b.control_point_id in cp_by_id
    ]
    grouped = group_contract(obligations, bindings, constraints=constraints)
    return {**grouped, "aliases": aliases, "constraints": constraints}


def _query_terms(q: str) -> set[str]:
    return set(tokenize(q, min_len=3, keep_digits=True))


def _group_vocab(group: dict, obligations_by_id: dict) -> set[str]:
    vocab = _query_terms(group["label"])
    for ob_id in group["obligation_ids"]:
        vocab |= _query_terms(obligations_by_id.get(ob_id, ""))
    for path in group["files"]:
        vocab |= _query_terms(path.replace("/", " ").replace("_", " ").replace(".", " "))
    return vocab


def resolve_term(
    q: str,
    state: dict,
    obligations: list[dict],
    llm_pick=None,
) -> dict:
    """Returns {group, method, confidence, alternatives} — group may be None."""
    groups = state["groups"]
    by_anchor = {g["anchor"]: g for g in groups}
    q_norm = " ".join(q.lower().split())

    # Rung 1 — confirmed aliases, labels, ids, path segments (deterministic).
    for term, anchor in (state.get("aliases") or {}).items():
        if term.lower() == q_norm and anchor in by_anchor:
            return {"group": by_anchor[anchor], "method": "alias", "confidence": 1.0, "alternatives": []}
    for g in groups:
        if q_norm == g["label"].lower() or q_norm in [i.lower() for i in g["obligation_ids"]]:
            return {"group": g, "method": "label", "confidence": 1.0, "alternatives": []}

    # Rung 2 — lexical overlap (deterministic).
    obligations_by_id = {o["obligation_id"]: o["statement"] for o in obligations}
    q_terms = _query_terms(q)
    scored = []
    for g in groups:
        vocab = _group_vocab(g, obligations_by_id)
        overlap = len(q_terms & vocab) / max(len(q_terms), 1)
        scored.append((overlap, g))
    scored.sort(key=lambda x: -x[0])
    if scored and scored[0][0] >= _LEXICAL_RESOLVE_MIN:
        top, runner = scored[0], (scored[1] if len(scored) > 1 else (0.0, None))
        if runner[0] == 0 or top[0] / max(runner[0], 1e-9) >= _LEXICAL_MARGIN:
            return {
                "group": top[1],
                "method": "lexical",
                "confidence": round(min(top[0] * 2, 0.95), 2),
                "alternatives": [g["group_id"] for score, g in scored[1:3] if score > 0],
            }

    # Rung 3 — LLM translation among existing groups only (heuristic).
    if llm_pick is not None:
        menu = "\n".join(
            f"- anchor={g['anchor']} :: {g['group_id']} \"{g['label']}\"\n"
            + "\n".join(
                f"    · {obligations_by_id.get(i, '')}" for i in g["obligation_ids"][:5]
            )
            for g in groups
        )
        pick = llm_pick(
            "An engineer typed a term from their company's vocabulary. Pick "
            "the ONE product area below it most likely refers to, or return "
            "an empty anchor if none fits. You may only choose from the "
            "list — never invent an area.\n\n"
            f"Term: \"{q}\"\n\n## Product areas\n{menu}"
        )
        if pick.anchor and pick.anchor in by_anchor:
            return {
                "group": by_anchor[pick.anchor],
                "method": "llm",
                "confidence": round(pick.confidence, 2),
                "alternatives": [g["group_id"] for score, g in scored[:2] if score > 0],
            }

    return {
        "group": None,
        "method": "unresolved",
        "confidence": 0.0,
        "alternatives": [g["group_id"] for score, g in scored[:3] if score > 0],
    }


def haiku_pick(prompt: str) -> TermPick:
    from langchain_anthropic import ChatAnthropic

    model = ChatAnthropic(
        model="claude-haiku-4-5", temperature=0, max_tokens=512
    ).with_structured_output(TermPick)
    return model.invoke(prompt)


def community_card(adapter, store, group: dict, state: dict) -> dict:
    """Assemble everything known about one community — pure aggregation."""
    analyses = store.list_analyses(repository=adapter.repository())
    timeline = build_timeline(adapter, analyses)
    events = timeline["events"]
    current = events[-1]["state_after"] if events else {}
    group_files = set(group["files"])
    member_ids = set(group["obligation_ids"])
    obligations_by_id = {o["obligation_id"]: o for o in timeline["obligations"]}

    recent = [
        {
            "pr_number": e["pr_number"],
            "title": e["title"],
            "verdict": e["verdict"],
            "ts": e["ts"],
            "changes": [c for c in e["changes"] if c["obligation_id"] in member_ids],
        }
        for e in events
        if member_ids & {c["obligation_id"] for c in e["changes"]}
    ][-8:]

    open_findings = []
    if events:
        for f in events[-1]["open_findings"]:
            # attribute findings to the group via the changed paths recorded
            # in the analysis' behavioral delta
            matching = [
                a
                for a in analyses
                if a.pr_number == f["pr_number"] and a.behavioral_delta is not None
            ]
            paths = {
                p
                for a in matching
                for c in a.behavioral_delta.changes
                for p in c.control_point_paths
            }
            if paths & group_files:
                open_findings.append(f)

    weights = {m["obligation_id"]: m["weight"] for m in group["members"]}
    return {
        "group_id": group["group_id"],
        "label": group["label"],
        "anchor": group["anchor"],
        "aliases": [t for t, a in (state.get("aliases") or {}).items() if a == group["anchor"]],
        "obligations": [
            {
                **obligations_by_id.get(ob_id, {"obligation_id": ob_id}),
                "weight": weights.get(ob_id, 1.0),
                "health": current.get(ob_id, {"status": "unobserved"}),
            }
            for ob_id in group["obligation_ids"]
        ],
        "files": group["files"],
        "bridges": [b for b in state.get("bridges", []) if b["path"] in group_files],
        "recent_events": recent,
        "open_findings": open_findings,
    }


def save_alias(workspace_dir: pathlib.Path, term: str, anchor: str) -> None:
    """Human-confirmed resolution → durable alias (the dialect, learned)."""
    groups_file = workspace_dir / "groups.yaml"
    data = yaml.safe_load(groups_file.read_text()) if groups_file.exists() else {}
    data = data or {}
    data.setdefault("aliases", {})[term.lower().strip()] = anchor
    groups_file.write_text(yaml.safe_dump(data, sort_keys=False))
