# Graph Mutation Schema

```yaml
mutation_id: string
mutation_type:
  enum:
    - prompt          # Chr 1: Instructions
    - format          # Chr 2: How input is rendered
    - synthesis       # Chr 3: What is pre-computed
    - data_selection  # Chr 4: What raw data enters
    - routing
    - topology
    - crossover       # Breed offspring from two parent variants
target_component: string  # which node or chromosome
hypothesis: string
parent_variants:          # for crossover mutations
  - variant_id: string
    traits_to_keep: string  # what this parent got right
rollback_strategy: string
locked_chromosomes:       # what is held constant during this experiment
  - chromosome: string
    allele: string
varied_chromosome:        # what is being tested
  chromosome: string
  alleles:
    - string
expected_impact:
  quality: string
  latency: string
  cost: string
```

## Crossover Process

When two variants tie or each excels on different dimensions:
1. Record which traits each parent variant exhibited
2. Create offspring that combines winning traits from both parents
3. Test offspring as a new candidate in the same phase
4. The offspring must beat or tie BOTH parents to be promoted
