# Node Contract Schema

```yaml
node_name: string
purpose: string  # stated as a question the node answers
purpose_question: string  # e.g. "What is signal vs noise in this chunk?"
input_state:
  type: object
  pre_computed_fields:  # explicitly list what arrives pre-computed
    - field: string
      source: string   # which upstream node produced it
output_state:
  type: object
allowed_tools:
  - string
model:
  enum:
    - haiku    # classification, routing, cheap critics
    - sonnet   # reasoning, moment detection, narrative
llm_calls: number  # 0 = deterministic, 1 = single call, N = fan-out
failure_behavior:
  retryable: boolean
  escalation: string
evaluators:
  - string
```

## Design Principles

- Purpose is a question, not a description
- Pre-computed fields are explicitly declared (not re-derived)
- Model selection follows the task: Haiku for classification, Sonnet for reasoning
- `llm_calls: 0` means the node is fully deterministic
- State enrichment: nodes ADD to state, never REPLACE upstream data
