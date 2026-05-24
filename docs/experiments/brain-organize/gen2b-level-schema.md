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

### Output Tree
```
Pipeline Execution
  └── Relevance Classification
  └── Tech Stack & Architecture
  └── Model Assignments & Data Sources
  └── Moment Detection
  └── Eval-Driven Development
  └── Moment as Atomic Unit
  └── V2 Greenfield Strategy
Brain Synthesis
Dashboard UI
Infrastructure & Deployment
```

### Metrics
- Root nodes: 4
- Children: 7
- Max depth: 2
- Tree tells a story: PARTIALLY — has hierarchy but groupings are imprecise

### Observations
- First variant to produce real nesting (4 roots, 7 children)
- The `level: "root" | "child"` constraint forced the LLM to commit at assignment time
- "Tech Stack & Architecture" is wrongly nested under "Pipeline Execution" — should be its own root
- Some children are conceptual ("Moment as Atomic Unit", "V2 Greenfield Strategy") rather than subsystem specs
- Demonstrates that **schema constraints > reasoning instructions** for hierarchy output

### Key Learning
Chr 2 (Format) mutation was the right move. Making hierarchy structural in the schema forces it in a way that conceptualMap + instructions cannot. The LLM CAN produce hierarchy — it just needs the output contract to require it.

## Decision
- [x] Promote as best Chr 2 variant — use Gen2B level schema in all future experiments
- [ ] Combine with Gen3 (relate pre-computation) for input quality improvement

## Notes
This is a format (Chr 2) mutation — changing how the LLM's output is structured. The hypothesis is that flat results come from optional fields being ignored. Making hierarchy non-optional at the schema level may force it.

Prompt file: `src/llm/prompts/brain-organize-gen2b.ts`
