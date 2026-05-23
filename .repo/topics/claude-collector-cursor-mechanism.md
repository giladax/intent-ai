# claude_collector cursor mechanism

The claude_collector tracks ingestion progress using a per-file byte offset cursor stored as a JSON object. The previous timestamp-based cursor was replaced after discovering 47 duplicate timestamps in real production data, which caused both missed and duplicate ingestion. The new cursor maps file paths to byte offsets, enabling reliable incremental reads across JSONL files.

## structure

- The cursor is a JSON object mapping file paths to byte offsets, allowing the collector to resume reading each JSONL file from exactly where it left off without re-processing or skipping entries.

## constraint

- Any future changes to the cursor format must maintain the per-file byte offset structure — reverting to timestamp-based cursors is explicitly ruled out by production evidence of failure.

## decision

- The cursor was redesigned from a bare timestamp to a JSON object tracking per-file byte offsets — the timestamp approach was proven fragile by 47 duplicate timestamps found in real production JSONL files.

## behavior

- The cursor fix was developed TDD-first using real repo JSONL data as test fixtures, not synthetic data — integration tests in test_claude_collector_cursor.py use actual claude_session_sample.jsonl.

## risk

- Legacy tests that used the old timestamp cursor format had to be updated to the new JSON cursor format — any test that constructs cursor state directly must use the new per-file byte offset format.

## Files

- `src/brain/collectors/claude_collector.py` — Implements the collector with the new per-file byte offset cursor logic
- `tests/fixtures/claude_session_sample.jsonl` — Real production JSONL data used as test fixture for cursor integration tests
- `tests/test_claude_collector_cursor.py` — TDD integration tests for the cursor mechanism using real fixture data
- `tests/test_claude_collector.py` — Existing collector tests updated to use new cursor format

## Evidence

- Apr 23: The developer set out to do a competitive evaluation of Brain against the entireio/cli repo, whic... (24 moments)

## Related

- [digestion pipeline](digestion-pipeline.md)
- [intent pipeline v2 architecture](intent-pipeline-v2-architecture.md)
