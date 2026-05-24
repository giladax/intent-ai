import { BrainCard } from "../adapters/types.js";

const MAX_SUMMARY_WORDS = 150;
const MAX_INSIGHTS = 5;
const MAX_INSIGHTS_PER_CATEGORY = 2;

/**
 * Truncate a summary to at most maxWords words.
 * Appends "..." if truncated.
 */
function truncateSummary(summary: string, maxWords: number = MAX_SUMMARY_WORDS): string {
  const words = summary.split(/\s+/);
  if (words.length <= maxWords) return summary;
  return words.slice(0, maxWords).join(" ") + "...";
}

/**
 * Select top insights: deduplicate by statement, sort by confidence descending,
 * take top MAX_INSIGHTS with at most MAX_INSIGHTS_PER_CATEGORY per category.
 */
function selectTopInsights(
  insights: { category: string; statement: string; confidence?: number }[]
): { category: string; statement: string }[] {
  // Deduplicate by exact statement
  const seen = new Set<string>();
  const deduped = insights.filter((ins) => {
    if (seen.has(ins.statement)) return false;
    seen.add(ins.statement);
    return true;
  });

  // Sort by confidence descending (treat missing confidence as 0)
  const sorted = [...deduped].sort(
    (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)
  );

  // Take top MAX_INSIGHTS with at most MAX_INSIGHTS_PER_CATEGORY per category
  const categoryCounts: Record<string, number> = {};
  const selected: { category: string; statement: string }[] = [];

  for (const ins of sorted) {
    if (selected.length >= MAX_INSIGHTS) break;
    const count = categoryCounts[ins.category] ?? 0;
    if (count >= MAX_INSIGHTS_PER_CATEGORY) continue;
    categoryCounts[ins.category] = count + 1;
    selected.push({ category: ins.category, statement: ins.statement });
  }

  return selected;
}

/**
 * Generate a BrainCard from a full spec input.
 * Pure function — no LLM, deterministic compression.
 */
export function generateCard(input: {
  name: string;
  level: "area" | "spec" | "file";
  summary: string;
  insights: { category: string; statement: string; confidence?: number }[];
  fileRefs?: { path: string; role: string }[];
  parent?: string | null;
  children?: string[];
  related?: string[];
  sessions?: string[];
  versionId?: string;
  path?: string | null;
  exports?: string[];
}): BrainCard {
  const summary = truncateSummary(input.summary);
  const insights = selectTopInsights(input.insights);
  const files = input.fileRefs?.map((ref) => ref.path);

  const card: BrainCard = {
    name: input.name,
    level: input.level,
    summary,
    insights,
    sessions: input.sessions ?? [],
  };

  if (input.parent !== undefined) card.parent = input.parent;
  if (input.children !== undefined) card.children = input.children;
  if (input.related !== undefined) card.related = input.related;
  if (input.versionId !== undefined) card.versionId = input.versionId;

  // File-level fields
  if (input.path !== undefined) card.path = input.path;
  if (input.exports !== undefined) card.exports = input.exports;

  // Spec/area-level key files extracted from fileRefs
  if (files !== undefined && files.length > 0) card.files = files;

  return card;
}
