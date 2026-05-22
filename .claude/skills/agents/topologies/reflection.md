# Topology: Reflection

## Purpose
Use Reflection when the agent needs to critique its own intermediate work against a specific rubric before producing a final output.

Reflection is reference material, not an automatic behavior. Do not add reflection because the file exists. Diagnose the failure first.

## Shape

```text
START -> draft -> critique -> revise -> END
```

Optional loop:

```text
revise -> critique -> revise
```

only with a strict iteration budget.

## Use when
- The first draft is plausible but misses subtle requirements.
- A critique rubric can be written clearly.
- The cost of one extra pass is justified by quality gains.
- The output is creative, strategic, or judgment-heavy.

## Do not use when
- A deterministic verifier is available.
- The task needs external truth, not introspection.
- The model tends to over-edit correct content.
- Reflection adds latency without measurable eval improvement.

## State contract

```ts
type State = {
  input: UserInput;
  draft: DraftOutput;
  critique?: Critique;
  revision?: FinalOutput;
  reflectionCount: number;
};
```

## Critique contract

```text
Evaluate the draft against the rubric.
Name only actionable issues.
Do not solve the task again.
```

## Revise contract

```text
Apply the critique.
Preserve correct parts.
Do not introduce new unsupported claims.
```

## Evaluation signals
Track:
- quality delta draft vs revision
- critique usefulness
- over-edit rate
- latency/cost increase
- user correction rate

## Common mutations
- Replace reflection with `verify-repair.md` for objective failures.
- Replace self-critique with independent evaluator for high-stakes outputs.
- Limit reflection to specific fields rather than the full output.
- Remove reflection if evals show no lift.
