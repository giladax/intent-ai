# Data Collection & Ingestion

Data Collection & Ingestion is the entry point of the data pipeline — responsible for acquiring raw data from external or internal sources and loading it into the system in a form suitable for downstream processing. This subsystem defines how data enters the codebase: what sources are supported, how data is fetched or received, how it is validated at the boundary, and how it is persisted or queued for further transformation. It exists to provide a clean, auditable boundary between the outside world and internal processing logic, ensuring that all downstream components can assume data has passed basic structural and quality checks before they operate on it.

## structure

- No knowledge fragments were provided for this spec, so no structural relationships between ingestion components, sources, or downstream consumers can be confirmed from evidence.

## constraint

- The cursor format MUST remain a JSON object of {file_path: byte_offset} entries. Any reversion to a bare timestamp cursor will reintroduce duplicate-processing and new-file-skipping bugs confirmed in production data.

## decision

- The Entire CLI integration was prototyped (entireio_collector.py reading from Git orphan branch `entire/checkpoints/v1`) and then explicitly rejected by the developer. The rejection was unambiguous: 'no, dont keep it'. Brain does not use Entire CLI as a data source.

## Files

- `src/brain/collectors/claude_collector.py`
- `src/brain/collectors/entireio_collector.py`
- `tests/fixtures/claude_session_sample.jsonl`
- `tests/test_claude_collector.py`
- `tests/test_claude_collector_cursor.py`
- `tests/test_entireio_collector.py`

## Sessions

- May 15: The developer set out to make PRDs version-controlled and repo-native, enabling Brain to detect a... (18 moments)
- May 21: The developer proposed a two-layer model architecture distinguishing observed facts from derived ... (5 moments)
- Apr 5: The developer assigned the AI to implement Task 10 of the Faithful Memory Foundation plan — loop ... (10 moments)
- Apr 23: The developer set out to do a competitive evaluation of Brain against the entireio/cli repo, whic... (24 moments)
