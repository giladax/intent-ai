"""Overlapping semantic grouping of contract candidates — link communities.

Not invented here; assembled from the literature:

- **Link communities** (Ahn, Bagrow & Lehmann, "Link communities reveal
  multiscale complexity in networks", Nature 2010): cluster the EDGES of
  the obligation↔file bipartite graph instead of the nodes. A node belongs
  to every community its edges land in — overlap is native, and membership
  weight is the node's edge-mass share per community.
- **Single-linkage agglomerative clustering** over edge similarity, with
  the cut level chosen by Ahn's **partition density** objective (scanned
  over all dendrogram levels; trivial at contract scale, m ≤ a few hundred
  edges → O(m²) similarities).
- **Constrained clustering** (Wagstaff et al., COP-KMeans 2001): human
  edits become must-link / cannot-link constraint sets over obligations.
  Cannot-links veto dendrogram cuts that would violate them; must-links
  merge communities post-cut. Renames persist as labels anchored to a
  group's dominant member. The constraint log doubles as training signal:
  it is the ground truth against which the similarity blend weights can be
  tuned (grid search — no ML infra needed).

Edge model:

- Binding edges (obligation, file) carry relation weights — decides and
  enforces bind identity hardest; verifies weakest. This generalizes the
  earlier "test files don't glue groups" rule into a soft prior.
- Similarity is defined only for edge pairs sharing an endpoint (Ahn):
  neighborhood Jaccard of the *other* endpoints, blended with content
  priors — TF-IDF cosine + same-source-section for obligation pairs, path
  proximity for file pairs. Neighborhood Jaccard inherently discounts hub
  files (a file bound to everything has a huge neighborhood → low
  similarity), so promiscuous files can't collapse the structure.

The LLM's role is strictly heuristic: naming groups, and (future)
adjudicating borderline pairs. It never determines the structure.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from typing import NamedTuple

from pydantic import BaseModel, Field

from quire_align.text import (
    cosine_similarity,
    jaccard_similarity,
    tf_idf_vectors,
    tokenize,
)

RELATION_WEIGHTS = {
    "decides": 1.0,
    "enforces": 1.0,
    "executes": 0.8,
    "configures": 0.8,
    "observes": 0.5,
    "verifies": 0.3,
}

_STOP = {
    "must", "never", "always", "every", "system", "that", "with", "when",
    "shall", "should", "only", "into", "from", "their", "this", "have",
    "them", "each", "over", "will", "been", "being", "than", "there",
}
_MEMBERSHIP_FLOOR = 0.15
_TEXT_BLEND = 0.45  # neighborhood Jaccard vs content prior
_SECTION_BONUS = 0.25
_TEXT_EDGE_MIN = 0.30  # cosine floor for first-class o–o similarity edges
# Dendrogram cut floor: partition density is degenerate (zero) for small
# tree-like communities, so merges below this similarity never happen.
# This is THE tunable that accumulated human must/cannot-links calibrate.
_SIM_CUTOFF = 0.18


class GroupingConstraints(BaseModel):
    """Human edits, persisted with the workspace and replayed on regroup."""

    must_link: list[list[str]] = Field(default_factory=list)  # [[ob_a, ob_b]]
    cannot_link: list[list[str]] = Field(default_factory=list)
    labels: dict[str, str] = Field(
        default_factory=dict,
        description="anchor obligation id → human label for its group",
    )


class Endpoint(NamedTuple):
    """A node in the bipartite obligation↔file graph."""

    kind: str  # "obligation" | "file"
    key: str  # obligation_id or repo path


@dataclass
class _Edge:
    """Binding edges are obligation–file; text-similarity edges are
    obligation–obligation (first-class edges — vocabulary kinship groups
    obligations even with disjoint files)."""

    u: Endpoint
    v: Endpoint
    weight: float
    relation: str

    def endpoints(self) -> tuple[Endpoint, Endpoint]:
        return (self.u, self.v)

    def obligations(self) -> list[str]:
        return [e.key for e in (self.u, self.v) if e.kind == "obligation"]

    def files(self) -> list[str]:
        return [e.key for e in (self.u, self.v) if e.kind == "file"]


@dataclass
class _SimilarityContext:
    """Precomputed material every edge-pair similarity lookup needs."""

    ob_vocab: dict[str, dict[str, float]]  # obligation id → tf-idf vector
    ob_section: dict[str, str]  # obligation id → source section
    neighbors: dict[Endpoint, set[Endpoint]]  # full-graph adjacency


class _UnionFind:
    """Path-halving union-find over edge indices (single-linkage merges)."""

    def __init__(self, n: int) -> None:
        self._parent = list(range(n))

    def find(self, x: int) -> int:
        while self._parent[x] != x:
            self._parent[x] = self._parent[self._parent[x]]
            x = self._parent[x]
        return x

    def union(self, a: int, b: int) -> None:
        self._parent[self.find(a)] = self.find(b)


def _content_words(text: str) -> list[str]:
    """Grouping vocabulary: content words ≥4 chars plus digit-bearing
    tokens ("$50", "24h") minus grouping stopwords."""
    return tokenize(text, min_len=4, keep_digits=True, stopwords=_STOP)


def _path_proximity(f1: str, f2: str) -> float:
    p1, p2 = f1.split("/")[:-1], f2.split("/")[:-1]
    shared = 0
    for a, b in zip(p1, p2):
        if a != b:
            break
        shared += 1
    return shared / max(len(p1), len(p2), 1)


def _node_prior(x: Endpoint, y: Endpoint, ctx: _SimilarityContext) -> float:
    if x.kind == "obligation" and y.kind == "obligation":
        prior = cosine_similarity(ctx.ob_vocab[x.key], ctx.ob_vocab[y.key])
        if ctx.ob_section.get(x.key) and ctx.ob_section.get(x.key) == ctx.ob_section.get(y.key):
            prior = min(1.0, prior + _SECTION_BONUS)
        return prior
    if x.kind == "file" and y.kind == "file":
        return _path_proximity(x.key, y.key)
    return 0.0  # mixed endpoints: rely on neighborhood Jaccard


def _edge_similarity(e1: _Edge, e2: _Edge, ctx: _SimilarityContext) -> float:
    shared = set(e1.endpoints()) & set(e2.endpoints())
    if not shared:
        return 0.0
    k = next(iter(shared))
    x = next((n for n in e1.endpoints() if n != k), None)
    y = next((n for n in e2.endpoints() if n != k), None)
    if x is None or y is None or x == y:
        # Parallel edges, or a degenerate self-loop (guarded against
        # upstream, but similarity must stay total): maximal overlap.
        return 1.0
    jac = jaccard_similarity(ctx.neighbors[x], ctx.neighbors[y])
    base = (1 - _TEXT_BLEND) * jac + _TEXT_BLEND * _node_prior(x, y, ctx)
    # Weighted link communities: weak relations (verifies) attract weakly —
    # a shared e2e suite must not fuse unrelated concerns.
    return base * math.sqrt(e1.weight * e2.weight)


def _partition_density(communities: list[set[int]], edges: list[_Edge]) -> float:
    """Ahn et al. eq. — density of edges within induced node sets."""
    m_total = sum(len(c) for c in communities) or 1
    score = 0.0
    for community in communities:
        nodes = set()
        for idx in community:
            nodes.update(edges[idx].endpoints())
        m_c, n_c = len(community), len(nodes)
        if n_c <= 2:
            continue
        denom = (n_c * (n_c - 1) / 2) - (n_c - 1)
        if denom > 0:
            score += m_c * (m_c - (n_c - 1)) / denom
    return 2 * score / m_total


def _violates_cannot_link(
    communities: list[set[int]], edges: list[_Edge], cannot: list[list[str]]
) -> bool:
    for community in communities:
        members = {ob for i in community for ob in edges[i].obligations()}
        for a, b in cannot:
            if a in members and b in members:
                return True
    return False


def _cluster_edges(
    edges: list[_Edge], ctx: _SimilarityContext, cannot: list[list[str]]
) -> list[set[int]]:
    """Single-linkage over edge similarity; cut = best partition density
    among cut levels that respect cannot-link constraints."""
    m = len(edges)
    pairs = []
    for i in range(m):
        for j in range(i + 1, m):
            s = _edge_similarity(edges[i], edges[j], ctx)
            if s > 0:
                pairs.append((s, i, j))
    pairs.sort(reverse=True)

    components = _UnionFind(m)

    def snapshot() -> list[set[int]]:
        comps: dict[int, set[int]] = defaultdict(set)
        for i in range(m):
            comps[components.find(i)].add(i)
        return list(comps.values())

    best, best_score = snapshot(), -1.0
    if not _violates_cannot_link(best, edges, cannot):
        best_score = _partition_density(best, edges)

    k = 0
    while k < len(pairs) and pairs[k][0] >= _SIM_CUTOFF:
        level = pairs[k][0]
        # merge every pair at this similarity level, then evaluate the cut
        while k < len(pairs) and pairs[k][0] >= level - 1e-9:
            _, i, j = pairs[k]
            components.union(i, j)
            k += 1
        cut = snapshot()
        if _violates_cannot_link(cut, edges, cannot):
            break  # constrained: no deeper merge can un-violate
        score = _partition_density(cut, edges)
        if score >= best_score:
            best, best_score = cut, score
    return best


def group_contract(
    obligations: list[dict],
    bindings: list[dict],
    constraints: GroupingConstraints | None = None,
    llm_labels: dict[str, str] | None = None,
    pair_hints: dict[str, str] | None = None,
) -> dict:
    """Main entry. obligations: [{obligation_id, statement, source_section?}];
    bindings: [{obligation_id, path, relation}]. Returns groups with
    weighted overlapping membership, bridges, and unassigned obligations."""
    constraints = constraints or GroupingConstraints()
    # Defensive dedupe: duplicate ids upstream would create self-loop text
    # edges and double-counted mass.
    ids = list(dict.fromkeys(o["obligation_id"] for o in obligations))
    known = set(ids)
    edges = [
        _Edge(
            Endpoint("obligation", b["obligation_id"]),
            Endpoint("file", b["path"]),
            RELATION_WEIGHTS.get(b["relation"], 0.5),
            b["relation"],
        )
        for b in bindings
        if b["obligation_id"] in known
    ]

    ob_vocab = tf_idf_vectors(
        {o["obligation_id"]: _content_words(o["statement"]) for o in obligations}
    )
    # Text-similarity edges: vocabulary kinship is a first-class edge, so
    # obligations with disjoint files can still share a community.
    # Constraint-aware construction: never create an edge that contains a
    # cannot-linked pair (Wagstaff-style — constraints shape the graph).
    forbidden = {frozenset(pair) for pair in constraints.cannot_link}
    pair_hints = pair_hints or {}
    for i, a in enumerate(ids):
        for b in ids[i + 1 :]:
            if frozenset((a, b)) in forbidden:
                continue
            hint = pair_hints.get(f"{min(a, b)}|{max(a, b)}")
            if hint == "different":
                continue  # LLM-adjudicated apart (softer than a human cannot-link)
            cos = cosine_similarity(ob_vocab[a], ob_vocab[b])
            if hint == "same":
                cos = max(cos, 0.6)  # adjudicated together: guarantee the edge
            if cos >= _TEXT_EDGE_MIN:
                edges.append(
                    _Edge(Endpoint("obligation", a), Endpoint("obligation", b), cos, "similar")
                )

    ctx = _SimilarityContext(
        ob_vocab=ob_vocab,
        ob_section={o["obligation_id"]: o.get("source_section", "") for o in obligations},
        neighbors=defaultdict(set),
    )
    for e in edges:
        ctx.neighbors[e.u].add(e.v)
        ctx.neighbors[e.v].add(e.u)

    communities = _cluster_edges(edges, ctx, constraints.cannot_link)

    # --- must-link: merge the communities holding each pair's edge mass ----
    def dominant(ob: str, comms: list[set[int]]) -> int | None:
        best_i, best_w = None, 0.0
        for ci, community in enumerate(comms):
            w = sum(edges[i].weight for i in community if ob in edges[i].obligations())
            if w > best_w:
                best_i, best_w = ci, w
        return best_i

    # NOTE: this loop mutates `communities` in place (merge then pop), which
    # invalidates indices computed before the mutation — safe only because
    # `dominant` is recomputed from the current list on every iteration.
    for a, b in constraints.must_link:
        ca, cb = dominant(a, communities), dominant(b, communities)
        if ca is not None and cb is not None and ca != cb:
            communities[ca] |= communities[cb]
            communities.pop(cb)

    # Splinter cleanup (standard in link-community implementations): a
    # community whose obligation set is contained in another's is residue
    # of the same structure (e.g. a text edge clustering apart from its
    # pair's binding edges) — fold it in. True overlaps have incomparable
    # member sets and survive.
    def ob_set(community: set[int]) -> frozenset:
        return frozenset(ob for i in community for ob in edges[i].obligations())

    communities.sort(key=lambda c: (-len(ob_set(c)), -len(c)))
    folded: list[set[int]] = []
    for community in communities:
        obs = ob_set(community)
        target = next(
            (
                f
                for f in folded
                if obs
                and obs <= ob_set(f)
                and not _violates_cannot_link([f | community], edges, constraints.cannot_link)
            ),
            None,
        )
        if target is not None:
            target |= community
        else:
            folded.append(community)
    communities = folded

    # --- memberships: normalized edge mass per community -------------------
    mass: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    for ci, community in enumerate(communities):
        for i in community:
            for ob in edges[i].obligations():
                mass[ob][ci] += edges[i].weight
    memberships: dict[str, dict[int, float]] = {}
    for ob, per in mass.items():
        total = sum(per.values()) or 1.0
        weighted = {ci: w / total for ci, w in per.items()}
        kept = {ci: w for ci, w in weighted.items() if w >= _MEMBERSHIP_FLOOR}
        memberships[ob] = kept or dict([max(weighted.items(), key=lambda kv: kv[1])])

    # --- assemble output (stable order: big communities first) -------------
    order = sorted(range(len(communities)), key=lambda ci: -len(communities[ci]))
    groups, bridges = [], defaultdict(set)
    for gi, ci in enumerate(order):
        members = sorted(
            [
                {"obligation_id": ob, "weight": round(w, 2)}
                for ob, per in memberships.items()
                if (w := per.get(ci)) is not None
            ],
            key=lambda m: -m["weight"],
        )
        if not members:
            continue
        files = sorted({f for i in communities[ci] for f in edges[i].files()})
        for f in files:
            bridges[f].add(f"G{gi + 1}")
        counts: dict[str, float] = defaultdict(float)
        for m in members:
            for t, v in ctx.ob_vocab[m["obligation_id"]].items():
                counts[t] += v * m["weight"]
        auto_label = " / ".join(t for t, _ in sorted(counts.items(), key=lambda kv: -kv[1])[:3])
        anchor = members[0]["obligation_id"]
        groups.append(
            {
                "group_id": f"G{gi + 1}",
                # precedence: human rename > LLM name > TF-IDF fallback
                "label": constraints.labels.get(
                    anchor, (llm_labels or {}).get(anchor, auto_label or "ungrouped")
                ),
                "anchor": anchor,
                "members": members,
                "obligation_ids": [m["obligation_id"] for m in members],
                "files": files,
            }
        )
    orphans = [i for i in ids if i not in memberships]
    if orphans:
        groups.append(
            {
                "group_id": f"G{len(groups) + 1}",
                "label": "unbound",
                "anchor": orphans[0],
                "members": [{"obligation_id": i, "weight": 1.0} for i in orphans],
                "obligation_ids": orphans,
                "files": [],
            }
        )
    return {
        "groups": groups,
        "bridges": [
            {"path": path, "groups": sorted(gs)}
            for path, gs in sorted(bridges.items())
            if len(gs) > 1
        ],
    }
