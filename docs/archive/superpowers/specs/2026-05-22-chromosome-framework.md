# Chromosome Framework — Evolutionary Pipeline Optimization

## What This Is

A genetic algorithm framework for optimizing the execution memory pipeline. Every processing node in the pipeline graph is an **organism** — composed of 4 independent chromosomes. The graph **topology** itself is also a variable. We evaluate combinations against real fixtures and evolve toward the best configuration.

## Core Concepts

### Node

A processing unit in the pipeline graph. A node is NOT necessarily an LLM call. It can be:
- **0 LLM calls** — pure deterministic (normalize, chunk, pre-compute)
- **1 LLM call** — single inference (classify, detect moments)
- **Multiple LLM calls** — fan-out per chunk, critic loop, router → specialists
- **A router** — deterministic or LLM-based dispatch to different downstream paths

### Organism

Each node's behavior is defined by an organism — 4 chromosomes composed **in parallel** (not sequentially) into one processing unit:

```
          ┌─ Chr 1: Instructions ─────┐
          │   (what to do)             │
          │                            │
          ├─ Chr 2: Format ────────────┤
          │   (how to render input)    ├──▶  NODE OUTPUT
          │                            │
          ├─ Chr 3: Synthesis ─────────┤
          │   (what to pre-compute)    │
          │                            │
          └─ Chr 4: Data Selection ───┘
              (what raw data enters)
```

All 4 chromosomes contribute to the same node simultaneously. Chr 1 doesn't receive output from Chr 2 — they're assembled together. For a deterministic node (0 LLM calls), Chr 1 is "no LLM — deterministic logic" and Chr 2/3/4 define the code behavior.

### Allele

A specific variant of a chromosome. Each chromosome has 3-4 alleles. An organism selects one allele per chromosome.

### Topology

How nodes connect in the pipeline graph. The topology is a separate variable from the organisms — you can test the same organism alleles in different graph shapes.

### Input/Output Contracts

The interfaces between nodes. These are implicit in how chromosomes are defined — Chr 4 (data selection) determines what enters the node, and the node's output schema determines what leaves. These are NOT a separate chromosome; they're artifacts of the organism's configuration.

---

## The 4 Chromosomes

### Chromosome 1: Instructions

What the node does with its input. For LLM nodes, this is the system prompt. For deterministic nodes, this is the processing logic.

| Allele | Description | Cognitive Load |
|--------|-------------|----------------|
| **1a** Moment Hunter | "Identify moments, classify type, determine agency, generate fingerprints, find evidence, write statements" | 10 tasks |
| **1b** Exchange Scorer | "Confirm or override pre-computed labels. Write the statement." | 2 tasks |
| **1c** Narrative Editor | "Drop weak moments, sharpen strong ones, use developer's language" | 2 tasks |
| **1d** Arc Detector | "Given topic-grouped exchanges, detect and narrate arcs" | 2 tasks |
| **1e** No LLM | Pure deterministic logic (for pre-computation nodes) | 0 (code) |
| **1f** Router | Classify input complexity, output routing decision | 1 task |

### Chromosome 2: Format

How input data is rendered for the node. For LLM nodes, this is the user prompt format. For deterministic nodes, this is the data structure.

| Allele | Description | Tokens/exchange |
|--------|-------------|-----------------|
| **2a** Flat list | Sequential events, no grouping | ~145 |
| **2b** Threaded exchanges | Grouped by dev→AI turn pairs | ~200 |
| **2c** Behavioral headers + adaptive | Headers with engagement labels, content density varies by engagement | 45-180 |
| **2d** Change ledger | Code deltas centered, conversation as annotation | ~60-80 |
| **2e** Pre-labeled exchanges | Structured fields (agency, candidate type, topic, quotes) | ~100 |

### Chromosome 3: Synthesis

What deterministic pre-computation happens before the node processes data.

| Allele | Description | Computes |
|--------|-------------|----------|
| **3a** None | Raw events, no pre-computation | — |
| **3b** Exchange pairing | Turn exchanges + behavioral flags (Layer 0) | devResponseChars, devAskedQuestion, devUsedReasoning |
| **3c** Full pre-computation | 3b + agency labels + candidate types + topic fingerprints + notable quotes + struggle grouping | All of 3b + agency, candidateType, topicFingerprint, notableQuotes |
| **3d** Arc pre-grouping | 3c + group by topic into candidate arcs + pre-assign arc roles | All of 3c + arcId, arcRole suggestions |

### Chromosome 4: Data Selection

What raw data from the CC log enters the node.

| Allele | Description | Tokens/exchange |
|--------|-------------|-----------------|
| **4a** Conversation only | User text + AI text. No tools. | ~145 |
| **4b** Conversation + actions | 4a + tool names and file paths | ~200 |
| **4c** Conversation + actions + results | 4b + tool results (windowed for large outputs) | ~375 |
| **4d** Conversation + diffs | User text + AI text + Edit diffs + Bash output. No Read results unless flagged as discovery. | ~250 |

---

## Topologies

The graph shape connecting nodes. Each topology can use different organisms at each node.

### Topology L: Linear (current)

```
normalize → classify → chunk → moments_p1 → moments_p2 → transitions → narrative
```

Every session takes the same path. Simple but no optimization for input complexity.

### Topology R: Routed

```
normalize → [classify + chunk + analyze] (parallel)
                    │
                  route ─── simple → simple_narrative (1 Haiku call)
                    │
                  standard → moments → transitions → narrative
```

Simple sessions skip expensive steps. Router is a node with organism `{1f, -, 3b, -}`.

### Topology T: Top-Down

```
normalize → classify → arc_planner (identify arcs from overview)
                           │
                    ┌──────┼──────┐
                    ▼      ▼      ▼
               arc_1    arc_2    arc_3    (per-arc moment detection, fan-out)
                    │      │      │
                    └──────┼──────┘
                           ▼
                    merge + narrative
```

Arcs identified first, then moments found within each arc's context. Each arc node is an organism.

### Topology C: Critic Loop

```
normalize → chunk → moments → critic ──── pass ──→ narrative
                                  │
                                  └─ fail → revise → critic (max 2 loops)
```

Quality gate after moments. Critic node has its own organism (could be Haiku with `{1c, 2e, 3c, 4a}`).

### Topology H: Hybrid (R + T + C combined)

```
normalize → [classify + chunk + analyze] ─── route
                                               │
                           simple ◄────────────┤
                             │                  │
                        1 Haiku call       standard
                                               │
                                          arc_planner
                                               │
                                    ┌──────────┼──────────┐
                                    ▼          ▼          ▼
                                 arc_1      arc_2      arc_3  (fan-out)
                                    │          │          │
                                    └──────────┼──────────┘
                                               ▼
                                            merge
                                               │
                                           narrative
                                               │
                                            critic ── pass → output
                                               │
                                               └── fail → revise (max 2)
```

---

## Organism Examples

Each node in a topology gets its own organism. Here are example configurations for the moment detection node:

| Organism | Chr 1 | Chr 2 | Chr 3 | Chr 4 | Total tasks | Est. tokens |
|----------|-------|-------|-------|-------|-------------|-------------|
| **α** Current | 1a (hunter) | 2b (threaded) | 3b (exchange pairs) | 4b (conv+actions) | 10 | ~200/ex |
| **β** Pre-computed | 1b (scorer) | 2e (pre-labeled) | 3c (full precomp) | 4b (conv+actions) | 2 | ~100/ex |
| **γ** Diff-centric | 1d (arc detector) | 2d (change ledger) | 3d (arc groups) | 4d (conv+diffs) | 2 | ~80/ex |
| **δ** Minimal | 1c (editor) | 2a (flat) | 3c (full precomp) | 4a (conv only) | 2 | ~60/ex |

Different nodes can use different organisms:
- Moment detection: organism β (pre-computed scorer)
- Narrative generation: organism δ (minimal editor)
- Critic: `{1c, 2e, 3c, 4a}` (editor checking pre-labeled moments against narrative)
- Router: `{1e, -, 3b, -}` (no LLM, deterministic routing from directives)

---

## Evaluation

### Fitness Function

Score each full pipeline configuration (topology + per-node organisms) against eval criteria:

| Metric | Weight | What it measures |
|--------|--------|-----------------|
| Moment detection | 0.25 | % of mustDetectMoments found (match by statement content) |
| Moment precision | 0.10 | % of moments without false positives |
| Narrative quality | 0.25 | % of narrativeMust phrases present |
| Narrative precision | 0.10 | % of narrativeMustNot anti-patterns absent |
| Directive accuracy | 0.15 | % of expected directive flags correct |
| Token efficiency | 0.15 | Normalized inverse of tokens used |

### Evolution Protocol

**Gen 0:** 4 organisms on the moment detection node, Topology L, design-scope fixture. Establish baseline.

**Gen 1:** Take winning chromosomes from Gen 0. Crossover: swap one chromosome between top 2. Mutation: vary one parameter (truncation length, label granularity). Test 4-6 offspring.

**Gen 2:** Introduce topology variation. Test Topology R (routed) with Gen 1 winner. Test Topology C (critic loop) with Gen 1 winner.

**Gen 3:** Expand to multiple nodes. Optimize narrative organism independently from moment organism. Test on pivot-scope fixture.

**Gen 4+:** Test Topology T (top-down) and H (hybrid). Full-scope fixture for final validation.

### Fixtures (ascending cost)

| Fixture | Events | Est. Cost | Use |
|---------|--------|-----------|-----|
| design scope | 257 lines | ~$0.05 | Gen 0-2 |
| pivot scope | 725 lines | ~$0.10 | Gen 2-3 |
| implementation scope | 1563 lines | ~$0.20 | Gen 3+ |
| full scope | 2525 lines | ~$0.40 | Final validation |

---

## Implementation

### File Structure

```
src/eval/
  ├── chromosomes/
  │   ├── chr1-instructions.ts    # instruction alleles (prompts + deterministic logic)
  │   ├── chr2-formats.ts         # format alleles (rendering functions)
  │   ├── chr3-synthesis.ts       # synthesis alleles (pre-computation functions)
  │   └── chr4-data.ts            # data selection alleles (filter functions)
  ├── organism.ts                 # assembles 4 alleles into a node processor
  ├── topology.ts                 # defines graph shapes, wires nodes
  ├── fitness.ts                  # scores pipeline output against criteria
  ├── evolution.ts                # selection, crossover, mutation logic
  └── runner.ts                   # runs a (topology + organisms) config against a fixture
```

### Allele Interface

Each chromosome defines a contract. Alleles implement it:

```typescript
// Chr 1: Instructions
interface InstructionAllele {
  name: string;
  type: "llm" | "deterministic" | "router";
  // For LLM: returns system prompt
  // For deterministic: returns processing function
  // For router: returns routing function
  build(context: NodeContext): InstructionConfig;
}

// Chr 2: Format
interface FormatAllele {
  name: string;
  render(data: SynthesizedData): string;  // renders into prompt text
}

// Chr 3: Synthesis
interface SynthesisAllele {
  name: string;
  process(events: NormalizedDevEvent[]): SynthesizedData;
}

// Chr 4: Data Selection
interface DataAllele {
  name: string;
  select(events: RawDevEvent[]): RawDevEvent[];  // filters raw events
}
```

### Organism Assembly

```typescript
interface Organism {
  instructions: InstructionAllele;
  format: FormatAllele;
  synthesis: SynthesisAllele;
  dataSelection: DataAllele;
}

// Assemble into a node processor
function assembleNode(organism: Organism): NodeProcessor {
  return async (rawEvents, context) => {
    const selected = organism.dataSelection.select(rawEvents);
    const synthesized = organism.synthesis.process(normalize(selected));
    const formatted = organism.format.render(synthesized);
    return organism.instructions.build(context).execute(formatted);
  };
}
```

### Topology Assembly

```typescript
interface TopologyConfig {
  shape: "linear" | "routed" | "top-down" | "critic" | "hybrid";
  nodes: Record<string, Organism>;  // node name → organism
}

// Example: Topology R with different organisms per node
const config: TopologyConfig = {
  shape: "routed",
  nodes: {
    router: { instructions: chr1f, format: null, synthesis: chr3b, dataSelection: null },
    simple_narrative: { instructions: chr1c, format: chr2a, synthesis: chr3b, dataSelection: chr4a },
    moment_detector: { instructions: chr1b, format: chr2e, synthesis: chr3c, dataSelection: chr4b },
    narrative: { instructions: chr1c, format: chr2a, synthesis: chr3d, dataSelection: chr4a },
  }
};
```
