"""The entity graph: durable semantic entities, mutated ONLY by approved diffs.

PRD v1.0 §2–3. The diff log is the graph's immutable history; the entity
state is always a fold over approved diffs — never stored, never edited
in place. The rules this module enforces mechanically:

- Rule 5  (one mutation path): the only writers are ``append_proposals``
  and ``decide``; the fold is pure.
- Rule 6  (structured rejection): rejections carry a reason code; a
  rejected proposal's shape is suppressed — the proposer may not return
  in the same shape.
- Rule 7  (edited approvals are human-amended): approving with edited
  operations records ``amended: true`` and keeps the original operations
  in the record.
- Rule 8  (blast radius): stakes are computed from the operations; the
  ordering and the stakes label derive from the same number, so they can
  never disagree.
- Rule 9  (retired names forward): ``resolve_entity`` follows a
  superseded entity's name or alias to its successor, with the receipt.
- Rule 10 (supersession freezes, fully legibly): a supersede operation
  that does not enumerate the fate of EVERY live promise on the
  predecessor fails validation at decision time.

Storage: ``<workspace>/graph/diffs.yaml`` — a list of diff records. Each
record is written once as a proposal and completed once with its
decision; nothing is ever removed.
"""

from __future__ import annotations

import hashlib
import json
import pathlib
import re
from typing import Literal, Union

import yaml
from pydantic import BaseModel, Field, TypeAdapter

MAX_OPEN_PROPOSALS = 5

REJECT_REASONS = ("not_one_thing", "wrong_name", "bad_evidence", "other")

HoldingKind = Literal[
    "promise", "code", "doc", "ticket", "decision", "incident", "check"
]


class EvidenceQuote(BaseModel):
    """A verbatim quote from an org artifact — validated by the proposer
    before it ever reaches a card (rule 3: no quote, no render)."""

    quote: str
    source: str


class CreateEntity(BaseModel):
    op: Literal["create_entity"] = "create_entity"
    entity_id: str
    name: str
    identity_sentence: str = ""
    aliases: list[str] = Field(default_factory=list)


class Attach(BaseModel):
    op: Literal["attach"] = "attach"
    entity_id: str
    kind: HoldingKind
    ref: str
    note: str = ""


class AddAlias(BaseModel):
    op: Literal["alias"] = "alias"
    entity_id: str
    terms: list[str]


class Rename(BaseModel):
    op: Literal["rename"] = "rename"
    entity_id: str
    name: str


class Relate(BaseModel):
    op: Literal["relate"] = "relate"
    entity_id: str
    relation: Literal["part_of", "depends_on"]
    other_id: str


class PromiseFate(BaseModel):
    """Rule 10: every live promise on a superseded entity gets an explicit
    fate — carried forward (with lineage) or retired. Silence is invalid."""

    ref: str
    fate: Literal["carried", "retired"]
    note: str = ""


class Supersede(BaseModel):
    op: Literal["supersede"] = "supersede"
    entity_id: str  # the predecessor that freezes
    successor_id: str
    promise_fates: list[PromiseFate] = Field(default_factory=list)


Operation = Union[CreateEntity, Attach, AddAlias, Rename, Relate, Supersede]

_OPERATIONS = TypeAdapter(list[Operation])


class Decision(BaseModel):
    action: Literal["approved", "rejected"]
    by: str
    at: str  # ISO timestamp
    reason_code: str = ""
    reason_text: str = ""
    amended: bool = False
    # Present only on amended approvals — the operations the human actually
    # approved. The original proposal stays untouched in the record.
    final_operations: list[Operation] | None = None


class GraphDiff(BaseModel):
    diff_id: str
    question: str  # one sentence — the card IS this question (rule 8)
    proposed_by: str = "llm"
    evidence: list[EvidenceQuote] = Field(default_factory=list)
    operations: list[Operation] = Field(default_factory=list)
    mechanics_note: str = ""  # footnote, never the argument
    stakes: float = 0.0
    shape_key: str = ""
    status: Literal["open", "approved", "rejected"] = "open"
    proposed_at: str = ""
    decision: Decision | None = None

    def effective_operations(self) -> list[Operation]:
        if self.decision and self.decision.final_operations is not None:
            return self.decision.final_operations
        return self.operations


class GraphIntegrityError(ValueError):
    """An operation that would corrupt the graph — raised at decision time
    so the approval fails loudly and nothing mutates."""


# -- stakes: one number drives both ordering and label (rule 8) -----------

_OP_STAKES = {
    "supersede": 3.0,
    "create_entity": 1.0,
    "relate": 0.5,
    "rename": 0.4,
    "alias": 0.3,
    "attach": 0.2,
}


def compute_stakes(operations: list[Operation]) -> float:
    return round(sum(_OP_STAKES[op.op] for op in operations), 2)


def stakes_label(stakes: float) -> str:
    if stakes >= 3.0:
        return "high"
    if stakes >= 1.5:
        return "medium"
    return "low"


# -- shape keys: how a rejection suppresses re-proposal (rule 6) ----------


def _op_signature(op: Operation) -> list:
    if op.op == "create_entity":
        return ["create_entity", op.name.lower(), sorted(a.lower() for a in op.aliases)]
    if op.op == "attach":
        return ["attach", op.entity_id, op.kind, op.ref]
    if op.op == "alias":
        return ["alias", op.entity_id, sorted(t.lower() for t in op.terms)]
    if op.op == "rename":
        return ["rename", op.entity_id, op.name.lower()]
    if op.op == "relate":
        return ["relate", op.entity_id, op.relation, op.other_id]
    return [
        "supersede",
        op.entity_id,
        op.successor_id,
        sorted(f.ref for f in op.promise_fates),
    ]


def compute_shape_key(operations: list[Operation]) -> str:
    canonical = json.dumps(sorted(_op_signature(op) for op in operations))
    return hashlib.sha256(canonical.encode()).hexdigest()[:12]


# -- entity id minting ----------------------------------------------------


def slug_entity_id(name: str, taken: set[str]) -> str:
    base = "ent-" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    candidate, n = base, 1
    while candidate in taken:
        n += 1
        candidate = f"{base}-{n}"
    return candidate


# -- the fold: approved diffs → entity state ------------------------------


def _new_entity(op: CreateEntity, via: str) -> dict:
    return {
        "entity_id": op.entity_id,
        "name": op.name,
        "identity_sentence": op.identity_sentence,
        "aliases": list(op.aliases),
        "status": "active",
        "created_via": via,
        "name_history": [],
        "holdings": [],
        "relations": [],
        "superseded_by": None,
        "superseded_at": None,
        "superseded_via": None,
        "superseded_by_user": None,
        "promise_fates": [],
    }


def _require(entities: dict, entity_id: str, *, active: bool = True) -> dict:
    entity = entities.get(entity_id)
    if entity is None:
        raise GraphIntegrityError(f"unknown entity '{entity_id}'")
    if active and entity["status"] != "active":
        raise GraphIntegrityError(
            f"entity '{entity_id}' is superseded and frozen — only its "
            f"successor moves (rule 10)"
        )
    return entity


def _apply_operation(entities: dict, op: Operation, diff: GraphDiff) -> None:
    if op.op == "create_entity":
        if op.entity_id in entities:
            raise GraphIntegrityError(f"entity '{op.entity_id}' already exists")
        entities[op.entity_id] = _new_entity(op, diff.diff_id)
    elif op.op == "attach":
        entity = _require(entities, op.entity_id)
        holding = {"kind": op.kind, "ref": op.ref, "note": op.note, "via": diff.diff_id}
        if not any(
            h["kind"] == op.kind and h["ref"] == op.ref for h in entity["holdings"]
        ):
            entity["holdings"].append(holding)
    elif op.op == "alias":
        entity = _require(entities, op.entity_id)
        for term in op.terms:
            if term.lower() not in [a.lower() for a in entity["aliases"]]:
                entity["aliases"].append(term)
    elif op.op == "rename":
        entity = _require(entities, op.entity_id)
        entity["name_history"].append({"name": entity["name"], "until": diff.diff_id})
        entity["name"] = op.name
    elif op.op == "relate":
        entity = _require(entities, op.entity_id)
        _require(entities, op.other_id, active=False)
        edge = {"relation": op.relation, "other_id": op.other_id}
        if edge not in entity["relations"]:
            entity["relations"].append(edge)
    elif op.op == "supersede":
        predecessor = _require(entities, op.entity_id)
        successor = _require(entities, op.successor_id)
        live_promises = {
            h["ref"] for h in predecessor["holdings"] if h["kind"] == "promise"
        }
        fated = {f.ref for f in op.promise_fates}
        missing = sorted(live_promises - fated)
        if missing:
            raise GraphIntegrityError(
                f"supersession of '{op.entity_id}' does not enumerate the "
                f"fate of every live promise (rule 10) — missing: "
                f"{', '.join(missing)}"
            )
        unknown = sorted(fated - live_promises)
        if unknown:
            raise GraphIntegrityError(
                f"supersession of '{op.entity_id}' names promises it does "
                f"not hold: {', '.join(unknown)}"
            )
        decision = diff.decision
        predecessor["status"] = "superseded"
        predecessor["superseded_by"] = op.successor_id
        predecessor["superseded_via"] = diff.diff_id
        predecessor["superseded_at"] = decision.at if decision else diff.proposed_at
        predecessor["superseded_by_user"] = decision.by if decision else ""
        predecessor["promise_fates"] = [f.model_dump() for f in op.promise_fates]
        for fate in op.promise_fates:
            if fate.fate == "carried":
                successor["holdings"].append(
                    {
                        "kind": "promise",
                        "ref": fate.ref,
                        "note": fate.note
                        or f"carried from {predecessor['name']} via {diff.diff_id}",
                        "via": diff.diff_id,
                    }
                )


def graph_state(diffs: list[GraphDiff]) -> dict:
    """Pure fold. Approved diffs apply in decision order; everything else
    is history, not state."""
    approved = sorted(
        (d for d in diffs if d.status == "approved" and d.decision),
        key=lambda d: d.decision.at,
    )
    entities: dict[str, dict] = {}
    for diff in approved:
        for op in diff.effective_operations():
            _apply_operation(entities, op, diff)
    return {"entities": entities}


def validate_operations(state: dict, diff: GraphDiff) -> None:
    """Dry-run the diff against current state — approval calls this first
    so an invalid diff fails loudly and mutates nothing."""
    entities = {k: json.loads(json.dumps(v)) for k, v in state["entities"].items()}
    for op in diff.effective_operations():
        _apply_operation(entities, op, diff)


# -- rule 9: retired names forward ---------------------------------------


def resolve_entity(state: dict, term: str) -> dict | None:
    """Name or alias → entity view. A superseded match forwards to its
    successor, carrying the receipt (who, when, which proposal)."""
    q = " ".join(term.lower().split())
    match = None
    for entity in state["entities"].values():
        names = [entity["name"].lower()] + [a.lower() for a in entity["aliases"]]
        names += [h["name"].lower() for h in entity["name_history"]]
        if q in names:
            # an active match always wins over a superseded one
            if entity["status"] == "active":
                match = entity
                break
            match = match or entity
    if match is None:
        return None
    if match["status"] == "active":
        return {"entity": match, "forwarded_from": None}
    successor = state["entities"].get(match["superseded_by"])
    return {
        "entity": successor,
        "forwarded_from": {
            "entity_id": match["entity_id"],
            "name": match["name"],
            "superseded_at": match["superseded_at"],
            "superseded_by_user": match["superseded_by_user"],
            "via": match["superseded_via"],
        },
    }


# -- the two writers (rule 5: nothing else mutates the map) ---------------


def graph_file(workspace_dir: pathlib.Path) -> pathlib.Path:
    return workspace_dir / "graph" / "diffs.yaml"


def load_diffs(workspace_dir: pathlib.Path) -> list[GraphDiff]:
    path = graph_file(workspace_dir)
    if not path.exists():
        return []
    raw = yaml.safe_load(path.read_text()) or []
    return [GraphDiff.model_validate(d) for d in raw]


def _write_diffs(workspace_dir: pathlib.Path, diffs: list[GraphDiff]) -> None:
    path = graph_file(workspace_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        yaml.safe_dump(
            [d.model_dump(exclude_none=True) for d in diffs],
            sort_keys=False,
            allow_unicode=True,
        )
    )


def rejected_shape_keys(diffs: list[GraphDiff]) -> set[str]:
    return {d.shape_key for d in diffs if d.status == "rejected"}


def open_proposals(diffs: list[GraphDiff]) -> list[GraphDiff]:
    """Open proposals, highest stakes first (rule 8: the label shown next
    to each card derives from the same number as this ordering)."""
    return sorted(
        (d for d in diffs if d.status == "open"), key=lambda d: -d.stakes
    )


def append_proposals(
    workspace_dir: pathlib.Path,
    proposals: list[GraphDiff],
    now: str,
) -> dict:
    """Add proposals to the log — enforcing the open cap and rejected-shape
    suppression. Diff ids are minted here, server-side, never upstream."""
    diffs = load_diffs(workspace_dir)
    suppressed_shapes = rejected_shape_keys(diffs)
    existing_shapes = {d.shape_key for d in diffs if d.status != "rejected"}
    capacity = MAX_OPEN_PROPOSALS - len(open_proposals(diffs))
    next_seq = (
        max((int(d.diff_id.split("-")[1]) for d in diffs), default=0) + 1
    )

    added, skipped_shape, skipped_cap, skipped_dup = [], [], [], []
    for proposal in proposals:
        proposal.shape_key = compute_shape_key(proposal.operations)
        proposal.stakes = compute_stakes(proposal.operations)
        if proposal.shape_key in suppressed_shapes:
            skipped_shape.append(proposal.question)
            continue
        if proposal.shape_key in existing_shapes:
            skipped_dup.append(proposal.question)
            continue
        if len(added) >= capacity:
            skipped_cap.append(proposal.question)
            continue
        proposal.diff_id = f"GD-{next_seq}"
        next_seq += 1
        proposal.status = "open"
        proposal.proposed_at = now
        proposal.decision = None
        existing_shapes.add(proposal.shape_key)
        added.append(proposal)

    if added:
        _write_diffs(workspace_dir, diffs + added)
    return {
        "added": [d.diff_id for d in added],
        "skipped_rejected_shape": skipped_shape,
        "skipped_duplicate": skipped_dup,
        "skipped_cap": skipped_cap,
        "open": len(open_proposals(diffs)) + len(added),
    }


def decide(
    workspace_dir: pathlib.Path,
    diff_id: str,
    action: Literal["approved", "rejected"],
    by: str,
    now: str,
    reason_code: str = "",
    reason_text: str = "",
    operations: list[dict] | None = None,
) -> GraphDiff:
    """The single decision path. Approve validates against current state
    first; an edited approval is recorded human-amended (rule 7); a
    rejection requires a structured reason (rule 6)."""
    diffs = load_diffs(workspace_dir)
    target = next((d for d in diffs if d.diff_id == diff_id), None)
    if target is None:
        raise KeyError(f"no proposal '{diff_id}'")
    if target.status != "open":
        raise GraphIntegrityError(
            f"'{diff_id}' was already {target.status} — decisions are final; "
            f"propose a new diff instead"
        )

    if action == "rejected":
        if reason_code not in REJECT_REASONS:
            raise GraphIntegrityError(
                f"a rejection needs a structured reason, one of: "
                f"{', '.join(REJECT_REASONS)}"
            )
        if reason_code == "other" and not reason_text.strip():
            raise GraphIntegrityError(
                "rejecting as 'other' requires a sentence of reason — it "
                "teaches the system"
            )
        target.status = "rejected"
        target.decision = Decision(
            action="rejected",
            by=by,
            at=now,
            reason_code=reason_code,
            reason_text=reason_text,
        )
        _write_diffs(workspace_dir, diffs)
        return target

    final_ops = _OPERATIONS.validate_python(operations) if operations is not None else None
    decision = Decision(
        action="approved",
        by=by,
        at=now,
        amended=final_ops is not None
        and compute_shape_key(final_ops) != target.shape_key,
        final_operations=final_ops,
    )
    target.decision = decision
    state = graph_state(diffs)
    try:
        validate_operations(state, target)
    except GraphIntegrityError:
        target.decision = None
        raise
    target.status = "approved"
    _write_diffs(workspace_dir, diffs)
    return target
