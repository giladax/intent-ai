# 20 — The LLM Inventory (every call site)

Every LLM call in the system, what mechanically checks it, and its
offline substitute. See [00 overview](00-architecture-overview.md),
[10 pipeline](10-analysis-pipeline.md), [30 derived](30-graph-and-derived-layers.md).

## Governing rule

**The LLM proposes, phrases, or ranks. Deterministic code decides what it
may see (compiled, bounded inputs — never free search) and whether it told
the truth (verbatim validation, citation resolution, faithfulness
judging).** No LLM output enters the signed record (tier 1) without
mechanical validation *and* a human signature.

## Model-choice policy

Models follow the **understanding requirement, not tier dogma** (memory:
trust-the-lm). Sonnet for reasoning and for judges that guard user-facing
truth (a Haiku faithfulness judge once passed an attribution inversion —
now Sonnet). Haiku for cheap closed-enum routing and classification where
a miss is recoverable. Every model is a constructor arg — swappable.

## The inventory

Legend: **det-gate** = the mechanical check that decides what renders /
survives. T = temperature. All structured outputs are Pydantic via
`.with_structured_output`; all wrapped in `llm_retry.invoke_with_retry`
(retries validation/parse errors only).

### A. Analysis pipeline (`analysis/llm.py:AnthropicAlignmentLLM`)

| # | call site | model | T | purpose | schema | det-gate | offline |
|---|---|---|---|---|---|---|---|
| 1 | `parse_intent` | Haiku | 0 | read the PR's declared intent | `DeclaredIntent` | advisory only; not the contract | `FakeAlignmentLLM` / canned |
| 2 | `infer_delta` | Sonnet | 0 | behavioral delta of the diff | `BehavioralDelta` | `material` gate + short-circuit D | canned |
| 3 | `assess_obligation` ×N | Sonnet | 0 | one impact verdict per candidate obligation | `ObligationImpact` | binding gate limits N; **evidence validation** drops bad citations; classify.py decides the verdict, not the model | canned |

The model never picks the `Classification` — `classify.py:classify` does,
deterministically, over these structured impacts (see [10](10-analysis-pipeline.md)).

### B. Onboarding (`propose.py:ProposerLLM`)

| # | call site | model | T | purpose | schema | det-gate | offline |
|---|---|---|---|---|---|---|---|
| 4 | `extract_obligations` | Sonnet | 0 | candidate promises from an intent doc | `ObligationCandidates` | **verbatim quote** must match the doc (`validate_candidates`) — no match, dropped | `FakeProposer` |
| 5 | `propose_bindings` | Sonnet | 0 | map promises → real repo paths | `BindingCandidates` | every path must exist in the repo tree; doc-cited paths scope the search | `FakeProposer` |

### C. Seeding the map (`entity_propose.py`)

| # | call site | model | T | purpose | schema | det-gate | offline |
|---|---|---|---|---|---|---|---|
| 6 | `EntityProposerLLM.propose` | Sonnet | 0 | consolidate promises into entity proposals | `EntityCandidates` | verbatim quote per entity; `_wrong_scale` corpus-name guard (≥0.6 footprint); dup-name drop | `FakeEntityProposer` |
| 7 | `haiku_doc_complement_judge` | Haiku | 0 | is a doc the *opposite* of an entity's identity? | `Verdict{contradicts_identity}` | screens doc attachments; phrased **independently** of the eval judge | pass-through when llm off |

### D. Grouping heuristics (`graph_heuristics.py:GraphHeuristics`, all Haiku T0)

| # | call site | purpose | schema | det-gate | offline |
|---|---|---|---|---|---|
| 8 | `name_areas` | product-language names for derived clusters | `AreaNames` | precedence human > LLM > TF-IDF (`grouping.py`) | regex/TF-IDF fallback |
| 9 | `judge_pair` | do two borderline promises belong together? | `PairVerdict` | only borderline cosine window; budget-capped; cached in groups.yaml | skip → offline heuristic |
| 10 | `route_question` | which of 5 closed answer-shapes fits a question | `RouteDecision` (Literal enum) | closed enum; regex is the logged *offline fallback* only | regex router |

### E. The working mind (`mind.py:MindLLM`, Sonnet — two-phase)

| # | call site | T | purpose | schema | det-gate | offline |
|---|---|---|---|---|---|---|
| 11 | `_thinker` (phase 1) | 0.6 | free prose thinking, no schema | plain text | none (thinking runs free) | `FakeMind` |
| 12 | `_structurer` (phase 2) | 0 | extract nodes from its own notes | `Mind` | **`validate_mind`**: every connection must resolve to a real ref; unresolvable dropped; a node about nothing dropped | `FakeMind` |

Two phases because forcing a schema onto open thinking caused empty
tool-calls and silent truncation-to-zero (both fixed by the split).

### F. The story layer (`story.py`, Sonnet)

| # | call site | T | purpose | schema | det-gate | offline |
|---|---|---|---|---|---|---|
| 13 | `StorytellerLLM.tell` | 0 | narrate the plot, cited per sentence | `Story{sentences[]{text,cites[]}}` | **`validate_story`**: every cite resolves or the sentence drops; `because` needs a reason-bearing cite | `FakeStoryteller` |
| 14 | `faithfulness_judge` | 0 | is a sentence faithful to the facts? | `Verdict{faithful}` | **Sonnet on purpose** (guards truth; Haiku once let an inversion through); unfaithful sentences withheld & counted in the byline | skipped when llm off |

### G. Ask resolution (`ask.py`)

| # | call site | model | T | purpose | schema | det-gate | offline |
|---|---|---|---|---|---|---|
| 15 | `haiku_pick` | Haiku | 0 | last-rung term → an EXISTING area | `TermPick` | **only after** alias/label/lexical/semantic rungs fail; may pick only from the given menu, never invent | `llm=false` skips it |

### H. Eval judges (not shipped to users — CI/measurement)

| # | call site | model | purpose | note |
|---|---|---|---|---|
| 16 | `evals/seed_quality.py:_haiku_complement_judge` | Haiku | grades seed complement hygiene | phrased independently of call #7 |
| 17 | `evals/repo_cognition.py:judge_case` | Sonnet | did the mind notice a known phenomenon? | ground truth lives only in the judge (blind-subagent-eval playbook) |

## Totals

**17 distinct LLM call sites.** By tier of consequence: 3 in the check
engine (verdict-adjacent, none decides the verdict), 4 in onboarding/
seeding (every output verbatim-gated), 3 grouping heuristics (cached,
fallback-backed), 4 in mind+story (citation/faithfulness gated), 1 ask
rung (last resort), 2 eval-only. Every one is Fake-swappable for offline
tests; every user-facing one has a deterministic gate deciding what
survives.
