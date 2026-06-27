// ── Feature resolution + formatting (PRD v0.3) ──────────────────────
//
// Pure, DB-free helpers behind the Feature-scoped MCP tools:
//   - file → Feature resolution via the file↔Feature map (longest-glob-wins)
//   - task → Feature fuzzy matching over name/description
//   - candidate-list and featureContext text formatting
//
// brain.enter never silently guesses: on 0 or >1 matching Features it
// returns the CANDIDATE LIST for the agent to pick. All matching here is
// STRUCTURAL (glob → regex over file paths), which is an allowed use of
// regex — semantic/behavioral classification must use an LLM, not regex.

import type {
  FeatureRecord,
  FeatureContextData,
  FeatureFileRow,
} from "../storage/queries.js";

// ── Text scoring (shared with the topic tools via re-export) ─────────

export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export function fuzzyScore(query: string, text: string): number {
  const qTokens = tokenize(query);
  const tTokens = new Set(tokenize(text));
  if (qTokens.length === 0) return 0;

  if (text.toLowerCase().includes(query.toLowerCase())) return 1.0;

  let hits = 0;
  for (const q of qTokens) {
    if (tTokens.has(q)) { hits += 1; continue; }
    for (const t of tTokens) {
      if (t.includes(q) || q.includes(t)) { hits += 0.5; break; }
    }
  }
  return hits / qTokens.length;
}

// ── Glob matching (structural) ──────────────────────────────────────

/** Normalize a path/glob for comparison: drop a leading "./" and "/". */
export function normalizePath(p: string): string {
  return p.replace(/^\.\//, "").replace(/^\/+/, "").trim();
}

/**
 * Convert a glob to a RegExp.
 *  - `**` matches any characters including `/` (and an optional trailing `/`)
 *  - `*` matches any characters except `/`
 *  - `?` matches a single non-`/` character
 * All other regex metacharacters are escaped.
 */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++; // `src/**` should match `src/a/b`
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$+.()|[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

interface PatternMatch {
  featureId: string;
  /** specificity = matched pattern length; longer wins */
  specificity: number;
}

/** All feature_files rows whose pattern matches the given file path. */
export function matchingRows(filePath: string, rows: FeatureFileRow[]): PatternMatch[] {
  const target = normalizePath(filePath);
  const out: PatternMatch[] = [];
  for (const row of rows) {
    if (row.glob) {
      const pat = normalizePath(row.glob);
      if (globToRegExp(pat).test(target)) {
        out.push({ featureId: row.featureId, specificity: pat.length });
      }
    } else if (row.filePath) {
      const pat = normalizePath(row.filePath);
      // exact, or suffix match either direction (handles abs vs rel paths)
      if (pat === target || target.endsWith(pat) || pat.endsWith(target)) {
        out.push({ featureId: row.featureId, specificity: pat.length });
      }
    }
  }
  return out;
}

export interface FeatureResolution {
  /** set only when exactly one Feature wins */
  featureId?: string;
  /** candidate Feature ids when 0 or >1 match */
  candidateIds: string[];
}

/**
 * Resolve a file to a Feature via longest-glob-wins. When exactly one
 * Feature has the longest matching pattern, it is returned. On 0 matches
 * or a tie across Features, the candidate list is returned instead.
 */
export function resolveFeature(filePath: string, rows: FeatureFileRow[]): FeatureResolution {
  const matches = matchingRows(filePath, rows);
  if (matches.length === 0) return { candidateIds: [] };

  // Best (longest) matching pattern per Feature.
  const bestByFeature = new Map<string, number>();
  for (const m of matches) {
    if (m.specificity > (bestByFeature.get(m.featureId) ?? -1)) {
      bestByFeature.set(m.featureId, m.specificity);
    }
  }

  let maxLen = -1;
  for (const len of bestByFeature.values()) if (len > maxLen) maxLen = len;
  const winners = [...bestByFeature.entries()]
    .filter(([, len]) => len === maxLen)
    .map(([id]) => id);

  if (winners.length === 1) return { featureId: winners[0], candidateIds: winners };
  return { candidateIds: [...bestByFeature.keys()] };
}

// ── Task → Feature matching ─────────────────────────────────────────

export interface TaskScore {
  feature: FeatureRecord;
  score: number;
}

/** Score Features against a task/goal string (name weighted over description). */
export function scoreFeaturesForTask(task: string, features: FeatureRecord[]): TaskScore[] {
  return features
    .map((feature) => {
      const nameScore = fuzzyScore(task, feature.name) * 2.0;
      const descScore = fuzzyScore(task, feature.description ?? "") * 1.0;
      return { feature, score: Math.max(nameScore, descScore) };
    })
    .sort((a, b) => b.score - a.score);
}

export interface TaskResolution {
  feature?: FeatureRecord;
  candidates: FeatureRecord[];
}

/**
 * Resolve a task to a Feature. Exactly one Feature above threshold → match;
 * otherwise return candidates (0 matches → top-N for the agent to pick).
 */
export function resolveTask(
  task: string,
  features: FeatureRecord[],
  threshold = 0.3,
): TaskResolution {
  const scored = scoreFeaturesForTask(task, features);
  const above = scored.filter((s) => s.score >= threshold);
  if (above.length === 1) return { feature: above[0].feature, candidates: [above[0].feature] };
  if (above.length > 1) return { candidates: above.map((s) => s.feature) };
  // 0 above threshold → offer the top few non-zero candidates.
  return { candidates: scored.filter((s) => s.score > 0).slice(0, 5).map((s) => s.feature) };
}

// ── Formatting ──────────────────────────────────────────────────────

/** Deterministic "how to work here safely" instruction (mental model, not changelog). */
export function buildAgentInstructions(ctx: FeatureContextData): string {
  const lines: string[] = [];
  const { feature } = ctx;
  if (feature.constraints.length > 0) {
    lines.push(
      `Respect these constraints before editing: ${feature.constraints.join("; ")}.`,
    );
  }
  if (feature.knownUnknowns.length > 0) {
    lines.push(`Open questions to watch for: ${feature.knownUnknowns.join("; ")}.`);
  }
  if (ctx.relevantFiles.length > 0) {
    lines.push(`Touch points: ${ctx.relevantFiles.slice(0, 8).join(", ")}.`);
  }
  lines.push(
    "Report observations, unknowns, and a context-quality rating back to Brain when done.",
  );
  return lines.join(" ");
}

export function formatCandidates(features: FeatureRecord[], reason: string): string {
  if (features.length === 0) {
    return `No Feature matched (${reason}). Use brain_enter again with a different file/task, or create the file↔Feature mapping first.`;
  }
  const lines = [`Multiple/ambiguous Feature candidates (${reason}). Pick one and call brain_feature_context(featureId):\n`];
  for (const f of features) {
    const summary = (f.description || f.currentUnderstanding || "").slice(0, 140);
    lines.push(`- ${f.name}  [id: ${f.id}]${summary ? ` — ${summary}` : ""}`);
  }
  return lines.join("\n");
}

export function formatFeatureContext(ctx: FeatureContextData): string {
  const { feature } = ctx;
  const parts: string[] = [];
  parts.push(`# Feature: ${feature.name}  [id: ${feature.id}]`);

  if (feature.description) parts.push(`\n${feature.description}`);

  // Current understanding = stored text + approved observations (assembled).
  const understanding: string[] = [];
  if (feature.currentUnderstanding) understanding.push(feature.currentUnderstanding);
  for (const o of ctx.approvedObservations) understanding.push(`- ${o.summary}`);
  if (understanding.length > 0) {
    parts.push(`\n## Current Understanding\n\n${understanding.join("\n")}`);
  }

  if (feature.constraints.length > 0) {
    parts.push(`\n## Constraints\n\n${feature.constraints.map((c) => `- ${c}`).join("\n")}`);
  }

  if (ctx.relevantFiles.length > 0) {
    parts.push(`\n## Relevant Files\n\n${ctx.relevantFiles.map((f) => `- \`${f}\``).join("\n")}`);
  }

  if (ctx.relatedSessions.length > 0) {
    parts.push(
      `\n## Related Sessions\n\n${ctx.relatedSessions
        .slice(0, 8)
        .map((s) => `- ${s.summary} (${s.shape ?? "session"}${s.role ? `, ${s.role}` : ""})`)
        .join("\n")}`,
    );
  }

  const unknowns = [
    ...feature.knownUnknowns,
    ...ctx.reportedUnknowns.map((o) => o.summary),
  ];
  if (unknowns.length > 0) {
    parts.push(`\n## Known Unknowns\n\n${unknowns.map((u) => `- ${u}`).join("\n")}`);
  }

  parts.push(`\n## Agent Instructions\n\n${buildAgentInstructions(ctx)}`);

  return parts.join("\n");
}
