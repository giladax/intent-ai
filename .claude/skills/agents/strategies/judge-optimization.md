# Judge Optimization

## Purpose

Improve evaluator quality and consistency.

Poor evaluators create misleading optimization pressure. Programmatic scoring alone misses quality dimensions.

## Proven Approach: 5-Dimension LLM-as-Judge

Use Haiku for judging (~$0.01 per eval). Score on 5 explicit dimensions:

| Dimension | What it measures | Scale |
|-----------|-----------------|-------|
| Coverage | Did it find the moments/patterns that should be found? | 1-5 |
| Quality | Are statements specific, evidence-grounded, not generic? | 1-5 |
| Accuracy | Are attributions correct? Are claims supported by evidence? | 1-5 |
| Insight | Does it surface non-obvious patterns the developer would value? | 1-5 |
| Anti-patterns | Does it avoid hallucination, generic language, wrong agency? | 1-5 |

Each dimension requires the judge to provide reasoning before scoring.

## Why Not Programmatic Scoring Alone?

Our Gen 0 programmatic fitness scored 65% — but it missed that narrative quality was actually 100%. Programmatic scoring (keyword matching, moment fingerprints) is good for structural checks but blind to quality. The judge catches:
- generic vs specific language
- evidence grounding
- insight depth
- attribution accuracy

**Use both:** Programmatic scoring for structural gates (did it find X? did it avoid Y?), LLM-as-judge for quality assessment.

## Principles

- Prefer explicit rubrics with per-dimension scoring
- Separate correctness from style
- Use deterministic scoring for structural checks
- Use LLM-as-judge for quality and nuance
- Keep evaluator prompts stable across experiments
- Require reasoning before scores (prevents score inflation)

## Calibration

Review:
- evaluator disagreement across runs
- score drift over time
- false positives (high score for bad output)
- false negatives (low score for good output)
- whether all outputs score the same (no discrimination = bad evaluator)

Human spot checks should be performed regularly.

## LLM-as-Judge Guidance

Use judges for:
- nuanced reasoning quality
- comparative ranking
- evidence grounding assessment
- attribution accuracy

Avoid using judges for:
- schema validity (use Zod)
- deterministic correctness (use programmatic checks)
- tool argument validation

## Preferred Evaluator Stack

1. deterministic checks (schema, structure, required fields)
2. programmatic scoring (moment fingerprints, anti-pattern detection)
3. LLM-as-judge (quality, insight, accuracy — 5-dimension scoring)
