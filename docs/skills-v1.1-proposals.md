# Skills v1.1 Improvement Proposals

Based on 7 key insights from the intent-ai session.

---

## Brainstorming Skill — 3 changes

### 1a. Add "Computation Boundary Analysis"

After "Design for isolation and clarity" section, add:

> **Computation boundary analysis:**
> - For every component, explicitly classify it: **deterministic** or **judgment**?
> - Deterministic work (parsing, grouping, counting, fingerprinting) should be pre-computed by code, not delegated to the LLM.
> - The LLM should receive pre-computed structure and focus on narrative judgment — it should be an editor, not an analyst.
> - Ask: "What can I hand the next step so it has a simpler problem?"
> - If a component mixes both, split it: deterministic pre-processing feeds into an LLM judgment step.

### 1b. Add "Pipeline Topology" to approaches exploration

> - For systems involving multi-step processing, consider topology: DAG (parallel branches), conditional routing (skip steps for simple inputs), MapReduce (fan-out/fan-in), critic loop (iterative refinement with quality gate).

### 1c. Add "Eval Criteria" to design presentation

> - Define eval criteria alongside the design. For each core behavior: what does "good" look like, what does "bad" look like? Identify 3-5 real-world inputs as eval fixtures. Prefer real data over synthetic.

---

## Writing-Plans Skill — 3 changes

### 2a. Add "Eval Fixture Tasks" for LLM pipelines

Before implementation tasks, include:
> Task 0: Create Eval Fixtures
> - Capture 3-5 real-world inputs (not synthetic)
> - Define grading criteria per fixture
> - Run baseline through stub pipeline

### 2b. Add "Assembly Line Principle"

> **Assembly line sequencing:** Order tasks so each pre-computes what the next needs. First tasks = deterministic (parsing, grouping). Later tasks = LLM judgment on top of structure. If a task mixes both, split it.

### 2c. Add "Prompt Design via Composition"

> 1. Identify context ingredients (raw input, pre-computed summaries, behavioral signals)
> 2. Design 2-3 composition variants ("chromosomes")
> 3. Evaluate against fixtures
> 4. Select best-performing composition
> Don't tune prompt wording in isolation. Tune what information the prompt receives.

---

## LangChain-Architecture Skill — 3 changes

### 3a. Add "Pattern 5: Hybrid Pipeline with Pre-Computation and Conditional Routing"

Full LangGraph code example showing:
- Deterministic `parse_and_structure` node (no LLM)
- `route_by_complexity` conditional edge
- LLM `synthesize` node receiving pre-computed structure
- Simple path vs full path

### 3b. Add "State Enrichment Pattern"

> State should accumulate evidence across nodes, never discard it. Each node adds to state; no node strips fields downstream nodes might need.
> Anti-pattern: a node that receives rich state and passes only a summary string.

### 3c. Add "Behavioral Signals" pitfall

> When processing human interactions, HOW users interact (passive/challenge/delegation) is more valuable than WHAT was discussed. Design extraction logic for behavioral patterns, not just content.

---

## LangSmith-Evaluator Skill — 2 changes

### 4a. Add "EDD Workflow"

> 1. Collect real fixtures (3-5 real inputs, never synthetic)
> 2. Define grading criteria (write evaluator BEFORE building)
> 3. Run baseline
> 4. Implement
> 5. Evaluate against baseline
> 6. Iterate composition, not just wording

### 4b. Add "Composition-Based Prompt Optimization"

> Vary what information the prompt receives (composition), not just wording.
> Define 2-3 composition variants, run each against same fixtures, compare scores.

---

## LangSmith-Dataset Skill — 1 change

### 5a. Add "Real Data First" principle

> Always prefer real data over synthetic. Real data contains edge cases synthetics miss. Even 3 real examples > 30 synthetic ones.

---

## NEW: Pipeline Design Patterns Skill

A standalone skill covering:
- Pre-computation reduces LLM complexity (assembly line principle)
- LLM as editor, not analyst
- Evidence flows through the pipeline
- Behavioral signals over content
- Pipeline topologies (linear, DAG, conditional, MapReduce, critic loop, hybrid)
- Eval-driven pipeline development workflow
- Anti-patterns (god prompt, evidence stripping, synthetic-only evals, prompt-only optimization, linear-by-default)
