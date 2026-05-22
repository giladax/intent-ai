# Topology: ReAct / Tool Loop

## Purpose
Use ReAct when the agent must iteratively reason about what tool to call next, observe the result, and continue until it can produce a final answer.

This topology is useful for retrieval, code execution, API calls, database lookup, calendar/email workflows, or any task where the needed information is not fully present in the prompt.

## Shape

```text
START -> agent
agent -> tool_node -> agent
agent -> END
```

The agent decides whether to call a tool or finish. The graph constrains the loop, retry budget, and final output contract.

## Use when
- The agent needs external information or actions.
- Tool results may change the next step.
- The number of steps is not known in advance.
- Tool traces are important for debugging and evaluation.

## Do not use when
- The task can be solved from context in one call.
- Tool use is predictable and should be hard-coded as nodes.
- You need strict stage separation between planning and execution.
- Tool calls are high-risk and need approval gates.

## State contract

```ts
type State = {
  input: UserInput;
  messages: BaseMessage[];
  toolCalls: ToolCallRecord[];
  observations: Observation[];
  final?: FinalOutput;
  loopCount: number;
};
```

## Routing contract

```text
if agent emits tool call and loopCount < maxLoops -> tool_node
if agent emits final answer -> END
if loopCount >= maxLoops -> fallback_or_error
```

## Guardrails
- Set max loop count.
- Restrict available tools by task class.
- Validate tool arguments before execution.
- Add deterministic error handling for failed tools.
- Require final answer to cite or reference observations when appropriate.

## Evaluation signals
Track:
- tool selection accuracy
- unnecessary tool calls
- failed tool arguments
- loop count distribution
- final answer correctness
- trace-level failure patterns

## Common mutations
- Replace free-form tool choice with explicit routing.
- Split high-risk tools into approval-gated nodes.
- Add a summarizer node for long observations.
- Convert to `plan-execute.md` when tool use benefits from an explicit plan.
