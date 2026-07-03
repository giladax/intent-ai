# Digest Fidelity: Eval + Provenance Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make digest fidelity measurable (fidelity eval + baseline), fix the deterministic provenance bugs the 2026-07-04 audit found, and retire the Gen-0 eval machinery — per `docs/audits/2026-07-04-digest-fidelity-report.md`.

**Architecture:** A new deterministic fidelity eval (`src/eval/fidelity.ts` + `run-fidelity.ts`) scores stored digests against DB-level provenance checks and catalog-derived criteria — run it BEFORE and AFTER each fix (EDD). The fixes are: preserve evidence/chunk provenance through moment pass 2, anchor evidence quotes to events at store time, stamp occurred-time, re-digest grown logs, stop fabricating confidence defaults. Finally the winning organism is inlined into the pipeline and the chromosome/Gen-0 machinery deleted.

**Tech Stack:** TypeScript ESM, Vitest, Zod, Drizzle/Postgres (port 5433, docker container `intent-ai-db-1`, `DATABASE_URL=postgresql://intent:intent@localhost:5433/intent`).

## Global Constraints

- Baselines to hold: **311 tests pass**, **exactly 16 pre-existing `npx tsc --noEmit` errors** (do not add new ones; fixing some is fine).
- No classes — exported functions only. All domain types in `src/adapters/types.ts`.
- Lenient Zod on LLM output — but per project feedback memory: required structure goes in the **schema**, not prompt wording. A schema default must never fabricate a *judgment* (confidence, agency).
- `.js` extensions in all imports (ESM).
- `digest` must stay safe to re-run (idempotent for unchanged logs).
- LLM cost discipline: no new per-chunk LLM calls. All fixes here are deterministic except prompt-text edits.
- Commit after each task (`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer, plus session link trailer as configured).

## Context you need (read once)

- The audit report: `docs/audits/2026-07-04-digest-fidelity-report.md`. Failure classes F1–F8 referenced below.
- Production moment detection: `src/pipeline/orchestrator.ts:133` → `detectMomentsWithOrganism` (`src/eval/organism.ts`) with `DEFAULT_ORGANISM` (`src/pipeline/default-organism.ts`). Pass 2 prompt/schemas live in `src/llm/prompts/moments.ts`. A parallel non-production path `src/pipeline/moments.ts:detectMoments` shares `buildPass2Prompt`/`Pass2OutputSchema` — it must keep compiling and its tests passing.
- Storage: `src/storage/queries.ts:storeSessionDigest` (raw SQL via `getClient()`), schema in `src/storage/schema.ts`, migrations via `drizzle-kit` (`drizzle.config.ts`, `drizzle/` with `0000_baseline.sql`).
- DB state that motivates everything: 101/102 moment_evidence rows = `'no evidence provided'`; 102/102 `source_event_id` NULL; all moments on chunk_index 0; transitions/outcomes confidence all `'medium'` (schema default).

---

### Task 1: Fidelity scoring core (pure functions)

**Files:**
- Create: `src/eval/fidelity.ts`
- Test: `tests/eval/fidelity.test.ts`

**Interfaces:**
- Produces (Task 2 and Task 9 rely on these exact names):

```typescript
export interface MomentFidelityRow {
  statement: string;
  type: string;
  agency: string | null;
  confidence: string | null;
  chunkIndex: number | null;
  occurredAt: Date | null;
  evidenceQuotes: string[];
  anchoredEvidenceCount: number; // evidence rows with non-null source_event_id
}

export interface ProvenanceScore {
  momentCount: number;
  evidenceRealPct: number;      // % of moments with ≥1 quote that is not the fabricated default
  evidenceAnchoredPct: number;  // % of moments with ≥1 anchored evidence row
  distinctChunks: number;
  chunkSpreadOk: boolean;       // distinctChunks > 1 when momentCount > 3
  occurredTimeSpanMs: number | null; // max-min occurredAt, null if none stamped
}

export interface CalibrationScore {
  distribution: Record<string, number>; // confidence value -> count (null keyed as "null")
  dominantShare: number;                // share of most common value, 0..1
  informative: boolean;                 // >1 distinct value AND dominantShare < 0.9
}

export interface TailScore {
  digestEndedAt: Date | null;
  rawLastEventAt: Date | null;
  lostMs: number;               // max(0, rawLastEventAt - digestEndedAt)
  covered: boolean;             // lostMs <= 60_000
}

export function scoreProvenance(moments: MomentFidelityRow[]): ProvenanceScore;
export function scoreCalibration(values: (string | null)[]): CalibrationScore;
export function scoreTail(digestEndedAt: Date | null, rawLastEventAt: Date | null): TailScore;

export interface ExpectedMoment { desc: string; keywords: string[]; agency?: "developer" | "ai" | "collaborative" }
export interface ForbiddenClaim { desc: string; keywords: string[] }
export interface RecallResult { expected: number; matched: number; missed: string[] }
export interface PrecisionResult { violations: string[] } // descs of forbidden claims that matched
export interface AgencyResult { checked: number; correct: number; wrong: string[] }

// A moment/statement "matches" when EVERY keyword appears case-insensitively in it.
// Recall searches moment statements AND narrative text (summary + progression + discoveries joined).
export function scoreRecall(expected: ExpectedMoment[], momentStatements: string[], narrativeText: string): RecallResult;
export function scorePrecision(forbidden: ForbiddenClaim[], momentStatements: string[], narrativeText: string): PrecisionResult;
export function scoreAgency(expected: ExpectedMoment[], moments: MomentFidelityRow[]): AgencyResult;
// scoreAgency: for each expected item that has an `agency` AND matches ≥1 moment statement,
// check the first matching moment's agency equals expected. wrong[] gets "desc: got X, want Y".
```

The fabricated default string is exactly `"no evidence provided"` — a quote counts as real when it is not that string and `quote.trim().length >= 10`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/eval/fidelity.test.ts
import { describe, it, expect } from "vitest";
import {
  scoreProvenance, scoreCalibration, scoreTail,
  scoreRecall, scorePrecision, scoreAgency,
  type MomentFidelityRow,
} from "../../src/eval/fidelity.js";

const row = (over: Partial<MomentFidelityRow>): MomentFidelityRow => ({
  statement: "developer chose postgres",
  type: "commitment",
  agency: "developer",
  confidence: "high",
  chunkIndex: 0,
  occurredAt: null,
  evidenceQuotes: ["let's use postgres over sqlite"],
  anchoredEvidenceCount: 0,
  ...over,
});

describe("scoreProvenance", () => {
  it("counts fabricated default evidence as not real", () => {
    const s = scoreProvenance([
      row({ evidenceQuotes: ["no evidence provided"] }),
      row({ evidenceQuotes: ["a real verbatim quote from the session"] }),
    ]);
    expect(s.evidenceRealPct).toBe(50);
  });
  it("flags degenerate chunk spread (all moments on one chunk)", () => {
    const s = scoreProvenance([0, 0, 0, 0].map((c) => row({ chunkIndex: c })));
    expect(s.distinctChunks).toBe(1);
    expect(s.chunkSpreadOk).toBe(false);
  });
  it("accepts spread chunks and computes occurred-time span", () => {
    const s = scoreProvenance([
      row({ chunkIndex: 0, occurredAt: new Date("2026-07-03T10:00:00Z") }),
      row({ chunkIndex: 3, occurredAt: new Date("2026-07-03T12:00:00Z") }),
      row({ chunkIndex: 5, occurredAt: new Date("2026-07-03T11:00:00Z") }),
      row({ chunkIndex: 1, occurredAt: null }),
    ]);
    expect(s.chunkSpreadOk).toBe(true);
    expect(s.occurredTimeSpanMs).toBe(2 * 3600 * 1000);
  });
});

describe("scoreCalibration", () => {
  it("uniform values are uninformative", () => {
    const s = scoreCalibration(["high", "high", "high"]);
    expect(s.informative).toBe(false);
    expect(s.dominantShare).toBe(1);
  });
  it("nulls are counted under 'null'", () => {
    const s = scoreCalibration(["high", null, "medium"]);
    expect(s.distribution["null"]).toBe(1);
    expect(s.informative).toBe(true);
  });
});

describe("scoreTail", () => {
  it("flags a lost tail beyond 60s", () => {
    const s = scoreTail(new Date("2026-07-03T15:33:30Z"), new Date("2026-07-03T23:14:19Z"));
    expect(s.covered).toBe(false);
    expect(s.lostMs).toBeGreaterThan(7 * 3600 * 1000);
  });
  it("covers when digest end >= raw end", () => {
    expect(scoreTail(new Date("2026-07-03T12:00:00Z"), new Date("2026-07-03T12:00:30Z")).covered).toBe(true);
  });
});

describe("recall/precision/agency", () => {
  const moments = ["Developer committed to journal-as-product; trees rejected"];
  const narrative = "The session pivoted: the river is primary.";
  it("recall matches when all keywords present in a statement", () => {
    const r = scoreRecall(
      [
        { desc: "journal pivot", keywords: ["journal", "trees"] },
        { desc: "cron built", keywords: ["cron", "running"] },
      ],
      moments, narrative,
    );
    expect(r.matched).toBe(1);
    expect(r.missed).toEqual(["cron built"]);
  });
  it("precision flags forbidden claims", () => {
    const p = scorePrecision(
      [{ desc: "fabricated wrong-location", keywords: ["wrong location"] }],
      ["first edit targeted the wrong location in the file"], "",
    );
    expect(p.violations).toEqual(["fabricated wrong-location"]);
  });
  it("agency checks matched moments only", () => {
    const a = scoreAgency(
      [{ desc: "journal pivot", keywords: ["journal"], agency: "developer" }],
      [row({ statement: "Developer committed to journal-as-product", agency: "ai" })],
    );
    expect(a.checked).toBe(1);
    expect(a.correct).toBe(0);
    expect(a.wrong[0]).toContain("journal pivot");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/eval/fidelity.test.ts`
Expected: FAIL — cannot resolve `src/eval/fidelity.js`.

- [ ] **Step 3: Implement `src/eval/fidelity.ts`**

Pure functions, no I/O, no classes. Percentages rounded to 1 decimal (`Math.round(x * 1000) / 10`). `chunkSpreadOk = momentCount <= 3 || distinctChunks > 1`. `occurredTimeSpanMs`: null when fewer than 1 stamped date. Keyword matching: `keywords.every(k => text.toLowerCase().includes(k.toLowerCase()))`, tested against each statement and against the narrative text; recall counts an expected item matched if any statement OR the narrative matches.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/eval/fidelity.test.ts` — Expected: PASS.
Also: `npx vitest run` (all 311+ pass) and `npx tsc --noEmit 2>&1 | grep -c "error TS"` (≤16).

- [ ] **Step 5: Commit** — `feat(eval): fidelity scoring core (provenance, calibration, tail, recall/precision/agency)`

---

### Task 2: Fidelity criteria + runner + captured baseline

**Files:**
- Create: `tests/eval/fidelity-criteria.ts`
- Create: `run-fidelity.ts`
- Create (generated output, committed): `docs/audits/fidelity-baseline-2026-07-04.md`

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces: `export interface SessionFidelityCriteria { ccSessionId: string; label: string; rawLogPath: string; expectedMoments: ExpectedMoment[]; forbiddenClaims: ForbiddenClaim[] }` and `export const fidelityCriteria: SessionFidelityCriteria[]` from `tests/eval/fidelity-criteria.ts`. Command `npx tsx run-fidelity.ts` prints a per-session and aggregate report and exits 0 (informational scoring, not a hard gate).

- [ ] **Step 1: Write the criteria file**

Derive from the audit catalogs (`docs/audits/catalogs/catalog-*.md`) — read all four and distill. The criteria below are the required floor (they encode the audit's concrete findings); add more items from the catalogs where the catalog gives verbatim evidence, keeping keywords distinctive and lowercase-matchable:

```typescript
// tests/eval/fidelity-criteria.ts
import type { ExpectedMoment, ForbiddenClaim } from "../../src/eval/fidelity.js";

export interface SessionFidelityCriteria {
  ccSessionId: string;
  label: string;
  rawLogPath: string; // .intent/raw-sessions preferred; fall back to ~/.claude/projects
  expectedMoments: ExpectedMoment[];
  forbiddenClaims: ForbiddenClaim[];
}

export const fidelityCriteria: SessionFidelityCriteria[] = [
  {
    ccSessionId: "20f5efec-83cc-4a16-ac34-86728b07ccbf",
    label: "large + self-digested mid-life (tail = 65% of session)",
    rawLogPath: ".intent/raw-sessions/20f5efec-83cc-4a16-ac34-86728b07ccbf.jsonl",
    expectedMoments: [
      // In-window (should already pass at baseline):
      { desc: "docker disk-full root cause", keywords: ["disk", "100%"] },
      { desc: "port 5433 already-in-use discovery", keywords: ["5433"] },
      { desc: "clean-slate migration decision", keywords: ["clean", "migration"] },
      // Tail (must pass only after F1 fix + re-digest — pre-registered improvement):
      { desc: "journal-as-product pivot (trees rejected)", keywords: ["journal", "river"] },
      { desc: "correspondence chat built", keywords: ["correspondence"] },
      { desc: "topic subsystem excision", keywords: ["topic", "excis"] },
      { desc: "scheduled/cron digestion built and running", keywords: ["digest", "schedule"] },
    ],
    forbiddenClaims: [
      { desc: "fabricated wrong-location edit mechanism (audit F4)", keywords: ["wrong location"] },
      { desc: "cron digestion claimed unbuilt (falsified by tail)", keywords: ["cron", "unbuilt"] },
    ],
  },
  {
    ccSessionId: "b9ab1a0c-1315-463d-85e7-3143c9e7fb59",
    label: "resumed, 3 sittings over 4 days",
    rawLogPath: ".intent/raw-sessions/b9ab1a0c-1315-463d-85e7-3143c9e7fb59.jsonl",
    expectedMoments: [
      { desc: "brain helps the next agent insight", keywords: ["next agent"] },
      { desc: "API-key blocker + resume refocus", keywords: ["api key"] },
      { desc: "brain_cards unique-constraint bug (4th bug, dropped)", keywords: ["brain_cards"] },
    ],
    forbiddenClaims: [
      { desc: "all 5 tools confirmed (only 3 invoked — audit F4)", keywords: ["all 5", "confirm"] },
    ],
  },
  {
    ccSessionId: "5b31a1bb-3f6b-4d03-b418-a6c0f0ab704c",
    label: "17/17-high-confidence symptom case",
    rawLogPath: ".intent/raw-sessions/5b31a1bb-3f6b-4d03-b418-a6c0f0ab704c.jsonl",
    expectedMoments: [
      { desc: "30-day log purge discovery (rewrote PRD scope)", keywords: ["30", "purge"] },
      { desc: "developer prompted the UI redesign", keywords: ["redesign"], agency: "developer" },
    ],
    forbiddenClaims: [
      { desc: "vi.hoisted claimed to unblock tests (a later fix did — audit F4)", keywords: ["hoisted", "unblock"] },
    ],
  },
  {
    ccSessionId: "d73d5190-3683-4204-9e04-d325a7bb6527",
    label: "short (15 min) — intent dropped, agency inverted",
    rawLogPath: ".intent/raw-sessions/d73d5190-3683-4204-9e04-d325a7bb6527.jsonl",
    expectedMoments: [
      { desc: "founding requirement: activity event table + derived memory", keywords: ["activity", "event"], agency: "developer" },
      { desc: "file-sink vs DB gap discovery", keywords: ["file", "sink"], agency: "ai" },
    ],
    forbiddenClaims: [],
  },
];
```

Note: `.intent/raw-sessions/` currently holds only `20f5efec`; `run-fidelity.ts` must fall back to `/Users/giladkoch/.claude/projects/-Users-giladkoch-dev-intent-ai/<uuid>.jsonl` when the archive copy is missing (and say so in output). Copy the other three into `.intent/raw-sessions/` as part of this task (plain `cp`) so the eval's raw material is durable.

- [ ] **Step 2: Write `run-fidelity.ts`**

```typescript
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getClient } from "./src/storage/connection.js";
import {
  scoreProvenance, scoreCalibration, scoreTail, scoreRecall, scorePrecision, scoreAgency,
  type MomentFidelityRow,
} from "./src/eval/fidelity.js";
import { fidelityCriteria } from "./tests/eval/fidelity-criteria.js";

function resolveRawLog(c: { rawLogPath: string; ccSessionId: string }): string | null {
  const archive = path.resolve(c.rawLogPath);
  if (fs.existsSync(archive)) return archive;
  const cc = path.join(os.homedir(), ".claude", "projects", "-Users-giladkoch-dev-intent-ai", `${c.ccSessionId}.jsonl`);
  return fs.existsSync(cc) ? cc : null;
}

function rawLastEventAt(logPath: string): Date | null {
  const lines = fs.readFileSync(logPath, "utf-8").trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const d = JSON.parse(lines[i]);
      // skip trailing system-only noise (F8 report: 581def3d case)
      if (d.timestamp && d.type !== "system") return new Date(d.timestamp);
    } catch { /* skip */ }
  }
  return null;
}

const sql = getClient();
for (const c of fidelityCriteria) {
  const sess = await sql`SELECT id, ended_at FROM sessions WHERE source_hash = ${c.ccSessionId} LIMIT 1`;
  if (sess.length === 0) { console.log(`\n## ${c.label}\n  NOT DIGESTED — skipping`); continue; }
  const sessionId = sess[0].id as string;

  const momentRows = await sql`
    SELECT m.id, m.statement, m.type, m.agency, m.confidence, m.occurred_at, c2.chunk_index
    FROM moments m LEFT JOIN chunks c2 ON m.chunk_id = c2.id
    WHERE m.session_id = ${sessionId}`;
  const evidence = await sql`
    SELECT me.moment_id, me.quote, me.source_event_id FROM moment_evidence me
    JOIN moments m ON me.moment_id = m.id WHERE m.session_id = ${sessionId}`;
  const narr = await sql`SELECT summary, progression, discoveries FROM narratives WHERE session_id = ${sessionId} LIMIT 1`;
  const tConf = await sql`SELECT confidence FROM transitions WHERE session_id = ${sessionId}`;
  const oConf = await sql`SELECT confidence FROM outcomes WHERE session_id = ${sessionId}`;

  const moments: MomentFidelityRow[] = momentRows.map((m) => {
    const ev = evidence.filter((e) => e.moment_id === m.id);
    return {
      statement: m.statement as string, type: m.type as string,
      agency: (m.agency as string) ?? null, confidence: (m.confidence as string) ?? null,
      chunkIndex: (m.chunk_index as number) ?? null,
      occurredAt: m.occurred_at ? new Date(m.occurred_at as string) : null,
      evidenceQuotes: ev.map((e) => e.quote as string),
      anchoredEvidenceCount: ev.filter((e) => e.source_event_id != null).length,
    };
  });

  const narrativeText = narr.length
    ? [narr[0].summary, ...(narr[0].progression ?? []), ...(narr[0].discoveries ?? [])].join(" ")
    : "";
  const logPath = resolveRawLog(c);

  const prov = scoreProvenance(moments);
  const momentCal = scoreCalibration(moments.map((m) => m.confidence));
  const toCal = scoreCalibration([...tConf, ...oConf].map((r) => (r.confidence as string) ?? null));
  const tail = scoreTail(sess[0].ended_at ? new Date(sess[0].ended_at as string) : null, logPath ? rawLastEventAt(logPath) : null);
  const statements = moments.map((m) => m.statement);
  const recall = scoreRecall(c.expectedMoments, statements, narrativeText);
  const precision = scorePrecision(c.forbiddenClaims, statements, narrativeText);
  const agency = scoreAgency(c.expectedMoments, moments);

  console.log(`\n## ${c.label} (${c.ccSessionId.slice(0, 8)})`);
  console.log(`  provenance: evidenceReal ${prov.evidenceRealPct}% | anchored ${prov.evidenceAnchoredPct}% | chunks ${prov.distinctChunks} (${prov.chunkSpreadOk ? "ok" : "DEGENERATE"}) | occurredSpan ${prov.occurredTimeSpanMs == null ? "none" : Math.round(prov.occurredTimeSpanMs / 60000) + "min"}`);
  console.log(`  calibration: moments ${JSON.stringify(momentCal.distribution)} ${momentCal.informative ? "" : "UNINFORMATIVE"} | transitions+outcomes ${JSON.stringify(toCal.distribution)} ${toCal.informative ? "" : "UNINFORMATIVE"}`);
  console.log(`  tail: ${tail.covered ? "covered" : `LOST ${Math.round(tail.lostMs / 60000)}min`}`);
  console.log(`  recall: ${recall.matched}/${recall.expected}${recall.missed.length ? " missed: " + recall.missed.join("; ") : ""}`);
  console.log(`  precision violations: ${precision.violations.length ? precision.violations.join("; ") : "none"}`);
  console.log(`  agency: ${agency.correct}/${agency.checked}${agency.wrong.length ? " wrong: " + agency.wrong.join("; ") : ""}`);
}
await sql.end();
```

- [ ] **Step 3: Run it and capture the baseline**

Run: `npx tsx run-fidelity.ts | tee /tmp/fidelity-baseline.txt`
Expected baseline (this is the audit's numbers — verify they reproduce): evidenceReal 0% everywhere (except ≤1 moment), anchored 0%, chunks DEGENERATE (1 distinct) everywhere, occurredSpan none, moment calibration UNINFORMATIVE, transitions+outcomes all-medium UNINFORMATIVE, tail LOST ~460min for `20f5efec`, several recall misses (all tail items), ≥1 precision violation in `20f5efec`/`b9ab1a0c`/`5b31a1bb`.

Wrap the output in `docs/audits/fidelity-baseline-2026-07-04.md` with a two-line header stating the command and the pre-registered definition of better (copy verbatim from the report's final paragraph).

- [ ] **Step 4: Full suite green** — `npx vitest run` and tsc count ≤16.

- [ ] **Step 5: Commit** — `feat(eval): fidelity eval + criteria from audit catalogs + captured baseline`

---

### Task 3: Preserve evidence + chunk provenance through pass 2 (F2.1–F2.3)

**Files:**
- Modify: `src/llm/prompts/moments.ts` (Pass2 schema + pass-2 prompt; Pass1 evidence default)
- Modify: `src/eval/organism.ts` (`detectMomentsWithOrganism` — restore provenance deterministically)
- Modify: `src/pipeline/moments.ts` (same restore for the non-production path so shared schema change compiles and behaves)
- Test: `tests/pipeline/provenance.test.ts` (new), existing `tests/pipeline/moments.test.ts` must keep passing

**Interfaces:**
- Produces: `export function restoreProvenance(pass2Moments: Pass2Moment[], pass1ByChunk: { chunkIndex: number; moments: Pass1Moment[] }[], chunks: SessionChunk[]): SessionMoment[]` in a new file `src/pipeline/restore-provenance.ts` — used by both detection paths and by Task 5.
- Schema change consumed by both paths:

```typescript
// in src/llm/prompts/moments.ts
const Pass2SourceSchema = z.object({ chunkIndex: z.number(), momentIndex: z.number() });
const Pass2MomentSchema = Pass1MomentSchema.passthrough().extend({
  arcId: z.string().optional().default("general"),
  arcRole: z.enum(["origin", "development", "turning_point", "resolution"]).optional().default("development"),
  relatedMomentIds: z.array(z.number()).optional().default([]),
  sources: z.array(Pass2SourceSchema).min(1),  // REQUIRED — schema-enforced, per feedback memory
});
```

And the Pass1 evidence default stops fabricating:

```typescript
evidence: z.union([
  z.array(FlexibleEvidenceSchema).min(1),
  z.string().transform((s) => [{ quote: s, sourceType: "ai" as const, quoteType: "verbatim" as const }]),
]).optional().default([]),   // was: [{ quote: "no evidence provided", ... }]
```

- [ ] **Step 1: Write failing tests**

```typescript
// tests/pipeline/provenance.test.ts
import { describe, it, expect } from "vitest";
import { restoreProvenance } from "../../src/pipeline/restore-provenance.js";
import type { SessionChunk } from "../../src/adapters/types.js";

const chunk = (i: number): SessionChunk => ({
  id: `chunk-${i}`, sessionId: "s", chunkIndex: i, topicHint: "t",
  filesInScope: [], eventRange: [i * 10, i * 10 + 9],
  events: [{ id: `e${i}`, sessionId: "s", causalOrder: i * 10, timestamp: `2026-07-03T1${i}:00:00Z`,
    category: "intent", actor: "user", content: { summary: "s", detail: "d" } } as any],
} as any);

const p1 = (statement: string, quote: string) => ({
  type: "commitment" as const, statement, significance: "why", agency: "developer" as const,
  confidence: "high" as const, topicFingerprint: "t",
  evidence: [{ quote, sourceType: "user" as const, quoteType: "verbatim" as const }],
});

const p2 = (statement: string, sources: { chunkIndex: number; momentIndex: number }[]) => ({
  ...p1(statement, "PASS2 REWROTE THIS"), arcId: "a", arcRole: "development" as const,
  relatedMomentIds: [], sources,
});

describe("restoreProvenance", () => {
  const pass1 = [
    { chunkIndex: 0, moments: [p1("chose postgres", "quote-from-chunk-0")] },
    { chunkIndex: 2, moments: [p1("fixed the bug", "quote-from-chunk-2")] },
  ];
  const chunks = [chunk(0), chunk(1), chunk(2)];

  it("restores evidence verbatim from cited pass-1 moments, ignoring pass-2 rewrites", () => {
    const out = restoreProvenance([p2("merged: fixed the bug", [{ chunkIndex: 2, momentIndex: 0 }])], pass1, chunks);
    expect(out[0].evidence.map((e) => e.quote)).toEqual(["quote-from-chunk-2"]);
  });
  it("assigns the real chunk id from the first cited source", () => {
    const out = restoreProvenance([p2("x", [{ chunkIndex: 2, momentIndex: 0 }])], pass1, chunks);
    expect(out[0].chunkId).toBe("chunk-2");
  });
  it("unions evidence across multiple cited sources", () => {
    const out = restoreProvenance(
      [p2("merged", [{ chunkIndex: 0, momentIndex: 0 }, { chunkIndex: 2, momentIndex: 0 }])], pass1, chunks);
    expect(out[0].evidence.map((e) => e.quote)).toEqual(["quote-from-chunk-0", "quote-from-chunk-2"]);
  });
  it("keeps pass-2 evidence only when a cited source cannot be resolved", () => {
    const out = restoreProvenance([p2("dangling", [{ chunkIndex: 9, momentIndex: 4 }])], pass1, chunks);
    expect(out[0].evidence.map((e) => e.quote)).toEqual(["PASS2 REWROTE THIS"]);
    expect(out[0].chunkId).toBe("chunk-0"); // falls back to first chunk, as before
  });
  it("stamps occurredAt from the chunk's first event timestamp", () => {
    const out = restoreProvenance([p2("x", [{ chunkIndex: 2, momentIndex: 0 }])], pass1, chunks);
    expect(out[0].occurredAt).toBe("2026-07-03T12:00:00Z");
  });
});
```

(`occurredAt` lands on `SessionMoment` in this task as an optional field; storage/emit wiring is Task 5.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/pipeline/provenance.test.ts` — module not found.

- [ ] **Step 3: Implement**

1. `src/adapters/types.ts`: add `occurredAt?: string | null;` to `SessionMoment`.
2. Schema changes in `src/llm/prompts/moments.ts` exactly as in Interfaces above. Update `buildPass2Prompt`'s system prompt: add a rule `6. **Cite your sources.** Every output moment MUST include "sources": the chunkIndex and momentIndex (within that chunk's list) of each Pass-1 moment it derives from. Evidence quotes are restored from your cited sources — you do not need to repeat evidence arrays.` and add `"sources": [{"chunkIndex": 0, "momentIndex": 2}]` to the output-format JSON example.
3. Create `src/pipeline/restore-provenance.ts` implementing the tested behavior: map `(chunkIndex, momentIndex)` → pass-1 moment; evidence = union (in source order) of resolved sources' evidence, falling back to the pass-2 moment's own evidence when no source resolves; `chunkId` = chunk with first resolved source's chunkIndex (fallback `chunks[0]?.id ?? "unknown"`); `occurredAt` = that chunk's `events[0]?.timestamp ?? null`; id/type/statement/significance/agency/confidence/topicFingerprint/arcId/arcRole/relatedMomentIds mapped as today in `organism.ts:169-187` (reuse `mapArcRole`/`mapSourceType` — move them into `restore-provenance.ts` and re-export or import from there).
4. `src/eval/organism.ts`: `detectMomentsWithOrganism` keeps `pass1Results` (it already has `{chunkIndex, moments}`), calls pass 2, then returns `restoreProvenance(pass2Result.moments, pass1Results, chunks)`. Delete the inline mapping block.
5. `src/pipeline/moments.ts`: same — after its pass-2 call, use `restoreProvenance` with its own pass-1 results and chunks. Remove its inline mapping.

- [ ] **Step 4: Run tests** — new file passes; `npx vitest run` all green (update any moments.test.ts expectations that asserted the old fabricated default or `chunks[0]` behavior — the *new* behavior is correct); tsc ≤16.

- [ ] **Step 5: Commit** — `fix(pipeline): restore evidence + real chunk provenance through moment pass 2 (audit F2.1-F2.3)`

---

### Task 4: Anchor evidence quotes to normalized events at store time (F2.2)

**Files:**
- Create: `src/storage/anchor-evidence.ts`
- Modify: `src/storage/queries.ts:storeSessionDigest` (steps 2 and 5)
- Test: `tests/storage/anchor-evidence.test.ts`

**Interfaces:**
- Produces: `export function anchorQuote(quote: string, events: NormalizedDevEvent[]): number | null` — returns the `causalOrder` of the first event whose `content.detail` or `content.summary` contains the quote (whitespace-normalized, case-insensitive, using the quote's first 60 chars when longer), or null.
- Consumes: `NormalizedDevEvent` from `src/adapters/types.ts`.

- [ ] **Step 1: Failing tests**

```typescript
// tests/storage/anchor-evidence.test.ts
import { describe, it, expect } from "vitest";
import { anchorQuote } from "../../src/storage/anchor-evidence.js";
import type { NormalizedDevEvent } from "../../src/adapters/types.js";

const ev = (causalOrder: number, detail: string): NormalizedDevEvent => ({
  id: `e${causalOrder}`, sessionId: "s", causalOrder, timestamp: "2026-07-03T10:00:00Z",
  category: "intent", actor: "user", content: { summary: "", detail },
} as any);

describe("anchorQuote", () => {
  it("finds the event containing the quote", () => {
    const events = [ev(0, "hello"), ev(7, "let's use postgres over sqlite for this")];
    expect(anchorQuote("use postgres over sqlite", events)).toBe(7);
  });
  it("normalizes whitespace and case", () => {
    const events = [ev(3, "We  lack actual\nworthwhile meaning here")];
    expect(anchorQuote("we lack actual worthwhile meaning", events)).toBe(3);
  });
  it("uses a 60-char prefix for long quotes", () => {
    const long = "a".repeat(50) + " unique-marker " + "b".repeat(200);
    const events = [ev(4, "prefix " + long.slice(0, 80) + " suffix")];
    expect(anchorQuote(long, events)).toBe(4);
  });
  it("returns null when nothing matches", () => {
    expect(anchorQuote("absent", [ev(0, "hello")])).toBeNull();
  });
});
```

- [ ] **Step 2: Verify fail**, **Step 3: Implement** (normalize = lowercase + collapse `\s+` to single space + trim, applied to both sides), **Step 4: Tests pass.**

- [ ] **Step 5: Wire into `storeSessionDigest`**

In step 2 of that function, build `const eventIdByCausalOrder = new Map<number, string>()` while inserting normalized_events (it currently discards the generated uuid — keep it). In step 5, for each evidence row compute `const order = anchorQuote(e.quote, data.normalizedEvents); const sourceEventUuid = order != null ? eventIdByCausalOrder.get(order) ?? null : null;` and include `source_event_id` in the INSERT column list. Skip anchoring for empty-evidence moments (nothing to insert).

- [ ] **Step 6: Full suite + tsc**, **Step 7: Commit** — `fix(storage): anchor evidence quotes to normalized events (source_event_id was 100% NULL)`

---

### Task 5: Occurred-time persisted and emitted (F2.4)

**Files:**
- Modify: `src/storage/schema.ts` (moments: add `occurredAt: timestamp("occurred_at", { withTimezone: true })`)
- Create: new drizzle migration via `npx drizzle-kit generate` (do NOT hand-edit `drizzle/meta`)
- Modify: `src/storage/queries.ts` (insert `occurred_at`; also add it to `getSessionMoments`' SELECT mapping if that function returns full moments)
- Modify: `src/pipeline/emit-events.ts` + its input type
- Modify: `src/pipeline/orchestrator.ts` (pass `sessionEndedAt` to `buildSessionEvents`)
- Test: extend `tests/pipeline/emit-events.test.ts` (exists? if not, create)

**Interfaces:**
- Consumes: `SessionMoment.occurredAt` (Task 3).
- Produces: `SessionEventInput` gains `sessionEndedAt?: Date | null`. Event timestamps: moment events use `occurredAt` when present; narrative/transition/outcome events use `sessionEndedAt`; everything falls back to `new Date()` only when neither exists.

- [ ] **Step 1: Failing test**

```typescript
// in tests/pipeline/emit-events.test.ts (create the file if absent, using buildSessionEvents' existing test style if present)
it("stamps moment events with occurredAt and session-level events with sessionEndedAt", () => {
  const events = buildSessionEvents({
    sessionId: "s",
    sessionEndedAt: new Date("2026-07-03T15:33:30Z"),
    moments: [makeMoment({ occurredAt: "2026-07-03T11:22:00Z" })],
    transitions: [], outcomes: [],
    narrative: makeNarrative(),
  });
  const momentEvent = events.find((e) => e.sourceType === "moment")!;
  expect(momentEvent.timestamp.toISOString()).toBe("2026-07-03T11:22:00.000Z");
  const narrativeEvent = events.find((e) => e.sourceType === "narrative")!;
  expect(narrativeEvent.timestamp.toISOString()).toBe("2026-07-03T15:33:30.000Z");
});
```

(Build `makeMoment`/`makeNarrative` helpers with minimal valid objects from `src/adapters/types.ts` — copy field lists from an existing test that constructs these, e.g. `tests/pipeline/orchestrator.test.ts`.)

- [ ] **Step 2: Verify fail.**
- [ ] **Step 3: Implement** — schema column, `npx drizzle-kit generate` (name it `occurred_at`), apply with `npx tsx src/cli/index.ts up` (runs migrations; verify with `docker exec intent-ai-db-1 psql -U intent -d intent -c "\d moments" | grep occurred_at`). Storage insert: `${m.occurredAt ?? null}`. emit-events per Interfaces. Orchestrator: `buildSessionEvents({ ..., sessionEndedAt: endedAt })`.
- [ ] **Step 4: Full suite + tsc.** Existing emit-events assertions on timestamps may need the fallback path — keep `new Date()` fallback exact.
- [ ] **Step 5: Commit** — `feat(pipeline): persist and emit occurred-time for moments (journal no longer collapses sessions to digest instant)`

---

### Task 6: Re-digest grown logs; `--force` flag (F1)

**Files:**
- Modify: `src/pipeline/orchestrator.ts`
- Modify: `src/storage/queries.ts` (add `getSessionEndedAt`, `deleteSessionDigest`)
- Modify: `src/cli/index.ts` (digest `--force` option → `runPipeline(logPath, { force: true })`)
- Test: extend `tests/pipeline/orchestrator.test.ts`

**Interfaces:**
- Produces: `runPipeline(logPath: string, opts?: { force?: boolean })`. `deleteSessionDigest(sessionId: string): Promise<void>` — deletes, in order: `activity_events WHERE session_id = ${sessionId}`, `feature_sessions WHERE session_id = ${sessionId}` (FK lacks cascade), then `sessions WHERE id = ${sessionId}` (cascades the rest).

- [ ] **Step 1: Failing tests** (mock style follows the existing idempotency test at `tests/pipeline/orchestrator.test.ts:293`):

```typescript
it("re-digests when the source log has grown past the stored digest", async () => {
  // stored digest ended at T0; parsed raw events now extend to T0 + 2h
  // arrange mocks: findDigestedSession→id, getSessionEndedAt→T0, parse→events ending T0+2h
  // assert: deleteSessionDigest called with the stored id, pipeline ran, storeSessionDigest called
});
it("returns the stored digest untouched when the log has not grown", async () => {
  // parse→events ending exactly at stored ended_at; assert deleteSessionDigest NOT called, no LLM steps run
});
it("--force re-digests even an unchanged log", async () => {
  // runPipeline(path, { force: true }); assert delete + full pipeline
});
```

Write these as real tests with the file's existing mock helpers — read the existing idempotency test first and mirror its setup exactly.

- [ ] **Step 2: Verify fail.**
- [ ] **Step 3: Implement in orchestrator**

Restructure: parse FIRST (`parseClaudeCodeLog` is deterministic and needed for the growth check), then:

```typescript
const existingId = await findDigestedSession(ccSessionId);
if (existingId) {
  const storedEndedAt = await getSessionEndedAt(existingId);
  const maxTs = latestTimestamp(rawEvents); // max over e.timestamp, null-safe
  const grown = storedEndedAt != null && maxTs != null && maxTs.getTime() > storedEndedAt.getTime() + 60_000;
  if (!grown && !opts?.force) {
    log(`  ⚠ Session already digested (${existingId}). Returning stored digest.`);
    const stored = await loadStoredDigest(existingId);
    if (stored) return stored;
    log("  ⚠ Stored digest incomplete; re-digesting.");
  } else {
    log(grown
      ? `  ↻ Source log grew past stored digest (${storedEndedAt?.toISOString()} → ${maxTs?.toISOString()}). Re-digesting.`
      : "  ↻ --force: replacing stored digest.");
    await deleteSessionDigest(existingId);
  }
}
```

60s epsilon avoids re-digesting on trailing system-only noise (`581def3d` case — `parseClaudeCodeLog` output ends at the last *parsed* event, matching how `endedAt` was computed at store time).

- [ ] **Step 4: Full suite + tsc.**
- [ ] **Step 5: Commit** — `fix(pipeline): re-digest grown session logs instead of returning stale digests; add digest --force (audit F1)`

---

### Task 7: Stop fabricating transition/outcome confidence (F3)

**Files:**
- Modify: `src/llm/prompts/transitions.ts` (schemas + prompt)
- Modify: `src/adapters/types.ts` (`IntentTransition.confidence` and `AcceptedOutcome.confidence` become `"high" | "medium" | "low" | null`)
- Test: `tests/llm/transitions-schema.test.ts` (new; or extend the existing transitions test file if one exists — check `tests/` first)

**Interfaces:**
- Schema (both `IntentTransitionSchema` and `AcceptedOutcomeSchema`):

```typescript
confidence: z.enum(["high", "medium", "low"]).nullable().optional().transform((v) => v ?? null),
```

- Prompt: add to BOTH the transitions and outcomes sections of the system prompt:

```
Include a "confidence" field on every transition and outcome:
- "high"  — the transcript contains an explicit statement or verified action supporting this
- "medium" — inferred from multiple moments but not explicitly stated
- "low"   — plausible reading, weak or indirect support
```

and add `"confidence": "high|medium|low"` to the example JSON shapes in the prompt (there are currently none — add a minimal output-shape block showing all fields of each object).

- [ ] **Step 1: Failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { TransitionsOutputSchema } from "../../src/llm/prompts/transitions.js";

describe("transitions confidence honesty", () => {
  it("stores null, not a fabricated default, when the LLM omits confidence", () => {
    const out = TransitionsOutputSchema.parse({
      transitions: [{ fromStatement: "a", toStatement: "b", reason: "r" }],
      outcomes: [{ statement: "done" }],
    });
    expect(out.transitions[0].confidence).toBeNull();
    expect(out.outcomes[0].confidence).toBeNull();
  });
  it("passes through a real confidence", () => {
    const out = TransitionsOutputSchema.parse({
      transitions: [], outcomes: [{ statement: "done", confidence: "low" }],
    });
    expect(out.outcomes[0].confidence).toBe("low");
  });
});
```

- [ ] **Step 2: Verify fail** (currently returns `"medium"`).
- [ ] **Step 3: Implement** schema + prompt + types. Chase type errors through `src/pipeline/transitions.ts`, `emit-events.ts`, storage (DB columns are already nullable) — without adding tsc errors.
- [ ] **Step 4: Full suite + tsc ≤16.**
- [ ] **Step 5: Commit** — `fix(llm): transition/outcome confidence is the LLM's judgment or null — never a schema default (audit F3)`

---

### Task 8: Retire the Gen-0 machinery; promote the organism into the pipeline

**Files:**
- Create: `src/pipeline/detect-moments.ts` (the production path, organism inlined)
- Modify: `src/pipeline/orchestrator.ts` (import swap), `tests/pipeline/orchestrator.test.ts` (mock path swap)
- Move: scorer system-prompt builder from `src/eval/chromosomes/chr1-instructions.ts` into `src/llm/prompts/moments.ts` (export `buildScorerSystemPrompt(context)`); `hybrid` render + helpers from `chr2-formats.ts` into `src/pipeline/detect-moments.ts` (private); `fullPrecompute` logic from `chr3-synthesis.ts` into `src/pipeline/precompute.ts` (its dependencies `classify-exchanges.ts`, `analyze.ts` already live in `src/pipeline/`); the 3-line `conversationOnly` filter inline into `detect-moments.ts`.
- Delete: `run-gen0.ts`, `run-crossover.ts`, `run-learn.ts`, `run-phase1.ts`, `src/eval/organism.ts`, `src/eval/runner.ts`, `src/eval/fitness.ts`, `src/eval/judge.ts`, `src/eval/langsmith-experiment.ts` (verify no importer outside deleted files first: `grep -rln "langsmith-experiment" src/ tests/ *.ts`), `src/eval/chromosomes/` (whole dir), `src/pipeline/default-organism.ts`, `tests/eval/session-criteria.ts`.
- Keep: `src/eval/mvp-*.ts`, `src/eval/transcript-metrics.ts`, `src/eval/langsmith-setup.ts` (check importers — if only langsmith-experiment used it, delete too), `src/eval/fidelity.ts`, `tests/eval/fixtures/` (raw transcripts, reusable), `run-mvp-eval.ts`, `run-fidelity.ts`.
- Modify: `CLAUDE.md` — remove `run-gen0.ts` from Commands and Reference, replace the Eval Workflow step 1 with `npx tsx run-fidelity.ts`, update the pipeline diagram note if it mentions organisms, update `src/eval/` description in Source Layout to "Fidelity eval + measurement-v2 (mvp) harness".

**Interfaces:**
- Produces: `export async function detectMoments(rawEvents: RawDevEvent[], chunks: SessionChunk[], sessionShape: string, normalizedEvents: NormalizedDevEvent[]): Promise<SessionMoment[]>` in `src/pipeline/detect-moments.ts` — byte-for-byte the behavior of today's `detectMomentsWithOrganism(DEFAULT_ORGANISM, ...)` including Task 3's `restoreProvenance`. This is a REFACTOR: no prompt text, no data selection, no format changes.
- Note: the old `src/pipeline/moments.ts:detectMoments` (hunter-prompt path) is now unreachable from production. Keep it and its tests this task (deleting is an LLM-behavior decision for later EDD work); add a one-line comment at its top: `// NOTE: non-production path — production uses detect-moments.ts (see audit report 2026-07-04).`

- [ ] **Step 1: Write the refactor** — create the new files by MOVING code (no rewrites). `detect-moments.ts` contains: `conversationOnly` filter → `normalize` → `precompute` (`fullPrecompute` logic) → per-chunk Sonnet call with `buildScorerSystemPrompt` + hybrid render → pass 2 → `restoreProvenance`.
- [ ] **Step 2: Update orchestrator + tests** — orchestrator imports `detectMoments` from `./detect-moments.js`; `tests/pipeline/orchestrator.test.ts` re-points its `vi.mock` from `../../src/eval/organism.js` to `../../src/pipeline/detect-moments.js` (and the import at line 67).
- [ ] **Step 3: Delete the dead machinery** (list above), then `grep -rn "chromosomes\|organism\|run-gen0\|session-criteria" src/ tests/ *.ts docs/superpowers/ CLAUDE.md` — every remaining hit must be either the new `detect-moments.ts` comment trail, `.claude/skills` docs (leave those), or archived docs.
- [ ] **Step 4: Update CLAUDE.md** per Files above.
- [ ] **Step 5: Full suite + tsc** — test count will drop with deleted eval tests only if any existed for deleted modules (check; `threading-criteria.ts` in `tests/eval/` is used by `tests/pipeline/threading.test.ts` — KEEP it). Expect ≥ the surviving-test count green, tsc ≤16 (deletions may reduce it — record new count).
- [ ] **Step 6: Commit** — `refactor!: promote the winning organism into the pipeline; retire Gen-0 eval machinery (audit ask 4)`

---

### Task 9: EDD close-the-loop — re-digest, re-run fidelity, record deltas

**Files:**
- Create: `docs/audits/fidelity-after-fixes-2026-07-04.md`
- Modify: `docs/audits/2026-07-04-digest-fidelity-report.md` (append a short "Post-fix results" section)

Requires `ANTHROPIC_API_KEY` in `.env` and Postgres up. Costs real LLM calls (~25 Sonnet calls for the grown 20f5efec log — it now has ~2400 lines).

- [ ] **Step 1: Re-digest the tail-loss session** — `npx tsx src/cli/index.ts digest /Users/giladkoch/.claude/projects/-Users-giladkoch-dev-intent-ai/20f5efec-83cc-4a16-ac34-86728b07ccbf.jsonl`
Expected: the Task-6 "Source log grew" path fires, old digest replaced, new digest spans to ~23:14.
- [ ] **Step 2: Re-digest one control session with `--force`** (pick `d73d5190`, the cheap one) to exercise provenance fixes on an unchanged log.
- [ ] **Step 3: Run `npx tsx run-fidelity.ts`** and diff against the baseline. Pre-registered success (from the report): for re-digested sessions — evidenceReal >0% → expect ≥80%, anchored >0%, chunkSpreadOk true, occurredSpan non-null, transitions/outcomes calibration no longer a single fabricated value (null is acceptable and honest), `20f5efec` tail covered and its 4 tail recall items matched, no NEW precision violations. Sessions not re-digested keep baseline scores (expected — note it).
- [ ] **Step 4: Write `docs/audits/fidelity-after-fixes-2026-07-04.md`** — baseline vs after table, per check, plus any check that did NOT move and why. Append the summary section to the audit report.
- [ ] **Step 5: Full suite one last time; commit** — `docs(audit): post-fix fidelity results vs pre-registered baseline`

---

## Self-Review Notes

- Spec coverage: report's fix list items 1–4 → Tasks 3–7; "make fidelity measurable + baseline + pre-register" → Tasks 1–2; "leave the harness honest / one command" → Task 8; EDD compare → Task 9. LLM-behavior items 5–8 from the report (confidence rubric for moments, tool-action data selection, agency context, sitting/gap awareness) are deliberately OUT of this plan — they are gated on the Task-2 baseline and belong to the next EDD cycle.
- Type consistency: `SessionMoment.occurredAt?: string | null` (ISO string in domain types, `Date` only at DB/emit boundaries); `restoreProvenance` returns `SessionMoment[]`; `MomentFidelityRow.occurredAt: Date | null` (it is read back from Postgres).
- Task 3 changes a shared schema consumed by two call sites — both updated in the same task, so no intermediate broken state.
