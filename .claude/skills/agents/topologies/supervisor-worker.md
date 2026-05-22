# Topology: Supervisor → Worker

## Purpose
Use Supervisor → Worker when a central coordinator should route work to specialized workers with different tools, contexts, or contracts.

The supervisor owns delegation and integration. Workers own execution within their domain.

## Shape

```text
START -> supervisor
supervisor -> worker_a -> supervisor
supervisor -> worker_b -> supervisor
supervisor -> finalizer -> END
```

## Use when
- Tasks require distinct specialties.
- Workers need different context windows or tools.
- You need controlled communication between agents.
- A single agent is overloaded by too many responsibilities.

## Do not use when
- Workers are just prompt variants of the same role.
- The supervisor cannot reliably route.
- Shared state becomes ambiguous or bloated.
- Direct deterministic routing would be simpler.

## State contract

```ts
type State = {
  input: UserInput;
  taskQueue: DelegatedTask[];
  workerResults: WorkerResult[];
  supervisorDecisions: SupervisorDecision[];
  final?: FinalOutput;
};
```

## Supervisor contract

```text
Decide whether to delegate, to whom, and why.
Provide each worker only the context required for its task.
Integrate worker results into the final answer or next delegation.
```

## Worker contract

```text
Perform the delegated task only.
Return structured result, confidence, evidence, and blockers.
Do not delegate further unless explicitly allowed.
```

## Routing contract

```text
supervisor selects worker by task type, missing information, or failure mode
worker returns to supervisor
supervisor either delegates again, finalizes, or fails with reason
```

## Evaluation signals
Track:
- routing accuracy
- worker success rate by task type
- redundant delegation
- context leakage between workers
- integration quality
- latency from serial vs parallel worker calls

## Common mutations
- Replace LLM supervisor with deterministic router for known task classes.
- Run independent workers in parallel when dependencies allow.
- Add worker-specific schemas.
- Split supervisor into router and final integrator if it becomes overloaded.
