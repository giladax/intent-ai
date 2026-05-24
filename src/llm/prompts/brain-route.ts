import { z } from "zod";

// ── Types ──────────────────────────────────────────────────────────

export interface SpecCard {
  name: string;
  card: string;           // ~100-150 word agent-friendly summary
  fileList: string[];
  parentSpec?: string;     // tree position
}

export interface FragmentForRouting {
  index: number;
  nameHint: string;
  insightSummaries: string[];  // just the statements, compact
  files: string[];
}

export interface FileMatchScore {
  specName: string;
  score: number;           // 0.0 - 1.0: |fragment.files ∩ spec.files| / |fragment.files|
  sharedFiles: string[];
}

// ── Zod Schema ─────────────────────────────────────────────────────

const RouteResultSchema = z.object({
  specName: z.string(),
  relevance: z.enum(["high", "partial", "none"]),
  reasoning: z.string().optional().default(""),
}).passthrough();

const FragmentRouteSchema = z.object({
  fragmentIndex: z.number(),
  topMatches: z.array(RouteResultSchema),
  newTopicNeeded: z.boolean().optional().default(false),
  newTopicHint: z.string().optional().default(""),
}).passthrough();

export const RouteOutputSchema = z.object({
  routes: z.array(FragmentRouteSchema),
}).passthrough();

export type RouteOutput = z.infer<typeof RouteOutputSchema>;

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Compute file match scores between a fragment and all specs.
 * Returns specs sorted by score descending, zero-scores excluded.
 */
export function computeFileMatchScores(
  fragmentFiles: string[],
  specs: SpecCard[],
): FileMatchScore[] {
  if (fragmentFiles.length === 0) return [];

  const fragSet = new Set(fragmentFiles);
  const results: FileMatchScore[] = [];

  for (const spec of specs) {
    const shared = spec.fileList.filter(f => fragSet.has(f));
    if (shared.length > 0) {
      results.push({
        specName: spec.name,
        score: shared.length / fragmentFiles.length,
        sharedFiles: shared,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

// ── Prompt Builder ─────────────────────────────────────────────────

export function buildBrainRoutePrompt(
  specCards: SpecCard[],
  fragments: FragmentForRouting[],
  fileMatches: Map<number, FileMatchScore[]>, // fragmentIndex → scores
): { system: string; user: string } {

  const system = `You are a semantic router for a codebase knowledge graph.

TASK: For each fragment, pick the top-5 most relevant existing specs. You receive:
- Spec cards (~100 words each) describing what each spec covers
- File match scores showing which specs share files with the fragment
- The fragment's insights and files

HOW TO ROUTE:
1. Specs marked STRONG MATCH (fileScore > 0.5) are very likely relevant. Confirm or override.
2. Specs with partial file overlap (fileScore > 0) are candidates. Evaluate semantically.
3. You MAY add specs with zero file overlap if the semantic connection is clear.
4. If NO existing spec fits, set newTopicNeeded: true with a nameHint.

WHAT MAKES A GOOD MATCH:
- The fragment describes knowledge that belongs in that spec
- The fragment's files live in that spec's domain
- The fragment's insights extend or refine what the spec already covers

WHAT IS NOT A MATCH:
- The fragment merely mentions a concept the spec covers (passing reference ≠ relevance)
- The fragment is about a different aspect of a shared file

Output top-5 per fragment, ordered by relevance. Respond with valid JSON only.`;

  let user = `## Spec Cards (${specCards.length})\n\n`;
  for (const sc of specCards) {
    user += `### ${sc.name}${sc.parentSpec ? ` (child of: ${sc.parentSpec})` : " (root)"}\n`;
    user += `${sc.card}\n`;
    if (sc.fileList.length > 0) {
      user += `Files: ${sc.fileList.slice(0, 10).join(", ")}${sc.fileList.length > 10 ? ` (+${sc.fileList.length - 10} more)` : ""}\n`;
    }
    user += "\n";
  }

  user += `## Fragments to Route (${fragments.length})\n\n`;
  for (const f of fragments) {
    user += `### Fragment ${f.index}: ${f.nameHint}\n`;
    user += `Insights: ${f.insightSummaries.join("; ")}\n`;
    if (f.files.length > 0) {
      user += `Files: ${f.files.join(", ")}\n`;
    }

    // File match scores
    const matches = fileMatches.get(f.index) || [];
    if (matches.length > 0) {
      user += `File matches:\n`;
      for (const m of matches.slice(0, 10)) {
        const label = m.score > 0.5 ? "STRONG MATCH" : "partial";
        user += `  - ${m.specName}: ${(m.score * 100).toFixed(0)}% (${label}, shared: ${m.sharedFiles.join(", ")})\n`;
      }
    } else {
      user += `File matches: none\n`;
    }
    user += "\n";
  }

  user += `Route each fragment to its top-5 specs. Output format:
{
  "routes": [
    {
      "fragmentIndex": 0,
      "topMatches": [
        { "specName": "spec name", "relevance": "high" | "partial" | "none", "reasoning": "why" }
      ],
      "newTopicNeeded": false,
      "newTopicHint": ""
    }
  ]
}`;

  return { system, user };
}
