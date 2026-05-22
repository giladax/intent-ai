# Judge Output Schema

5-dimension scoring with per-dimension reasoning. Used by Haiku LLM-as-judge (~$0.01 per eval).

```yaml
dimensions:
  coverage:
    score: number  # 1-5
    reasoning: string
  quality:
    score: number  # 1-5
    reasoning: string
  accuracy:
    score: number  # 1-5 (attribution correctness, evidence grounding)
    reasoning: string
  insight:
    score: number  # 1-5 (non-obvious patterns surfaced)
    reasoning: string
  anti_patterns:
    score: number  # 1-5 (absence of hallucination, generic language, wrong agency)
    reasoning: string
overall_score:
  type: number  # average of 5 dimensions
recommendation:
  enum:
    - pass
    - fail
    - review
summary:
  type: string  # brief justification of overall assessment
```

## Scoring Guide

| Score | Meaning |
|-------|---------|
| 1 | Completely wrong or missing |
| 2 | Major issues, partially present |
| 3 | Acceptable but generic or incomplete |
| 4 | Good — specific, grounded, few issues |
| 5 | Excellent — precise, insightful, no issues |

## Notes

- Reasoning MUST come before the score in the prompt (prevents anchoring)
- All 5 dimensions are scored independently
- Overall score is the average, not a separate judgment
- Anti-patterns dimension is scored inversely: 5 = no anti-patterns detected
