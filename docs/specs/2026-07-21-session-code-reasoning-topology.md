# Session⇄Code Reasoning Topology — design spec

Companion to `docs/plans/2026-07-21-pr-session-unification.md` (its U2/U3
tasks implement this). Answers: how the LLM reasons over a PR *and* the
sessions that produced it — huge context refined, partial relations
mechanically grounded, verdict discipline intact. (Founder, 2026-07-21:
"graph analysis topology that allows the session as context… how to clean
and refine the session and code data… how to intelligently connect the
session and code — we might have partial relation — in a way the LLM can
reason about it.")

Design stance, from the house rules it composes: pre-computation
(understanding is computed once at digestion, cached; analysis retrieves
slices, never re-derives), the-IP (free thinking mechanically bound to
evidence; reasoning kept on nodes), context-composition (digest-inject, not
transcript-dump), and the alignment invariants (deterministic label; no
similarity-as-authority; verbatim citations).

## 1. Refinement — what of a session enters analysis

**The journal digest IS the refinement.** Raw transcripts never enter the
analyzer. By analysis time a coupled session already exists as bounded,
evidence-anchored artifacts, precomputed once at digestion:

| Artifact | Altitude | Used for |
|---|---|---|
| `SessionDigest.decisions` (chosen/rejected/why) | intent | `parse_intent` context |
| narrative + arcs | story | `parse_intent` (thin-PR case) |
| moments (+ evidence anchors → events → files) | per-change rationale | `infer_delta`, `compare_obligations` slices |

Fallback when a coupled session was never journal-digested: `session.py`'s
decisions-first cut (one cheap cached call) — same shape, thinner.

**Altitude escape hatch, EDD-gated:** if the U2 eval shows journal moments
are too coarse for per-obligation comparison, a config-gated
`distill_for_check` node (one Sonnet call per session×check, cached by that
pair, `AnalyzerConfig.check_distillation: bool = False`) produces a
check-scoped distillation. It ships OFF; only an eval failure turns it on
(⚑ decision E below).

**Code side:** coupling changes *ranking*, not bounds. Within the existing
`max_context_files` budget: files both diff-touched and moment-referenced
rank first (the reasoning names them); unexplained files next (no reasoning
covers them — the code must speak for itself); the rest as today.

## 2. The relation substrate — partial relations as first-class fact

The LLM reasons OVER a graph it can never edit. Every edge is deterministic
with provenance; there is no content-similarity edge anywhere:

```
session ↔ check     trailer | attach (binding) · inferred (proposal, never promotes)
session ↔ file      touched_paths (tool inputs — mechanical)
moment  ↔ file      evidence anchor → sourceEventId → normalized event → file path
file    ↔ obligation  bindings.yaml control points (existing)
moment  ↔ obligation  composed join: moment↔file ∘ file↔obligation
```

**The coverage map** is computed deterministically BEFORE any LLM call and
stored on the analysis row:

```
coverage: explained_files / changed_files          (e.g. 4/6 = 0.67)
unexplained: [src/x.ts, src/y.ts]
per-session: {A: {files: 3, moments: 7}, B: {files: 1, moments: 2}}
context_only_moments: 2      (moments about files outside this diff)
```

Partiality is surfaced, never smoothed, at all three altitudes:
- **To the model:** a labeled preamble — "Sessions explain 4 of 6 changed
  files. For src/x.ts and src/y.ts no session reasoning exists: judge them
  from code alone. Session evidence for one file never justifies another."
- **To the human:** one sentence in the comment ("Reasoned in 2 sessions,
  covering 4 of 6 changed files").
- **To the evaluators:** the stored coverage fields (checked exactly, §4).

## 3. The topology — `coupled-v1`, a registered variant

Extends `linear-v1`; the deterministic core is untouched. Registered in
`graph.py` / `config.py` so it A/Bs through `run_eval.py --variant
coupled-v1` like everything else.

```
load_inputs → snapshot_artifacts → resolve_product_context → load_obligations
   → load_couplings                 NEW · deterministic · links_for_check →
                                    digest slices → relation substrate →
                                    coverage map. Zero LLM calls.
   → parse_intent                   + CheckContextPacket (decisions from all
                                    coupled sessions; narrative of the most-
                                    overlapping one; labeled OBSERVED)
   → collect_diff → match_points
   → gather_code_context            coverage-ranked within existing budget
   → infer_delta                    + per-file moment slices
   → compare_obligations            per-obligation calls get ONLY moments
                                    reaching that obligation via the
                                    mechanical join — bounded and relevant
   → inspect_tests → validate       + session-citation SCOPE check: every
                                    session quote resolves verbatim AND its
                                    moment mechanically reaches the cited
                                    file/obligation (deterministic — no
                                    reflection node needed)
   → classify_alignment             UNCHANGED — sessions cannot move labels
   → persist → publish              + coverage sentence, "Reasoned in session…"
```

No LLM reflection node: the two failure modes reflection would catch
(out-of-scope citation, coverage overclaim) are both mechanically checkable
in `validate`. Cheaper, and honest by construction. The one semantic
tension case (session contradicts an obligation) is `parse_intent`'s job to
*report*, not any node's job to resolve.

**Budgets** (all `AnalyzerConfig` fields, stated defaults — start points for
A/B, not dogma):

| Field | Default | Why |
|---|---|---|
| `session_packet_chars` | 12 000 | ~3k tokens of already-distilled material; decisions are dense — this fits ~4 sessions' decisions + one narrative |
| `max_full_sessions` | 3 | overlap-ranked; beyond that, decisions-only (multi-session rule from the plan's unknowns, now concrete) |
| `moments_per_file` | 3 | infer_delta slice bound |
| `moments_per_obligation` | 5 | compare slice bound; joined moments are pre-filtered for relevance by construction |
| `check_distillation` | False | the altitude escape hatch (⚑ E) |

## 4. Eval plan — criteria BEFORE code (EDD, binding)

Deterministic evaluators (no judge needed):
1. **Coverage honesty** — reported map ≡ recomputed from the substrate, exact.
2. **Citation scope** — every session quote resolves verbatim against the
   transcript AND its moment reaches the cited file/obligation through
   mechanical edges. (Extends the existing evidence validator.)
3. **Label invariance** — (a) all 10 existing uncoupled cases through
   `coupled-v1` → byte-identical labels; (b) every coupled fixture re-run
   with its couplings stripped → same deterministic label. Sessions explain;
   they never move verdicts.
4. **Partiality honesty** — no unexplained file is ever justified by session
   reasoning in any output field.

Cases (fixture PRs with coupled transcripts; keyword-criteria checks are the
sanctioned deterministic eval mechanism):
- **C1 thin-PR** — body says nothing; session states intent explicitly →
  DeclaredIntent captures it, labeled session-derived.
- **C2 adversarial** — session reasoning contradicts an approved obligation
  → intent parse reports the tension verbatim; classification unchanged.
- **C3 partial coverage** — sessions cover 2 of 5 files → coverage map
  exact; unexplained files judged from code; no scope-crossing citations.
- **C4 multi-session** — 3 sessions, one dominant → packet respects
  `max_full_sessions` ranking; all decisions present.
- **C5 wrong session** — an unrelated session attached → intent parse marks
  the context irrelevant (UNKNOWN-over-forced-relevance); label unchanged.
- **C6 zero-coupling sweep** — the invariance battery (evaluator 3).

Coupled-beats-uncoupled is measured on C1/C3: intent-completeness and
context-file-ranking criteria met with coupling, unmet without — the value
of the feature, demonstrated deterministically.

## ⚑ Founder decisions — RULED 2026-07-21

- **D — default variant: RULED — `coupled-v1` becomes the default analyzer
  once the eval battery is green.** The zero-coupling invariance eval
  (byte-identical on uncoupled cases) is what makes defaulting safe;
  coupled context then arrives automatically wherever trailers exist.
- **E — check-scoped distillation spend: RULED — `check_distillation`
  ships OFF** until the U2 eval proves the digest's altitude too coarse.
  Trust the precomputed digest first; spend follows evidence.
