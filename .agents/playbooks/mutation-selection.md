# Mutation Selection

## Principle

Apply the narrowest possible mutation that can plausibly resolve the failure.

Do not mutate prompts, topology, routing, and retrieval simultaneously.

## Preferred Mutation Order

### Retrieval Failure
1. context composition
2. retrieval ranking
3. retrieval filtering
4. topology mutation

### Schema Failure
1. node contract tightening
2. structured output enforcement
3. verifier node
4. reflection

### Routing Failure
1. edge routing rules
2. deterministic conditions
3. state cleanup
4. supervisor topology

### Hallucination
1. reduce context noise
2. tighten instructions
3. verification layer
4. reflection loop

### Retry Instability
1. retry budgets
2. edge constraints
3. deterministic repair
4. topology redesign

## Anti-Patterns

Avoid:
- adding reflection before verification
- adding multi-agent systems for simple workflows
- expanding prompts before diagnosing traces
- adding tools to compensate for routing failures