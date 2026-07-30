"""The shared brain's read surface: any ref → its focus card and typed
neighborhood, with the reasoning on every edge.

This is the composition the navigator renders and the MCP surface will
wrap (`quire_around(ref)`): one brain, two clients — no privileged
human data, no privileged agent data. Read-only; zero LLM calls at view
time; everything composes from what the stores already hold (the fold,
the contract, analyses, atoms, the mind cache).

The hero walk this module exists to serve: a claim → the reasoning that
produced it → the check receipt → the exact file:line the check
observed → who signed what along the way. Every neighbor row carries
its *why* when the store holds one (a shared control point's rationale
is deliberately not borrowed — board C3); every signed hop names its
signer.
"""

from __future__ import annotations

import pathlib
import re

from quire.atoms import atoms_for
from quire.entity_graph import graph_state, load_diffs
from quire.mind import read_mind_cache
from quire.mirror import HEALTH_LABELS
from quire.timeline import UNOBSERVED, current_state

# An entity focus shows its freshest events only — the full stream lives
# on the "What's changing" shelf and each check's receipt.
_RECENT_EVENTS_SHOWN = 6


def _health(entry: dict) -> str:
    """One promise-health vocabulary everywhere (The Hush): the mirror's
    labels — kept / partly kept / broken / not yet exercised — never a
    private twin of them."""
    return HEALTH_LABELS.get(entry.get("status"), HEALTH_LABELS[UNOBSERVED])


def _neighbor(mood, kind, label, ref="", why="", meta="") -> dict:
    return {
        "mood": mood, "kind": kind, "label": label,
        "ref": ref, "why": why, "meta": meta,
    }


def _diff_meta(diff) -> str:
    if diff.status == "open":
        return "in quires — unsigned"
    d = diff.decision
    if diff.status == "approved":
        return f"signed by {d.by} · {d.at[:10]}" + (" · amended" if d.amended else "")
    reason = d.reason_code.replace("_", " ")
    return f"declined by {d.by} · {d.at[:10]} · {reason}"


def _diff_mood(diff) -> str:
    """A declined proposal must NEVER wear ink (board round 1, C2): the
    three diff states are three presentations — proposed / signed /
    declined."""
    return {"open": "proposed", "approved": "signed", "rejected": "declined"}[
        diff.status
    ]


def _diff_why(diff) -> str:
    """The middle link of the hero chain, honestly: the proposer's kept
    thinking when it exists; otherwise the evidence the proposal stood
    on (pre-reasoning-era diffs have custody too — quotes, not invented
    thoughts)."""
    if diff.reasoning:
        return diff.reasoning
    quote = next(iter(diff.evidence), None)
    return f"proposed on this evidence: “{quote.quote}”" if quote else ""


def _op_entity_ids(op) -> set[str]:
    """Every entity an operation touches, whichever field names it."""
    return {
        getattr(op, "entity_id", ""), getattr(op, "other_id", ""),
        getattr(op, "successor_id", ""),
    } - {""}


def _diffs_touching(diffs, entity_ids: set[str], promise_refs: set[str]):
    for d in diffs:
        for op in d.operations:
            if (_op_entity_ids(op) & entity_ids
                    or getattr(op, "ref", None) in promise_refs):
                yield d
                break


def _mind_neighbors(mind: dict, touchable: set[str]) -> list[dict]:
    rows = []
    for n in mind.get("nodes", []):
        hit = next(
            (c for c in n.get("connects", []) if c.get("ref") in touchable), None
        )
        if hit:
            rows.append(_neighbor(
                "thought", n.get("kind", "thought"),
                n["name"] + " — " + n.get("gloss", ""),
                ref=n["name"], why=hit.get("why", ""),
                meta=n.get("salience", "ambiguous"),
            ))
    return rows


def around(workspace_dir: pathlib.Path, adapter, store, ref: str) -> dict | None:
    # Chosen debt (board T5, deferral accepted round 2): every call
    # refolds the graph, rebuilds the timeline, and re-reads the mind —
    # O(analyses × obligations) per view. Pegged: a memo layer is owed
    # at ~100–150 checks, or when a read exceeds ~2.5s, whichever comes
    # first (the round-2 CTO's re-pegged trigger; round 1's "~300–500
    # checks" figure is stale and must not be cited).
    from quire.entity_graph import read_state

    diffs, state = read_state(workspace_dir)  # read-only; never mutated
    entities = state["entities"]
    obligations = {o.obligation_id: o for o in adapter.obligations()}
    mind = read_mind_cache(workspace_dir)
    analyses = store.list_analyses(repository=adapter.repository())

    if ref in entities:
        return _around_entity(
            workspace_dir, adapter, store, entities[ref], diffs, entities,
            obligations, mind, analyses,
        )
    if ref in obligations:
        return _around_promise(
            adapter, obligations[ref], diffs, entities, mind, analyses
        )
    if re.fullmatch(r"GD-\d+", ref):
        diff = next((d for d in diffs if d.diff_id == ref), None)
        return _around_diff(diff, entities, obligations, mind) if diff else None
    if ref.isdigit():
        mine = [a for a in analyses if a.pr_number == int(ref)]
        return _around_check(
            max(mine, key=lambda a: a.created_at), entities, obligations, mind,
            workspace_dir,
        ) if mine else None
    if ref.startswith("session-"):
        from quire.session import find_session

        record = find_session(workspace_dir, ref)
        return _around_session(record, entities) if record else None
    lowered = ref.lower()
    node = next(
        (n for n in mind.get("nodes", []) if n["name"].lower() == lowered), None
    )
    if node:
        return _around_thought(node, mind, entities, obligations)
    # history: a retired or dismissed thought is still addressable
    for section, badge in (("retired", "retired"), ("dismissed", "dismissed")):
        past = next(
            (x for x in mind.get(section, []) if x["name"].lower() == lowered),
            None,
        )
        if past:
            return {
                "node": {
                    "kind": "thought", "mood": "thought", "ref": past["name"],
                    "title": past["name"],
                    "body": past.get("why", ""),
                    "reasoning": "",
                    "meta": f"{badge}"
                    + (f" by {past['by']}" if past.get("by") else "")
                    + (f" · {past.get('at', '')[:10]}" if past.get("at") else ""),
                    "status": badge,
                },
                "neighbors": [],
                "authority": {},
            }
    return None


def _around_entity(workspace_dir, adapter, store, entity, diffs, entities,
                   obligations, mind, analyses) -> dict:
    refs = {h["ref"] for h in entity["holdings"] if h["kind"] == "promise"}
    current = current_state(adapter, analyses)
    creating = next(
        (d for d in diffs if d.diff_id == entity.get("created_via")), None
    )
    neighbors: list[dict] = []
    for h in entity["holdings"]:
        if h["kind"] == "promise":
            o = obligations.get(h["ref"])
            entry = current.get(h["ref"]) or {}
            bucket = _health(entry)
            since = entry.get("since")
            neighbors.append(_neighbor(
                "signed", "promise",
                o.statement if o else h["ref"], ref=h["ref"],
                why=h.get("note", ""),
                meta=bucket + (f" · since check #{since}" if since else ""),
            ))
        else:
            neighbors.append(_neighbor(
                "signed", h["kind"], h["ref"], why=h.get("note", "")
            ))
    for r in entity["relations"]:
        other = entities.get(r["other_id"], {})
        neighbors.append(_neighbor(
            "signed", "relation",
            f"{r['relation'].replace('_', ' ')} {other.get('name', r['other_id'])}",
            ref=r["other_id"],
        ))
    for d in _diffs_touching(diffs, {entity["entity_id"]}, refs):
        neighbors.append(_neighbor(
            _diff_mood(d), "decision",
            d.question, ref=d.diff_id,
            why=_diff_why(d), meta=_diff_meta(d),
        ))
    seen_checks = set()
    for a in sorted(analyses, key=lambda a: a.created_at):
        for impact in a.obligation_impacts:
            # material findings only — a check that merely LOOKED and
            # found nothing related is not part of this node's mental
            # model (it stays complete on the check's own focus)
            if (impact.obligation_id in refs
                    and impact.relation.value != "unrelated"
                    and a.pr_number not in seen_checks):
                seen_checks.add(a.pr_number)
                neighbors.append(_neighbor(
                    "observed", "check",
                    f"check #{a.pr_number}", ref=str(a.pr_number),
                    why=impact.reasoning,
                    meta=impact.relation.value.replace("_", " "),
                ))
    for atom in atoms_for(workspace_dir, adapter, store,
                          entity_id=entity["entity_id"])[-_RECENT_EVENTS_SHOWN:]:
        neighbors.append(_neighbor("observed", "event", atom["text"]))
    neighbors += _mind_neighbors(
        mind, refs | {entity["entity_id"]}
        | {h["ref"] for h in entity["holdings"]},
    )
    from quire.session import session_ref, sessions_for_entity

    for sess in sessions_for_entity(workspace_dir, adapter, store, entity):
        neighbors.append(_neighbor(
            "observed", "session",
            sess["title"] or sess["session_id"][:8],
            ref=session_ref(sess),
            why=sess.get("reasoning", "")[:400],
            meta=sess.get("_via", "a coding session")
            + (f" · {sess['digested_at'][:10]}" if sess.get("digested_at") else ""),
        ))
    return {
        "node": {
            "kind": "entity", "mood": "signed", "ref": entity["entity_id"],
            "title": entity["name"], "body": entity["identity_sentence"],
            "reasoning": creating.reasoning if creating else "",
            "evidence": [
                {"quote": q.quote, "source": q.source}
                for q in (creating.evidence if creating else [])
            ],
            "meta": (
                _diff_meta(creating) if creating else ""
            ) + (" · frozen" if entity["status"] != "active" else ""),
            "status": entity["status"],
            "record": entity["entity_id"],
        },
        "neighbors": neighbors,
        "authority": {"teach": entity["entity_id"]}
        if entity["status"] == "active" else {},
    }


def _around_promise(adapter, o, diffs, entities, mind, analyses) -> dict:
    ref = o.obligation_id
    by_diff = {d.diff_id: d for d in diffs}
    current = current_state(adapter, analyses)
    entry = current.get(ref) or {}
    bucket = _health(entry)
    since = entry.get("since")
    neighbors: list[dict] = []
    for e in entities.values():
        holding = next(
            (h for h in e["holdings"]
             if h["kind"] == "promise" and h["ref"] == ref), None
        )
        if holding:
            via = by_diff.get(holding.get("via", ""))
            neighbors.append(_neighbor(
                "signed", "entity", e["name"], ref=e["entity_id"],
                why=holding.get("note", ""),
                meta="holds it · " + (_diff_meta(via) if via else
                                      f"via {holding.get('via', '')}"),
            ))
    cps = {cp.control_point_id: cp for cp in adapter.control_points()}
    bindings = list(adapter.bindings())
    bound_count = {}
    for b in bindings:
        bound_count[b.control_point_id] = bound_count.get(b.control_point_id, 0) + 1
    for b in bindings:
        if b.obligation_id == ref and b.control_point_id in cps:
            cp = cps[b.control_point_id]
            # the description belongs to the CONTROL POINT; presenting it
            # as this promise's edge rationale misattributes when several
            # promises bind here (board round 1, C3)
            solo = bound_count.get(b.control_point_id, 0) == 1
            neighbors.append(_neighbor(
                "signed", "code", cp.path,
                why=getattr(cp, "description", "") if solo else "",
                meta=b.relation.value.replace("_", " ")
                + ("" if solo else " · control point shared by "
                   f"{bound_count[b.control_point_id]} promises"),
            ))
    for d in _diffs_touching(diffs, set(), {ref}):
        neighbors.append(_neighbor(
            _diff_mood(d), "decision",
            d.question, ref=d.diff_id, why=_diff_why(d), meta=_diff_meta(d),
        ))
    for a in sorted(analyses, key=lambda a: a.created_at):
        for impact in a.obligation_impacts:
            if (impact.obligation_id == ref
                    and impact.relation.value != "unrelated"):
                cite = next(iter(impact.evidence), None)
                neighbors.append(_neighbor(
                    "observed", "check",
                    f"check #{a.pr_number}", ref=str(a.pr_number),
                    why=impact.reasoning,
                    meta=impact.relation.value.replace("_", " ")
                    + (f" · {cite.reference}:{cite.start_line}" if cite else ""),
                ))
    neighbors += _mind_neighbors(mind, {ref})
    source = f"{o.source_reference} {o.source_section}".strip()
    return {
        "node": {
            "kind": "promise", "mood": "signed", "ref": ref,
            "title": o.statement,
            "body": (f"from {source}" if source else "")
            + (f' — “{o.source_quote}”' if getattr(o, "source_quote", "") else ""),
            "reasoning": "",
            "meta": bucket + (f" · since check #{since}" if since else ""),
            "status": bucket,
        },
        "neighbors": neighbors,
        "authority": {},
    }


def _around_diff(diff, entities, obligations, mind) -> dict:
    neighbors: list[dict] = []
    for op in diff.operations:
        for eid in _op_entity_ids(op):
            if eid in entities:
                neighbors.append(_neighbor(
                    "signed", "entity", entities[eid]["name"], ref=eid,
                    meta=op.op.replace("_", " "),
                ))
        pref = getattr(op, "ref", None)
        if pref and pref in obligations:
            neighbors.append(_neighbor(
                "signed", "promise", obligations[pref].statement, ref=pref,
                why=getattr(op, "note", ""), meta=op.op,
            ))
    neighbors += _mind_neighbors(mind, {diff.diff_id})
    quotes = "\n".join(f"“{q.quote}” — {q.source}" for q in diff.evidence)
    return {
        "node": {
            "kind": "decision", "ref": diff.diff_id,
            "mood": _diff_mood(diff),
            "title": diff.question,
            "body": quotes,
            "reasoning": diff.reasoning,
            "meta": _diff_meta(diff),
            "status": diff.status,
        },
        "neighbors": neighbors,
        "authority": {"decide_in_inbox": True} if diff.status == "open" else {},
    }


def _around_check(analysis, entities, obligations, mind, workspace_dir=None) -> dict:
    from quire.analysis.render import DISPLAY_LABELS

    neighbors: list[dict] = []
    for impact in analysis.obligation_impacts:
        o = obligations.get(impact.obligation_id)
        cites = "; ".join(
            f"{e.reference}:{e.start_line}" for e in impact.evidence[:2]
        )
        excerpt = next(
            (e.excerpt for e in impact.evidence if e.excerpt), ""
        )
        neighbors.append(_neighbor(
            "signed", "promise",
            o.statement if o else impact.obligation_id,
            ref=impact.obligation_id,
            why=impact.reasoning,
            meta=impact.relation.value.replace("_", " ")
            + (f" · {cites}" if cites else "")
            + (f" · “{excerpt[:90]}”" if excerpt else ""),
        ))
    neighbors += _mind_neighbors(
        mind, {str(analysis.pr_number), f"check #{analysis.pr_number}"}
    )
    if workspace_dir is not None:
        from quire.session import session_ref, sessions_for_check

        for sess in sessions_for_check(workspace_dir, analysis.pr_number):
            neighbors.append(_neighbor(
                "observed", "session",
                sess["title"] or sess["session_id"][:8],
                ref=session_ref(sess),
                why=sess.get("summary", ""),
                meta="the session that produced this change",
            ))
    return {
        "node": {
            "kind": "check", "mood": "observed", "ref": str(analysis.pr_number),
            "title": f"check #{analysis.pr_number} — {DISPLAY_LABELS[analysis.classification]}",
            "body": f"commit {analysis.head_sha[:12]} · analyzer "
            f"{analysis.analyzer_version} · "
            f"{analysis.created_at.isoformat(timespec='seconds')[:16]}",
            "reasoning": "",
            "meta": (
                f"reviewed: {analysis.review_state.value} · {analysis.reviewer}"
                if analysis.reviewer else ""
            ),
            "status": analysis.classification.value,
        },
        "neighbors": neighbors,
        "authority": {},
    }


def _around_session(record, entities) -> dict:
    """A coding session as a node: its distilled reasoning first-class,
    its key decisions listed, related to the PR it produced and the
    entities whose code it touched. Observed evidence — it happened; the
    reasoning is the agent's own words, not our inference."""
    from quire.session import session_ref

    touched = set(record.get("touched_paths", []))
    neighbors: list[dict] = []
    if record.get("pr") is not None:
        neighbors.append(_neighbor(
            "observed", "check", f"check #{record['pr']}",
            ref=str(record["pr"]),
            meta="the change this session produced",
        ))
    for entity in entities.values():
        code = {h["ref"] for h in entity["holdings"] if h["kind"] == "code"}
        hit = sorted(
            tp for tp in touched
            for cr in code if tp == cr or tp.endswith("/" + cr) or cr.endswith("/" + tp)
        )
        if hit:
            neighbors.append(_neighbor(
                "signed", "entity", entity["name"], ref=entity["entity_id"],
                why="the session edited " + ", ".join(hit[:3]),
            ))
    decisions = record.get("decisions") or []
    body = record.get("summary", "")
    if decisions:
        body += "\n\nKey decisions:\n" + "\n".join(
            f"• {d['choice']}" + (f" — {d['why']}" if d.get("why") else "")
            + (f" (not: {d['rejected']})" if d.get("rejected") else "")
            for d in decisions
        )
    return {
        "node": {
            "kind": "session", "mood": "observed",
            "ref": record.get("_ref") or session_ref(record),
            "title": record.get("title") or record["session_id"][:12],
            "body": body,
            "reasoning": record.get("reasoning", ""),
            "meta": (f"{record.get('turns', 0)} turns · "
                     f"{record.get('digested_at', '')[:10]} · "
                     f"reasoning captured, not re-derived"),
            "status": "observed",
        },
        "neighbors": neighbors,
        "authority": {},
    }


def _around_thought(node, mind, entities, obligations) -> dict:
    neighbors: list[dict] = []
    for c in node.get("connects", []):
        ref = c.get("ref", "")
        if ref in entities:
            neighbors.append(_neighbor(
                "signed", "entity", entities[ref]["name"], ref=ref,
                why=c.get("why", ""),
            ))
        elif ref in obligations:
            neighbors.append(_neighbor(
                "signed", "promise", obligations[ref].statement, ref=ref,
                why=c.get("why", ""),
            ))
        elif re.fullmatch(r"GD-\d+", ref):
            neighbors.append(_neighbor(
                "signed", "decision", ref, ref=ref, why=c.get("why", ""),
            ))
        elif ref.isdigit():
            neighbors.append(_neighbor(
                "observed", "check", f"check #{ref}", ref=ref,
                why=c.get("why", ""),
            ))
        else:
            neighbors.append(_neighbor(
                "signed", "path", ref, why=c.get("why", ""),
            ))
    first_seen = node.get("first_seen", "")[:10]
    return {
        "node": {
            "kind": node.get("kind", "thought"), "mood": "thought",
            "ref": node["name"], "title": node["name"],
            "body": node.get("gloss", ""),
            "reasoning": node.get("reasoning", ""),
            "meta": node.get("salience", "ambiguous")
            + (f" · first seen {first_seen}" if first_seen else "")
            + " · unsigned",
            "status": "active",
        },
        "neighbors": neighbors,
        "authority": {"dismiss": node["name"]},
    }
