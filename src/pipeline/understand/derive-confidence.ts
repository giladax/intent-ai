import type { SessionMoment, EvidenceAnchor } from "../../adapters/types.js";

// ── deriveConfidence ──────────────────────────────────────────────────
//
// Deterministic confidence derivation from anchoring + verification.
// Replaces model-emitted confidence (A5: model always emits "high" ~95%
// regardless of rubric — no information content).
//
// Rules (in priority order):
//   high   = verification === "supported"
//            OR ≥1 evidence with anchored===true AND sourceType==="user"
//   medium = ≥1 evidence with anchored===true (but none are user-sourced,
//            and verification is not "supported")
//   low    = no anchored evidence (and verification is not "supported")

export function deriveConfidence(
  moment: SessionMoment,
): "high" | "medium" | "low" {
  // "supported" verification always yields high
  if (moment.verification === "supported") {
    return "high";
  }

  // Inspect evidence — evidence items may be EvidenceAnchor (from pipeline/agent)
  // or legacy Evidence objects (which lack the anchored field).
  // We cast speculatively; items without `anchored` are treated as not anchored.
  const evidence = moment.evidence as unknown as Partial<EvidenceAnchor>[];

  const hasAnchoredUserEvidence = evidence.some(
    (e) => e.anchored === true && e.sourceType === "user",
  );

  if (hasAnchoredUserEvidence) {
    return "high";
  }

  const hasAnyAnchoredEvidence = evidence.some((e) => e.anchored === true);

  if (hasAnyAnchoredEvidence) {
    return "medium";
  }

  // No anchored evidence at all
  return "low";
}

// ── applyDerivedConfidence ────────────────────────────────────────────
//
// Non-mutating mapper: overwrites the confidence field on every moment
// using deriveConfidence. Safe to apply after verification (so that
// "supported" verdicts already present in verification field are honoured).

export function applyDerivedConfidence(
  moments: SessionMoment[],
): SessionMoment[] {
  return moments.map((m) => ({
    ...m,
    confidence: deriveConfidence(m),
  }));
}
