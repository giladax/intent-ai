// ── featureContext(fileOrTask) — the Brain's serve function ─────────
//
// The single entry point that turns "what am I working on" (a file path or
// a task description) into the served Feature context block: current
// understanding, recent session narratives, evidence-anchored key moments
// with verification status, constraints, and known unknowns — all built
// from the re-digested corpus (PRD MVP §Serve).
//
// brain_enter / brain_file_context / brain_feature_context serve exactly
// this output via renderFeatureContext(). On 0 or >1 Feature matches the
// candidate list is returned instead — we never silently guess.

import {
  getDefaultProjectId,
  listFeatures,
  getFeatureFileRows,
  loadFeatureContext,
} from "../storage/queries.js";
import {
  resolveFeature,
  resolveTask,
  formatCandidates,
  formatFeatureContext,
  type SessionNarrativeSummary,
  formatSessionNarrative,
} from "./feature.js";

/**
 * Structural heuristic: is the input a file path (vs. a task description)?
 * Path-shaped = a single token that ends in an extension or contains "/"
 * with no spaces. Anything with whitespace is a task, even if it mentions
 * a file. Structural regex only — no semantic classification.
 */
export function looksLikeFilePath(input: string): boolean {
  const s = input.trim();
  if (s.length === 0 || /\s/.test(s)) return false;
  return s.includes("/") || /\.[A-Za-z0-9]+$/.test(s);
}

/** Load + format one Feature's served context. Null when it doesn't exist. */
export async function renderFeatureContext(
  featureId: string,
  depth: "orientation" | "full" = "orientation",
): Promise<string | null> {
  const ctx = await loadFeatureContext(featureId);
  return ctx ? formatFeatureContext(ctx, depth) : null;
}

export { formatSessionNarrative, type SessionNarrativeSummary };

export interface FeatureContextResult {
  /** the served context block (or candidate list) — model-facing text */
  text: string;
  /** resolved Feature id when exactly one Feature won */
  featureId?: string;
  /** candidate Feature ids when resolution was ambiguous or empty */
  candidateIds: string[];
}

/**
 * Resolve a file path or task description to a Feature and return its
 * served context. This is the treatment arm of the MVP measurement: what
 * a coding agent gets when it asks the Brain before touching code.
 */
export async function featureContext(fileOrTask: string): Promise<FeatureContextResult> {
  const projectId = await getDefaultProjectId();

  if (looksLikeFilePath(fileOrTask)) {
    const rows = await getFeatureFileRows(projectId ?? undefined);
    const res = resolveFeature(fileOrTask, rows);
    if (res.featureId) {
      const text = await renderFeatureContext(res.featureId);
      if (text) return { text, featureId: res.featureId, candidateIds: res.candidateIds };
    }
    if (res.candidateIds.length > 1) {
      const features = await listFeatures(projectId ?? undefined);
      const candidates = features.filter((f) => res.candidateIds.includes(f.id));
      return {
        text: formatCandidates(candidates, `file: ${fileOrTask}`),
        candidateIds: res.candidateIds,
      };
    }
    // 0 matches for the file → fall through and try it as a task string,
    // so `featureContext()` always gives its best answer.
  }

  const features = await listFeatures(projectId ?? undefined);
  const res = resolveTask(fileOrTask, features);
  if (res.feature) {
    const text = await renderFeatureContext(res.feature.id);
    if (text) return { text, featureId: res.feature.id, candidateIds: [res.feature.id] };
  }
  return {
    text: formatCandidates(res.candidates, `task: ${fileOrTask}`),
    candidateIds: res.candidates.map((f) => f.id),
  };
}
