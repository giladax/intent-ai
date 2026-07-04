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
  FeatureMomentRow,
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

/**
 * Does a file path (possibly absolute) match any of the Feature's patterns
 * (repo-relative globs or exact paths)? Absolute corpus paths are handled by
 * testing every path-segment suffix against the glob — structural matching
 * only, no repo-root knowledge required.
 */
export function fileMatchesPatterns(file: string, patterns: string[]): boolean {
  const target = normalizePath(file);
  const segments = target.split("/");
  for (const p of patterns) {
    const pat = normalizePath(p);
    if (pat === target || target.endsWith("/" + pat)) return true;
    const re = globToRegExp(pat);
    for (let i = 0; i < segments.length; i++) {
      if (re.test(segments.slice(i).join("/"))) return true;
    }
  }
  return false;
}

// ── Key-moment selection (served evidence) ──────────────────────────
//
// Deterministic ranking over the Feature's digested moments. Eligibility:
// high/medium confidence AND an anchored evidence quote (the provenance
// rule — no quote, no serving). Rank: confidence, file overlap with the
// Feature's patterns, verification status; recency breaks ties.

const KEY_MOMENT_LIMIT = 8;

function keyMomentScore(m: FeatureMomentRow, patterns: string[]): number {
  let score = m.confidence === "high" ? 2 : 1;
  if (patterns.length > 0 && m.files.some((f) => fileMatchesPatterns(f, patterns))) {
    score += 1.5;
  }
  if (m.verification === "supported") score += 0.5;
  if (m.verification === "contradicted") score -= 2;
  return score;
}

export function selectKeyMoments(
  candidates: FeatureMomentRow[],
  patterns: string[],
  limit = KEY_MOMENT_LIMIT,
): FeatureMomentRow[] {
  return candidates
    .filter(
      (m) =>
        (m.confidence === "high" || m.confidence === "medium") &&
        typeof m.quote === "string" &&
        m.quote.trim().length > 0,
    )
    .map((m) => ({ m, score: keyMomentScore(m, patterns) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const at = a.m.occurredAt?.getTime() ?? 0;
      const bt = b.m.occurredAt?.getTime() ?? 0;
      return bt - at;
    })
    .slice(0, limit)
    .map((s) => s.m);
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

/**
 * Terse orientation block (~15 lines): verdict-grade understanding, constraints
 * (if ≤3), and drill handles so the agent can pull depth on demand.
 * This is the default serve shape — orientation first, drill on demand.
 */
export function formatFeatureOrientation(ctx: FeatureContextData): string {
  const { feature } = ctx;
  const lines: string[] = [];

  lines.push(`Feature: ${feature.name}  [id: ${feature.id}]`);

  // Verdict-grade understanding: first 2-3 sentences of assembled understanding.
  const understandingParts: string[] = [];
  if (feature.currentUnderstanding) understandingParts.push(feature.currentUnderstanding);
  for (const o of ctx.approvedObservations) understandingParts.push(o.summary);
  if (understandingParts.length > 0) {
    const full = understandingParts.join(" ");
    // Split on sentence boundaries; take first 3 sentences.
    const sentences = full.match(/[^.!?]+[.!?]+/g) ?? [full];
    const verdict = sentences.slice(0, 3).join(" ").trim();
    lines.push(`\nUnderstanding: ${verdict}`);
  }

  // Constraints earn their tokens — always include if ≤3; skip if >3 (tell agent to drill).
  if (feature.constraints.length > 0 && feature.constraints.length <= 3) {
    lines.push(`\nConstraints:`);
    for (const c of feature.constraints) lines.push(`  · ${c}`);
  } else if (feature.constraints.length > 3) {
    lines.push(`\nConstraints: ${feature.constraints.length} — call brain_feature_context("${feature.id}", depth: "full") to see all.`);
  }

  // Drill handles: counts + ids so the agent can pull exactly what it needs.
  const keyMoments = selectKeyMoments(ctx.momentCandidates, ctx.relevantFiles);
  const sessionIds = ctx.relatedSessions.slice(0, 3).map((s) => s.id.slice(0, 8) + "…");
  const drillParts: string[] = [];
  if (keyMoments.length > 0) {
    const momentIds = keyMoments.slice(0, 3).map((m) => m.id.slice(0, 8) + "…").join(", ");
    drillParts.push(`${keyMoments.length} moment${keyMoments.length === 1 ? "" : "s"} (ids: ${momentIds}) → brain_moments("${feature.id}")`);
  }
  if (ctx.relatedSessions.length > 0) {
    drillParts.push(`${ctx.relatedSessions.length} session${ctx.relatedSessions.length === 1 ? "" : "s"} (s: ${sessionIds.join(", ")}) → brain_narrative(sessionId)`);
  }
  if (keyMoments.length > 0) {
    drillParts.push(`evidence per moment → brain_evidence(momentId)`);
  }
  if (drillParts.length > 0) {
    lines.push(`\nDrill:`);
    for (const d of drillParts) lines.push(`  · ${d}`);
  }

  lines.push(`\nFor full context (moments+evidence+sessions+files): brain_feature_context("${feature.id}", depth: "full")`);

  return lines.join("\n");
}

/**
 * Full assembled context block — the original rich format.
 * Returned when depth:"full" is requested (backward compat).
 */
export function formatFeatureContextFull(ctx: FeatureContextData): string {
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

  // Key moments: digested, evidence-anchored claims from this Feature's
  // sessions — confidence + verification shown so the agent can weigh them.
  const keyMoments = selectKeyMoments(ctx.momentCandidates, ctx.relevantFiles);
  if (keyMoments.length > 0) {
    const lines = keyMoments.map((m) => {
      const day = m.occurredAt ? m.occurredAt.toISOString().slice(0, 10) : "undated";
      const verification = m.verification && m.verification.trim() ? m.verification : "unverified";
      const quote = (m.quote ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
      return `- [${m.confidence}, ${verification}] ${m.statement} (${day})\n  > "${quote}"`;
    });
    parts.push(`\n## Key Moments (evidence-anchored)\n\n${lines.join("\n")}`);
  }

  if (ctx.relevantFiles.length > 0) {
    parts.push(`\n## Relevant Files\n\n${ctx.relevantFiles.map((f) => `- \`${f}\``).join("\n")}`);
  }

  if (ctx.relatedSessions.length > 0) {
    parts.push(
      `\n## Related Sessions\n\n${ctx.relatedSessions
        .slice(0, 8)
        .map((s) => {
          const day = s.startedAt ? `${s.startedAt.toISOString().slice(0, 10)} — ` : "";
          return `- ${day}${s.summary} (${s.shape ?? "session"}${s.role ? `, ${s.role}` : ""})`;
        })
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

/**
 * Default entry point: orientation by default, full on demand.
 * The depth param is the backward-compat escape hatch.
 */
export function formatFeatureContext(
  ctx: FeatureContextData,
  depth: "orientation" | "full" = "orientation",
): string {
  return depth === "full" ? formatFeatureContextFull(ctx) : formatFeatureOrientation(ctx);
}

// ── Drill tool formatters ────────────────────────────────────────────

/**
 * Terse moment list for brain_moments: statement + confidence/verification + id.
 * No evidence quotes — those come from brain_evidence(momentId).
 */
export function formatMomentList(moments: FeatureMomentRow[]): string {
  if (moments.length === 0) return "No moments available for this Feature.";
  const lines = moments.map((m) => {
    const conf = m.confidence ?? "?";
    const verif = m.verification ?? "unverified";
    const day = m.occurredAt ? m.occurredAt.toISOString().slice(0, 10) : "undated";
    const hasEvidence = typeof m.quote === "string" && m.quote.trim().length > 0;
    return `[${m.id.slice(0, 8)}…] [${conf}, ${verif}] ${m.statement} (${day})${hasEvidence ? " · evidence: brain_evidence(\"" + m.id + "\")" : ""}`;
  });
  lines.push(`\nUse brain_evidence(momentId) for anchored quotes.`);
  return lines.join("\n");
}

/**
 * Evidence detail for brain_evidence(momentId): the anchored quotes +
 * transcript refs. Used after brain_moments to pull provenance for a
 * specific claim.
 */
export interface MomentEvidenceItem {
  quote: string;
  sourceType: string;
  quoteType: string | null;
  sourceEventId: string | null;
}

export function formatMomentEvidence(
  momentId: string,
  statement: string,
  evidence: MomentEvidenceItem[],
): string {
  if (evidence.length === 0) {
    return `Moment ${momentId.slice(0, 8)}… has no stored evidence quotes.`;
  }
  const lines: string[] = [
    `Moment [${momentId.slice(0, 8)}…]: ${statement}`,
    ``,
    `Evidence (${evidence.length} quote${evidence.length === 1 ? "" : "s"}):`,
  ];
  for (const e of evidence) {
    const ref = e.sourceEventId ? ` [event: ${e.sourceEventId.slice(0, 8)}…]` : "";
    const qt = e.quoteType ? ` (${e.quoteType})` : "";
    lines.push(`  > "${e.quote.replace(/\s+/g, " ").trim().slice(0, 300)}"${qt} · ${e.sourceType}${ref}`);
  }
  return lines.join("\n");
}

/**
 * Narrative summary for brain_narrative(sessionId): the session's summary +
 * progression + key discoveries. Compact enough for on-demand reads.
 */
export interface SessionNarrativeSummary {
  sessionId: string;
  sessionShape: string;
  summary: string;
  progression: string[];
  discoveries: string[];
}

export function formatSessionNarrative(n: SessionNarrativeSummary): string {
  const lines: string[] = [
    `Session ${n.sessionId.slice(0, 8)}… (${n.sessionShape})`,
    ``,
    `Summary: ${n.summary}`,
  ];
  if (n.progression.length > 0) {
    lines.push(`\nProgression:`);
    for (const p of n.progression) lines.push(`  · ${p}`);
  }
  if (n.discoveries.length > 0) {
    lines.push(`\nDiscoveries:`);
    for (const d of n.discoveries) lines.push(`  · ${d}`);
  }
  return lines.join("\n");
}
