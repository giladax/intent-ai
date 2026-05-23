# moment detection system

Moment detection is the crown jewel of intent-ai v1 — the component that must make output feel like 'this system actually understood what I was doing.' It uses Claude Sonnet for detection, requires causal links between moments, a structured agency field, and an `execution` moment type to handle the 'boring middle' problem where 80% of sessions have no inflection points. Eval-driven development with adversarial inputs is a first-class requirement from v1.

## structure

- Moments require a structured `agency` field (developer vs AI) and causal links to other moments — these are schema-level requirements, not optional metadata
- An `execution` moment type exists specifically to handle the 'boring middle' problem — sessions where 80% of activity has no inflection points still need representation

## constraint

- Eval-driven development with fixtures and adversarial inputs is a first-class v1 requirement — not a testing afterthought

## decision

- Moment detection is the highest-priority design surface in v1 — maximum design effort, prompt engineering, and quality investment goes here above all other components

## behavior

- Claude Sonnet is assigned to moment detection and transition generation; Claude Haiku handles shape classification — a deliberate model-tier split based on task complexity

## Files

- `docs/superpowers/specs/2026-05-21-execution-memory-design.md` — Contains the full moment detection design including types, agency field, causal links, and model assignments

## Evidence

- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
