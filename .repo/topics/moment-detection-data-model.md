# moment detection data model

The moment detection schema was hardened through adversarial review that identified 7 concrete gaps. Key additions include: causal links between moments, a structured `agency` field distinguishing AI vs developer actions, and an `execution` moment type to handle the 'boring middle' problem where 80% of sessions have no inflection points.

## structure

- Moments require an `agency` field to distinguish whether the AI or the developer drove the action — this was a gap identified in adversarial review and is now a required schema field.
- An `execution` moment type exists to capture the 'boring middle' — sessions where 80% of activity has no inflection points still need representation.
- Moments must include causal links to other moments — isolated moments without causal context were identified as a schema weakness.

## risk

- The adversarial review surfaced 7 design gaps — any future changes to the moment schema should re-run adversarial critique to avoid reintroducing these weaknesses.

## Files

- `docs/superpowers/specs/2026-05-21-execution-memory-design.md` — Contains the SessionNarrative interface and moment schema definitions including agency field and execution type.

## Evidence

- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)

## Related

- [digestion pipeline](digestion-pipeline.md)
