# Topology: Multi-Graph

## Purpose
Use Multi-Graph when the system contains multiple independent graphs with different lifecycles, states, triggers, or evaluation suites.

This is an architectural topology, not just a larger graph. Each graph should have a reason to exist independently.

## Shape

```text
graph_a: intake / classification
graph_b: task execution
graph_c: review / evaluation
graph_d: long-running follow-up
```

Graphs communicate through durable state, events, queues, APIs, or persisted artifacts.

## Use when
- Workflows have different triggers or runtimes.
- Some processes are long-running or asynchronous.
- Teams need to deploy/evaluate parts independently.
- State ownership would be unclear in one monolithic graph.

## Do not use when
- A subgraph would provide enough modularity.
- Cross-graph communication is not well-defined.
- You cannot trace end-to-end behavior.
- Operational complexity exceeds product value.

## System contract

```ts
type GraphBoundaryEvent = {
  sourceGraph: string;
  targetGraph: string;
  artifactId: string;
  payloadSchemaVersion: string;
  reason: string;
};
```

## Boundary rules
- Each graph has an owner, state schema, and eval suite.
- Cross-graph messages are versioned.
- Durable artifacts are referenced by ID, not copied blindly.
- End-to-end traces must preserve causality across graph boundaries.

## Evaluation signals
Track:
- per-graph task success
- cross-graph handoff failures
- stale artifact usage
- recovery after graph failure
- end-to-end latency
- deployment regression by graph version

## Common mutations
- Split a monolithic graph when lifecycle boundaries become clear.
- Merge graphs if handoff overhead dominates.
- Add orchestration metadata to every boundary event.
- Create shared schemas for graph-to-graph contracts.
