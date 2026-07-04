import { z } from "zod";
import type { ExtractedMoment, Sitting } from "../../../adapters/types.js";

// ── Zod Schemas ───────────────────────────────────────────────────────

export const WeaveDecisionSchema = z.object({
  action: z.enum(["keep", "merge", "drop"]),
  momentIds: z.array(z.string()).min(1), // extract ids; merge lists ≥2, primary first
  arcId: z.string().optional().default("general"),
  arcRole: z.enum(["origin", "development", "turning_point", "resolution"]).optional().default("development"),
  relatedTo: z.array(z.string()).optional().default([]),
  statement: z.string().optional(), // merge only: the combined statement (new judgment, allowed)
  reason: z.string().optional(),    // drop only
});

export const WeaveOutputSchema = z.object({
  decisions: z.array(WeaveDecisionSchema),
});

// ── Prompt Builder ─────────────────────────────────────────────────────

/**
 * Build the system + user prompt for the weave stage.
 *
 * The model receives a compact view of extracted moments and outputs ONLY
 * decisions (keep/merge/drop) — it never re-emits statements/evidence/agency.
 * Deterministic code in applyWeaveDecisions carries all data forward.
 */
export function buildWeavePrompt(input: {
  moments: ExtractedMoment[];
  sessionShape: string;
  sittings: Sitting[];
}): { system: string; user: string } {
  const { moments, sessionShape, sittings } = input;

  const system = `You are the weave stage of a developer-session understanding pipeline. You receive a flat list of extracted moments (from multiple chunks of the same session) and produce ONLY a decisions object.

Your job is:
1. **Dedup / merge** moments that describe the same event from overlapping chunks (chunk boundaries cause duplicates). When merging, list all source moment ids — primary first.
2. **Drop** moments that are low quality: vague statement AND zero anchored evidence. Give a short reason.
3. **Assign arcs** — group moments into named story arcs (arcId). Use kebab-case names like "auth-refactor", "test-setup". If a moment doesn't fit a named arc, use "general".
4. **Assign arc roles** — within each arc, classify the role: origin / development / turning_point / resolution.
5. **Link related moments** — if moments are causally or thematically related across arcs, list their ids in relatedTo.

## Absolute constraints

- You output DECISIONS about the listed moment ids. You never rewrite statements except when merging (then "statement" combines the merged moments in the developer's language).
- Every input id appears in exactly one decision.
- Never invent ids. Never re-emit evidence — it is carried automatically.
- For drop decisions, include a brief "reason" field.
- For merge decisions with 2+ ids, the "statement" field should combine the merged moments into one crisp statement in the developer's language.

## Output format

Return ONLY a JSON object:
{
  "decisions": [
    {
      "action": "keep" | "merge" | "drop",
      "momentIds": ["c0-m0"],          // all source ids for this decision
      "arcId": "kebab-case-arc-name",  // optional, default "general"
      "arcRole": "origin" | "development" | "turning_point" | "resolution",
      "relatedTo": ["c0-m2"],          // extract ids of related moments
      "statement": "...",              // merge only: new combined statement
      "reason": "..."                  // drop only: why dropped
    }
  ]
}`;

  // Build a compact view of each moment for the LLM
  const momentLines = moments.map((m) => {
    const firstEvidence = m.evidence[0];
    const quote = firstEvidence
      ? firstEvidence.quote.slice(0, 120)
      : "(no evidence)";
    const anchoredCount = m.evidence.filter((e) => e.anchored).length;

    return [
      `id: ${m.id}`,
      `  type: ${m.type}`,
      `  statement: ${m.statement}`,
      `  agency: ${m.agency}`,
      `  confidence: ${m.confidence ?? "null"}`,
      `  topic: ${m.topicFingerprint}`,
      `  chunk: ${m.chunkIndex}`,
      `  occurredAt: ${m.occurredAt ?? "null"}`,
      `  anchored_evidence: ${anchoredCount}/${m.evidence.length}`,
      `  first_quote: "${quote}"`,
    ].join("\n");
  });

  // Sitting boundaries to help the model understand chunk overlaps
  const sittingLines =
    sittings.length > 0
      ? sittings
          .map(
            (s) =>
              `  sitting ${s.sittingIndex}: events ${s.eventRange[0]}–${s.eventRange[1]} (${s.startedAt} → ${s.endedAt})`,
          )
          .join("\n")
      : "  (no sitting boundaries)";

  const user = [
    `## Session shape: ${sessionShape}`,
    "",
    `## Sitting boundaries`,
    sittingLines,
    "",
    `## Extracted moments (${moments.length} total)`,
    "",
    momentLines.join("\n\n"),
    "",
    "Produce the decisions object. Every input id must appear in exactly one decision. Return JSON only.",
  ].join("\n");

  return { system, user };
}
