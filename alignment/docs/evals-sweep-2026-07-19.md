# Eval sweep — 2026-07-19

Sweep discipline (owner directive): every eval iteration REMOVES or
UPDATES as well as adds; an eval suite that only accumulates dies of
redundancy. Boundary rule enforced by this sweep: **unit tests pin
deterministic engine behavior; evals grade LLM output quality.** An eval
that duplicates a unit test is redundancy and gets removed.

Ownership: the CPO owns the eval suite from this sweep forward — he
judges results and updates cases; engineering proposes, he decides.

## Existing suite — verdicts

### E2E check-engine cases (`evals/cases.py`, 11 cases)

| Case | Verdict | Why |
|---|---|---|
| fully-aligned-change | keep | pins the happy path; nothing else does |
| partial-implementation-demo | keep | enforcement lags policy — distinct PARTIAL mechanism |
| off-intent-hard-rule | keep | behavior contradicts a hard rule |
| undeclared-behavior-drift | keep | code-vector drift |
| irrelevant-refactor | keep | NO_MATERIAL_IMPACT short-circuit |
| removed-enforcement-point | keep | structural OFF_INTENT (guard bypass) |
| config-only-behavior-change | keep | config-vector drift — distinct from 104 |
| missing-test-coverage | keep | verification lags policy — distinct from 101 |
| stale-prd-distractor | keep | authority ladder under distraction |
| ungoverned-surface | keep | whole-PR ungoverned |
| ambiguous-product-source | keep | abstention |

No removals: each pins a distinct classification rule, and the PRD keeps
the engine as the evidence supply. **Gap found (added below): no case
covers a MIXED PR (governed + ungoverned files together) asserting the
ungoverned remainder is NAMED, not dropped — the conservation principle
applied to checks.** (Deferred until a fixture PR exists; tracked here so
it isn't silently forgotten.)

### Evaluators (`evals/evaluators.py`)

| Evaluator | Verdict | Why |
|---|---|---|
| classification_correct … missing_evidence_detected (9) | keep | deterministic, each scores a distinct stage |
| explanation_quality_judge | **update** | "clear and actionable" is too weak; replaced by decision-sufficiency judging: could a cold reader make the review decision from the comment ALONE — does every claim complete its chain (statement → source → file → verdict)? |

### Blind probes (`evals/blind_probe.py`)

Keep — methodology, not a case list; still the anti-overfit instrument.

### Experience-EDD mutation cases (entity spec §Part 2)

Superseded as a *runnable* suite by PRD §7 acceptance + the engine unit
tests that now pin rules 5–10 mechanically. Not deleted (doc history),
but no longer the eval frontier.

## What was missing (the CPO-session lessons, as evals)

The seed proposer — the layer where all nine CPO defects lived — had
ZERO evals. New suite `evals/seed_quality.py`, deterministic first:

1. **conservation** — every approved promise appears in a proposal or is
   NAMED in the report's `unplaced` list. Silent omission (defect D1)
   fails the eval, not the demo.
2. **scope_honesty** — no entity name that names the whole corpus: fails
   if the name matches the workspace id, or its lexical footprint across
   ALL promises is more than twice its membership (the "Brain" error,
   mechanically).
3. **decision_sufficiency** — every non-promise attachment carries a
   provenance note; every evidence quote carries an org address (source
   reference/section). The card must carry enough to answer its own
   question.
4. **complement_hygiene** (LLM judge, Haiku, per attachment) — an
   attached artifact must not be the defined complement/opposite of the
   entity's identity (the future-knowledge ⊄ Current Understanding
   error). Judge grades quality; it never decides correctness of the
   engine.

Isolation rule: seed-quality evals run on a COPY of the workspace — an
eval run must never write proposals into a real diff log.

Not added (would duplicate unit tests): cap-of-5, rejected-shape
suppression, amended detection, fold integrity — all pinned in
tests/test_entity_graph.py. Evals grade the LLM; tests pin the engine.

---

## CPO ownership pass — 2026-07-19

First ownership pass under the sweep charter above. I judged the two
eval-vs-product disagreements live, recalibrated the eval judge,
re-audited every eval for redundancy, and removed one metric.

### Verdicts on the complement_hygiene disagreements

**(a) `docs/future-knowledge.md` on an "Understanding Review" entity —
the EVAL JUDGE was wrong; the product filter was right.** My session
precedent (GD-5) is the standard: the test is contradiction with the
entity's OWN identity sentence, not conceptual duality. I stripped this
doc from *Current Understanding* because that identity claims to BE "the
human-approved body of knowledge" — a register of consciously deferred
hypotheses is exactly what that corpus excludes. "Understanding Review"
claims to be the *gate*, not the corpus; the deferred register is an
artifact OF the gate (the org's own bindings mark it `decides` for
QUIREB-008, the review-gate promise). The judge's own reasoning conceded
the point: "the deferred state exists precisely because the review
process has not yet approved it" — that is co-definition, not exclusion.

**(b) `.repo/brain.md` on a "Source Boundary" entity — the EVAL JUDGE
was wrong; the product filter was right.** "One side of the boundary vs
the other = definitional opposite" proves too much: it would empty every
boundary/gate/process entity of every artifact, since every artifact
sits on some side. `.repo/brain.md` is bound `decides` to both member
promises (QUIREB-001, 012) — it is the document that *states* the
boundary. An entity about a boundary legitimately holds the artifacts
that define it.

**(b′) discovered during re-run:** a fresh proposal shape ("Source-of-
Truth Boundary" citing `docs/specs/2026-07-03-brain-api-review.md`) was
flagged with a use–mention confusion: the judge read "Brain stores only
the understanding … never the artifacts themselves" as a membership
claim about the *card*, when it is a conduct rule about the *product*. A
card citing the document that states a storage rule is not the product
storing an artifact. Same verdict class: eval too strict.

**Resolution: tightened `evals/seed_quality.py:_haiku_complement_judge`,
left `quire_align/entity_propose.py:haiku_doc_complement_judge`
untouched** (it already applies the correct contradiction-with-identity
standard). The eval judge is now an explicit two-step exclusion test —
STEP 1: is the entity a body/corpus of material at all? (rules,
boundaries, gates, workflows, capabilities answer false and stop);
STEP 2: only for a corpus, is the artifact a register of exactly what
the corpus excludes? Phrasing stays independent of the product judge
(exclusion/misrepresentation framing vs the product's contradiction-by-
definition framing). Calibrated against a four-triple set — the GD-5
precedent (must flag) plus (a), (b), (b′) (must clear) — all four
correct after tightening; an intermediate draft that cleared (b′) but
lost the precedent was rejected and reworked.

### Redundancy re-audit

| Eval | Verdict | Why |
|---|---|---|
| seed: conservation | **REMOVED** | Could not fail, by construction: accounted = placed ∪ housed ∪ (all − placed − housed) = all promises, always — the eval recomputed the product's own `unplaced` formula and called it a check. The never-silent contract is deterministic engine behavior, pinned by tests/test_entity_propose.py::test_proposals_api_reports_coverage_and_already_held (API names homeless promises). Boundary rule applied. |
| seed: scope_honesty | keep, unchanged | Not pinned by any unit test (`_wrong_scale` has none); scores the whole open diff log, so it also guards proposal paths that bypass the seed guard (heuristics, manual appends), and holds MY thresholds independently if engineering ever loosens the product's. Threshold affirmed: the real "Brain" error sat at 6× the 2× line; a name under 2× is close enough to its scale that a human, not a metric, should decide. |
| seed: decision_sufficiency | **tightened** | The generic fallback address ("QUIREB-004 · approved promise") was passing the org-address check — but that exact string is defect D6, the address that told me nothing in the live session. Now fails. This gives the metric teeth unit tests can't have: it gates live workspace data (a newly onboarded workspace with source-less obligations fails here before a human meets the weak card). The note/address happy path stays pinned by test_attachments_carry_binding_provenance and test_evidence_source_includes_org_address. |
| seed: complement_hygiene | keep, judge recalibrated | The only LLM-graded seed metric; the semantic layer no deterministic check reaches. See verdicts above. |
| engine cases (11) | keep all | Re-examined for redundancy against the entity layer: none — the entity layer seeds the graph, the check engine classifies PRs; no case's mechanism is subsumed. The two PARTIAL cases (101/108) and two POSSIBLE_DRIFT cases (104/107) pin distinct vectors (enforcement-lag vs verification-lag; code vs config surface). Fixed stale "10 cases" docstring → 11. MIXED-PR conservation case stays deferred until a fixture exists — tracked above, not silently forgotten. |
| explanation_quality_judge | keep | Decision-sufficiency bar already encodes the session's chain standard (claim → source → file → action); nothing further from my defect list applies to the PR-comment surface. |
| blind_probe | keep | Methodology (anti-overfit probing), not an accumulating case list. |

Net: 4 seed metrics → 3; 11 engine cases unchanged; one judge
recalibrated; one metric grew teeth. Nothing added.

### Stability

With the final judge: quire-brain PASS × 2 consecutive live runs
(different Sonnet proposal shapes each run — the judge held across
"External Source Boundaries" and "Source-of-Truth Boundary" variants),
intent-ai-live PASS. Full suite: `python3 -m pytest -q` — 140 passed.

### Standing bar for the suite

A new eval must clear ALL of:
1. It grades LLM output or live-workspace data that no unit test can pin
   deterministically (boundary rule — tests pin the engine).
2. It traces to an observed defect (live session, production mistake) or
   a PRD acceptance criterion — never a hypothetical.
3. It can fail: before landing, show the input on which it fails today,
   or the concrete regression it would catch. A metric that passes by
   construction is decoration (see: conservation).
4. It names its removal condition at birth (e.g. "remove once a unit
   test pins X").

An existing eval is removed when: it cannot fail by construction; a unit
test pins the same contract; or it cannot fail independently of another
eval in the suite.

LLM judges additionally: never decide engine correctness; are phrased
independently of the product mechanism they grade; and carry a
calibration set — at least one must-flag precedent and one must-clear
counterexample, run before and after ANY criteria change (this pass
added a fourth triple when a new over-flag class appeared; the set only
grows from adjudicated real cases).

— cpo
