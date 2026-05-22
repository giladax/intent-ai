# Chromosome Framework for Context Composition

## What This Is

A genetic algorithm-inspired framework for optimizing how CC session data is composed into LLM context. Instead of designing one prompt and hoping, we define modular building blocks (chromosomes) that combine into organisms, evaluate them against real fixtures, and evolve the best combinations.

## The Genome

An **organism** is a complete pipeline configuration: one allele from each chromosome.

```
Organism = Chr1 (prompt) × Chr2 (format) × Chr3 (synthesis) × Chr4 (data) × Chr5 (edges)
```

```
┌──────────┐   edge    ┌──────────┐   edge    ┌──────────┐   edge    ┌──────────┐
│ Chr 4    │─────────▶│ Chr 3    │─────────▶│ Chr 2    │─────────▶│ Chr 1    │
│ Raw Data │  (Chr 5)  │ Synthesis│  (Chr 5)  │ Context  │  (Chr 5)  │ System   │
│ Selection│           │          │           │ Format   │           │ Prompt   │
└──────────┘           └──────────┘           └──────────┘           └──────────┘
```

---

## Chromosome 1: System Prompt

What the LLM is told to do. Defines the role, task framing, and output expectations.

### 1a: Moment Hunter (current)

"You are an expert at identifying meaningful moments in developer coding sessions. You read a sequence of events and extract the moments that matter."

LLM does: identify moments, classify type, determine agency, generate fingerprints, find evidence, write statements, assess significance and confidence. (10 cognitive tasks)

### 1b: Exchange Scorer

"You receive pre-labeled developer-AI exchanges. Each has a candidate moment type, pre-computed agency, and topic. Your job: confirm or override the label, and write a one-sentence statement describing what happened."

LLM does: validate pre-labels, write statements. (2 cognitive tasks)

### 1c: Narrative Editor

"You receive a draft list of moments with evidence. Some are strong, some are weak. Your job: drop the weak ones, sharpen the strong ones, and ensure each uses the developer's own language."

LLM does: quality filter, rewrite statements. (2 cognitive tasks)

### 1d: Arc Detector

"You receive exchanges grouped by topic. For each topic group, determine: is there a narrative arc here (origin → development → turning point → resolution)? If so, write the arc. If not, flag the strongest single moment."

LLM does: arc detection, arc narration. (2 cognitive tasks)

---

## Chromosome 2: Context Format

How pre-processed data is rendered into text for the LLM.

### 2a: Flat Event List

```
[0] DEV/INTENT: will we be able to track editor edits...
[1] AI/PROPOSAL: Yes — CC logs capture every tool call...
[2] AI/ACTION: Tool: Read on auth.ts
[3] DEV/RESULT: [file contents]
```

No grouping. Sequential. Current default for chunks without user intents.

### 2b: Threaded Exchanges (current)

```
── Exchange ──
DEV: "will we be able to track editor edits..."
  AI:
    - "Yes — CC logs capture..."
    - Read auth.ts
    - "I see the issue..."
```

Grouped by exchange. Shows conversation topology.

### 2c: Behavioral-Header + Adaptive Content

```
---
[EX-7] behavior: { engagement: challenging, initiative: user-led, density: full }
---
DEV: "will we be able to track editor edits with A? because..."
AI: "Yes — CC logs capture every tool call..."
```

Passive exchanges get minimal content (~45 tokens). Challenges get full (~180 tokens).

### 2d: Change Ledger

```
CHANGE [4] /src/auth.ts
  - old: `if (!token) return 401;`
  + new: `if (!token || isExpired(token)) return 401;`
  why: AI proposed fixing token expiry

REDIRECT [7]
  DEV: "actually that's not it, check the proxy"
```

Centered on code deltas. Conversation as annotation.

---

## Chromosome 3: Data Synthesis

What deterministic pre-computation happens before the LLM sees the data.

### 3a: None

Raw normalized events. No pre-computation. LLM infers everything.

### 3b: Exchange Pairing + Behavioral Labels

Group events into turn exchanges. Compute per-exchange: `devResponseChars`, `devAskedQuestion`, `devUsedReasoning`, `devIntroducedNewTopic`. Compute session-level directives. (Current Layer 0 output)

### 3c: Full Pre-computation

Everything in 3b, plus:
- **Agency per exchange**: developer / ai / collaborative / ambiguous (deterministic rules)
- **Candidate moment type**: proposal / confirmation / rejection / pivot / struggle / null (heuristic rules)
- **Topic fingerprint**: from file paths (directory → topic) or dev message nouns
- **Notable quotes**: dev's exact words, AI's first sentence, error messages from tool results
- **Struggle grouping**: consecutive failed edits on same file → grouped

### 3d: Full Pre-computation + Arc Pre-grouping

Everything in 3c, plus:
- Group exchanges by topic fingerprint into candidate arcs
- Detect arc boundaries (topic fingerprint changes)
- Pre-assign arc roles from position (first = origin, last = resolution candidate)

---

## Chromosome 4: Raw Data Selection

What raw data from the CC log enters the pipeline.

### 4a: Conversation Only

User text messages + AI text responses. No tool calls, no tool results, no thinking.
~145 tokens/exchange.

### 4b: Conversation + Actions

User text + AI text + tool call names and file paths. No tool results (no file contents, no command output).
~200 tokens/exchange.

### 4c: Conversation + Actions + Key Results

User text + AI text + tool calls with params + tool results (windowed: first 10 + last 5 lines for large outputs, full for errors).
~375 tokens/exchange.

### 4d: Conversation + Diffs Only

User text + AI text + Edit old/new diffs + Bash commands with output. No Read results (unless discovery detected by Chr 3).
~250 tokens/exchange.

---

## Chromosome 5: Edge Schemas

How data flows between chromosomes. The shape of the handoff.

### 5a: Loose Strings

Each stage outputs free text. Next stage receives a string blob. Simple but no structure.

### 5b: Typed Interfaces (current)

Structured TypeScript interfaces. `NormalizedDevEvent[]` → `TurnExchange[]` → `EnrichedExchange[]`. Compile-time safety.

### 5c: Annotated Typed

Typed interfaces with metadata annotations on each field:

```typescript
interface AnnotatedField<T> {
  value: T;
  confidence: "deterministic" | "heuristic" | "llm-inferred";
  source: string;  // which step produced this
}

interface AnnotatedExchange {
  agency: AnnotatedField<"developer" | "ai" | "collaborative">;
  candidateType: AnnotatedField<MomentType | null>;
  topicFingerprint: AnnotatedField<string>;
}
```

Context format (Chr 2) can render differently based on confidence:
- `deterministic` → bold, stated as fact
- `heuristic` → presented as suggestion the LLM can override
- `llm-inferred` → from a previous LLM step, presented as prior judgment

---

## Valid Combinations

Not all allele combinations make sense. Constraints:

| Constraint | Rule |
|-----------|------|
| Chr 1b (exchange scorer) requires Chr 3c or 3d | Needs pre-computed labels to score |
| Chr 1d (arc detector) requires Chr 3d | Needs pre-grouped arcs |
| Chr 2c (behavioral headers) requires Chr 3b+ | Needs behavioral labels |
| Chr 2d (change ledger) requires Chr 4b+ | Needs action data |
| Chr 5c (annotated) requires Chr 3c+ | Needs confidence metadata |
| Chr 4a (conversation only) incompatible with Chr 2d | No diffs to render |

Valid organism count: ~50-60 out of 243 theoretical.

---

## Gen 0 Organisms to Test

Start with 4 organisms spanning the design space:

### Organism α: Current Baseline
`{1a, 2b, 3b, 4b, 5b}` — moment hunter + threaded exchanges + exchange pairing + conversation+actions + typed interfaces

### Organism β: Pre-computed + Scorer
`{1b, 2c, 3c, 4b, 5b}` — exchange scorer + behavioral headers + full pre-computation + conversation+actions + typed

### Organism γ: Diff-Centric + Arc Detector
`{1d, 2d, 3d, 4d, 5b}` — arc detector + change ledger + full pre-computation with arcs + diffs only + typed

### Organism δ: Minimal + Narrative Editor
`{1c, 2a, 3c, 4a, 5b}` — narrative editor + flat list + full pre-computation + conversation only + typed

---

## Evaluation Protocol

### Fitness Function

Score each organism against eval criteria:
- **Moment detection**: % of mustDetectMoments found (match by statement content, not fingerprint)
- **Moment precision**: % of moments that aren't false positives
- **Narrative quality**: % of narrativeMust phrases present
- **Narrative precision**: % of narrativeMustNot phrases absent
- **Directive accuracy**: % of expected directive flags correct
- **Token efficiency**: tokens used (lower = better, weighted)

`totalScore = moments*0.25 + precision*0.10 + narrativeQuality*0.25 + narrativePrecision*0.10 + directives*0.15 + tokenEfficiency*0.15`

### Evolution

1. **Gen 0**: Test organisms α, β, γ, δ on design-scope fixture
2. **Selection**: Keep top 2 scorers
3. **Crossover**: Swap one chromosome between winners (e.g., take β's Chr3 + α's Chr1)
4. **Mutation**: Vary one parameter per offspring (truncation length, label granularity, diff lines shown)
5. **Gen 1**: Test 4-6 offspring on design-scope + implementation-scope
6. **Repeat** until score plateaus or reaches target (>85%)

### Fixtures (by cost, ascending)

| Fixture | Lines | Est. Cost/Run | Use |
|---------|-------|---------------|-----|
| design scope | 257 | ~$0.05 | Gen 0-2 (cheap iteration) |
| pivot scope | 725 | ~$0.10 | Gen 2+ (tests quality rejection detection) |
| implementation scope | 1563 | ~$0.20 | Gen 3+ (tests code-heavy sessions) |
| full scope | 2525 | ~$0.40 | Final validation only |

---

## Implementation

### What to build:

1. **Allele registry** — each allele is a function that implements its chromosome's contract
2. **Organism assembler** — composes alleles into a runnable pipeline configuration
3. **Fitness runner** — runs an organism against a fixture, scores it
4. **Evolution loop** — selection, crossover, mutation, next generation

### File structure:

```
src/eval/
  ├── chromosomes/
  │   ├── chr1-prompts.ts       # system prompt alleles
  │   ├── chr2-formats.ts       # context format alleles
  │   ├── chr3-synthesis.ts     # data synthesis alleles
  │   ├── chr4-data.ts          # raw data selection alleles
  │   └── chr5-edges.ts         # edge schema alleles
  ├── organism.ts               # assembler — combines alleles into pipeline config
  ├── fitness.ts                # scoring function (exists, needs update)
  ├── evolution.ts              # selection, crossover, mutation
  └── runner.ts                 # runs organism against fixture, returns FitnessResult
```
