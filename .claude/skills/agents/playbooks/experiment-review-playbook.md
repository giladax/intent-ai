# Experiment Review Playbook

## Purpose

Review graph mutations using structured evaluation evidence instead of intuition.

Experiments should be treated as software change reviews, not prompt demos.

## Review Workflow

### 1. Validate Experiment Metadata

Every experiment must define:
- hypothesis
- graph version
- evaluator version
- dataset version
- mutation scope (which chromosome / which allele)
- rollback condition
- what is locked vs what is varied

Reject experiments with undefined mutation boundaries.

### 2. Use LLM-as-Judge (Not Keyword Matching)

**Proven approach:** 5-dimension scoring with Haiku (~$0.01 per eval).

| Dimension | What it measures |
|-----------|-----------------|
| Coverage | Did it find the moments/patterns that should be found? |
| Quality | Are the statements specific, evidence-grounded, not generic? |
| Accuracy | Are attributions correct? Are claims supported by evidence? |
| Insight | Does it surface non-obvious patterns? |
| Anti-patterns | Does it avoid hallucination, generic language, wrong agency? |

**Why not programmatic scoring alone:** Programmatic fitness (keyword matching, moment fingerprints) scored our Gen 0 at 65% — but missed that narrative quality was actually 100%. The judge caught quality dimensions that programmatic metrics cannot measure. Use programmatic scoring for structural checks (did it find X moments? did it avoid Y anti-patterns?), but use the judge for quality assessment.

### 3. Crossover Analysis

When comparing variants:
1. Run both parent variants on the same fixture
2. Read the ACTUAL outputs side-by-side — not just scores
3. Identify which traits each parent got right
4. If parents excel on different dimensions, breed an offspring combining their strengths
5. Test the offspring as a new candidate

### 4. Inspect Regression Cases

Focus on:
- new failure classes
- evaluator disagreements
- quality regressions masked by aggregate score improvements
- hallucination increases
- wrong agency attribution

A successful experiment may still be rejected if regressions are operationally dangerous.

### 5. Review Traces

Inspect:
- state growth
- unnecessary reasoning
- retry loops
- pre-computation quality (are labels accurate?)
- prompt section activation (which conditional sections triggered?)

Trace review is mandatory for topology mutations and synthesis (Chr 3) changes.

### 6. Decision

Allowed outcomes:
- Promote — improvements are clear and regressions acceptable
- Reject — regressions outweigh improvements
- Breed — combine traits from multiple variants
- Needs isolation — test on additional fixture scopes
- Requires additional datasets — current fixtures insufficient

## Promotion Standard

Promote only if:
- improvements are statistically meaningful across fixture scopes
- complexity increase is justified by eval lift
- the winner is validated on ALL fixture scopes (not just the one it was tuned on)
- regressions are acceptable and documented
