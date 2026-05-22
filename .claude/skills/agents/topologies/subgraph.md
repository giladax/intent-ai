# Topology: Subgraph

## Purpose
Use a Subgraph when a reusable workflow deserves its own internal state, nodes, validation, and evaluation, while still being callable from a larger graph.

A subgraph is not just a helper function. It is a bounded graph module with a stable interface.

## Shape

```text
parent_graph
  -> node_a
  -> subgraph(input_slice)
       START -> internal_nodes -> END
  -> node_b
```

## Use when
- A repeated workflow appears in multiple graphs.
- The workflow has meaningful internal state.
- You want separate tests/evals for a subsystem.
- The parent graph should not know internal implementation details.

## Do not use when
- A plain function or tool is enough.
- The subgraph interface is unstable.
- Parent and child state are tightly coupled.
- Debugging would become harder than the reuse is worth.

## Interface contract

```ts
type SubgraphInput = {
  task: SubTask;
  context: ContextSlice;
};

type SubgraphOutput = {
  result: SubResult;
  evidence?: Evidence[];
  errors?: SubgraphError[];
};
```

## State boundary rules
- Parent passes only required state.
- Subgraph returns structured output, not arbitrary messages.
- Internal retries stay inside the subgraph unless terminal failure occurs.
- Parent decides how to use the subgraph result.

## Evaluation signals
Track:
- subgraph success rate independent of parent graph
- parent integration failures
- interface churn
- internal retry rate
- reusable coverage across workflows

## Common mutations
- Extract repeated node clusters into a subgraph.
- Collapse subgraph back into parent if the boundary is artificial.
- Version the subgraph interface before breaking changes.
- Add contract tests at the parent/subgraph boundary.
