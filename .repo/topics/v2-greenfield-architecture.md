# v2 greenfield architecture

The project is being rebuilt from scratch as v2, with v1 serving as reference only. No code migration, no incremental evolution — the new system is built on a fundamentally different mental model where the atomic unit is a 'moment' rather than a 'fact', and the pipeline reorients around cognitive compression rather than fact extraction.

## constraint

- Do not port, migrate, or adapt v1 code into v2 — v1 exists solely as a conceptual reference for understanding what was built before.

## decision

- v2 is a clean-slate greenfield implementation — v1 code is reference only and must not be migrated, reused, or built upon.
- The atomic unit of the v2 pipeline is a 'moment' (proposals, discoveries, transitions, confirmations, rejections, commitments) — not a 'fact' as in v1.
- The v2 pipeline is oriented around cognitive compression rather than fact extraction — the goal is to compress what happened cognitively, not enumerate discrete facts.

## Evidence

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)

## Related

- [digestion pipeline](digestion-pipeline.md)
- [moment detection data model](moment-detection-data-model.md)
- [intent pipeline v2 architecture](intent-pipeline-v2-architecture.md)
