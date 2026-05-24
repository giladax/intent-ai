# Experiment: Gen 2B — Level Schema

## Phase
Phase 2 — Chr 2 (Format) variation

## Hypothesis
Making the hierarchy structural in the schema (every assignment declares `level: "root" | "child"`) forces the LLM to commit at assignment time, not in a disconnected reasoning field.

## Configuration

### Locked Chromosomes
| Chromosome | Allele | Rationale |
|-----------|--------|-----------|
| Chr 1 (Instructions) | Updated for levels | Adapted to schema |
| Chr 3 (Synthesis) | None | No pre-computation |
| Chr 4 (Data Selection) | Same as baseline | Unchanged |

### Varied
| Allele | Description |
|--------|-------------|
| 2b-level-schema | Remove conceptualMap. Add `level: z.enum(["root", "child"])` to AssignmentSchema. Prompt says "2-4 roots, everything else is a child with parentSpec REQUIRED." |

## Results
_Not yet run_

## Decision
- [ ] Pending

## Notes
This is a format (Chr 2) mutation — changing how the LLM's output is structured. The hypothesis is that flat results come from optional fields being ignored. Making hierarchy non-optional at the schema level may force it.

Prompt file: `src/llm/prompts/brain-organize-gen2b.ts`
