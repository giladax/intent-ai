# Experiment Review Schema

```yaml
experiment_id: string
hypothesis: string
mutation_scope:
  - string
baseline_metrics:
  success_rate: number
  latency_ms: number
candidate_metrics:
  success_rate: number
  latency_ms: number
regressions:
  - string
decision:
  enum:
    - promote
    - reject
    - isolate
reviewer: string
review_date: string
```