"""The teaching loop: human input becomes graph learning.

Two gestures, two paths (both through the diff log — rule 5 holds):

- **Teaching a word** (``teach_alias``): "payments" is another name for
  an entity. Zero blast radius beyond search, and the human saying it IS
  the authority — so the diff is proposed and decided in one gesture,
  signed, with the full receipt in the log. The word is never stored
  until a human confirms it (the dialect is learned from confirmed use).
- **Changing shared meaning** (``teach_create``, ``correct``): a new
  entity, a rename, a re-relation, a detachment. These affect what
  everyone else reads, so they mint OPEN human-proposed cards and take
  the same inbox path as machine proposals — blast-radius ordered,
  edit-first, structured rejection.

Human proposals bypass the open cap and machine-shape suppression (see
append_proposals): those exist to make the machine earn attention.
"""

from __future__ import annotations

import pathlib

from quire_align.entity_graph import (
    AddAlias,
    CreateEntity,
    Detach,
    EvidenceQuote,
    GraphDiff,
    GraphIntegrityError,
    Relate,
    Rename,
    append_proposals,
    decide,
    graph_state,
    load_diffs,
    resolve_entity,
    slug_entity_id,
)


def _require_entity(workspace_dir: pathlib.Path, entity_id: str) -> dict:
    state = graph_state(load_diffs(workspace_dir))
    entity = state["entities"].get(entity_id)
    if entity is None:
        raise KeyError(f"no entity '{entity_id}'")
    if entity["status"] != "active":
        raise GraphIntegrityError(
            f"'{entity_id}' is superseded — teach its successor instead"
        )
    return entity


def _append_human(
    workspace_dir: pathlib.Path, diff: GraphDiff, now: str
) -> GraphDiff:
    report = append_proposals(workspace_dir, [diff], now, human=True)
    if not report["added"]:
        raise GraphIntegrityError(
            "this exact question is already open in the inbox — decide it there"
        )
    return diff


def teach_alias(
    workspace_dir: pathlib.Path, term: str, entity_id: str, by: str, now: str
) -> GraphDiff:
    """One gesture: propose the alias and approve it, signed. The log
    keeps both halves of the receipt."""
    entity = _require_entity(workspace_dir, entity_id)
    term = " ".join(term.split())
    diff = GraphDiff(
        diff_id="",
        question=f"“{term}” is another name for {entity['name']} — taught by {by}",
        proposed_by=f"human:{by}",
        evidence=[EvidenceQuote(quote=term, source=f"taught by {by}")],
        operations=[AddAlias(entity_id=entity_id, terms=[term])],
    )
    _append_human(workspace_dir, diff, now)
    return decide(workspace_dir, diff.diff_id, "approved", by=by, now=now)


def teach_create(
    workspace_dir: pathlib.Path, term: str, by: str, now: str, note: str = ""
) -> GraphDiff:
    """The propose-it path of a designed refusal: the map lacks a thing
    the human named. Opens a card — the human shapes and approves it in
    the inbox (Edit-first exists for exactly this)."""
    term = " ".join(term.split())
    state = graph_state(load_diffs(workspace_dir))
    if resolve_entity(state, term):
        raise GraphIntegrityError(
            f"an entity already answers to '{term}' — teach it as an alias "
            f"or correct it instead"
        )
    taken = set(state["entities"])
    diff = GraphDiff(
        diff_id="",
        question=f"“{term}” is a thing the map lacks — create it?",
        proposed_by=f"human:{by}",
        evidence=[
            EvidenceQuote(quote=note or term, source=f"taught by {by}"),
        ],
        operations=[
            CreateEntity(
                entity_id=slug_entity_id(term, taken),
                name=term,
                identity_sentence=note,
            )
        ],
    )
    return _append_human(workspace_dir, diff, now)


CORRECTION_VERBS = ("rename", "part_of", "detach", "alias")


def correct(
    workspace_dir: pathlib.Path,
    entity_id: str,
    verb: str,
    by: str,
    now: str,
    *,
    name: str = "",
    other_id: str = "",
    kind: str = "",
    ref: str = "",
    terms: list[str] | None = None,
    note: str = "",
) -> GraphDiff:
    """A correction on a hit: mints an OPEN human-proposed card. Changing
    shared meaning takes the inbox path, whoever proposes it."""
    entity = _require_entity(workspace_dir, entity_id)
    if verb == "rename":
        if not name.strip():
            raise GraphIntegrityError("rename needs the better name")
        question = f"{entity['name']} should be called “{name}” — says {by}"
        operations = [Rename(entity_id=entity_id, name=name.strip())]
    elif verb == "part_of":
        container = _require_entity(workspace_dir, other_id)
        question = f"{entity['name']} is part of {container['name']} — says {by}"
        operations = [
            Relate(entity_id=entity_id, relation="part_of", other_id=other_id)
        ]
    elif verb == "detach":
        question = (
            f"{kind} “{ref}” does not belong on {entity['name']} — says {by}"
        )
        operations = [Detach(entity_id=entity_id, kind=kind, ref=ref)]
    elif verb == "alias":
        cleaned = [" ".join(t.split()) for t in (terms or []) if t.strip()]
        if not cleaned:
            raise GraphIntegrityError("alias needs at least one term")
        listed = ", ".join(f"“{t}”" for t in cleaned)
        question = f"{entity['name']} also answers to {listed} — says {by}"
        operations = [AddAlias(entity_id=entity_id, terms=cleaned)]
    else:
        raise GraphIntegrityError(
            f"unknown correction '{verb}' — one of: {', '.join(CORRECTION_VERBS)}"
        )
    diff = GraphDiff(
        diff_id="",
        question=question,
        proposed_by=f"human:{by}",
        evidence=[EvidenceQuote(quote=note or question, source=f"said by {by}")],
        operations=operations,
    )
    return _append_human(workspace_dir, diff, now)
