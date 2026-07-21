import { z } from "zod";

// Evidence item with eventIndex (causalOrder index) — min(1) enforced on the array
export const DigestEvidenceSchema = z.object({
  quote: z.string().min(1),
  eventIndex: z.union([
    z.number(),
    z.string().transform((s) => {
      const n = parseInt(s, 10);
      return Number.isNaN(n) ? null : n;
    }),
  ]).nullable(),
  sourceType: z.enum(["user", "ai", "tool_output"]).optional().default("ai"),
});

// Moment schema mirrors ExtractMomentSchema + sittingIndex; confidence is nullable (no default)
export const DigestMomentSchema = z.object({
  sittingIndex: z.number().int().min(0),
  type: z.enum([
    "proposal",
    "discovery",
    "pivot",
    "confirmation",
    "rejection",
    "commitment",
    "struggle",
    "breakthrough",
    "execution",
  ]),
  statement: z.string().min(1),
  significance: z.string().optional().default(""),
  agency: z.enum(["developer", "ai", "collaborative"]),
  confidence: z.enum(["high", "medium", "low"]).nullable().optional().transform(
    (v) => v ?? null,
  ),
  topicFingerprint: z.string().optional().default("general"),
  evidence: z.array(DigestEvidenceSchema).min(1),
});

export const DigestTransitionSchema = z.object({
  fromStatement: z.string().min(1),
  toStatement: z.string().min(1),
  reason: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]).nullable().optional().transform(
    (v) => v ?? null,
  ),
});

export const DigestOutcomeSchema = z.object({
  statement: z.string().min(1),
  supportingFiles: z.array(z.string()).optional().default([]),
  confidence: z.enum(["high", "medium", "low"]).nullable().optional().transform(
    (v) => v ?? null,
  ),
});

export const DigestNarrativeSchema = z.object({
  sessionShape: z.enum(["narrative", "exploratory", "janitorial", "debugging", "review"]),
  summary: z.string().min(1),
  progression: z.array(z.string()).optional().default([]),
  discoveries: z.array(z.string()).optional().default([]),
  stabilizedDirections: z.array(z.string()).optional().default([]),
  abandonedDirections: z.array(z.string()).optional().default([]),
});

export const DigestAgentOutputSchema = z.object({
  moments: z.array(DigestMomentSchema),
  transitions: z.array(DigestTransitionSchema).optional().default([]),
  outcomes: z.array(DigestOutcomeSchema).optional().default([]),
  narrative: DigestNarrativeSchema,
});

export type DigestAgentOutput = z.infer<typeof DigestAgentOutputSchema>;
