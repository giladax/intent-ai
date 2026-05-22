# Judge Optimization

## Purpose

Improve evaluator quality and consistency.

Poor evaluators create misleading optimization pressure.

## Principles

- Prefer explicit rubrics
- Separate correctness from style
- Use deterministic scoring when possible
- Keep evaluator prompts stable
- Avoid vague quality criteria

## Calibration

Review:
- evaluator disagreement
- score drift
- false positives
- false negatives

Human spot checks should be performed regularly.

## LLM-as-Judge Guidance

Use judges for:
- nuanced reasoning quality
- comparative ranking
- subjective preference evaluation

Avoid using judges for:
- schema validity
- deterministic correctness
- tool argument validation

## Preferred Evaluator Stack

1. deterministic checks
2. schema validation
3. tool validation
4. retrieval grounding
5. LLM-as-judge