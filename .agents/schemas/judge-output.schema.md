# Judge Output Schema

```yaml
score:
  type: number
reasoning:
  type: string
confidence:
  type: number
failure_tags:
  - string
recommendation:
  enum:
    - pass
    - fail
    - review
```