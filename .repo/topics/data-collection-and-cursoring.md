# Data Collection and Cursoring

> Children: [Rejected Integrations](rejected-integrations.md)

The data collection layer ingests raw session data from external sources (e.g., Claude JSONL files) into the pipeline using cursor-based resumption to avoid reprocessing. The primary collector, `claude_collector.py`, reads JSONL files from disk and tracks ingestion progress via a cursor stored as a JSON object keyed by file path with byte offset values. This design was chosen specifically because JSONL files can contain duplicate timestamps — 47 were found in production data — making any timestamp-based cursor fundamentally unreliable. By tracking byte offsets per file, the collector can resume exactly where it left off regardless of timestamp collisions, and correctly handles new files appearing alongside existing ones. The cursor format is a hard architectural constraint: reverting to bare timestamps would reintroduce both duplicate-processing and new-file-skipping bugs. Child spec 'Rejected Integrations' covers data sources that were evaluated and not adopted.

## constraint

- The cursor format MUST remain a JSON object of {file_path: byte_offset} entries. Any reversion to a bare timestamp cursor will reintroduce duplicate-processing and new-file-skipping bugs confirmed in production data.

## Files

- `src/brain/collectors/claude_collector.py`
- `tests/fixtures/claude_session_sample.jsonl`
- `tests/test_claude_collector.py`
- `tests/test_claude_collector_cursor.py`
- _from [Rejected Integrations](rejected-integrations.md):_
  - `src/brain/collectors/entireio_collector.py`
  - `tests/test_entireio_collector.py`

## Sessions

- May 15: The developer set out to make PRDs version-controlled and repo-native, enabling Brain to detect a... (18 moments)
- May 21: The developer proposed a two-layer model architecture distinguishing observed facts from derived ... (5 moments)
- Apr 23: The developer set out to do a competitive evaluation of Brain against the entireio/cli repo, whic... (24 moments)
