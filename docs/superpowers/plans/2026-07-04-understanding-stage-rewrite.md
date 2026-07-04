# Understanding-Stage Rewrite Implementation Plan

> **Historical (superseded 2026-07-04):** This plan describes the implementation of the understanding-stage rewrite (completed 2026-07-04). The Gen-0 machinery it deletes (organism.ts, run-gen0.ts, chromosomes/) has been removed from the codebase. See the completed design in `docs/superpowers/specs/2026-07-04-understanding-stage-rewrite-design.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace chunk→moments→transitions→narrative→emit with a provenance-first understanding stage per `docs/superpowers/specs/2026-07-04-understanding-stage-rewrite-design.md`, judged against the captured fidelity baseline.

**Architecture:** New `src/pipeline/understand/` module: deterministic sittings → salvaged chunking → extract (Sonnet/chunk, evidence with event anchors required) → weave (Sonnet ×1, emits only decisions referencing moment ids; code joins data back) → verify (Sonnet ×1, claims vs tool events) → revised transitions/narrative (nullable rubric'd confidence, sitting-aware) → occurred-time emit. Orchestrator gains grown-log re-digestion and `--force`. Gen-0 machinery deleted at the end.

**Tech Stack:** TypeScript ESM, Vitest, Zod (via `callSonnet`/`callHaiku` in `src/llm/client.ts`), Drizzle/Postgres (docker `intent-ai-db-1`, port 5433, `DATABASE_URL=postgresql://intent:intent@localhost:5433/intent`).

## Global Constraints

- Baselines: **321 tests pass**, **exactly 16 pre-existing `npx tsc --noEmit` errors**. Break nothing; add no new tsc errors (deleting some in Task 8 is fine — record the new count).
- **The design rule (binding):** LLMs judge; code carries. No LLM step re-emits data an earlier step produced. No Zod default may fill a judgment field (confidence, agency, verification) — emitted or null.
- No classes — exported functions. All domain types in `src/adapters/types.ts`. `.js` extensions in imports.
- Keep boundary untouched: `src/adapters/claude-code.ts`, `normalize.ts`, `classify.ts`, `analyze.ts`, existing schema columns, all readers. Schema changes additive only.
- `PipelineResult` shape unchanged. `ActivityEvent` payload shape unchanged (values improve; fields don't move).
- Prompts: Sonnet (`callSonnet`) for extract/weave/verify/transitions/narrative; Haiku stays where it is today (classify, topic shifts, exchange classification).
- Commit per task with trailers:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01CT7KvNTVAGKSLmyGKVvVpM`
- `digest` stays safe to re-run: unchanged log ⇒ stored digest returned; grown log ⇒ replace; `--force` ⇒ replace.

## Canonical rubric text (used verbatim wherever a prompt asks for confidence)

```
"confidence" reflects evidential support, not enthusiasm:
- "high": a direct quote or tool result in the provided events explicitly supports the statement (a test passed, a commit was made, the developer said it)
- "medium": inferred from multiple events but never explicitly stated
- "low": plausible reading with weak or indirect support
If you cannot decide, omit the field entirely.
```

## Canonical agency rubric (extract prompt)

```
"agency" is about who set the direction, not who typed:
- "developer": the developer initiated the idea, requirement, or correction
- "ai": the AI proposed or decided and the developer at most acquiesced
- "collaborative": genuine back-and-forth shaped the result
Executing tools is NOT agency — an AI running edits toward a developer-stated goal is developer agency.
```

---

### Task 1: Domain types + deterministic sittings

**Files:**
- Modify: `src/adapters/types.ts`
- Create: `src/pipeline/understand/sittings.ts`
- Test: `tests/pipeline/understand/sittings.test.ts`

**Interfaces (later tasks import these exact names):**

```typescript
// src/adapters/types.ts — additions
export interface Sitting {
  sittingIndex: number;          // 0-based
  startedAt: string;             // ISO, first event's timestamp
  endedAt: string;               // ISO, last event's timestamp
  eventRange: [number, number];  // causalOrder span, inclusive
}

export interface EvidenceAnchor {
  quote: string;
  eventIndex: number | null;     // causalOrder cited by the LLM (null if unparseable)
  anchored: boolean;             // code-verified: index in chunk range AND quote found in that event
  sourceType: "user" | "ai" | "tool_output";
}

export interface ExtractedMoment {
  id: string;                    // deterministic: `c${chunkIndex}-m${i}`, assigned in code
  chunkIndex: number;
  type: SessionMoment["type"];
  statement: string;
  significance: string;
  agency: "developer" | "ai" | "collaborative";
  confidence: "high" | "medium" | "low" | null;
  topicFingerprint: string;
  evidence: EvidenceAnchor[];    // ≥1, schema-enforced at the LLM boundary
  occurredAt: string | null;     // ISO; first anchored evidence's event timestamp, else chunk start
}

// SessionMoment — add two optional fields (do not touch existing ones):
//   occurredAt?: string | null;
//   verification?: "supported" | "contradicted" | "unverified" | null;
```

```typescript
// src/pipeline/understand/sittings.ts
export const SITTING_GAP_MS = 30 * 60 * 1000;
export function detectSittings(events: NormalizedDevEvent[]): Sitting[];
```

Behavior: sort-stable walk over events in causalOrder; a gap of `>= SITTING_GAP_MS` between consecutive event timestamps closes a sitting and opens the next. Empty input → `[]`. Events with missing/unparseable timestamps inherit the previous event's timestamp for gap purposes (never crash).

- [ ] **Step 1: Write failing tests**

```typescript
// tests/pipeline/understand/sittings.test.ts
import { describe, it, expect } from "vitest";
import { detectSittings, SITTING_GAP_MS } from "../../../src/pipeline/understand/sittings.js";
import type { NormalizedDevEvent } from "../../../src/adapters/types.js";

const ev = (causalOrder: number, iso: string): NormalizedDevEvent => ({
  id: `s-${causalOrder}`, sessionId: "s", timestamp: iso, causalOrder,
  category: "intent", actor: "user",
  content: { summary: "x", detail: "x" }, rawEventId: `r${causalOrder}`, turnId: `t${causalOrder}`,
} as NormalizedDevEvent);

describe("detectSittings", () => {
  it("one sitting when gaps stay under the threshold", () => {
    const out = detectSittings([ev(0, "2026-06-19T10:00:00Z"), ev(1, "2026-06-19T10:20:00Z")]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      sittingIndex: 0, startedAt: "2026-06-19T10:00:00Z", endedAt: "2026-06-19T10:20:00Z", eventRange: [0, 1],
    });
  });
  it("splits on a multi-day gap (the b9ab1a0c shape)", () => {
    const out = detectSittings([
      ev(0, "2026-06-19T11:00:00Z"), ev(1, "2026-06-19T11:24:00Z"),
      ev(2, "2026-06-21T20:08:00Z"), ev(3, "2026-06-21T20:30:00Z"),
      ev(4, "2026-06-22T16:00:00Z"),
    ]);
    expect(out.map((s) => s.eventRange)).toEqual([[0, 1], [2, 3], [4, 4]]);
    expect(out[1].sittingIndex).toBe(1);
  });
  it("a gap of exactly the threshold splits", () => {
    const t0 = Date.parse("2026-06-19T10:00:00Z");
    const out = detectSittings([ev(0, new Date(t0).toISOString()), ev(1, new Date(t0 + SITTING_GAP_MS).toISOString())]);
    expect(out).toHaveLength(2);
  });
  it("empty input → empty output", () => {
    expect(detectSittings([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run tests/pipeline/understand/sittings.test.ts` (module not found).
- [ ] **Step 3: Implement** types + `detectSittings`.
- [ ] **Step 4: Full suite + tsc** — 321+ green, ≤16 errors.
- [ ] **Step 5: Commit** — `feat(understand): Sitting/ExtractedMoment domain types + deterministic sitting detection`

---

### Task 2: Additive schema migration + storage write/read

**Files:**
- Modify: `src/storage/schema.ts` (moments: `occurredAt: timestamp("occurred_at", { withTimezone: true })`, `verification: text("verification")`; new `sittings` table per design doc)
- Create: migration via `npx drizzle-kit generate` (never hand-edit `drizzle/meta`); apply with `npx tsx src/cli/index.ts up`
- Modify: `src/storage/queries.ts` — `storeSessionDigest` gains `sittings: Sitting[]` in its input and: (a) inserts sittings rows; (b) inserts `occurred_at`/`verification` on moments; (c) builds `causalOrder → normalized_event uuid` map during the normalized_events insert loop and stores `source_event_id` for each evidence row whose `EvidenceAnchor.anchored === true` (moment evidence arrives as `EvidenceAnchor[]` on `SessionMoment.evidence` — see Task 4's join). `getSessionMoments` returns the two new fields.
- Modify: `run-fidelity.ts` — remove the `NULL as occurred_at` workaround; select the real column.
- Test: `tests/storage/store-digest.test.ts` (new — unit-test the pure helper below; DB writes are verified in Task 9's live run)

**Interfaces:**
- Produces: pure helper `export function resolveEvidenceSourceIds(evidence: EvidenceAnchor[], idByCausalOrder: Map<number, string>): (string | null)[]` in `src/storage/queries.ts` (exported for tests): anchored evidence with a mapped index → uuid; everything else → null.

- [ ] **Step 1: Failing test**

```typescript
// tests/storage/store-digest.test.ts
import { describe, it, expect } from "vitest";
import { resolveEvidenceSourceIds } from "../../src/storage/queries.js";

describe("resolveEvidenceSourceIds", () => {
  const map = new Map([[7, "uuid-7"], [9, "uuid-9"]]);
  it("maps anchored evidence to the event uuid", () => {
    expect(resolveEvidenceSourceIds(
      [{ quote: "q", eventIndex: 7, anchored: true, sourceType: "user" }], map,
    )).toEqual(["uuid-7"]);
  });
  it("unanchored or unmapped evidence stays null", () => {
    expect(resolveEvidenceSourceIds(
      [
        { quote: "q", eventIndex: 7, anchored: false, sourceType: "ai" },
        { quote: "q", eventIndex: 99, anchored: true, sourceType: "ai" },
        { quote: "q", eventIndex: null, anchored: false, sourceType: "ai" },
      ], map,
    )).toEqual([null, null, null]);
  });
});
```

- [ ] **Step 2: Verify fail.** **Step 3: Implement** schema + migration (verify: `docker exec intent-ai-db-1 psql -U intent -d intent -c "\d moments" | grep -E "occurred_at|verification"` and `\d sittings`) + storage wiring + read-side + run-fidelity column.
  Note: `SessionMoment.evidence` items will carry the anchor fields from Task 4 onward; type the storage layer against `EvidenceAnchor` now. Existing rows keep null occurred_at/verification — readers must tolerate null (they already read nullable columns).
- [ ] **Step 4: Full suite + tsc; run `npx tsx run-fidelity.ts`** — must still complete (occurredSpan reads real column; still "none" until re-digest).
- [ ] **Step 5: Commit** — `feat(storage): additive provenance columns (occurred_at, verification), sittings table, real source_event_id resolution`

---

### Task 3: Chunk render + extract (per-chunk moment extraction with required anchors)

**Files:**
- Create: `src/llm/prompts/understand/extract.ts` (prompt builder + Zod)
- Create: `src/pipeline/understand/extract.ts` (render, LLM call, anchor validation, id assignment)
- Test: `tests/pipeline/understand/extract.test.ts` (pure parts: render + validation; no live LLM)

**Interfaces:**

```typescript
// src/llm/prompts/understand/extract.ts
export const ExtractEvidenceSchema = z.object({
  quote: z.string().min(1),
  eventIndex: z.union([z.number(), z.string().transform((s) => { const n = parseInt(s, 10); return Number.isNaN(n) ? null : n; })]).nullable(),
  sourceType: z.enum(["user", "ai", "tool_output"]).optional().default("ai"),
});
export const ExtractMomentSchema = z.object({
  type: z.enum(["proposal","discovery","pivot","confirmation","rejection","commitment","struggle","breakthrough","execution"]),
  statement: z.string().min(1),
  significance: z.string().optional().default(""),
  agency: z.enum(["developer", "ai", "collaborative"]),
  confidence: z.enum(["high", "medium", "low"]).nullable().optional().transform((v) => v ?? null),
  topicFingerprint: z.string().optional().default("general"),
  evidence: z.array(ExtractEvidenceSchema).min(1),   // REQUIRED — no default, no fabrication
});
export const ExtractOutputSchema = z.object({ moments: z.array(ExtractMomentSchema) });
export function buildExtractPrompt(input: { chunk: SessionChunk; sessionShape: string; directives?: PipelineDirectives; digestHeader?: string }): { system: string; user: string };
```

```typescript
// src/pipeline/understand/extract.ts
export function renderChunkEvents(events: NormalizedDevEvent[]): string;
export function validateAnchors(moments: z.infer<typeof ExtractOutputSchema>["moments"], chunk: SessionChunk): ExtractedMoment[];
export async function extractChunk(chunk: SessionChunk, sessionShape: string, directives?: PipelineDirectives, digestHeader?: string): Promise<ExtractedMoment[]>;
```

**Prompt content requirements (system):** carry over from the salvaged inventory — the 9-type taxonomy definitions and the 6 rules from `src/llm/prompts/moments.ts:113-136` (specific-not-generic, developer's own language, evidence mandatory, agency, topicFingerprint, fewer-is-better) and `getShapeGuidance` (move that function into the new prompt file). ADD, verbatim: the canonical confidence rubric; the canonical agency rubric; and these two new rules:
```
7. **Opening intent is a moment.** If this is chunk 0, the developer's first substantive message states what they came to do — extract it (usually "commitment" or "proposal", agency "developer").
8. **Cite the event index.** Every evidence item includes "eventIndex": the [N] number shown on the event you are quoting. Quotes must come from the events shown — never from memory.
```
Output-format JSON block mirrors `ExtractMomentSchema` exactly (with `"eventIndex": 12`).

**renderChunkEvents:** every event on one block prefixed `[<causalOrder>]`, then per category — `intent`/`proposal`/`reflection`: `DEV:`/`AI:` + full `content.detail`; `action`: `AI/ACTION(<files or summary>)` + first 200 chars of detail; `result`: include ONLY if `content.detail` contains error markers (`error`, `Error`, `FAIL`, `ERR!`) → `RESULT(error):` + first 300 chars — otherwise a single line `RESULT: <summary first 120 chars>`. This makes tool activity visible (design F4/F5) without flooding tokens.

**validateAnchors:** for each parsed moment `i` in chunk `c`: id = `c${c.chunkIndex}-m${i}`; for each evidence item: anchored = `eventIndex` is a number AND within `chunk.eventRange` (or overlap events' causalOrders present in `chunk.events`) AND normalized-quote ⊆ normalized text of THAT event (`content.detail + " " + content.summary`, lowercase, `\s+`→" "). If the quote is not in the cited event but IS found in exactly one other event in the chunk, re-anchor to that event (fix the index, anchored = true). Else anchored = false, keep the evidence visibly unanchored. `occurredAt` = timestamp of the first anchored evidence's event, else `chunk.events[0]?.timestamp ?? null`. Never drop a moment here; visibility over deletion.

- [ ] **Step 1: Failing tests** — cover: render shows `[N]` prefixes, action lines, error results included, ok-results summarized; validateAnchors: valid anchor accepted; wrong index but quote found elsewhere → re-anchored; quote nowhere → anchored:false; occurredAt from first anchored evidence; ids deterministic. Build chunk fixtures inline (same `ev()` helper style as Task 1 plus `category`/`detail` variation). Write ~8 focused `it()` blocks with exact expectations (e.g. `expect(out[0].evidence[0]).toEqual({ quote: "use postgres", eventIndex: 7, anchored: true, sourceType: "user" })`).
- [ ] **Step 2: Verify fail.** **Step 3: Implement** (`extractChunk` = buildExtractPrompt → `callSonnet(system, user, ExtractOutputSchema)` → `validateAnchors`).
- [ ] **Step 4: Full suite + tsc.** **Step 5: Commit** — `feat(understand): extract stage — per-chunk moments with schema-required, code-validated event anchors`

---

### Task 4: Weave (decisions only) + deterministic join

**Files:**
- Create: `src/llm/prompts/understand/weave.ts`
- Create: `src/pipeline/understand/weave.ts`
- Test: `tests/pipeline/understand/weave.test.ts`

**Interfaces:**

```typescript
// src/llm/prompts/understand/weave.ts
export const WeaveDecisionSchema = z.object({
  action: z.enum(["keep", "merge", "drop"]),
  momentIds: z.array(z.string()).min(1),         // extract ids; merge lists ≥2, primary first
  arcId: z.string().optional().default("general"),
  arcRole: z.enum(["origin", "development", "turning_point", "resolution"]).optional().default("development"),
  relatedTo: z.array(z.string()).optional().default([]),
  statement: z.string().optional(),               // merge only: the combined statement (new judgment, allowed)
  reason: z.string().optional(),                  // drop only
});
export const WeaveOutputSchema = z.object({ decisions: z.array(WeaveDecisionSchema) });
export function buildWeavePrompt(input: { moments: ExtractedMoment[]; sessionShape: string; sittings: Sitting[] }): { system: string; user: string };
```

```typescript
// src/pipeline/understand/weave.ts
export function applyWeaveDecisions(decisions: z.infer<typeof WeaveOutputSchema>["decisions"], extracted: ExtractedMoment[], chunks: SessionChunk[]): SessionMoment[];
export async function weaveMoments(extracted: ExtractedMoment[], chunks: SessionChunk[], sessionShape: string, sittings: Sitting[]): Promise<SessionMoment[]>;
```

**Prompt (system) requirements:** the model receives the extracted moments (id, type, statement, agency, confidence, topic, first evidence quote ≤120 chars, chunkIndex, occurredAt) and sitting boundaries; its job is ONLY: dedup/merge across chunk overlaps, drop low-quality moments (vague statement AND zero anchored evidence), assign arcs + roles, link related moments. Explicit constraints, verbatim in the prompt:
```
- You output DECISIONS about the listed moment ids. You never rewrite statements except when merging (then "statement" combines the merged moments in the developer's language).
- Every input id appears in exactly one decision.
- Never invent ids. Never re-emit evidence — it is carried automatically.
```

**applyWeaveDecisions (pure):**
- keep → `SessionMoment` from the extract moment: `chunkId = chunks.find(c => c.chunkIndex === m.chunkIndex)!.id`, evidence carried as-is (`EvidenceAnchor[]`), `occurredAt` carried, `verification: null`, arc fields from the decision, `relatedMomentIds` = decision.relatedTo mapped to final SessionMoment ids (two-pass: build all, then resolve).
- merge → primary = first id; statement = decision.statement ?? primary.statement; evidence = union in id order; occurredAt = earliest non-null; type/agency/confidence/topic from primary; chunkId from primary.
- drop → excluded.
- Safety nets (code, not prompt): ids present in input but missing from all decisions → implicit keep (arc "general"); decisions naming unknown ids → ignored with a `process.stderr` warning; a merge with 1 id → treated as keep.
- Before the LLM call, run the salvaged `dedupMoments` (`src/pipeline/dedup-moments.ts`) over extracted moments (it keys on evidence event ids — adapt its input mapping to `EvidenceAnchor.eventIndex`); removed duplicates never reach the prompt.

- [ ] **Step 1: Failing tests** (pure `applyWeaveDecisions`): keep preserves evidence verbatim + real chunkId; merge unions evidence and uses decision.statement; drop removes; missing id → implicit keep; unknown id ignored; relatedTo resolves to final ids. ~7 `it()` blocks, exact `toEqual` on evidence arrays and chunkIds (fixtures: 2 chunks, 3 extracted moments).
- [ ] **Step 2: Verify fail.** **Step 3: Implement.** **Step 4: Full suite + tsc.**
- [ ] **Step 5: Commit** — `feat(understand): weave stage — LLM emits decisions, code carries the data`

---

### Task 5: Verify (claims vs tool events)

**Files:**
- Create: `src/llm/prompts/understand/verify.ts`
- Create: `src/pipeline/understand/verify.ts`
- Test: `tests/pipeline/understand/verify.test.ts`

**Interfaces:**

```typescript
// src/llm/prompts/understand/verify.ts
export const VerifyVerdictSchema = z.object({
  momentId: z.string(),
  verdict: z.enum(["supported", "contradicted", "unverified"]),
  note: z.string().optional().default(""),
});
export const VerifyOutputSchema = z.object({ verdicts: z.array(VerifyVerdictSchema) });
export function buildVerifyPrompt(input: { claims: { momentId: string; statement: string; type: string }[]; windows: Map<string, string> }): { system: string; user: string };
```

```typescript
// src/pipeline/understand/verify.ts
export function selectClaims(moments: SessionMoment[]): SessionMoment[];       // type ∈ {confirmation, breakthrough, execution}
export function buildClaimWindow(moment: SessionMoment, chunks: SessionChunk[]): string; // action+result events (ALL results incl. success) of the moment's chunk, rendered with [N] prefixes, ≤4000 chars
export function applyVerdicts(moments: SessionMoment[], verdicts: { momentId: string; verdict: "supported"|"contradicted"|"unverified" }[]): SessionMoment[];
export async function verifyMoments(moments: SessionMoment[], chunks: SessionChunk[]): Promise<SessionMoment[]>;
```

**Prompt (system), verbatim core:**
```
You are auditing claims from a coding-session digest against what the tools actually did.
For each claim you get the tool activity (commands, edits, results) from the same part of the session.
- "supported": tool events directly show the claimed thing happened (the test run passed, the commit exists, the command succeeded)
- "contradicted": tool events show the opposite (the test still failed after the claimed fix, the command errored)
- "unverified": the window contains no tool evidence either way
Judge ONLY from the provided events. An assistant SAYING it did something is not tool evidence.
```

**applyVerdicts (pure, code-enforced calibration):** sets `verification`; if verdict = contradicted → `confidence = "low"` (overriding anything higher); if verdict = supported and confidence is null → leave null (verification field itself carries the signal). Moments not selected as claims keep `verification: null` → set to `"unverified"`? No — non-claims keep `null` (never sent to the verifier); only sent-but-inconclusive claims get `"unverified"`. One LLM call for all claims (`callSonnet`); on LLM failure, return moments unchanged (fail-open, log to stderr).

- [ ] **Step 1: Failing tests** (pure parts): selectClaims picks exactly the 3 types; buildClaimWindow includes action + result events (success results too) and respects the 4000-char cap; applyVerdicts sets verification and demotes contradicted claims to low; unknown momentId in verdicts ignored; non-claim moments stay `verification: null`. ~6 `it()` blocks.
- [ ] **Step 2: Verify fail.** **Step 3: Implement.** **Step 4: Full suite + tsc.**
- [ ] **Step 5: Commit** — `feat(understand): verification stage — outcome claims checked against tool events (audit F4)`

---

### Task 6: Transitions + narrative revisions

**Files:**
- Modify: `src/llm/prompts/transitions.ts` — confidence: `z.enum(["high","medium","low"]).nullable().optional().transform((v) => v ?? null)` on BOTH schemas; system prompt gains the canonical confidence rubric and an explicit output-shape JSON block including `"confidence"`; the moments listed in the user prompt now show `verification` when non-null.
- Modify: `src/llm/prompts/narrative.ts` + `src/pipeline/narrative.ts` — `generateNarrative` gains a `sittings: Sitting[]` parameter; the user prompt lists sittings (`Sitting 2: 2026-06-21 20:08 → 20:30 (events 120–180), after a 2.3-day gap`) and each moment's `occurredAt`; the system prompt gains, verbatim:
```
This session happened in the sittings listed above. Progression entries must respect sitting boundaries — never narrate work from different sittings as one continuous flow; name the break ("after a two-day gap, ...").
```
- Modify: `src/adapters/types.ts` — `IntentTransition.confidence` and `AcceptedOutcome.confidence` become `"high" | "medium" | "low" | null`.
- Test: `tests/llm/transitions-confidence.test.ts` (new); existing narrative/transitions tests updated for the new signature.

- [ ] **Step 1: Failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { TransitionsOutputSchema } from "../../src/llm/prompts/transitions.js";

describe("transition/outcome confidence honesty", () => {
  it("omitted confidence is null, never a default", () => {
    const out = TransitionsOutputSchema.parse({
      transitions: [{ fromStatement: "a", toStatement: "b", reason: "r" }],
      outcomes: [{ statement: "done" }],
    });
    expect(out.transitions[0].confidence).toBeNull();
    expect(out.outcomes[0].confidence).toBeNull();
  });
  it("emitted confidence passes through", () => {
    const out = TransitionsOutputSchema.parse({ transitions: [], outcomes: [{ statement: "d", confidence: "low" }] });
    expect(out.outcomes[0].confidence).toBe("low");
  });
});
```

- [ ] **Step 2: Verify fail** (today both return `"medium"`). **Step 3: Implement**, chasing types through `src/pipeline/transitions.ts`, `emit-events.ts`, storage (columns already nullable). **Step 4: Full suite + tsc ≤16.**
- [ ] **Step 5: Commit** — `feat(understand): rubric'd nullable confidence for transitions/outcomes; sitting-aware narrative`

---

### Task 7: Stage orchestration + grown-log re-digestion + occurred-time emit

**Files:**
- Create: `src/pipeline/understand/index.ts`
- Modify: `src/pipeline/orchestrator.ts`
- Modify: `src/storage/queries.ts` (add `getSessionEndedAt(sessionId): Promise<Date | null>`, `deleteSessionDigest(sessionId): Promise<void>`)
- Modify: `src/pipeline/emit-events.ts`
- Modify: `src/cli/index.ts` (digest `--force`)
- Test: extend `tests/pipeline/orchestrator.test.ts` + `tests/pipeline/emit-events.test.ts` (create if absent)

**Interfaces:**

```typescript
// src/pipeline/understand/index.ts
export interface UnderstandResult {
  sittings: Sitting[];
  chunks: SessionChunk[];
  moments: SessionMoment[];
  transitions: IntentTransition[];
  outcomes: AcceptedOutcome[];
  narrative: SessionNarrative;
}
export async function understand(normalizedEvents: NormalizedDevEvent[], sessionId: string, sessionShape: SessionShape, directives: PipelineDirectives, topicShiftIds: Set<string>): Promise<UnderstandResult>;
```

`understand()` sequence: `detectSittings` → `chunkSession(events, sessionId, topicShiftIds, { hardBreaks: sittingBoundaryCausalOrders })` (add an optional 4th options param to `chunkSession` — a sitting boundary always starts a new chunk; default behavior unchanged when omitted) → `extractChunk` per chunk in parallel (reuse the existing session-digest header via `buildSessionDigest`) → `weaveMoments` → `verifyMoments` → `detectTransitionsAndOutcomes` → `generateNarrative(..., sittings)`.

Orchestrator: `runPipeline(logPath, opts?: { force?: boolean })`. Parse FIRST, then on the already-digested path:

```typescript
const existingId = await findDigestedSession(ccSessionId);
if (existingId) {
  const storedEndedAt = await getSessionEndedAt(existingId);
  const maxTs = latestTimestamp(rawEvents);
  const grown = storedEndedAt != null && maxTs != null && maxTs.getTime() > storedEndedAt.getTime() + 60_000;
  if (!grown && !opts?.force) { /* return stored digest as today */ }
  else { log(reason); await deleteSessionDigest(existingId); /* fall through to full pipeline */ }
}
```

`deleteSessionDigest`: delete `activity_events WHERE session_id`, `feature_sessions WHERE session_id` (FK lacks cascade), then `sessions WHERE id` (cascades the rest). The moment-detection call becomes `understand(...)`; `storeSessionDigest` receives `sittings`. `buildSessionEvents` input gains `sessionEndedAt?: Date | null`; moment events stamp `occurredAt` when present, narrative/transition/outcome events stamp `sessionEndedAt`, fallback `new Date()`.

- [ ] **Step 1: Failing tests** — mirror the existing idempotency test's mock setup (`tests/pipeline/orchestrator.test.ts:293`) for: grown log → deleteSessionDigest called + full pipeline runs; unchanged log → stored digest returned, no delete; `{force:true}` → delete + full pipeline. Emit tests: moment event timestamp = occurredAt; narrative event = sessionEndedAt; both fall back to now.
- [ ] **Step 2: Verify fail.** **Step 3: Implement** (update orchestrator mocks: it now mocks `understand` instead of `detectMomentsWithOrganism`). **Step 4: Full suite + tsc.**
- [ ] **Step 5: Commit** — `feat(understand): wire the new stage into the orchestrator; re-digest grown logs; digest --force; occurred-time emit`

---

### Task 8: Delete the replaced machinery + docs truth pass

**Files:**
- Delete: `src/eval/organism.ts`, `src/eval/runner.ts`, `src/eval/fitness.ts`, `src/eval/judge.ts`, `src/eval/chromosomes/` (entire dir), `src/pipeline/default-organism.ts`, `src/pipeline/moments.ts`, `src/llm/prompts/moments.ts`, `run-gen0.ts`, `run-crossover.ts`, `run-learn.ts`, `run-phase1.ts`, `tests/eval/session-criteria.ts`, `tests/pipeline/moments.test.ts`, plus `src/eval/langsmith-experiment.ts` and `src/eval/langsmith-setup.ts` IF `grep -rln "langsmith-experiment\|langsmith-setup" src/ tests/ *.ts` shows no surviving importer.
- First verify each deletion target has no surviving importer: `grep -rln "<module>" src/ tests/ *.ts` — anything still importing (e.g. `getShapeGuidance` or `buildPass2Prompt` remnants, `classify-exchanges` users) must have been migrated in Tasks 3–7; if not, STOP and report BLOCKED rather than leaving a broken tree.
- Keep: `tests/eval/fixtures/` (raw transcripts), `tests/eval/threading-criteria.ts` (used by `tests/pipeline/threading.test.ts`), `src/eval/mvp-*.ts`, `src/eval/transcript-metrics.ts`, `src/eval/fidelity.ts`, `run-mvp-eval.ts`, `run-fidelity.ts`, `src/pipeline/{chunk,dedup-moments,session-digest,classify-exchanges,analyze,classify,normalize}.ts`.
- Modify: `CLAUDE.md` — pipeline diagram: replace the moments-p1/p2 row with `sittings → chunks → extract → weave → verify` (models: Sonnet ×N extract, Sonnet ×1 each weave/verify/transitions/narrative); Commands: drop `run-gen0.ts`, add `npx tsx run-fidelity.ts`; Eval Workflow: baseline command becomes run-fidelity; Source Layout `src/eval/` line → "Fidelity eval + measurement-v2 (mvp) harness"; add `src/pipeline/understand/` line.
- Modify: `docs/superpowers/specs/2026-07-04-understanding-stage-rewrite-design.md` — status line → implemented.

- [ ] **Step 1: Delete with importer verification** (grep before each rm). **Step 2: Full suite + tsc** — record the new test and tsc-error counts in the commit body (deletions remove old tests; every surviving test green; tsc must not EXCEED 16). **Step 3: Docs updates.** **Step 4: Commit** — `refactor!: delete Gen-0/organism machinery replaced by the understanding stage`

---

### Task 9: EDD close-the-loop — live re-digest + fidelity delta

Requires `ANTHROPIC_API_KEY` (in `.env`) and Postgres up. Real LLM cost: ~35–50 Sonnet calls total.

**Files:**
- Create: `docs/audits/fidelity-after-rewrite-2026-07-04.md`
- Modify: `docs/audits/2026-07-04-digest-fidelity-report.md` (append "Post-rewrite results" section)

- [ ] **Step 1:** `npx tsx src/cli/index.ts digest /Users/giladkoch/.claude/projects/-Users-giladkoch-dev-intent-ai/20f5efec-83cc-4a16-ac34-86728b07ccbf.jsonl` — expect the grown-log path to fire and the new digest to span to ~23:14.
- [ ] **Step 2:** `npx tsx src/cli/index.ts digest --force <d73d5190 path>` and `--force <5b31a1bb path>` (control sessions: unchanged logs, provenance fixes exercised).
- [ ] **Step 3:** `npx tsx run-fidelity.ts | tee /tmp/fidelity-after.txt` — compare with `docs/audits/fidelity-baseline-2026-07-04.md` against the design doc's acceptance list (evidenceReal ≥80%, anchored ≥60% target/>0% floor, chunk spread ok, occurredSpan non-null, calibration informative or honestly null, 20f5efec tail covered + tail recall items matched, no recall/precision/agency regression, no new violations).
- [ ] **Step 4:** Any acceptance check that fails → diagnose from the stored digest (not vibes), apply ONE bounded fix (prompt wording or validation code), re-run the affected `--force` digest, re-run fidelity. Max two iterations; anything still failing is documented honestly in the results doc as open work.
- [ ] **Step 5:** Write the results doc (baseline vs after table + verdict per acceptance item + cost actually incurred), append summary to the audit report, full suite one last time, commit — `docs(audit): post-rewrite fidelity results vs pre-registered baseline`

---

## Self-Review Notes

- Coverage vs design doc: F1→T7, F2.1–F2.3→T3/T4, F2.4→T2/T3/T7, F3→T3/T5/T6, F4→T3(render)/T5, F5→T3(rubric), F6→T3(rule 7), F7→T1/T6/T7, harness retirement→T8, acceptance→T9. Deferred list untouched (by design).
- Type consistency: `ExtractedMoment.evidence: EvidenceAnchor[]` flows into `SessionMoment.evidence` (Task 4 join) and storage (Task 2's `resolveEvidenceSourceIds`); `occurredAt` is ISO string in domain types, Date only at DB/emit boundaries; `understand()` consumes the same `topicShiftIds` the orchestrator already computes.
- Order matters: T2 ships the schema before T7 stores sittings; T3–T5 are pure/prompt work testable without DB; T8 deletes only after T7 rewires the orchestrator.
