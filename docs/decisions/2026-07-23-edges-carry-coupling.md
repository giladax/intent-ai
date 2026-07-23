# 2026-07-23 — Graph rule: nodes are relation-agnostic; edges carry all coupling

**Founder, standing architectural constraint for the graph and layers.**

## The rule

- **Nodes embed no relations.** An entity (session, check, feature, promise,
  file, task, spend record…) is identity + content. It does not know its
  neighbors. Maximum decoupling between entities.
- **All coupling originates in edges** — first-class, typed, separate
  objects, each carrying its provenance (what created it: a trailer, a
  binding, an evidence anchor, a semantic judgment) and its evidence.
- **Edges are derivable; nodes are stable.** When reality changes — code
  refactors, files move, features split — connections are RE-DERIVED from
  the change stream (commits, diffs, digests) without rewriting nodes.
  Refactor-resilience is the point: we maintain connection truth by
  recomputation, not by migration.
- **The semantic exception, by design:** where entities ARE semantics
  (features, intents, concepts), the connection is legitimately semantic.
  Semantic edges are allowed — but they are still separate edge objects,
  labeled as semantic, with provenance, and they still never grant
  authority (similarity proposes; signatures decide — standing rule).

## Already conformant (this is a blessing, not a refactor order)

- `session_checks` (U0): session↔check edges with kind/confidence/evidence.
- The reasoning-topology spec's five deterministic edge types (trailer,
  touched-path, evidence-anchor, binding, and their joins).
- `bindings.yaml`: obligation↔file edges, human-curated, provenance clear.

## To audit when graph work lands (flag, don't churn now)

- Any node payload carrying arrays of related ids inline (e.g. event
  `topicIds`-style fields, moment arc references) — candidates to become
  edges when their subsystem is next touched.
- New primitives (the task bridge, spend and future reality sources) MUST
  be born conformant: node tables clean, edge tables beside them.

## Why it matters beyond hygiene

The re-derivable edge is what makes "nobody updated this, and it is true"
architecturally cheap: the board/graph stays correct because connections
are recomputed from what actually happened, not maintained by hand — the
same maintenance argument that kills wikis and Jira, applied to our own
internals.
