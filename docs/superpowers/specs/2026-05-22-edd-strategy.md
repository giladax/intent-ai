# EDD Strategy: Raw Events → LLM Output → Judge Scoring

## The Full Path

```
Raw CC Events (JSONL)
    │
    ▼
Chr 4: Data Selection ─── which events enter?
    │
    ▼
Chr 3: Synthesis ──────── what's pre-computed from them?
    │
    ▼
Chr 2: Format ─────────── how are they rendered into text?
    │
    ▼
Chr 1: Instructions ───── what does the LLM do with it?
    │
    ▼
LLM Call (system + user prompt)
    │
    ▼
Raw LLM Output (JSON)
    │
    ▼
Post-processing (Zod parse, type mapping)
    │
    ▼
Node Output (typed moments/narrative/etc)
    │
    ▼
Judge (LLM-as-judge scores the output)
```

Each chromosome transforms the data. The output of all 4 chromosomes assembles into ONE LLM call. The judge evaluates the result.

## What Each Chromosome Actually Does to the Data

### Chr 4: Data Selection

**Input:** Raw CC JSONL lines (2545 lines, 6 event types)

**Output:** Filtered subset of events

**What it's deciding:** Which raw signal to keep. This is a LOSS function — everything dropped here is gone forever for this node.

| Raw Event Type | Count | 4a (conv only) | 4b (conv+actions) | 4c (conv+actions+results) | 4d (conv+diffs) |
|---------------|-------|----------------|-------------------|--------------------------|-----------------|
| user:text | 73 | ✓ | ✓ | ✓ | ✓ |
| assistant:text | 57 | ✓ | ✓ | ✓ | ✓ |
| assistant:tool_use | 178 | ✗ | ✓ (name+path only) | ✓ (full params) | ✓ (Edit diffs only) |
| user:tool_results | 352 | ✗ | ✗ | ✓ (windowed) | ✓ (errors+diffs only) |
| assistant:thinking | varies | ✗ | ✗ | ✗ | ✗ |
| noise (progress, etc) | ~1300 | ✗ | ✗ | ✗ | ✗ |

**Isolation test:** Change ONLY Chr 4 (keep 1, 2, 3 constant). If 4b scores higher than 4a, tool call names carry signal. If 4c doesn't beat 4b much, tool results are mostly noise.

### Chr 3: Synthesis

**Input:** Normalized events (from Chr 4's selection, after normalize + chunk)

**Output:** Pre-computed structure layered on top of the events

**What it's deciding:** What the LLM WON'T need to figure out.

| What's pre-computed | 3a (none) | 3b (exchanges) | 3c (full) | 3d (arcs) |
|--------------------|-----------|----------------|-----------|-----------|
| Turn exchange pairing | ✗ | ✓ | ✓ | ✓ |
| Behavioral flags (devAskedQuestion, etc) | ✗ | ✓ | ✓ | ✓ |
| Pipeline directives | ✗ | ✓ | ✓ | ✓ |
| Agency per exchange | ✗ | ✗ | ✓ | ✓ |
| Candidate moment type | ✗ | ✗ | ✓ | ✓ |
| Topic fingerprint (from files) | ✗ | ✗ | ✓ | ✓ |
| Notable quotes extracted | ✗ | ✗ | ✓ | ✓ |
| Struggle grouping | ✗ | ✗ | ✓ | ✓ |
| Arc pre-grouping | ✗ | ✗ | ✗ | ✓ |

**Isolation test:** Change ONLY Chr 3 (keep 1, 2, 4 constant). If 3c beats 3b, pre-computed agency/topics help. If 3c doesn't help or hurts, the heuristics are too noisy and mislead the LLM.

### Chr 2: Format

**Input:** Synthesized data (events + pre-computed structure from Chr 3)

**Output:** A string — the user prompt content

**What it's deciding:** How the LLM "sees" the data. Same information, different rendering.

| Rendering | 2a (flat) | 2b (threaded) | 2c (behavioral) | 2d (change ledger) | 2e (pre-labeled) |
|-----------|-----------|---------------|-----------------|-------------------|-----------------|
| Grouping | none | by exchange | by exchange | by code change | by exchange |
| Dev messages | inline | under exchange header | under behavioral header | as REDIRECT/SIGNAL | with pre-labels |
| AI actions | inline | indented under AI | density-adaptive | centered (CHANGE) | summarized |
| Behavioral signal | none | none | header per exchange | implicit (REDIRECT) | inline labels |
| Passive exchanges | same as active | same | compressed (~45 tok) | often omitted | labeled "passive" |
| Challenge exchanges | same | same | expanded (~180 tok) | as REDIRECT | labeled "challenge" |

**Isolation test:** Change ONLY Chr 2 (keep 1, 3, 4 constant). If 2c beats 2b, behavioral headers help the LLM. If 2e beats 2c, explicit pre-labels are better than behavioral headers.

### Chr 1: Instructions

**Input:** Nothing from the data — this is the system prompt only

**Output:** The system prompt string

**What it's deciding:** What cognitive tasks the LLM performs, what output schema it follows, what guidance it receives.

| Prompt | 1a (hunter) | 1b (scorer) | 1c (editor) | 1d (arc detector) |
|--------|-------------|-------------|-------------|-------------------|
| Cognitive tasks | 10 | 2 | 2 | 2 |
| LLM role | "identify moments from scratch" | "confirm/override pre-labels" | "quality-filter draft moments" | "detect narrative arcs" |
| Requires pre-computation | no | yes (Chr 3c+) | yes (needs draft moments) | yes (Chr 3d) |
| Output format | full moments with all fields | confirmed/overridden moments | filtered/sharpened moments | arc-grouped moments |

**Isolation test:** Change ONLY Chr 1 (keep 2, 3, 4 constant). If 1b beats 1a WITH 3c, pre-computation + simple prompt wins. If 1a still beats 1b with 3c, the pre-computation isn't good enough yet to replace the LLM's judgment.

## Learning Strategy: One Chromosome at a Time

### Phase 1: Find the best data selection (Chr 4)

Hold constant: `{1a_hunter, 2b_threaded, 3b_exchanges}`
Vary: `4a` → `4b` → `4c` → `4d`

4 runs. Learn: does tool data help moment detection?

### Phase 2: Find the best synthesis (Chr 3)

Hold constant: `{1a_hunter, 2b_threaded, [best Chr 4]}`
Vary: `3a` → `3b` → `3c` → `3d`

4 runs. Learn: does pre-computation help or mislead?

### Phase 3: Find the best format (Chr 2)

Hold constant: `{1a_hunter, [best Chr 3], [best Chr 4]}`
Vary: `2a` → `2b` → `2c` → `2d` → `2e`

5 runs. Learn: how should the LLM see the data?

### Phase 4: Find the best instructions (Chr 1)

Hold constant: `{[best Chr 2], [best Chr 3], [best Chr 4]}`
Vary: `1a` → `1b` → `1c` → `1d`

4 runs. Learn: given optimal input, what should the LLM's job be?

### Phase 5: Validate

Run the winner (`{best 1, best 2, best 3, best 4}`) on ALL 4 fixture scopes. Compare to Gen 0 baseline.

**Total cost:** ~17 runs × ~$0.05/run = ~$0.85 for the full learning strategy.

## Judge Scoring (LLM-as-Judge)

### Why Not Programmatic Scoring

The current fitness function matches moments by keyword (`containsPhrase`). This is:
- **Brittle** — "TypeScript" vs "typescript" vs "TS" vs "the tech stack was corrected"
- **Shallow** — can't assess quality of the statement, only presence of a keyword
- **Missing nuance** — can't tell if agency attribution is correct, if the statement uses developer's own language, if evidence is well-cited

### Judge Design

A separate LLM call (Haiku — cheap) that receives:
1. The eval criteria for this fixture
2. The pipeline's output (moments, narrative)
3. A rubric

And scores on 5 dimensions:

```typescript
interface JudgeScore {
  momentCoverage: {
    score: number;        // 1-5
    reasoning: string;    // why this score
    found: string[];      // which expected moments were detected
    missed: string[];     // which were missed
  };
  momentQuality: {
    score: number;        // 1-5
    reasoning: string;
    // Does each moment use developer's language? Is evidence cited?
    // Is agency attribution correct? Are statements specific, not generic?
  };
  narrativeAccuracy: {
    score: number;        // 1-5
    reasoning: string;
    // Does the narrative capture what actually happened?
    // Does it use the developer's own words?
  };
  narrativeInsight: {
    score: number;        // 1-5
    reasoning: string;
    // Does the narrative reveal HOW the developer worked, not just WHAT?
    // Does it capture behavioral patterns, not just events?
  };
  antiPatterns: {
    score: number;        // 1-5 (5 = no anti-patterns found)
    reasoning: string;
    // Generic statements? Wrong agency? Hallucinated claims?
    // "The developer decided" instead of quoting them?
  };
  overall: number;        // weighted average
}
```

### Judge Prompt

```
You are evaluating the quality of an execution memory digest.

## What Actually Happened (ground truth)

{criteria.description — a human-written summary of what this fixture covers}

## Key Moments That Should Be Detected

{criteria.mustDetectMoments — listed with context}

## The Pipeline's Output

### Moments Detected:
{moments as JSON}

### Narrative:
{narrative.summary}
{narrative.progression}
{narrative.discoveries}

## Score on 5 Dimensions (1-5 each)

1. Moment Coverage: Were the key moments detected?
2. Moment Quality: Are statements specific, evidence-backed, using developer's language?
3. Narrative Accuracy: Does it capture what actually happened?
4. Narrative Insight: Does it reveal HOW the developer worked, not just WHAT?
5. Anti-Patterns: Any generic statements, wrong agency, hallucinated claims?

For each, give a score and explain why.
```

### Why Judge Scoring is Better

| Aspect | Programmatic | Judge |
|--------|-------------|-------|
| "TypeScript" detection | exact string match | understands "tech stack corrected to TS" |
| Agency quality | can't assess | "says 'developer' but the AI actually drove this" |
| Statement specificity | keyword presence | "this is generic — could describe any session" |
| Evidence quality | can't assess | "quotes the developer's exact words — excellent" |
| Narrative insight | keyword presence | "captures delegation pattern — goes beyond summary" |
| Cost per eval | free | ~$0.01 (Haiku) |
| Consistency | 100% deterministic | ~90% consistent (good enough for relative comparison) |

### Using Judge Scores for Chromosome Learning

Each chromosome variation gets a judge score. The learning loop:

```
1. Run organism with {1a, 2b, 3b, 4a} → judge score: 3.2
2. Change ONLY Chr 4: {1a, 2b, 3b, 4b} → judge score: 3.8
3. Change ONLY Chr 4: {1a, 2b, 3b, 4c} → judge score: 3.6
4. Change ONLY Chr 4: {1a, 2b, 3b, 4d} → judge score: 3.9
   → Best Chr 4: 4d (conversation + diffs)
   → Learning: diffs help more than full tool results

5. Lock Chr 4 = 4d. Change ONLY Chr 3: {1a, 2b, 3a, 4d} → judge: 3.5
6. {1a, 2b, 3b, 4d} → judge: 3.9
7. {1a, 2b, 3c, 4d} → judge: 4.2
8. {1a, 2b, 3d, 4d} → judge: 4.1
   → Best Chr 3: 3c (full pre-computation)
   → Learning: pre-computed agency + topics help, but arc pre-grouping doesn't add much

... continue for Chr 2, then Chr 1
```

Each step changes ONE variable. The judge score tells us if the change helped. After 17 runs, we have the optimal organism for moment detection AND we understand WHY each chromosome matters.

## Implementation

### What to Build

1. **Judge prompt + scoring** — `src/eval/judge.ts`
   - `judgeOutput(criteria, moments, narrative): Promise<JudgeScore>`
   - Uses Haiku, ~$0.01 per call
   - Returns structured 5-dimension scores with reasoning

2. **Learning runner** — `src/eval/learner.ts`
   - Runs the 4-phase learning strategy
   - Holds 3 chromosomes constant, varies 1
   - Logs each run's judge score
   - Reports the winning allele per chromosome with reasoning

3. **Update runner** — `run-gen0.ts` → `run-learn.ts`
   - Executes the full learning strategy
   - Outputs a formatted report with scores per variation

### Adding Ground Truth to Criteria

The judge needs a human-written description of what happened in each fixture. Add to `ScopeCriteria`:

```typescript
groundTruth: string;  // human-written summary of what this fixture covers
```

For design scope:
> "The developer submitted a detailed PRD for an Execution Memory System, then went through a structured brainstorming process. Key decisions: corrected Python to TypeScript (developer-driven rejection), chose monolith CLI architecture (collaborative), identified moment detection as 'painted gold' (developer emphasis), accepted all 7 adversarial review findings, committed to eval-driven development. The developer was highly engaged during design questions but delegated implementation details."
