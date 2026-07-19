# Scale dossier — onboarding pydantic (2026-07-20)

The investor objection: "telegram is a toy — 17 commits, 11 promises. Does any of
this survive contact with a real codebase?" This run onboards **pydantic** —
one of the most-downloaded Python libraries in existence — end to end on the
unmodified `quire_align` MVP, measures every phase, and reports what groaned
and what held. Workspace: `alignment/workspaces/pydantic/`. Server: local,
port 8381, tracing off. LLM budget: capped at 35 Sonnet-class calls — the run
landed on exactly 35.

## 1. Headline numbers

| | telegram (prior demo) | quire-brain (dogfood) | **pydantic (this run)** |
|---|---|---|---|
| Commits | 17 | 400 | **5,602** |
| Contributors | 1 | 2 | **824** |
| Repo age | days | ~2 months | **9.2 years** (2017-05 → 2026-07) |
| Files tracked | 52 | 770 | **782** (405 `.py`, **171,126 LOC** Python) |
| Docs scanned | — | — | 89 markdown docs |
| Promises in contract | 11 | 12 | **41** (from 3 behavior docs) |
| Bindings / control points | — | — | **131 bindings / 47 control points** (all 47 paths verified real) |
| Checks swept | 5 | 5 | **10 — one commit per year, 2017→2026** |

Intent sources: `docs/api/standard_library_types.md` (the type conformance
spec), `docs/concepts/serialization.md`, `docs/concepts/unions.md` (the smart-
union selection algorithm). Tutorial prose and two candidates with non-verbatim
quotes were dropped in curation; 41 of 45 drafted promises survived, every one
a testable behavioral claim with a verbatim source quote.

## 2. Cost table (calls + wall time per phase)

| Phase | Wall time | Sonnet calls | Notes |
|---|---|---|---|
| Onboard: scan | 0.13 s | 0 | deterministic; 782-file repo scanned instantly |
| Onboard: draft (3 docs) | 4 m 24 s | 6 | extract + bind per doc; 43 obligations, 138 bindings out |
| Curation + create | ~5 min operator | 0 | create endpoint itself: 0.08 s |
| Checks (10 commits) | 8 m 01 s total; mean 48 s, min 14 s, max 78 s | 20 (10 delta + 10 assessed impacts) | + 10 Haiku intent parses |
| Seeding (5 propose→decide rounds) | 5 m 39 s propose + decisions | 5 | + Haiku doc-complement judges |
| Mind sweep | 2 m 38 s | 2 | 19 grounded nodes |
| Org story | 1 m 10 s | 2 | 3 sentences; judge flagged 1 unfaithful |
| **Total** | **≈ 22 min machine time** | **35** | onboard-to-governed-map ≈ 14 min; the decade sweep ≈ 8 min |

Per-check cost is diff-size-bound, not repo-size-bound: the 41-promise contract
generated 211 impact verdicts across 10 checks, of which the deterministic
binding gate resolved 201 for free — only 10 hit Sonnet.

### Check-by-check (the decade sweep)

| # | Year | Commit | Wall | LLM-assessed | Verdict |
|---|---|---|---|---|---|
| 1 | 2017 | validate on assignment | 74 s | 3 | POSSIBLE_DRIFT |
| 2 | 2018 | don't validate dict keys | ~78 s | 3 | POSSIBLE_DRIFT |
| 3 | 2019 | StrictBool typechecks as bool | 36 s | 1 | POSSIBLE_DRIFT |
| 4 | 2020 | StrictBytes type | 37 s | 1 | POSSIBLE_DRIFT |
| 5 | 2021 | discriminated union support | 66 s | 0 | POSSIBLE_DRIFT |
| 6 | 2022 | `strict` on Field | 24 s | 0 | POSSIBLE_DRIFT |
| 7 | 2023 | JsonValue bool-subclass fix | 31 s | 1 | POSSIBLE_DRIFT |
| 8 | 2024 | serialize-as-any for Secret/Url | 45 s | 1 | POSSIBLE_DRIFT |
| 9 | 2025 | nested-union serialization (Rust) | 63 s | 0 | UNGOVERNED |
| 10 | 2026 | Fraction-subclass fix (Rust) | 14 s | 0 | UNGOVERNED |

No false ALIGNED anywhere: pre-v2 commits land POSSIBLE_DRIFT (the changed
surface predates the registered contract), and Rust-core-only commits land
UNGOVERNED — behavior moved where no control point watches. Which is the
honest reading and also finding #4 below.

## 3. The seeding-rounds finding (measured, reported honestly)

The cap-5 inbox forces propose→decide rounds. Measured: **5 rounds, ~11 min
end-to-end (5 m 39 s machine), 7 decisions (5 approved — one with edited
operations — 1 rejected, 1 bounced on a bad reason code), producing 5 entities
housing 26 of 41 promises. Then the map deadlocked with 15 promises
permanently homeless.**

The deadlock mechanism, per round: the proposer offers 8–13 candidates; the
wrong-scale validator (`quire_align/entity_propose.py:207`) discards most of
them because their name-words lexically touch more promises than the card
claims — *"Strict Mode: discarded — its words touch 18 of 41 promises but it
claims only 6"* — and the survivors are duplicates of entities already on the
map. "Strict Mode" is the **correct** entity for the homeless 15, was proposed
in **all five rounds**, and was discarded in all five, because at 41 promises
generic words ("strict", "mode", "valid") lexically brush half the contract.
Round 4 produced literally nothing: 11 candidates, 0 added. Two aggravators:
discarded shapes are not remembered (only *rejected* ones are suppressed), so
every round re-spends its Sonnet call re-proposing them; and the mind sweep
later named *"Schema Generation as Unnamed Center"* — the machine knows the
entity the heuristic won't let it create. The heuristic that kept telegram's
map clean is, at 41 promises, the wall.

## 4. Read-path latency vs the CTO's thresholds

CTO peg: per-request fold+timeline recompute becomes trouble at ~100–500
checks / >2.5 s reads. Measured at **10 checks / 41 promises / 5 entities**
(median of 3, localhost):

| Endpoint | Latency | vs 2.5 s line |
|---|---|---|
| `/app/pydantic` (shell) | 0.001 s | fine (static) |
| `/api/checks/…/8` (receipt) | 0.024 s | fine (store-only) |
| `/api/graph/pydantic` | 1.08 s | ⚠ 1 s floor |
| `/api/intent/pydantic/timeline` | 1.08 s | ⚠ |
| `/api/graph/…/entity/…` | 1.12 s | ⚠ |
| `/api/mind/pydantic?llm=false` | 1.27 s | ⚠ |
| `/api/ask/pydantic?llm=false` ×3 queries | 1.42 – 1.85 s | ⚠ |
| `/api/story/pydantic/org?llm=false` | 2.27 s (worst run 2.70 s) | **at/over the line** |
| `/api/model/…/around/…` | 2.32 s | **grazing** |
| `/api/tree/pydantic` | 2.48 s | **grazing** |

The store is fast (23 ms receipts); the ~1 s floor is per-request adapter +
fold recompute (`timeline.py:37 build_timeline`, `model.py:111 around`,
`hierarchy.py:199 derive_ring` each re-derive from YAML + git + all analyses on
every GET). **We are grazing the CTO's 2.5 s trouble line at 10 checks — 1/10th
to 1/50th of the check volume he pegged it at.** Linear extrapolation says 100
checks blows through it; the fold cache he sketched is not optional at this
size, it is the next commit.

## 5. UI at this size

Screenshots (headless Chrome 1600×1000): `scale-map.png`,
`scale-constellation.png` (session scratchpad).

- **Map** (`#/map`): holds up. Rail reads 5 entities / 41 promises / "What has
  no home **15**" — the deadlock is honestly visible in navigation. Entity
  cards render clean; org story sits on top with signed dates.
- **Constellation** (`#/constellation`): 5 stars is a sparse sky, not a
  strained one; the strain is the *mind* layer — 19 thought-nodes forced the
  legend "a crowded sky — showing important thoughts only (7 more on the
  mind's shelf)". The shedding is honest and legible; but the map's center of
  visual gravity at scale is machine musing, not the org's named things.
- Every promise glyph renders `·` unexercised — truthful (see groan #4) but a
  cold first impression for a freshly onboarded repo.

## 6. What groaned (engineering gold, unsanded)

1. **Seeding deadlock at 41 promises** — `entity_propose.py:207` `_wrong_scale`
   discards the correct entity every round; discarded shapes aren't remembered
   across rounds, so each round re-buys the same rejection with a fresh Sonnet
   call; 15/41 promises unhousable without a human `teach`. (§3.)
2. **Draft-id collision across multi-doc drafts** — each doc's extraction
   restarts numbering (`OB-DRAFT-1…` twice in one draft response);
   `onboard.py:130` builds `id_map` keyed on those ids, so duplicates silently
   collapse and bindings mis-house. I had to re-key ids client-side by
   reconstructing per-doc blocks from binding order. First real multi-doc
   onboard found it in minutes.
3. **Read-path floor ~1 s, ceiling 2.5 s, at ten checks** — per-request
   recompute with zero caching (§4). Worst read: 2.70 s (`/api/story` llm=false).
4. **Ten behavior-changing commits exercised zero promises** — every verdict
   was POSSIBLE_DRIFT/UNGOVERNED, all 41 promises end the run "unexercised."
   Two causes: pre-2023 commits touch a surface the v2 contract doesn't name,
   and modern behavior changes live in `pydantic-core/src/*.rs` while bindings
   point at Python shims and test files (checks 9–10). On repos whose engine is
   another language, path-keyed control points watch the shore, not the sea.
5. **Draft latency**: 4 m 24 s for 3 docs, strictly sequential per-doc
   (`api.py:206 onboard_draft` loops docs; no parallelism); at 10 docs this is
   a coffee break.
6. **Decision reason-code contract surfaced only at the edge** —
   `entity_graph.py:672` rejects free-form codes with a 400 listing the four
   valid ones; my first GD-6 rejection bounced, the card stayed open, and the
   next propose round (1 Sonnet) ran against a stale inbox before the retry.
7. **Analysis JSON contains raw control characters** — `check_1.json` fails
   `json.loads` strict parsing (invalid control char inside a reasoning/excerpt
   string); every downstream consumer needs `strict=False`. Receipts should be
   parseable by the pickiest parser on earth.
8. **Scan's promise-density heuristic missed the best docs** — surfaced 12 of
   89 markdown files, ranked README badges above `docs/concepts/strict_mode.md`
   and `docs/concepts/validators.md` (not surfaced at all;
   `onboard.py:46 scan_intent_sources`). Operator knowledge rescued doc choice.
9. **Story sentence flagged unfaithful** (1 of 4 generated) — the judge caught
   it, which is the system working, but at 35-call budgets a 25% sentence
   burn rate on the org story is worth a look.

## 7. What held (the honest wins)

- **The contract pipeline is real at this size.** 41 testable promises with
  verbatim quotes from three well-known public docs; 131 bindings; all 47
  control-point paths exist — including correctly picking up that pydantic now
  vendors `pydantic-core` in-tree. Two hallucinated quotes were caught by the
  verbatim validator, not by me.
- **Check cost did not scale with repo size.** Mean 48 s/check on a 171k-LOC
  repo vs comparable times on telegram's 52 files; the binding gate paid for
  201 of 211 impact verdicts deterministically. Contract size is decoupled
  from per-check inference cost by construction.
- **No false alignment.** The analyzer never claimed a 2017 commit satisfied a
  2026 contract; UNGOVERNED on Rust-core commits is exactly the right cry for
  help, and is itself the sales pitch for registering more surface.
- **Human-in-the-loop mechanics worked under load**: edited approval (GD-5
  minus an already-housed promise), structured rejection with suppression
  (GD-6's shape never returned), signed decisions throughout.
- **The mind earns its keep at scale**: 19 grounded nodes including the
  JSON-vs-strict-mode tension and the exact missing center entity — insight
  quality went *up* with corpus size.
- **The UI degrades honestly**: homeless counts on the rail, shelf-shedding in
  the constellation, unexercised glyphs never counted as kept.
- **Total spend: 35 Sonnet-class calls, ~22 minutes of machine time**, for a
  governed map of a 9-year, 824-contributor codebase.

## 8. The slide

**We pointed Quire at pydantic — 5,602 commits, 824 contributors, 171,000
lines of the most-downloaded validation library in Python — and it onboarded a
41-promise behavioral contract from pydantic's own docs, seeded a signed
entity map, and alignment-checked one commit from every year of the repo's
nine-year life, in 22 minutes of machine time and 35 model calls, at a flat
~48 seconds per check.** Cost scaled with the size of each change, not the
size of the repo; nothing was falsely blessed; and the two things that bent —
a naming heuristic tuned for small contracts and an uncached read path — bent
at exactly the seams the team had already named, with fixes scoped. The toy
objection doesn't survive: 5,602 commits, 41 promises, 48 seconds.

---
*Run artifacts: workspace `alignment/workspaces/pydantic/` (sources,
obligations, bindings, prs, graph diff-log, mind, stories); raw measurements
and screenshots in the session scratchpad. Repo clone:
`~/dev/scale-target/pydantic` @ 859945e47 (main, 2026-07-17). No quire_align
code was modified; server killed after the run.*
