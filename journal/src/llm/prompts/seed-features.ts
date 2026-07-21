// ── Feature-seeding prompt (Day-2 serve path) ────────────────────────
//
// One Sonnet call over deterministic corpus aggregates (per-session
// narrative summaries, discoveries, top files, topic fingerprints) that
// names 4–7 Features and writes cited current_understanding text. The
// PROVENANCE RULE is enforced downstream in code: every understanding
// sentence must cite a digested session ([s:<8-char id>]) and every glob
// must match a real corpus file — proposals that fail are rejected, not
// repaired.

import { z } from "zod";

export const SeededFeatureSchema = z
  .object({
    name: z.string(),
    description: z.string().optional().default(""),
    currentUnderstanding: z.string(),
    constraints: z.array(z.string()).optional().default([]),
    knownUnknowns: z.array(z.string()).optional().default([]),
    fileGlobs: z.array(z.string()).optional().default([]),
    supportingSessionIds: z.array(z.string()).optional().default([]),
  })
  .passthrough();

export const SeedFeaturesOutputSchema = z
  .object({
    features: z.array(SeededFeatureSchema),
  })
  .passthrough();

export type SeedFeaturesOutput = z.infer<typeof SeedFeaturesOutputSchema>;

export interface SessionAggregate {
  id: string;
  date: string | null;
  shape: string | null;
  narrativeSummary: string;
  discoveries: string[];
  stabilizedDirections: string[];
  topFiles: string[];
  topTopics: { fingerprint: string; count: number }[];
  momentCount: number;
}

export function buildSeedFeaturesSystemPrompt(): string {
  return [
    "You are the Brain's feature-seeding step for the intent-ai repository.",
    "You receive digested session aggregates (narrative summaries, discoveries, top files touched, topic fingerprints) from 9 real coding sessions.",
    "Derive the repository's FEATURES: the durable units of the system that these sessions built and evolved (e.g. a pipeline stage, an MCP server, an event backbone) — not one feature per session.",
    "",
    "Rules — violations cause the feature to be REJECTED by a deterministic validator:",
    "1. Propose 4 to 7 features.",
    "2. currentUnderstanding: 2-3 sentences describing what the feature IS and the key decisions that shaped it. EVERY sentence in EVERY feature's currentUnderstanding must end with one or more citations of the form [s:<first 8 chars of a session id>] pointing at the session(s) whose digest supports that sentence. Only cite sessions listed in that feature's supportingSessionIds. A feature with even one uncited sentence is DISCARDED ENTIRELY. Example of a valid understanding: \"The event backbone stores every significant action as a self-contained row with denormalized session context. [s:2b589b44] Categories were deliberately left as freeform text — an enum was considered and rejected. [s:2b589b44][s:8e312af2]\"",
    "3. Ground every claim ONLY in the provided aggregates. Do not invent capabilities, file paths, or history.",
    "4. fileGlobs: repo-relative globs (e.g. \"src/mcp/**\", \"src/storage/schema.ts\") derived ONLY from the topFiles lists. Each glob must match at least one listed file. When a feature owns a source directory (its code area, e.g. src/mcp, src/web, src/cli, src/storage), use the directory glob (\"src/mcp/**\") so future sibling files resolve to it too; use exact paths only for genuinely single-file claims. 1-5 globs per feature; features must not all claim the same broad glob.",
    "5. supportingSessionIds: full session UUIDs (from the aggregates) whose digests evidence this feature.",
    "6. constraints: hard rules an agent editing this feature must respect, taken from stabilized directions / discoveries (e.g. schema conventions, transport choices). Only include constraints the aggregates actually support.",
    "7. knownUnknowns: open questions the sessions left unresolved, if any.",
    "",
    "Respond with ONLY valid JSON matching: { \"features\": [ { \"name\", \"description\", \"currentUnderstanding\", \"constraints\": [], \"knownUnknowns\": [], \"fileGlobs\": [], \"supportingSessionIds\": [] } ] }",
  ].join("\n");
}

export function buildSeedFeaturesUserPrompt(aggregates: SessionAggregate[]): string {
  return [
    "Digested session aggregates (chronological):",
    "",
    JSON.stringify(aggregates, null, 2),
  ].join("\n");
}
