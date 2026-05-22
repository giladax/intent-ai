# Experiment Review Schema

```yaml
experiment_id: string
phase: number  # 1=Data, 2=Synthesis, 3=Format, 4=Instructions
hypothesis: string
mutation_scope:
  varied_chromosome: string
  varied_alleles:
    - string
  locked_chromosomes:
    - chromosome: string
      allele: string
baseline_metrics:
  judge_score: number  # overall 1-5
  coverage: number
  quality: number
  accuracy: number
  insight: number
  anti_patterns: number
candidate_metrics:
  judge_score: number
  coverage: number
  quality: number
  accuracy: number
  insight: number
  anti_patterns: number
crossover_needed: boolean  # if two variants tied, breed offspring
crossover_details:
  parent_a: string
  parent_a_strengths: string
  parent_b: string
  parent_b_strengths: string
  offspring_traits: string
regressions:
  - string
fixture_scopes_tested:
  - string  # design, implementation, pivot, full
decision:
  enum:
    - promote
    - reject
    - breed        # combine traits from multiple variants
    - isolate      # test on additional scopes
reviewer: string
review_date: string
```
