"""The derived tree: an organization's shape, computed — never declared.

The founder's correction: "Feature" and "Current Understanding" are not
top-level anything — they are words with no context. An organization
already has a shape: THE PROJECT is the root, and under it live its
capabilities, specs, requirements, updates. We don't invent that wheel
and we don't hard-code it either: which nodes sit at the top is DECIDED
DYNAMICALLY from how the graph actually connects —

- the project (the workspace) is always the root;
- explicit part_of edges nest first (a human said so);
- an entity whose world is mostly contained in a bigger entity's world
  nests under it (subsumption by shared refs);
- what remains at top level is ranked by how much of the org it
  carries — the big connectors float up;
- the mind's thoughts hang off the entity they think about most;
- and NOTHING is an orphan: promises without a home and thoughts
  without an anchor sit under named root branches, visible as gaps —
  related at minimum by the observable ("not yet placed" is a
  relation to the project, honestly labeled).

Every node carries its context path ("brain › MCP Surface") so no name
ever renders as a bare word again. Derived, cheap, recomputed on read.
"""

from __future__ import annotations

import pathlib

from quire_align.entity_graph import graph_state, load_diffs

# A nests under B when this share of A's world lives inside B's world
# and B is the larger of the two — subsumption, not mere overlap.
_SUBSUME_SHARE = 0.6


def _refs_of(entity: dict) -> set[str]:
    return {h["ref"] for h in entity["holdings"]}


def _node(kind: str, ref: str, name: str, context: list[str], **extra) -> dict:
    return {
        "kind": kind,
        "ref": ref,
        "name": name,
        "context": " › ".join(context),
        "children": [],
        **extra,
    }


def derive_tree(workspace_dir: pathlib.Path, adapter, store, include_thoughts: bool = True) -> dict:
    """The whole org as one tree rooted at the project."""
    import yaml

    diffs = load_diffs(workspace_dir)
    state = graph_state(diffs)
    active = [e for e in state["entities"].values() if e["status"] == "active"]
    statements = {o.obligation_id: o.statement for o in adapter.obligations()}

    project_name = workspace_dir.name.replace("-", " ")
    root = _node("project", "project", project_name, [])

    # 1) explicit containment first: a signed part_of outranks derivation
    parent_of: dict[str, str] = {}
    ids = {e["entity_id"] for e in active}
    for entity in active:
        for rel in entity["relations"]:
            if rel["relation"] == "part_of" and rel["other_id"] in ids:
                parent_of[entity["entity_id"]] = rel["other_id"]

    # 2) derived containment: mostly-contained worlds nest (dynamically —
    #    nobody declared these levels)
    refs = {e["entity_id"]: _refs_of(e) for e in active}
    for a in active:
        aid = a["entity_id"]
        if aid in parent_of or not refs[aid]:
            continue
        best, best_share = None, 0.0
        for b in active:
            bid = b["entity_id"]
            if bid == aid or len(refs[bid]) <= len(refs[aid]):
                continue
            share = len(refs[aid] & refs[bid]) / len(refs[aid])
            if share >= _SUBSUME_SHARE and share > best_share:
                best, best_share = bid, share
        if best:
            parent_of[aid] = best

    # 3) top level = the unparented, ranked by how much org they carry
    def promise_count(e: dict) -> int:
        return sum(1 for h in e["holdings"] if h["kind"] == "promise")

    by_id: dict[str, dict] = {}
    top = sorted(
        (e for e in active if e["entity_id"] not in parent_of),
        key=lambda e: (-promise_count(e), e["name"].lower()),
    )

    def build_entity(entity: dict, context: list[str]) -> dict:
        node = _node(
            "entity", entity["entity_id"], entity["name"],
            context,
            identity=entity["identity_sentence"],
        )
        by_id[entity["entity_id"]] = node
        here = context + [entity["name"]]
        for h in entity["holdings"]:
            if h["kind"] == "promise":
                node["children"].append(_node(
                    "promise", h["ref"],
                    statements.get(h["ref"], h["ref"]),
                    here,
                ))
        for child in sorted(
            (e for e in active if parent_of.get(e["entity_id"]) == entity["entity_id"]),
            key=lambda e: -promise_count(e),
        ):
            node["children"].append(build_entity(child, here))
        return node

    for entity in top:
        root["children"].append(build_entity(entity, [project_name]))

    # 4) the mind's thoughts hang where they think — anchorless ones are
    #    still related, observably, to the project itself
    mind_path = workspace_dir / "mind.yaml"
    thoughts = []
    if include_thoughts and mind_path.exists():
        thoughts = (yaml.safe_load(mind_path.read_text()) or {}).get("nodes", [])
    ref_to_entity: dict[str, str] = {}
    for entity in active:
        ref_to_entity[entity["entity_id"]] = entity["entity_id"]
        for h in entity["holdings"]:
            ref_to_entity.setdefault(h["ref"], entity["entity_id"])
    loose_thoughts = []
    for thought in thoughts:
        anchors: dict[str, int] = {}
        for c in thought.get("connects", []):
            eid = ref_to_entity.get(c.get("ref", ""))
            if eid:
                anchors[eid] = anchors.get(eid, 0) + 1
        node_kwargs = dict(
            salience=thought.get("salience", "ambiguous"),
            thought_kind=thought.get("kind", ""),
        )
        if anchors:
            home = max(anchors, key=lambda k: anchors[k])
            parent = by_id[home]
            parent["children"].append(_node(
                "thought", thought["name"], thought["name"],
                parent["context"].split(" › ") + [parent["name"]]
                if parent["context"] else [project_name, parent["name"]],
                **node_kwargs,
            ))
        else:
            loose_thoughts.append(_node(
                "thought", thought["name"], thought["name"],
                [project_name, "open threads"], **node_kwargs,
            ))
    if loose_thoughts:
        branch = _node("branch", "open-threads", "open threads — the mind, unanchored",
                       [project_name])
        branch["children"] = loose_thoughts
        root["children"].append(branch)

    # 5) no orphans: unplaced promises are a visible gap under the root
    housed = {h["ref"] for e in active for h in e["holdings"] if h["kind"] == "promise"}
    unplaced = [
        o for o in adapter.obligations() if o.obligation_id not in housed
    ]
    if unplaced:
        branch = _node("branch", "not-yet-placed",
                       "not yet placed — promises without a home", [project_name])
        branch["children"] = [
            _node("promise", o.obligation_id, o.statement,
                  [project_name, "not yet placed"])
            for o in unplaced
        ]
        root["children"].append(branch)

    return root


# -- the constant ring (docs/2026-07-19-top-level-structure.md) -----------
# Grammar constant, membership dynamic: seven shelves an org reads cold.
# Each shelf orders by its own law — subsumption, document structure,
# time, stakes, salience — and only branch 1 uses the derived tree.

def derive_ring(workspace_dir: pathlib.Path, adapter, store) -> dict:
    import yaml

    from quire_align.atoms import atoms_for
    from quire_align.entity_graph import open_proposals, stakes_label
    from quire_align.timeline import build_timeline

    diffs = load_diffs(workspace_dir)
    state = graph_state(diffs)
    active = [e for e in state["entities"].values() if e["status"] == "active"]
    obligations = list(adapter.obligations())
    project = workspace_dir.name.replace("-", " ")

    # branch 1 — the derived tree, entities only (thoughts keep their
    # canonical shelf; entity records keep their own threads section)
    tree = derive_tree(workspace_dir, adapter, store, include_thoughts=False)
    build = [c for c in tree["children"] if c["kind"] == "entity"]

    # branch 2 — the same promises through the spec door
    by_spec: dict[str, dict] = {}
    for o in obligations:
        spec = by_spec.setdefault(o.source_reference or "unsourced", {})
        spec.setdefault(o.source_section or "—", []).append(
            _node("promise", o.obligation_id, o.statement,
                  [project, o.source_reference or "unsourced"])
        )
    promised = [
        {**_node("spec", ref, ref, [project]),
         "children": [
             {**_node("section", f"{ref}{sec}", sec, [project, ref]),
              "children": rows}
             for sec, rows in sections.items()
         ]}
        for ref, sections in sorted(by_spec.items())
    ]

    # branch 3 — time orders here, never containment
    changing = [
        _node("event", "", a["text"], [project],
              at=a.get("at", ""), cites=a["cites"])
        for a in reversed(atoms_for(workspace_dir, adapter, store)[-20:])
    ]

    # branch 4 — worst first: open questions + broken promises
    analyses = store.list_analyses(repository=adapter.repository())
    events = build_timeline(adapter, analyses)["events"]
    current = events[-1]["state_after"] if events else {}
    statements = {o.obligation_id: o.statement for o in obligations}
    needs: list[dict] = []
    for ref, entry in current.items():
        if entry.get("status") == "contradicts":
            needs.append(_node(
                "promise", ref, statements.get(ref, ref), [project],
                mark="broken", since=entry.get("since")))
    for d in open_proposals(diffs):
        needs.append(_node(
            "proposal", d.diff_id, d.question, [project],
            mark=f"{stakes_label(d.stakes)} stakes"))

    # branch 5 — the mind's canonical shelf, salience first
    mind_path = workspace_dir / "mind.yaml"
    mind = (yaml.safe_load(mind_path.read_text()) or {}) if mind_path.exists() else {}
    rank = {"important": 0, "ambiguous": 1}
    wonders = [
        _node("thought", n["name"], n["name"], [project],
              gloss=n.get("gloss", ""), salience=n.get("salience", "ambiguous"),
              thought_kind=n.get("kind", ""))
        for n in sorted(mind.get("nodes", []),
                        key=lambda n: rank.get(n.get("salience"), 2))
    ]

    # branch 6 — gaps by age; renders only when gaps exist
    housed = {h["ref"] for e in active for h in e["holdings"] if h["kind"] == "promise"}
    gaps = [
        _node("promise", o.obligation_id, o.statement, [project])
        for o in obligations if o.obligation_id not in housed
    ]

    broken = sum(1 for e in current.values() if e.get("status") == "contradicts")
    ring = [
        {"id": "what-we-build", "name": "What we build",
         "line": "the capabilities this organization maintains",
         "children": build, "count": len(build)},
        {"id": "what-we-promised", "name": "What we promised",
         "line": "the same promises, by the documents that made them",
         "children": promised, "count": len(obligations)},
        {"id": "whats-changing", "name": "What's changing",
         "line": "signings, checks, and returns — newest first",
         "children": changing, "count": len(changing)},
        {"id": "what-needs-a-human", "name": "What needs a human",
         "line": "unsigned questions and broken promises, worst first",
         "children": needs, "count": len(needs)},
        {"id": "what-the-mind-wonders", "name": "What the mind wonders",
         "line": "unsigned thinking — tensions, questions, bets",
         "children": wonders, "count": len(wonders)},
    ]
    if gaps:
        ring.append({"id": "what-has-no-home", "name": "What has no home",
                     "line": "promises without a place — visible until placed",
                     "children": gaps, "count": len(gaps)})
    ring.append({"id": "who-and-where", "name": "Who and where",
                 "line": "people, channels, and sources — not yet connected",
                 "children": [], "count": 0, "dormant": True,
                 "empty": "No people or channels are connected yet. When "
                 "they are, they will relate the map to the humans who "
                 "shape it."})
    return {
        "project": project,
        "vitals": {
            "capabilities": len(active),
            "promises": len(obligations),
            "broken": broken,
            "awaiting": len(open_proposals(diffs)),
        },
        "ring": ring,
    }
