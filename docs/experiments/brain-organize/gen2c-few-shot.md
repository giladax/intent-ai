# Experiment: Gen 2C — Few-Shot Example

## Phase
Phase 4 — Chr 1 (Instructions) variation

## Hypothesis
The LLM doesn't produce hierarchy because it hasn't seen what one looks like. A concrete JSON example showing roots with children and parentSpec set correctly will ground the output pattern.

## Configuration

### Locked Chromosomes
| Chromosome | Allele | Rationale |
|-----------|--------|-----------|
| Chr 2 (Format) | Same as baseline | Unchanged |
| Chr 3 (Synthesis) | None | No pre-computation |
| Chr 4 (Data Selection) | Same as baseline | Unchanged |

### Varied
| Allele | Description |
|--------|-------------|
| 1d-few-shot | Add concrete example in system prompt: a project with 5 specs organized as 2 roots + 3 children, full JSON showing parentSpec used. |

## Results
_Not yet run_

## Decision
- [ ] Pending

## Notes
Few-shot is a proven technique for output formatting. If the LLM is capable of hierarchy but lacks the pattern, this should work. If it still fails, the problem is truly at the pre-computation level (Chr 3).

Prompt file: `src/llm/prompts/brain-organize-gen2c.ts`
