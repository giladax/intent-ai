"""Plot atoms: the derived narrative currency of the map.

Every event the product stores decomposes into pre-cited atoms —
"QUIREB-006 flipped kept→broken at check #7", "GD-1 declined,
wrong name", "the grouping returned as GD-7 under a new name". Atoms are
deterministic derivations (no LLM), cheap to recompute, and they are
what stories, answers, and relevance vectors compose from: the LLM
phrases atoms, it never reads raw tables — which is why validated
citations almost never drop.

Derived and disposable; never read by the fold.
"""

from __future__ import annotations

import pathlib

from quire_align.entity_graph import graph_state, load_diffs

_FLIP_LABEL = {
    "satisfies": "kept",
    "partially_satisfies": "partly kept",
    "contradicts": "broken",
}


def _cite(kind: str, ref: str) -> dict:
    return {"kind": kind, "ref": str(ref)}


def _decision_atoms(diffs, promise_sets_rejected) -> list[dict]:
    atoms = []
    for d in diffs:
        members = frozenset(
            op.ref for op in d.operations
            if op.op == "attach" and op.kind == "promise"
        )
        if d.status == "open":
            returned = members and members in promise_sets_rejected
            atoms.append({
                "kind": "returned" if returned else "proposed",
                "at": d.proposed_at,
                "text": (
                    f"The grouping rejected earlier returned as {d.diff_id}, "
                    f"unsigned, under a new shape: “{d.question}”"
                    if returned
                    else f"{d.diff_id} sits unsigned, in quires: “{d.question}”"
                ),
                "cites": [_cite("diff", d.diff_id)],
            })
            continue
        who, when = d.decision.by, d.decision.at
        if d.status == "rejected":
            reason = d.decision.reason_code.replace("_", " ")
            teaching = (
                f' — teaching: "{d.decision.reason_text}"'
                if d.decision.reason_text else ""
            )
            atoms.append({
                "kind": "declined",
                "at": when,
                "text": f"{who} declined {d.diff_id} ({reason}{teaching}): “{d.question}”",
                "cites": [_cite("diff", d.diff_id)],
            })
            continue
        for op in d.effective_operations():
            if op.op == "create_entity":
                atoms.append({
                    "kind": "born",
                    "at": when,
                    "entity_id": op.entity_id,
                    "text": f"{who} signed {d.diff_id}, putting “{op.name}” on the map"
                    + (" (edited before signing)" if d.decision.amended else ""),
                    "cites": [_cite("diff", d.diff_id)],
                })
            elif op.op == "supersede":
                atoms.append({
                    "kind": "superseded",
                    "at": when,
                    "entity_id": op.entity_id,
                    "text": f"{who} signed {d.diff_id}, retiring {op.entity_id} "
                    f"into {op.successor_id}; every promise's fate was enumerated",
                    "cites": [_cite("diff", d.diff_id)],
                })
            elif op.op == "alias" and d.proposed_by.startswith("human:"):
                for term in op.terms:
                    atoms.append({
                        "kind": "taught",
                        "at": when,
                        "entity_id": op.entity_id,
                        "text": f"{who} taught the map that “{term}” names {op.entity_id}",
                        "cites": [_cite("diff", d.diff_id), _cite("teach", term)],
                    })
    return atoms


def _flip_atoms(adapter, store) -> list[dict]:
    """Verdict changes per promise, walked from the check timeline — the
    wounds and recoveries that make a story a story."""
    from quire_align.timeline import build_timeline

    analyses = store.list_analyses(repository=adapter.repository())
    events = build_timeline(adapter, analyses)["events"]
    atoms: list[dict] = []
    prior: dict[str, str] = {}
    for event in events:
        for ref, entry in event["state_after"].items():
            status = entry.get("status")
            if status not in _FLIP_LABEL:
                continue
            label = _FLIP_LABEL[status]
            if prior.get(ref) == label:
                continue
            was = prior.get(ref)
            check = event["pr_number"]
            if was is None and label == "kept":
                text = f"{ref} was first exercised at check #{check} and held"
            elif label == "kept":
                text = f"{ref} recovered at check #{check} — kept again, after being {was}"
            else:
                text = f"{ref} went {label} at check #{check}" + (
                    f", after being {was}" if was else ""
                )
            atoms.append({
                "kind": "flip",
                "at": str(event.get("ts", "")),
                "promise": ref,
                "state": label,
                "text": text,
                "cites": [_cite("check", check), _cite("promise", ref)],
            })
            prior[ref] = label
    return atoms


def atoms_for(
    workspace_dir: pathlib.Path, adapter, store, entity_id: str = ""
) -> list[dict]:
    """All atoms for a workspace, oldest first; optionally scoped to one
    entity (its diffs, its promises' flips, its teachings)."""
    diffs = load_diffs(workspace_dir)
    rejected_sets = {
        frozenset(
            op.ref for op in d.operations
            if op.op == "attach" and op.kind == "promise"
        )
        for d in diffs
        if d.status == "rejected"
    }
    rejected_sets.discard(frozenset())
    atoms = _decision_atoms(diffs, rejected_sets) + _flip_atoms(adapter, store)
    if entity_id:
        state = graph_state(diffs)
        entity = state["entities"].get(entity_id)
        refs = (
            {h["ref"] for h in entity["holdings"] if h["kind"] == "promise"}
            if entity else set()
        )
        atoms = [
            a for a in atoms
            if a.get("entity_id") == entity_id or a.get("promise") in refs
        ]
    return sorted(atoms, key=lambda a: a.get("at") or "")
