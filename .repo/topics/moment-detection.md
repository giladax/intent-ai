# moment detection

Moment detection is the crown jewel of v1 — the component where maximum design effort is concentrated. It uses Claude Sonnet and must produce output that feels like 'this system actually understood what I was doing.' The data model was hardened through adversarial review, adding causal links between moments, a structured `agency` field, and an `execution` moment type to handle the 'boring middle' problem where 80% of sessions have no inflection points.

## structure

- The moment schema includes a structured `agency` field (distinguishing AI-driven vs developer-driven moments) and causal links between moments — both added after adversarial review.
- An `execution` moment type exists to handle the 'boring middle' — sessions where 80% of activity has no inflection points but still needs representation.

## decision

- Moment detection is the highest-priority quality target in v1 — it is explicitly 'painted gold' and sets the quality bar for the entire product.

## behavior

- Moment detection runs via Claude Sonnet (not Haiku) — quality is prioritized over cost for this component.

## risk

- The 'boring middle' problem — 80% of sessions lacking clear inflection points — is a known fragile area; the execution moment type is the mitigation but quality of detection there is unproven.

## Files

- `/Users/giladkoch/dev/intent-ai/docs/superpowers/specs/2026-05-21-execution-memory-design.md` — Spec containing the moment schema design including agency field, causal links, and execution moment type.

## Evidence

- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)

## Related

- [digestion pipeline](digestion-pipeline.md)
