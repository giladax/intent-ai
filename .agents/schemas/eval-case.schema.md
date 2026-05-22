# Eval Case Schema

```yaml
id: string
name: string
input:
  type: object
expected_behavior:
  type: string
expected_output:
  type: object
tags:
  - string
failure_modes:
  - string
difficulty:
  enum:
    - easy
    - medium
    - hard
metadata:
  owner: string
  created_at: string
```