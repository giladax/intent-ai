# Topology: Plan → Execute

## Purpose
Use Plan → Execute when the agent benefits from separating task decomposition from task execution.

The planner creates a bounded plan. The executor follows it, step by step, with state updates and optional tool use.

## Shape

```text
START -> planner -> executor -> maybe_continue
maybe_continue -> executor
maybe_continue -> finalizer -> END
```

## Use when
- The task has multiple dependent steps.
- A plan can reduce drift during execution.
- The executor should not constantly reconsider the overall strategy.
- You need to inspect or evaluate the plan separately from execution.

## Do not use when
- The task is simple enough for a single node.
- The plan will be mostly invented or unverifiable.
- The environment changes so much that pre-planning becomes stale.
- The plan itself becomes longer than the work.

## State contract

```ts
type State = {
  input: UserInput;
  plan: PlanStep[];
  currentStepIndex: number;
  stepResults: StepResult[];
  final?: FinalOutput;
  errors?: ExecutionError[];
};
```

## Planner contract

```text
Create the smallest sufficient ordered plan.
Each step must have: goal, required inputs, allowed tools, expected output, and stop condition.
```

## Executor contract

```text
Execute only the current step.
Do not rewrite the plan unless routed to replanning.
Return structured step result.
```

## Routing contract

```text
if step succeeds and more steps remain -> executor(next step)
if step succeeds and no steps remain -> finalizer
if step fails recoverably -> repair_or_replan
if step fails terminally -> END with failure report
```

## Evaluation signals
Track:
- plan validity
- step success rate
- replan frequency
- plan length vs task success
- divergence between plan and execution
- final answer quality

## Common mutations
- Cap the number of plan steps.
- Add a plan verifier before execution.
- Add replanning only after failure, not by default.
- Merge back to single-node if planning overhead does not improve evals.
