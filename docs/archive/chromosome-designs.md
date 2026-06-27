# Chromosome Designs: Context Composition Strategies

4 strategies for composing CC log data into LLM context for moment detection.

---

## Chromosome A: Minimal Exchange

**Bet:** Moments are conversational phenomena, not code phenomena.

**Include:** user:text (full), assistant:text (full), tool names only (deduplicated)
**Exclude:** All tool results, all tool params, all thinking, all infrastructure, timestamps

**Format:**
```
[EXCHANGE 7]
U: will we be able to track editor edits with A? because git commits are too compressed and usually lose semantic meaning
A: Yes — CC logs capture every tool call including Edit, Write, and file reads. Each edit has the exact before/after content...
I see two options:
Option A: Use CC session logs as the primary source...
Option B: Use git commits augmented with conventional commit parsing...
I'd recommend Option A.
A: [tools: Read]
U: ok
```

**Tokens:** ~145/exchange. 50-exchange session: ~6K total.

**Gains:** 10-20x compression. Clean signal. Consistent cost regardless of code size.
**Loses:** What code was written. What files were read. Error signals. Architectural context.

---

## Chromosome B: Rich Threaded Context

**Bet:** Moments need code evidence to distinguish "proposed" from "accepted" from "modified."

**Include:** user:text (800 chars), assistant:text (800 chars), tool_use with diffs (Edit old/new, Bash commands), tool_results (windowed: first 10 + last 5 lines), thinking (when >50 chars, truncated 400)
**Exclude:** Infrastructure noise, empty thinking, duplicate file reads

**Format:**
```
## Chunk 0/1 — Topic: data-source-design
## Time range: 10:05 → 10:08 (3 min)
## Files in scope: (none)
## Exchange count: 2 | Short responses: 1/2 (50%)

═══ Exchange 1 ═══════════════════════════════════════════════
[0] DEV: "will we be able to track editor edits with A?..."

[1] AI [proposal]: "Yes — CC logs capture every tool call..."

[2] AI [proposal]: "Two approaches: A) Parse CC logs... B) Hybrid..."

═══ Exchange 2 ═══════════════════════════════════════════════
[3] DEV: "ok"
  ⚠ short-response (2 chars)
```

Edit diffs render as:
```
[12] AI [action:Edit] src/pipeline/normalize.ts
  @@ -45,3 +45,5 @@
  - const old = something;
  + const newThing = betterSomething;
  + const extra = addedLine;
```

**Tokens:** ~375/exchange. 50-exchange session: ~15K total.

**Gains:** Full code evidence. Agency disambiguation via `⚠ short-response`. Causal threading explicit. Thinking blocks for intent.
**Loses:** 2-3x token cost. Complex formatter. Risk of overwhelming LLM on large chunks.

---

## Chromosome C: Behavioral-First Format

**Bet:** Behavioral metadata is more valuable per token than content. Front-load HOW the developer interacts.

**Include:** Behavioral header (always), then adaptive content based on engagement level:
- `minimal` (passive): 1-line AI summary + user response. ~45 tokens.
- `standard` (neutral): AI first paragraph + user response + tool names. ~100 tokens.
- `full` (challenge): complete AI response + user response + tool params + key results. ~180 tokens.

**Format:**
```
---
[EX-14] t=00:12:30
behavior: { engagement: passive, response: approval, initiative: ai-led, density: minimal }
tools: [Edit:tracker.ts, Bash:test]
---
AI proposed 3 tracking approaches (event-driven / git-based / hybrid), recommended hybrid.
USER: "ok"
AI executed: edited tracker.ts, ran tests (pass).
```

```
---
[EX-15] t=00:14:45
behavior: { engagement: challenging, response: question, initiative: user-led, density: full }
tools: []
---
USER: "will we be able to track editor edits with A? because git commits are too compressed and usually lose semantic meaning"

AI: "Good question. Option A captures each edit as it happens — every file save...
The tradeoff is storage volume — roughly 10x more data than git-based. But for
moment detection, that granularity is exactly what we need."

USER follow-up signals: [none — next exchange is new topic]
```

**Tokens:** 45-180/exchange (adaptive). 50-exchange session: ~4.4K total.

**Gains:** Smart compression — detail where moments live, minimal where routine. Headers form scannable "table of contents." 4:1 non-uniform compression.
**Loses:** Misclassified passivity compounds (resigned "ok" vs enthusiastic "ok"). Pre-computation errors baked in. Loss of "boring middle" baseline.

---

## Chromosome D: Diff-Centric / What-Changed

**Bet:** Ground truth = code deltas. Moments are best detected from state transitions, not dialogue.

**Include:** Only state-modifying events (Edit, Write, Bash) and their results. Reads only if they led to a discovery. User messages only if they redirect work.
**Exclude:** AI proposals that never became code. Read-only operations with no consequence. All infrastructure.

**Format:**
```
CHANGE [4] /src/auth.ts
  - old: `if (!token) return 401;`
  + new: `if (!token || isExpired(token)) return 401;`
  result: applied
  why: AI proposed fixing auth middleware token expiry check

REDIRECT [7]
  DEV: "actually that's not it, check the proxy config"
```

Struggles pre-grouped:
```
STRUGGLE [N-M] auth.ts
  attempt 1: added isExpired check → test failed (expected 401, got 200)
  attempt 2: moved check before proxy → test failed (same)
  attempt 3: added await to isExpired → tests pass
  resolution: async token validation was needed
```

Discoveries from Reads:
```
DISCOVERY [N] proxy.config.ts
  observed: "upstream timeout set to 5s, but auth endpoint takes 8s on cold start"
  source: AI read proxy.config.ts
```

Verbal-only moments get SIGNAL entries:
```
SIGNAL [7] confirmation
  DEV: "yeah that approach looks right, go ahead"
  after: CHANGE [4] /src/auth.ts (token expiry)
```

**Tokens:** ~60-80/exchange. 50-exchange session: ~3.5K total.

**Gains:** Most token-efficient. Focus on unfakeable ground truth. Pivots structurally visible (REDIRECT after CHANGE). Struggles pre-computed. 40-60% fewer tokens than exchange format.
**Loses:** Conversation nuance flattened. AI reasoning/confidence lost. Verbal confirmations/commitments may be missed without SIGNAL fallback. Developer engagement signals less visible.

---

## Comparison Matrix

| | A: Minimal | B: Rich | C: Behavioral | D: Diff-Centric |
|---|---|---|---|---|
| **Tokens/exchange** | ~145 | ~375 | 45-180 | ~60-80 |
| **50-exchange session** | ~6K | ~15K | ~4.4K | ~3.5K |
| **Shows code diffs** | No | Yes | Adaptive | Yes (center) |
| **Shows tool results** | No | Windowed | Adaptive | Only if discovery |
| **Behavioral labels** | No | `⚠` flag | Full header | `REDIRECT` entries |
| **Pre-computation** | None | Minimal | Labels+density | Struggle/discovery |
| **Best for** | Baseline, cheap testing | Implementation sessions | Design/discussion | Code-heavy sessions |

## Proposed Hybrid Router

Select composition per exchange based on behavioral signals:

```
if exchange has code changes → D (diff-centric, ~60 tokens)
if exchange is passive → A (minimal, ~45 tokens)
if exchange is challenge/pivot → B subset (rich, ~180 tokens)
always → C header (behavioral labels, ~15 tokens)
```

Estimated: ~3-5K tokens per 50 exchanges with maximum signal density.
