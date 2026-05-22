# Prompt Optimization

## Principle

Prompt optimization is a graph-level activity, not isolated copywriting.

The prompt is one mutable system component among many — and often the LEAST impactful one.

## Key Learning: Pre-computation Makes Prompts (Almost) Irrelevant

In our chromosome evolution, Instructions (Chr 1) was the LAST phase tested. Result: "Hunter" prompt (10 detailed tasks) tied with "Scorer" prompt (2 simple tasks) at 4.35/5. When the LLM receives well-structured, pre-computed inputs (accurate labels, behavioral flags, exchange classifications), the instructions barely matter.

**Implication:** Before optimizing prompts, maximize the quality of what you give the LLM. The intelligence is in WHAT you provide, not WHAT you tell it to do.

## Optimize Prompts Only After

1. pre-computation quality is high (Chr 3 — accurate labels, not regex)
2. data selection is correct (Chr 4 — right inputs reach the node)
3. format is appropriate (Chr 2 — structured, not raw dumps)
4. routing is stable
5. schemas are correct
6. topology is appropriate

## Preferred Changes

- reduce ambiguity
- improve instruction hierarchy
- clarify output contracts
- remove conflicting guidance
- remove instructions that duplicate what pre-computation already provides

## Avoid

- oversized prompts that repeat what pre-computed labels already convey
- hidden chain-of-thought assumptions
- excessive examples
- compensating for topology flaws with prompting
- compensating for bad pre-computation with more detailed instructions

## Prompt Mutation Rules

Mutate:
- one behavior at a time
- against stable datasets
- with evaluator comparison (LLM-as-judge, not just programmatic)

Always preserve rollback capability.
