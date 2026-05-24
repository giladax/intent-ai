# Rejected Integrations

> Parent: [Data Collection and Cursoring](data-collection-and-cursoring.md)

This document records data source integrations that were prototyped and explicitly rejected for Brain's data collection pipeline. Currently, the only rejected integration is the Entire CLI (entireio/cli), which was prototyped as a collector reading checkpoint data from a Git orphan branch (`entire/checkpoints/v1`). The integration was removed at the developer's explicit direction — Brain will not couple to Entire CLI as a data source. This spec exists to prevent future developers from re-introducing these integrations, either by rediscovering the idea independently or by misreading the deletion as accidental. The rejections here are deliberate architectural decisions, not gaps to be filled.

## decision

- The Entire CLI integration was prototyped (entireio_collector.py reading from Git orphan branch `entire/checkpoints/v1`) and then explicitly rejected by the developer. The rejection was unambiguous: 'no, dont keep it'. Brain does not use Entire CLI as a data source.

## Files

- `src/brain/collectors/entireio_collector.py`
- `tests/test_entireio_collector.py`

## Sessions

- May 15: The developer set out to make PRDs version-controlled and repo-native, enabling Brain to detect a... (18 moments)
- May 21: The developer proposed a two-layer model architecture distinguishing observed facts from derived ... (5 moments)
- Apr 23: The developer set out to do a competitive evaluation of Brain against the entireio/cli repo, whic... (24 moments)
