"""Relevance: every semantic node gets a vector built from its
CONNECTIONS' content — identity, promise statements, taught words, and
its recent plot atoms — so a question resolves by meaning, not by an
exact-match dictionary.

This retires the alias table as load-bearing infrastructure. Aliases
were weak and hard to maintain because they were the ONLY bridge from
the org's dialect to the map: every phrasing had to be taught, exactly.
Now the bridge is the node vector; taught words are one ingredient in
it (each teaching enriches the vector, so nearby phrasings resolve
untaught), and the alias list survives as confirmed display vocabulary
("answers to …"), not as the resolution mechanism.

Vectors are TF-IDF over connection content today — no new dependency,
same machinery as grouping — behind an interface a dense-embedding
provider can replace without touching callers. Deterministic, derived,
computed on demand (the map is small); thresholds mirror the lexical
rung's philosophy: resolve only with a clear winner, refuse otherwise.
"""

from __future__ import annotations

import pathlib

from quire_align.atoms import atoms_for
from quire_align.entity_graph import graph_state, load_diffs
from quire_align.mind import read_mind_cache
from quire_align.text import cosine_similarity, tf_idf_vectors, tokenize

# Same trust posture as the lexical rung: below the floor the match is
# noise; without the margin the term is genuinely ambiguous — refuse and
# name the neighbors rather than guess. Calibrated for n-gram vectors,
# where shared gram mass compresses relative margins (the lexical rung's
# 1.5 would refuse clear winners): floor 0.10, margin 1.2, tuned on live
# probes ("risky payouts" → Risk Review at 1.26×; nonsense → 0).
_SEMANTIC_MIN = 0.10
_SEMANTIC_MARGIN = 1.2


def _terms(text: str) -> list[str]:
    """Word tokens plus character 4-grams of each word. The n-grams
    bridge morphology ('risky' meets 'risk', 'reviews' meets 'review')
    — the cheapest honest step toward matching by meaning without a
    dense-embedding dependency."""
    words = tokenize(text, min_len=3, keep_digits=True)
    grams = [
        w[i : i + 4]
        for w in words
        if len(w) >= 4
        for i in range(len(w) - 3)
    ]
    return words + grams


def node_documents(
    workspace_dir: pathlib.Path, adapter, store
) -> dict[str, dict]:
    """One document per active entity: everything connected to it, as
    text. The vector drifts as the node's story evolves — 'the thing
    that broke last week' is literally in the vector."""
    from quire_align.entity_graph import read_state

    diffs, state = read_state(workspace_dir)  # read-only; never mutated
    statements = {o.obligation_id: o.statement for o in adapter.obligations()}
    atoms = atoms_for(workspace_dir, adapter, store)
    # the thinking kept on signed diffs reflects back into the map's
    # memory — the reasoning that grouped an entity is part of what it
    # MEANS, and it is where the connective vocabulary lives
    reasoning_by_diff = {
        d.diff_id: d.reasoning for d in diffs
        if d.status == "approved" and d.reasoning
    }
    docs: dict[str, dict] = {}
    for entity in state["entities"].values():
        if entity["status"] != "active":
            continue
        refs = {
            h["ref"] for h in entity["holdings"] if h["kind"] == "promise"
        }
        parts = [entity["name"], entity["identity_sentence"]]
        parts += entity["aliases"]
        parts += [statements.get(r, "") for r in refs]
        touching = {entity.get("created_via", "")} | {
            h.get("via", "") for h in entity["holdings"]
        }
        parts += [reasoning_by_diff[d] for d in touching if d in reasoning_by_diff]
        parts += [
            h["ref"].replace("/", " ").replace("_", " ")
            for h in entity["holdings"]
            if h["kind"] in ("code", "doc")
        ]
        parts += [
            a["text"] for a in atoms
            if a.get("entity_id") == entity["entity_id"]
            or a.get("promise") in refs
        ]
        parts += _mind_parts(workspace_dir, entity, refs)
        parts += _session_parts(workspace_dir, entity)
        docs[entity["entity_id"]] = {
            "name": entity["name"],
            "terms": _terms(" ".join(p for p in parts if p)),
        }
    return docs


def _mind_parts(workspace_dir, entity, refs) -> list[str]:
    """The working mind's thinking about an entity joins its vector —
    unsigned, but it is still what the map currently thinks the thing
    is about. Cache-only: vectors never trigger a sweep."""
    cached = read_mind_cache(workspace_dir)
    touchable = refs | {entity["entity_id"]} | {
        h["ref"] for h in entity["holdings"]
    }
    return [
        " ".join(p for p in (n.get("name"), n.get("gloss"), n.get("reasoning")) if p)
        for n in cached.get("nodes", [])
        if any(c.get("ref") in touchable for c in n.get("connects", []))
    ]


def _session_parts(workspace_dir, entity) -> list[str]:
    """A session's reasoning about an entity is part of what the entity
    MEANS — same propagation as diff reasoning. Cache-only read."""
    from quire_align.session import load_sessions

    code = {h["ref"] for h in entity["holdings"] if h["kind"] == "code"}
    if not code:
        return []
    out = []
    for sess in load_sessions(workspace_dir):
        touched = set(sess.get("touched_paths", []))
        if any(tp == cr or tp.endswith("/" + cr) or cr.endswith("/" + tp)
               for tp in touched for cr in code):
            out.append(" ".join(p for p in (
                sess.get("title"), sess.get("summary"), sess.get("reasoning")) if p))
    return out


def resolve_semantic(
    query: str, docs: dict[str, dict]
) -> dict | None:
    """Query → best entity by meaning, or None. When it resolves, it
    says WHY (the overlapping terms) — a match that cannot show its
    wording does not resolve (the refusal law, applied to search)."""
    if not docs:
        return None
    vectors = tf_idf_vectors(
        {**{k: d["terms"] for k, d in docs.items()}, "__q__": _terms(query)}
    )
    q = vectors.pop("__q__")
    scored = sorted(
        ((cosine_similarity(q, v), k) for k, v in vectors.items()),
        reverse=True,
    )
    top_score, top_id = scored[0]
    runner = scored[1][0] if len(scored) > 1 else 0.0
    near = [
        {"entity_id": k, "name": docs[k]["name"], "score": round(s, 3)}
        for s, k in scored[:3]
        if s > 0
    ]
    if top_score < _SEMANTIC_MIN:
        # refusal still helps: name the nearest by meaning
        return {"refused": True, "near": near} if near else None
    if runner and top_score / max(runner, 1e-9) < _SEMANTIC_MARGIN:
        return {"refused": True, "near": near}  # ambiguous — never guess
    # the receipt shows WORDS a human recognizes — whole tokens only,
    # never n-gram fragments (round-1 defect: "ctur, ools, ruct")
    q_words = set(tokenize(query, min_len=3, keep_digits=True))
    doc_words = set(docs[top_id]["terms"])
    matched = sorted(q_words & doc_words)
    if not matched:
        return {"refused": True, "near": near}
    return {
        "entity_id": top_id,
        "name": docs[top_id]["name"],
        "score": round(top_score, 3),
        "matched_terms": matched,
        "alternatives": near[1:],
    }
