# Parity Corpus

Deterministic dry-run outputs for 7 sessions, captured 2026-07-21 on branch
`feat/repo-brain` (Slice 0 of the TS→Python migration). Used by Slice 3 to
verify that the Python ingestion port produces equivalent deterministic stats.

## What "deterministic" means here

The `--dry-run` flag on the digest CLI runs the full parse→normalize→chunk
pipeline but makes **no LLM calls**. The printed stats are deterministic given
the same input file and the same code. The Python port's parity harness (Slice 3)
should re-derive these numbers from the same input files and diff them.

## Sessions included

| Directory                    | Source                                    | Session ID prefix |
|------------------------------|-------------------------------------------|-------------------|
| `fixture-scope-design/`      | `journal/tests/eval/fixtures/scope-design.jsonl`       | (fixture)  |
| `fixture-scope-full/`        | `journal/tests/eval/fixtures/scope-full.jsonl`         | (fixture)  |
| `fixture-scope-implementation/` | `journal/tests/eval/fixtures/scope-implementation.jsonl` | (fixture) |
| `fixture-scope-pivot/`       | `journal/tests/eval/fixtures/scope-pivot.jsonl`        | (fixture)  |
| `real-20f5efec/`             | `journal/.intent/raw-sessions/20f5efec-83cc-4a16-ac34-86728b07ccbf.jsonl` | 20f5efec |
| `real-45522a11/`             | `journal/.intent/raw-sessions/45522a11-4686-47bb-93ea-fd29b8ae5e4e.jsonl` | 45522a11 |
| `real-5b31a1bb/`             | `journal/.intent/raw-sessions/5b31a1bb-3f6b-4d03-b418-a6c0f0ab704c.jsonl` | 5b31a1bb |

## Files per session directory

- `dry-run-output.txt` — stdout from the CLI (the stats)
- `dry-run-stderr.txt` — stderr (contains the pre-existing Directives crash; see below)

## How to reproduce

```bash
# From journal/ directory:
npx tsx src/cli/index.ts digest --dry-run tests/eval/fixtures/scope-design.jsonl
npx tsx src/cli/index.ts digest --dry-run tests/eval/fixtures/scope-full.jsonl
npx tsx src/cli/index.ts digest --dry-run tests/eval/fixtures/scope-implementation.jsonl
npx tsx src/cli/index.ts digest --dry-run tests/eval/fixtures/scope-pivot.jsonl
npx tsx src/cli/index.ts digest --dry-run .intent/raw-sessions/20f5efec-83cc-4a16-ac34-86728b07ccbf.jsonl
npx tsx src/cli/index.ts digest --dry-run .intent/raw-sessions/45522a11-4686-47bb-93ea-fd29b8ae5e4e.jsonl
npx tsx src/cli/index.ts digest --dry-run .intent/raw-sessions/5b31a1bb-3f6b-4d03-b418-a6c0f0ab704c.jsonl
```

Redirect stdout to `dry-run-output.txt` and stderr to `dry-run-stderr.txt` for
comparison. The exit code will be 1 (due to the Directives crash) but all the
meaningful stats print before the crash.

## Known issue: Directives crash

The CLI's dry-run path calls `analyzeInteractions()` (an async function) without
`await`. This causes the Promise to be used as an object, and the subsequent
`.promptSections.detectPassiveAcceptance` access crashes. All stats before the
`Directives:` line are valid; the Directives block is incomplete in all captures.

**Impact on parity harness (Slice 3):** The Python port's parity check should
compare only the pre-crash stats (Raw events, Normalized events, Chunks, Time
span, Categories). The Directives block should be skipped or marked as a known
gap. When the Python port implements `analyzeInteractions`, it should produce
the correct Directives output, and the Slice 3 harness should compare against
the correct expected values (not the crashed TS output).

## What Slice 3 should verify (parity thresholds)

For each session in this corpus, the Python port must produce:
- `raw_events` within ±0 of TS (exact match — pure parsing, no ambiguity)
- `normalized_events` within ±0 of TS (exact match)
- `chunks` within ±1 of TS (chunking algorithm must be equivalent)
- Category counts within ±2% per category (normalization is structural but
  heuristics may differ slightly at edge cases)

Time span and session-level metadata are expected to match exactly.

## Stat snapshots

For quick reference without reading files:

```
fixture-scope-design:       118 raw, 118 norm, 5 chunks, 147 min, i:29 r:32 res:29 p:23 a:5
fixture-scope-full:         967 raw, 967 norm, 22 chunks, 1257 min, i:71 r:323 res:345 p:56 a:172
fixture-scope-implementation: 587 raw, 587 norm, 11 chunks, 858 min, i:17 r:198 res:222 a:135 p:15
fixture-scope-pivot:        277 raw, 277 norm, 8 chunks, 254 min, i:27 p:19 r:98 res:99 a:34
real-20f5efec:              1025 raw, 1025 norm, 30 chunks, 624 min, i:18 p:13 a:374 res:445 r:175
real-45522a11:              270 raw, 270 norm, 11 chunks, 9620 min, i:34 p:40 r:97 a:30 res:69
real-5b31a1bb:              398 raw, 398 norm, 15 chunks, 108 min, i:17 p:12 r:93 res:156 a:120
```

Category key: i=intent, r=reflection, res=result, p=proposal, a=action
