# eval-driven development

Evals are a first-class architectural component in intent-ai v1, not a testing afterthought. The developer committed to eval-driven development from day one, with fixtures, adversarial inputs, and measurable quality gates built into the initial release.

## constraint

- Moment detection quality must be measurable — evals with adversarial inputs are required to validate that the system 'actually understood what the developer was doing'.

## decision

- Eval-driven development is a v1 requirement — quality gates with fixtures and adversarial inputs must be present from the initial build, not added later.

## Files

- `docs/superpowers/specs/2026-05-21-execution-memory-design.md` — Design spec that should include eval architecture as a first-class component.

## Evidence

- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)

## Related

- [digestion pipeline](digestion-pipeline.md)
- [moment detection data model](moment-detection-data-model.md)
