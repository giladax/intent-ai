# Implementation Philosophy

> Parent: [Product View](product-view.md)

This codebase follows two interlocking principles that govern the order and validation of all feature work. First, EDD-first (Evaluation-Driven Development): before any feature is built, gold test cases must be written that import or mock pre-existing work and prove the system behaves correctly against real data. This prevents building on unvalidated assumptions and ensures each layer of the system is grounded in evidence before the next is added. Second, view-first construction: the product is a living view that developers and operators consult daily, and alerting/drift detection is a notification layer on top of that view — not the core product. This means the product view must exist and be useful before any drift or alerting infrastructure is built. Together these principles prevent the common failure mode of building sophisticated detection machinery that has no stable, human-readable surface to report into.

## constraint

- The implementation order is strictly: (1) product view, (2) drift/alerting on top of the view. Reversing this order is an explicit anti-pattern that was identified and corrected.

## decision

- EDD-first means gold test cases are written before feature implementation, importing or mocking pre-existing work to validate against real data — no feature is built without a passing test that proves the prior layer works.

## Files

- `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/docs/plans/2026-05-15-org-registry-drift-detection.md`

## Sessions

- May 15: The developer set out to make PRDs version-controlled and repo-native, enabling Brain to detect a... (18 moments)
- May 21: The developer proposed a two-layer model architecture distinguishing observed facts from derived ... (5 moments)
- Apr 23: The developer set out to do a competitive evaluation of Brain against the entireio/cli repo, whic... (24 moments)
