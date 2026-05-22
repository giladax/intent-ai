# Graph Mutation Schema

```yaml
mutation_id: string
mutation_type:
  enum:
    - prompt
    - routing
    - topology
    - retrieval
    - verifier
    - schema
target_component: string
hypothesis: string
rollback_strategy: string
expected_impact:
  quality: string
  latency: string
  cost: string
```