# Experiment: Gen 2A — Two-Pass Output

## Phase
Phase 4 — Chr 1 (Instructions) variation

## Hypothesis
If we explicitly tell the LLM "your assignments MUST match your conceptualMap — every child in the map needs parentSpec set in assignments," the structural reasoning will mechanically connect to output.

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
| 1c-two-pass | Prompt says: "First output tree skeleton in conceptualMap. Then assign fragments — every targetSpec must appear in your map. If a spec is a child in your map, set parentSpec." Adds validation instruction. |

## Results
_Not yet run_

## Decision
- [ ] Pending

## Notes
Still a Chr 1 fix. If pre-computation (Chr 3) is the real bottleneck, this won't help much even if it improves consistency. Test anyway — if it works, it's the cheapest fix.

Prompt file: `src/llm/prompts/brain-organize-gen2a.ts`
