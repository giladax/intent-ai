# moment detection system

Moment detection is the core intelligence layer of intent-ai v1 — the component responsible for identifying semantically significant inflection points within a development session and transforming raw activity into structured, causally-linked memory. It uses Claude Sonnet as the detection engine and must meet a specific qualitative bar: output should feel like 'the system actually understood what I was doing.' The moment schema is deliberately rich: each moment carries an `agency` field (capturing who or what drove the decision), causal links to other moments (preserving the reasoning chain), and a typed `execution` moment to handle the 'boring middle' — the ~80% of sessions where no meaningful inflection points exist and the system must gracefully produce no-op output rather than hallucinate significance. Eval-driven development is a first-class architectural requirement from v1: adversarial fixtures, edge-case inputs, and measurable quality gates are built in from the start, not retrofitted. This is the component that determines whether intent-ai feels like a smart collaborator or a glorified logger.

## structure

- Moments require a structured `agency` field (developer vs AI) and causal links to other moments — these are schema-level requirements, not optional metadata
- The moment schema requires three non-negotiable fields beyond basic content: an `agency` field (who/what drove the moment), causal links to other moments (preserving reasoning chains), and a typed `execution` moment for activity-without-inflection periods.
- An `execution` moment type exists specifically to handle the 'boring middle' problem — sessions where 80% of activity has no inflection points still need representation

## constraint

- Eval-driven development with fixtures and adversarial inputs is a first-class v1 requirement — not a testing afterthought
- Claude Sonnet is the required LLM for moment detection — this is not an interchangeable dependency. The qualitative bar for detection quality is tied to this model's capability profile.

## decision

- Moment detection is the highest-priority design surface in v1 — maximum design effort, prompt engineering, and quality investment goes here above all other components
- Moment detection is the explicit top-priority component of v1 — maximum design effort, prompt engineering investment, and quality bar enforcement are concentrated here above all other subsystems.
- Eval-driven development is a hard architectural commitment from v1 — adversarial input fixtures, edge-case scenarios, and measurable quality gates must exist before the system is considered shippable, not added as a later testing phase.

## behavior

- Claude Sonnet is assigned to moment detection and transition generation; Claude Haiku handles shape classification — a deliberate model-tier split based on task complexity
- Causal links between moments are a runtime output requirement, not optional metadata — the detector must emit a directed graph of moment relationships, not just a flat list of detected events.

## risk

- The 'boring middle' problem is a known failure mode: approximately 80% of sessions contain no meaningful inflection points, so the system must produce graceful no-op output rather than generating false-positive moments to fill the void.

## Files

- `docs/superpowers/specs/2026-05-21-execution-memory-design.md` — Canonical moment schema definitions — contains the agency field spec, causal link structure, and execution moment type that define the detection system's output contract.
- `docs/superpowers/specs/2026-05-21-execution-memory-design.md` — Contains the full moment detection design including types, agency field, causal links, and model assignments

## Evidence

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)
