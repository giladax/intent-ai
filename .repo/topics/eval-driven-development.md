# eval-driven development

Evals are a first-class architectural component in intent-ai from v1, not a testing afterthought. The developer explicitly committed to eval-driven development with fixtures, adversarial inputs, and measurable quality gates baked into the initial build. This shapes how moment detection quality is validated and how the pipeline is iterated.

## decision

- Eval-driven development is a v1 architectural requirement — fixtures, adversarial inputs, and measurable quality gates must be present from the start, not added later.

## behavior

- Adversarial review of designs (structured critique runs) is an established practice in this project — it produced 7 concrete schema improvements before a single line of code was written.

## Files

- `/Users/giladkoch/dev/intent-ai/docs/superpowers/specs/2026-05-21-execution-memory-design.md` — Spec that should reflect eval infrastructure as a v1 component.

## Evidence

- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)

## Related

- [digestion pipeline](digestion-pipeline.md)
- [moment detection](moment-detection.md)
