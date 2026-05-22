# Node Contract Schema

```yaml
node_name: string
purpose: string
input_state:
  type: object
output_state:
  type: object
allowed_tools:
  - string
failure_behavior:
  retryable: boolean
  escalation: string
evaluators:
  - string
```