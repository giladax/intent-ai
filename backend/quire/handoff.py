"""The handoff: signed promises become the team's week (O4.5, handoff preview).

Founder (2026-07-23): "Show how a PRD becomes a list of tasks relevant to
all departments. We know all repos and the designs and can deduce
requirements relevant to the feature. We are like an exoskeleton helping
them." And: "This is the same system — the topology, the schema. It should
reason about how org data really looks like, even be able to export some of
it later. Should be so clear."

Three stages, constitutionally honest:

1. Promises are SIGNED first (existing machinery — the wizard/approve act).
   The handoff operates on the signed contract: tasks are born from signed
   intent (ruling K), never from a raw document.
2. The exoskeleton: a deterministic grounding assembler queries what the
   org HAS (features + understanding/constraints, feature_files, bindings)
   and a structured Sonnet call drafts per-department task cards — each
   carrying its WHY. Deterministic citation validation drops any reference
   that doesn't resolve to a real feature/file/promise (similarity proposes,
   never authority; fabrication never persists).
3. Proposals pause for the signing act (per-card accept/reject/edit). Signed
   tasks are nodes with evidenced edges (edges-carry-coupling). Closure is
   evidence-tiered and honest (ruling N): dev closes on a real check
   verdict; product/bi close manually with a note, labeled.

The export (`quire org handoff export`) renders the signed handoff as a
self-contained markdown artifact — promises + per-department tasks with
their receipts, ids as footnotes. It carries only the org's own evidence
(patterns-separable-from-evidence holds trivially: nothing cross-org).
"""

from __future__ import annotations

import datetime as dt
import logging
import pathlib
import uuid
from typing import Literal

import yaml
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as SASession

from quire.db.task_models import (
    CLOSURE_TIERS,
    DEPARTMENTS,
    Task,
    TaskLink,
    ensure_task_tables,
)
from quire.llm_retry import invoke_with_retry
from quire.models import ImpactRelation

logger = logging.getLogger("quire.handoff")

_NOW = lambda: dt.datetime.now(dt.timezone.utc)  # noqa: E731

# Grounding packet budgets (reasoning-topology spec style: precomputed
# slices, never dumps).
_MAX_FEATURES = 20
_MAX_UNDERSTANDING_CHARS = 400
_MAX_CONSTRAINTS_PER_FEATURE = 4
_MAX_FILES_PER_FEATURE = 6
_MAX_PACKET_CHARS = 14000


# ---------------------------------------------------------------------------
# Structured output schemas
# ---------------------------------------------------------------------------

class CandidateTask(BaseModel):
    """One proposed unit of work, drafted by the model, validated by us."""

    department: Literal["dev", "qa", "product", "bi"]
    statement: str = Field(description="Plain-language task, one behavior")
    serves_obligation_id: str = Field(
        description="The SIGNED promise id this task serves (verbatim from the list)"
    )
    builds_on: list[str] = Field(
        default_factory=list,
        description=(
            "Feature names or file paths from the grounding that this task "
            "extends or uses — copied verbatim; fabricated entries are dropped"
        ),
    )
    gap: str = Field(
        default="",
        description="If nothing in the org covers this: one honest sentence",
    )
    why: str = Field(description="Plain-language reason this task exists")


class TaskCards(BaseModel):
    tasks: list[CandidateTask] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Grounding assembler — deterministic queries over what the org HAS
# ---------------------------------------------------------------------------

class Grounding(BaseModel):
    """What the org has, assembled deterministically for one workspace."""

    obligations: list[dict] = Field(default_factory=list)
    features: list[dict] = Field(default_factory=list)
    binding_paths: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)

    def feature_names(self) -> set[str]:
        return {f["name"].lower() for f in self.features}

    def feature_ids(self) -> set[str]:
        return {f["id"] for f in self.features}

    def known_paths(self) -> set[str]:
        paths: set[str] = set(self.binding_paths)
        for f in self.features:
            paths.update(f.get("files", []))
        return paths

    def obligation_ids(self) -> set[str]:
        return {o["obligation_id"] for o in self.obligations}


def assemble_grounding(
    workspace: str,
    source_reference: str | None = None,
    engine=None,
) -> Grounding:
    """Assemble the grounding packet: signed promises + real features/files.

    Deterministic only — obligations from the workspace's approved contract
    (optionally scoped to one source artifact, e.g. the new PRD), features +
    files from the journal Postgres, binding paths from the contract.
    Failure-safe on the journal side: if Postgres is unreachable the packet
    still carries the contract (the model then proposes with gaps — honest).
    """
    from quire import workspace as ws_mod

    notes: list[str] = []
    adapter = ws_mod.build_adapter(workspace)

    obligations = []
    for o in adapter.obligations():
        if source_reference and o.source_reference != source_reference:
            continue
        obligations.append({
            "obligation_id": o.obligation_id,
            "statement": o.statement,
            "kind": o.kind.value if hasattr(o.kind, "value") else str(o.kind),
            "quote": getattr(o, "provenance_quote", "") or o.source_quote
            if hasattr(o, "source_quote") else getattr(o, "provenance_quote", ""),
            "source_reference": o.source_reference,
        })

    binding_paths = []
    try:
        for cp in adapter.control_points():
            if cp.path:
                binding_paths.append(cp.path)
    except Exception as exc:  # a workspace without bindings is legal
        notes.append(f"bindings unavailable: {exc}")

    features: list[dict] = []
    try:
        if engine is None:
            from quire.db.engine import get_engine
            engine = get_engine()
        from quire.db.models import Feature, FeatureFile

        with SASession(engine) as s:
            rows = s.execute(
                select(Feature).order_by(Feature.created_at.desc()).limit(_MAX_FEATURES)
            ).scalars().all()
            for f in rows:
                files = [
                    ff.file_path or ff.glob or ""
                    for ff in s.execute(
                        select(FeatureFile).where(FeatureFile.feature_id == f.id)
                    ).scalars().all()
                ][:_MAX_FILES_PER_FEATURE]
                features.append({
                    "id": f.id,
                    "name": f.name,
                    "understanding": (f.current_understanding or f.description or "")[
                        :_MAX_UNDERSTANDING_CHARS
                    ],
                    "constraints": list(f.constraints or [])[:_MAX_CONSTRAINTS_PER_FEATURE],
                    "files": [p for p in files if p],
                })
    except Exception as exc:
        notes.append(f"journal features unavailable: {exc}")

    return Grounding(
        obligations=obligations,
        features=features,
        binding_paths=sorted(set(binding_paths)),
        notes=notes,
    )


def render_grounding_packet(g: Grounding) -> str:
    """Render the grounding as the model's context — budgeted, never a dump."""
    parts = ["## Signed promises (tasks MUST serve one of these ids)"]
    for o in g.obligations:
        parts.append(f"- {o['obligation_id']} [{o['kind']}]: {o['statement']}")
    parts.append("\n## What the org already has (features — cite names verbatim)")
    for f in g.features:
        c = "; ".join(str(x) for x in f["constraints"]) or "—"
        files = ", ".join(f["files"]) or "no files recorded"
        parts.append(
            f"- {f['name']}: {f['understanding'] or 'no summary'}\n"
            f"  constraints: {c}\n  files: {files}"
        )
    parts.append("\n## Governed paths (bindings)")
    parts.extend(f"- {p}" for p in g.binding_paths)
    packet = "\n".join(parts)
    if len(packet) > _MAX_PACKET_CHARS:
        packet = packet[:_MAX_PACKET_CHARS] + "\n… (truncated at budget)"
    return packet


# ---------------------------------------------------------------------------
# The proposer (Sonnet, structured) — swap with a fake offline
# ---------------------------------------------------------------------------

_PROPOSER_PROMPT = """You are helping a small R&D team hand off signed product promises \
into concrete work. Draft tasks for these departments: dev, qa, product, bi.

Rules — all binding:
- Every task serves EXACTLY ONE signed promise: set serves_obligation_id to \
an id copied verbatim from the signed promises list. Tasks with unknown ids \
are discarded mechanically.
- Ground every task in what the org already has: copy feature names or file \
paths VERBATIM into builds_on. Fabricated names are discarded mechanically. \
If nothing covers the task, leave builds_on empty and write one honest gap \
sentence ("nothing covers this — new module").
- Plain language a non-native reader gets on first read. Never say epic or \
story. One behavior per task; small enough to finish in a day or two.
- dev: what to build/change. qa: what to test (name the promise's risky \
edge). product: what to verify/decide with users or stakeholders. bi: what \
to measure and where the numbers would come from.
- 1-3 tasks per department. Fewer, sharper tasks beat coverage theater.

{packet}
"""


class HandoffLLM:
    """Sonnet-backed task proposer; tests pass a fake with the same shape."""

    def __init__(self, model: str = "claude-sonnet-4-6") -> None:
        from langchain_anthropic import ChatAnthropic

        base = ChatAnthropic(model=model, temperature=0, max_tokens=8192)
        self._tasks = base.with_structured_output(TaskCards)

    def propose_tasks(self, packet: str) -> TaskCards:
        return invoke_with_retry(self._tasks, _PROPOSER_PROMPT.format(packet=packet))


# ---------------------------------------------------------------------------
# Deterministic citation validation — fabrication never persists
# ---------------------------------------------------------------------------

def validate_cards(
    cards: TaskCards, grounding: Grounding
) -> tuple[list[dict], list[str]]:
    """Validate proposals against the grounding. Returns (kept, notes).

    - serves_obligation_id must be a signed promise id → else the CARD drops.
    - each builds_on entry must resolve to a real feature (by name,
      case-insensitive) or a known path → else the ENTRY drops (noted).
    """
    kept: list[dict] = []
    notes: list[str] = []
    by_name = {f["name"].lower(): f for f in grounding.features}
    known_paths = grounding.known_paths()
    signed = grounding.obligation_ids()

    for card in cards.tasks:
        if card.serves_obligation_id not in signed:
            notes.append(
                f"dropped task ({card.department}): cites unknown promise "
                f"{card.serves_obligation_id!r}"
            )
            continue
        resolved: list[dict] = []
        for ref in card.builds_on:
            key = ref.strip()
            f = by_name.get(key.lower())
            if f is not None:
                resolved.append({
                    "kind": "builds_on_feature",
                    "target_ref": f["id"],
                    "target_label": f["name"],
                    "evidence": (
                        f"extends {f['name']} — "
                        + (", ".join(f["files"]) if f["files"] else "feature exists")
                    ),
                })
            elif key in known_paths:
                resolved.append({
                    "kind": "touches_file",
                    "target_ref": key,
                    "target_label": key,
                    "evidence": f"{key} exists in the org's governed paths",
                })
            else:
                notes.append(
                    f"dropped citation on task ({card.department}): "
                    f"{key!r} resolves to no real feature or file"
                )
        kept.append({
            "department": card.department,
            "statement": card.statement.strip(),
            "why": card.why.strip(),
            "gap": card.gap.strip(),
            "serves_obligation_id": card.serves_obligation_id,
            "links": resolved,
        })
    return kept, notes


# ---------------------------------------------------------------------------
# TaskStore — single writer for tasks + task_links
# ---------------------------------------------------------------------------

class TaskStore:
    """Single writer for the tasks and task_links tables."""

    def __init__(self, engine=None) -> None:
        if engine is None:
            from quire.db.engine import get_engine
            engine = get_engine()
        self._engine = engine
        ensure_task_tables(self._engine)

    # -- write ------------------------------------------------------------

    def create_proposals(
        self, workspace: str, handoff_id: str, validated: list[dict],
        grounding: Grounding,
    ) -> list[str]:
        """Persist validated cards as proposed task nodes + evidenced edges."""
        ob_by_id = {o["obligation_id"]: o for o in grounding.obligations}
        ids: list[str] = []
        now = _NOW()
        with SASession(self._engine) as s:
            for card in validated:
                task_id = f"TSK-{uuid.uuid4().hex[:8]}"
                ids.append(task_id)
                s.add(Task(
                    id=task_id,
                    workspace=workspace,
                    handoff_id=handoff_id,
                    department=card["department"],
                    statement=card["statement"],
                    why=card["why"],
                    grounding_note=card["gap"],
                    status="proposed",
                    closure_tier=CLOSURE_TIERS[card["department"]],
                    created_at=now,
                ))
                ob = ob_by_id.get(card["serves_obligation_id"], {})
                s.add(TaskLink(
                    id=f"TLK-{uuid.uuid4().hex[:8]}",
                    task_id=task_id,
                    kind="serves_promise",
                    target_ref=card["serves_obligation_id"],
                    target_label=(ob.get("statement") or "")[:160],
                    evidence=ob.get("quote") or ob.get("statement") or "",
                    created_at=now,
                ))
                for link in card["links"]:
                    s.add(TaskLink(
                        id=f"TLK-{uuid.uuid4().hex[:8]}",
                        task_id=task_id,
                        kind=link["kind"],
                        target_ref=link["target_ref"],
                        target_label=link["target_label"],
                        evidence=link["evidence"],
                        created_at=now,
                    ))
            s.commit()
        return ids

    def approve(
        self, handoff_id: str, decisions: list[dict], approved_by: str
    ) -> dict:
        """The signing act: per-card accept/reject/edit. Explicit, never bulk-
        default — a task with no decision stays proposed (visible, unsigned)."""
        now = _NOW()
        signed, rejected = 0, 0
        by_id = {d["task_id"]: d for d in decisions}
        with SASession(self._engine) as s:
            rows = s.execute(
                select(Task).where(Task.handoff_id == handoff_id,
                                   Task.status == "proposed")
            ).scalars().all()
            for t in rows:
                d = by_id.get(t.id)
                if d is None:
                    continue
                if d.get("accept"):
                    if d.get("statement"):
                        t.statement = str(d["statement"]).strip()
                    t.status = "open"
                    t.signed_by = approved_by
                    t.signed_at = now
                    signed += 1
                else:
                    t.status = "rejected"
                    rejected += 1
            s.commit()
        return {"signed": signed, "rejected": rejected}

    def close_manual(self, task_id: str, note: str, closed_by: str) -> bool:
        """Manual close with a note (product/bi tier — ruling N, labeled)."""
        now = _NOW()
        with SASession(self._engine) as s:
            t = s.get(Task, task_id)
            if t is None or t.status != "open":
                return False
            t.status = "closed"
            t.closed_at = now
            t.closure_note = f"closed by {closed_by}: {note} (evidence detection coming)"
            s.commit()
        return True

    def close_on_check(
        self, task_id: str, analysis_id: str, relation: str, reasoning: str
    ) -> bool:
        """Evidence close: the check verdict is the receipt (dev tier)."""
        now = _NOW()
        with SASession(self._engine) as s:
            t = s.get(Task, task_id)
            if t is None or t.status != "open":
                return False
            t.status = "closed"
            t.closed_at = now
            t.closure_note = f"closed on check evidence ({relation})"
            s.add(TaskLink(
                id=f"TLK-{uuid.uuid4().hex[:8]}",
                task_id=task_id,
                kind="closed_by_check",
                target_ref=analysis_id,
                target_label=relation,
                evidence=reasoning[:400],
                created_at=now,
            ))
            s.commit()
        return True

    def add_closure_candidate(
        self, task_id: str, analysis_id: str, relation: str, reasoning: str
    ) -> None:
        now = _NOW()
        with SASession(self._engine) as s:
            existing = s.execute(
                select(TaskLink).where(
                    TaskLink.task_id == task_id,
                    TaskLink.kind == "closure_candidate",
                    TaskLink.target_ref == analysis_id,
                )
            ).scalars().first()
            if existing is not None:
                return
            s.add(TaskLink(
                id=f"TLK-{uuid.uuid4().hex[:8]}",
                task_id=task_id,
                kind="closure_candidate",
                target_ref=analysis_id,
                target_label=relation,
                evidence=reasoning[:400],
                created_at=now,
            ))
            s.commit()

    # -- read -------------------------------------------------------------

    def tasks_for_handoff(self, handoff_id: str) -> list[dict]:
        with SASession(self._engine) as s:
            rows = s.execute(
                select(Task).where(Task.handoff_id == handoff_id)
            ).scalars().all()
            return [self._task_dict(s, t) for t in rows]

    def tasks_for_workspace(
        self, workspace: str, status: str | None = None
    ) -> list[dict]:
        with SASession(self._engine) as s:
            stmt = select(Task).where(Task.workspace == workspace)
            if status:
                stmt = stmt.where(Task.status == status)
            rows = s.execute(stmt.order_by(Task.created_at)).scalars().all()
            return [self._task_dict(s, t) for t in rows]

    def open_tasks_serving(self, workspace: str, obligation_id: str) -> list[dict]:
        """Open dev-tier tasks whose serves_promise edge targets this promise."""
        with SASession(self._engine) as s:
            links = s.execute(
                select(TaskLink).where(
                    TaskLink.kind == "serves_promise",
                    TaskLink.target_ref == obligation_id,
                )
            ).scalars().all()
            out = []
            for link in links:
                t = s.get(Task, link.task_id)
                if t and t.workspace == workspace and t.status == "open" \
                        and t.closure_tier == "check_evidence":
                    out.append(self._task_dict(s, t))
            return out

    def needs_you_items(self) -> list[dict]:
        """Task items for the Needs-you surface: unsigned handoffs and
        closure candidates. Plain language; same item shape the org
        needs-you list uses."""
        items: list[dict] = []
        with SASession(self._engine) as s:
            proposed = s.execute(
                select(Task).where(Task.status == "proposed")
            ).scalars().all()
            by_handoff: dict[str, list[Task]] = {}
            for t in proposed:
                by_handoff.setdefault(t.handoff_id, []).append(t)
            for hid, ts in by_handoff.items():
                items.append({
                    "kind": "handoff_awaiting_signature",
                    "workspace": ts[0].workspace,
                    "handoff_id": hid,
                    "label": f"A handoff awaits your signature — {len(ts)} tasks",
                    "ink": "gold",
                })
            candidates = s.execute(
                select(TaskLink).where(TaskLink.kind == "closure_candidate")
            ).scalars().all()
            for link in candidates:
                t = s.get(Task, link.task_id)
                if t is None or t.status != "open":
                    continue
                items.append({
                    "kind": "closure_evidence_arrived",
                    "workspace": t.workspace,
                    "task_id": t.id,
                    "analysis_id": link.target_ref,
                    "label": f"Evidence arrived — close “{t.statement[:80]}”?",
                    "ink": "moss",
                })
        return items

    def _task_dict(self, s: SASession, t: Task) -> dict:
        links = s.execute(
            select(TaskLink).where(TaskLink.task_id == t.id)
        ).scalars().all()
        return {
            "task_id": t.id,
            "workspace": t.workspace,
            "handoff_id": t.handoff_id,
            "department": t.department,
            "statement": t.statement,
            "why": t.why,
            "grounding_note": t.grounding_note,
            "status": t.status,
            "closure_tier": t.closure_tier,
            "closure_note": t.closure_note,
            "signed_by": t.signed_by,
            "links": [
                {
                    "kind": l.kind,
                    "target_ref": l.target_ref,
                    "target_label": l.target_label,
                    "evidence": l.evidence,
                }
                for l in links
            ],
        }


# ---------------------------------------------------------------------------
# Draft + closure-candidacy entry points
# ---------------------------------------------------------------------------

def draft_handoff(
    workspace: str,
    store: TaskStore,
    llm=None,
    source_reference: str | None = None,
    engine=None,
) -> dict:
    """Stage 2: assemble grounding, propose tasks, validate, persist proposed.

    Returns {handoff_id, tasks, notes}. Pauses there — signing is a separate
    explicit act (constitutional).
    """
    grounding = assemble_grounding(workspace, source_reference, engine=engine)
    if not grounding.obligations:
        return {
            "handoff_id": None,
            "tasks": [],
            "notes": ["no signed promises found"
                      + (f" for source {source_reference!r}" if source_reference else "")
                      + " — sign the contract first (the handoff serves signed intent only)"],
        }
    packet = render_grounding_packet(grounding)
    llm = llm or HandoffLLM()
    cards = llm.propose_tasks(packet)
    validated, notes = validate_cards(cards, grounding)
    handoff_id = f"HND-{uuid.uuid4().hex[:8]}"
    store.create_proposals(workspace, handoff_id, validated, grounding)
    return {
        "handoff_id": handoff_id,
        "tasks": store.tasks_for_handoff(handoff_id),
        "notes": notes + grounding.notes,
    }


def record_closure_candidates(workspace: str, analysis, store: TaskStore) -> dict:
    """Deterministic closure wiring: after a check completes, tasks serving
    a SATISFIED promise gain evidence.

    Auto-close only when unambiguous: exactly one open dev-tier task serves
    the satisfied promise. Otherwise every matching task gets a
    closure_candidate edge and lands in Needs-you ("evidence arrived —
    close it?") — human in the loop, no dreams.
    """
    closed, candidates = 0, 0
    analysis_id = getattr(analysis, "analysis_id", "") or ""
    for impact in getattr(analysis, "obligation_impacts", []) or []:
        relation = impact.relation.value if hasattr(impact.relation, "value") \
            else str(impact.relation)
        if relation != ImpactRelation.SATISFIES.value:
            continue
        matching = store.open_tasks_serving(workspace, impact.obligation_id)
        if len(matching) == 1:
            if store.close_on_check(
                matching[0]["task_id"], analysis_id, relation, impact.reasoning
            ):
                closed += 1
        else:
            for t in matching:
                store.add_closure_candidate(
                    t["task_id"], analysis_id, relation, impact.reasoning
                )
                candidates += 1
    return {"closed": closed, "candidates": candidates}


# ---------------------------------------------------------------------------
# Export — the handoff as a self-contained markdown artifact
# ---------------------------------------------------------------------------

_DEPT_TITLES = {
    "dev": "Development — what to build",
    "qa": "QA — what to test",
    "product": "Product — what to verify",
    "bi": "BI — what to measure",
}


def render_handoff_markdown(
    workspace: str, tasks: list[dict], grounding: Grounding | None = None,
    handoff_id: str = "",
) -> str:
    """Render signed (and proposed) tasks as one clean document.

    Meaning before mechanics: sentences first, ids as footnotes. Carries
    only the org's own evidence.
    """
    date = _NOW().date().isoformat()
    lines = [
        f"# Handoff — {workspace}",
        "",
        f"Generated by Quire on {date}. Every task below serves a signed "
        "promise and carries its receipts. Nobody wrote a ticket.",
        "",
    ]
    obs: dict[str, dict] = {}
    if grounding:
        obs = {o["obligation_id"]: o for o in grounding.obligations}
        lines.append("## The promises this handoff serves")
        lines.append("")
        cited = {
            l["target_ref"]
            for t in tasks for l in t["links"] if l["kind"] == "serves_promise"
        }
        for oid in sorted(cited):
            o = obs.get(oid)
            if o:
                lines.append(f"- {o['statement']} [^{oid}]")
        lines.append("")

    footnotes: dict[str, str] = {}
    for dept in DEPARTMENTS:
        dept_tasks = [t for t in tasks if t["department"] == dept
                      and t["status"] in ("open", "proposed", "closed")]
        if not dept_tasks:
            continue
        lines.append(f"## {_DEPT_TITLES[dept]}")
        lines.append("")
        for t in dept_tasks:
            status = {"open": "☐", "proposed": "◌ (unsigned)",
                      "closed": "☑"}.get(t["status"], t["status"])
            lines.append(f"### {status} {t['statement']}")
            lines.append(f"{t['why']}")
            for l in t["links"]:
                if l["kind"] == "serves_promise":
                    lines.append(f"- Serves: {l['target_label']} [^{l['target_ref']}]")
                    footnotes[l["target_ref"]] = l["evidence"]
                elif l["kind"] in ("builds_on_feature", "touches_file"):
                    lines.append(f"- Builds on: {l['evidence']}")
                elif l["kind"] == "closed_by_check":
                    lines.append(
                        f"- Closed on evidence: check {l['target_ref']} "
                        f"({l['target_label']})"
                    )
            if t["grounding_note"]:
                lines.append(f"- Honest gap: {t['grounding_note']}")
            if t["closure_tier"] == "manual_note" and t["status"] != "closed":
                lines.append("- Closes: manually with a note (evidence detection coming)")
            if t["closure_note"]:
                lines.append(f"- {t['closure_note']}")
            lines.append("")

    if footnotes:
        lines.append("---")
        for oid, quote in sorted(footnotes.items()):
            q = (quote or "").strip().replace("\n", " ")
            lines.append(f"[^{oid}]: “{q}”" if q else f"[^{oid}]: {oid}")
    return "\n".join(lines) + "\n"


def export_handoff(
    workspace: str, store: TaskStore, handoff_id: str | None = None,
    out_path: pathlib.Path | None = None,
) -> tuple[str, pathlib.Path | None]:
    """Export a workspace's handoff to markdown; write to out_path if given."""
    tasks = (
        store.tasks_for_handoff(handoff_id)
        if handoff_id else store.tasks_for_workspace(workspace)
    )
    grounding = None
    try:
        grounding = assemble_grounding(workspace)
    except Exception as exc:
        logger.debug("export: grounding unavailable (%s) — footnotes only", exc)
    md = render_handoff_markdown(workspace, tasks, grounding, handoff_id or "")
    if out_path is not None:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(md)
    return md, out_path
