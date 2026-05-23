# Entire CLI competitive positioning

Brain duplicates the entire foundation layer of the mature open-source Entire CLI project (4K stars, 3,600+ commits): transcript parsing, session grouping, Claude session collection, git diffs, turn-based API, and SQLite storage. Despite format compatibility at the ingestion boundary, the developer rejected coupling Brain to Entire CLI. The projects are differentiated by purpose: Brain asks 'What am I in the middle of?' while Entire CLI asks 'What changed and why?'

## constraint

- Do not re-introduce entireio_collector.py or any Entire CLI data source coupling — these files were deliberately deleted after the prototype was rejected.

## decision

- Brain will NOT consume Entire CLI checkpoint data as its ingestion source — the coupling was prototyped and explicitly rejected by the developer.
- Brain's unique value proposition is 'What am I in the middle of?' (context continuity) vs Entire CLI's 'What changed and why?' (change documentation) — these are adjacent but distinct problems.

## risk

- Brain has duplicated the entire foundation layer that Entire CLI already ships as production-grade open source — this is a known technical debt risk if Brain's collectors need to match Entire CLI's maturity.

## Files

- `src/brain/collectors/entireio_collector.py` — DELETED — prototype Entire CLI collector, rejected and removed
- `src/brain/parsers/turn_parser.py` — Brain's own turn parser whose format is compatible with Entire's full.jsonl format at the ingestion boundary
- `tests/test_entireio_collector.py` — DELETED — tests for the rejected Entire CLI collector

## Evidence

- Apr 23: The developer set out to do a competitive evaluation of Brain against the entireio/cli repo, whic... (24 moments)

## Related

- [digestion pipeline](digestion-pipeline.md)
- [intent pipeline v2 architecture](intent-pipeline-v2-architecture.md)
- [claude_collector cursor mechanism](claude-collector-cursor-mechanism.md)
