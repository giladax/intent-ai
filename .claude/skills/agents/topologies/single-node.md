# Topology: Single Node

## Purpose
Use a single deterministic agent node when the task is narrow enough that one model call, one state update, and one contract can solve it reliably.

This is the baseline topology. Prefer it until the failure mode proves that extra graph structure is needed.

## Shape

```text
START -> agent_node -> END
```

## Use when
- The task has one clear objective.
- The output can be validated with a simple schema or lightweight evaluator.
- There is no need for decomposition, tool loops, multi-step repair, or human review.
- Latency and cost matter more than recoverability.

## Do not use when
- The node must plan, execute, verify, and repair in the same prompt.
- Failures are caused by hidden multi-step reasoning.
- The model needs to call tools repeatedly.
- The output depends on separate expert perspectives.

## State contract
Minimal state is best.

```ts
type State = {
  input: UserInput;
  output?: FinalOutput;
  errors?: ValidationError[];
};
```

## Node contract
The node should own one responsibility:

```text
Given input, produce output that satisfies schema X.
```

Avoid asking the node to self-review unless failures show that a second pass is necessary. If self-review becomes required, consider `verify-repair.md` or `evaluator-optimizer.md`.

## Evaluation signals
Track:
- schema validity
- task success
- hallucination / unsupported claim rate
- latency
- token cost
- user-visible correction rate

## Common mutations
- Tighten output schema.
- Add better few-shot examples.
- Split context into required vs optional.
- Add one validation edge before moving to a more complex topology.

## Complexity budget
Single-node is the lowest-complexity option. Any migration away from it should name the observed failure mode that justifies the added graph cost.
