# Mutation Selection

## Principle

Apply the narrowest possible mutation that can plausibly resolve the failure.

**One variable at a time.** Change ONE chromosome per phase, lock winners, then move to the next. Never mutate prompts, topology, routing, and retrieval simultaneously.

## Battle-Tested Process: Phased Evolution

Lock all chromosomes except one. Vary that one. Lock the winner. Move to next.

### Phase Order (proven effective)

1. **Data Selection (Chr 4)** — What raw data enters the node
2. **Synthesis (Chr 3)** — What is pre-computed before the LLM call
3. **Format (Chr 2)** — How input is rendered for the LLM
4. **Instructions (Chr 1)** — The prompt itself

This order works because each phase reduces the search space for the next. Pre-computation (Chr 3) can make instructions (Chr 1) almost irrelevant.

### Crossover / Breeding

When two variants tie or each excels on different dimensions:
1. Run both parents, compare outputs side-by-side
2. Identify which traits caused which results (e.g., "Parent A found more moments, Parent B had better quality")
3. Combine winning traits into an offspring variant
4. Test the offspring as a new candidate

### Actual Results (Intent-AI Pipeline)

| Phase | Locked | Varied | Winner | Score | Key Finding |
|-------|--------|--------|--------|-------|-------------|
| 1 (Data) | 1a, 2b, 3b | 4a vs 4b | 4a | 4.35/5 | Conversation-only data tied with conversation+actions |
| 2 (Synthesis) | 1a, 2b, 4a | 3a vs 3b vs 3c | 3c | 4.80/5 | Full pre-computation won — but only after removing regex |
| 3 (Format) | 1a, 3c, 4a | 2a vs 2b vs 2c vs 2e | 2a/2c tied | ~4.8/5 | Pre-computation made format less critical |
| 4 (Instructions) | 2a, 3c, 4a | 1a vs 1b | 1a/1b tied | ~4.8/5 | Pre-computation made instructions almost irrelevant |

## Critical Learning: Bad Pre-computation Is Worse Than None

Regex-based semantic classification POISONED Chr 3c — it scored WORSE than 3b (no pre-computation) until regex labels were replaced with Haiku structured output. Pre-computation only helps when the pre-computed labels are accurate. Inaccurate labels actively mislead the LLM.

## Preferred Mutation Order (by failure type)

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
2. improve pre-computation quality (give the LLM better inputs)
3. tighten instructions
4. verification layer

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
- using regex for semantic classification (use Haiku structured output instead)
- changing multiple chromosomes simultaneously — you cannot attribute improvements
- assuming pre-computation always helps — bad labels are worse than no labels
