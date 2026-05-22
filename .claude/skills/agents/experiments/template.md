# Experiment: [name]

## Phase
Phase [N] — [Chromosome being varied]

## Hypothesis
[What you expect to happen and why]

## Configuration

### Locked Chromosomes
| Chromosome | Allele | Rationale |
|-----------|--------|-----------|
| Chr 1 (Instructions) | [allele] | Winner from Phase 4 / default |
| Chr 2 (Format) | [allele] | Winner from Phase 3 / default |
| Chr 3 (Synthesis) | [allele] | Winner from Phase 2 / default |
| Chr 4 (Data Selection) | [allele] | Winner from Phase 1 / default |

### Varied
| Allele | Description |
|--------|-------------|
| [id] | [what it does differently] |

## Results

### Per-Variant Scores (LLM-as-Judge, 5 dimensions)

| Variant | Coverage | Quality | Accuracy | Insight | Anti-patterns | Overall |
|---------|----------|---------|----------|---------|---------------|---------|
| [id] | | | | | | |

### Observations
[What did each variant get right/wrong? Read actual outputs, not just scores.]

### Crossover Needed?
[If two variants tie or each excels on different dimensions, describe breeding plan]

## Decision
- [ ] Promote [variant]
- [ ] Reject all
- [ ] Breed offspring from [A] and [B]
- [ ] Test on additional fixture scopes

## Fixture Scopes Tested
- [ ] design
- [ ] implementation
- [ ] pivot
- [ ] full
