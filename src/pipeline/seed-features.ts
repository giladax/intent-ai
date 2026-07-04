// ── Feature seeding from the re-digested corpus (MVP Day-2) ─────────
//
// Derives Feature candidates from the digested corpus (narrative
// summaries, files touched, topic fingerprints), names them with ONE
// Sonnet call, then deterministically VALIDATES every proposal against
// the provenance rule before anything is written:
//   - every understanding sentence must cite a digested session [s:xxxxxxxx]
//   - every file glob must match a real corpus file
//   - every supporting session id must be a digested session
// Rejected proposals are reported, never repaired. Accepted features are
// written to features + feature_files + feature_sessions and announced on
// the journal as `feature:seeded` activity events (emit failures never
// fail the seeding itself).

import { randomUUID } from "crypto";
import { getClient } from "../storage/connection.js";
import { emitEvents } from "../storage/queries.js";
import type { ActivityEvent } from "../adapters/types.js";
import { globToRegExp, normalizePath } from "../mcp/feature.js";
import { callSonnet } from "../llm/client.js";
import {
  buildSeedFeaturesSystemPrompt,
  buildSeedFeaturesUserPrompt,
  SeedFeaturesOutputSchema,
  type SessionAggregate,
} from "../llm/prompts/seed-features.js";

// ── Pure helpers (unit-tested) ───────────────────────────────────────

/** Convert an absolute corpus path to repo-relative. Null if outside the
 *  repo. Tolerates paths whose leading "/" was stripped upstream. */
export function toRepoRelative(path: string, repoRoot: string): string | null {
  const p = path.trim();
  const root = repoRoot.replace(/\/+$/, "");
  const rootNoSlash = root.replace(/^\/+/, "");
  if (p.startsWith(root + "/")) return p.slice(root.length + 1);
  if (p.startsWith(rootNoSlash + "/")) return p.slice(rootNoSlash.length + 1);
  if (!p.startsWith("/")) return p; // already repo-relative
  return null;
}

export interface SeededFeatureProposal {
  name: string;
  description: string;
  currentUnderstanding: string;
  constraints: string[];
  knownUnknowns: string[];
  fileGlobs: string[];
  supportingSessionIds: string[];
}

export type ValidatedFeature = SeededFeatureProposal;

export interface RejectedFeature {
  name: string;
  reason: string;
}

function extractCitations(understanding: string): string[] {
  const out: string[] = [];
  const re = /\[s:([0-9a-fA-F]{8})\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(understanding)) !== null) out.push(m[1].toLowerCase());
  return out;
}

function globMatchesAny(glob: string, corpusFiles: string[]): boolean {
  const pat = normalizePath(glob);
  const re = globToRegExp(pat);
  return corpusFiles.some((f) => f === pat || re.test(f));
}

/**
 * Deterministic provenance gate over the LLM's proposals. corpusFiles are
 * repo-relative paths actually touched in the digested corpus.
 */
export function validateSeededFeatures(
  proposals: SeededFeatureProposal[],
  knownSessionIds: string[],
  corpusFiles: string[],
): { accepted: ValidatedFeature[]; rejected: RejectedFeature[] } {
  const accepted: ValidatedFeature[] = [];
  const rejected: RejectedFeature[] = [];
  const known = new Set(knownSessionIds);

  for (const p of proposals) {
    const validGlobs = p.fileGlobs.filter((g) => globMatchesAny(g, corpusFiles));
    if (validGlobs.length === 0) {
      rejected.push({ name: p.name, reason: "no glob matches any corpus file" });
      continue;
    }

    const validSessions = p.supportingSessionIds.filter((id) => known.has(id));
    if (validSessions.length === 0) {
      rejected.push({ name: p.name, reason: "no valid supporting session ids" });
      continue;
    }

    const citations = extractCitations(p.currentUnderstanding);
    if (citations.length === 0) {
      rejected.push({
        name: p.name,
        reason: "understanding has no [s:...] citation (provenance rule)",
      });
      continue;
    }
    const unresolved = citations.filter(
      (c) => !validSessions.some((id) => id.toLowerCase().startsWith(c)),
    );
    if (unresolved.length > 0) {
      rejected.push({
        name: p.name,
        reason: `citation(s) do not resolve to supporting sessions: ${unresolved.join(", ")}`,
      });
      continue;
    }

    accepted.push({ ...p, fileGlobs: validGlobs, supportingSessionIds: validSessions });
  }

  return { accepted, rejected };
}

/** Journal events announcing what the Brain just learned. */
export function buildSeedEvents(
  seeded: { feature: ValidatedFeature; featureId: string }[],
  repo?: string,
  branch?: string,
): ActivityEvent[] {
  return seeded.map(({ feature, featureId }) => ({
    timestamp: new Date(),
    category: "feature:seeded",
    tags: ["feature", "seed", "brain"],
    actor: "system",
    summary: `Brain seeded Feature "${feature.name}" from ${feature.supportingSessionIds.length} digested session${feature.supportingSessionIds.length === 1 ? "" : "s"}`,
    metadata: {
      featureId,
      supportingSessionIds: feature.supportingSessionIds,
      fileGlobs: feature.fileGlobs,
      understanding: feature.currentUnderstanding,
      seededFrom: "re-digested corpus (2026-07-04)",
    },
    sourceType: "feature-seed",
    sourceId: featureId,
    repo,
    branch,
    files: feature.fileGlobs,
  }));
}

// ── Corpus aggregation (deterministic, DB-backed) ───────────────────

interface CorpusData {
  projectId: string;
  repoRoot: string;
  aggregates: SessionAggregate[];
  corpusFiles: string[];
}

export async function collectCorpusData(): Promise<CorpusData> {
  const sql = getClient();

  const projects = await sql`SELECT id, name, path FROM projects ORDER BY created_at LIMIT 1`;
  if (!projects.length) throw new Error("No project row — run a digest first.");
  const projectId = projects[0].id as string;
  const repoRoot = projects[0].path as string;

  const sessionRows = await sql`
    SELECT s.id, s.session_shape, s.started_at,
           n.summary, n.discoveries, n.stabilized_directions
    FROM sessions s
    LEFT JOIN narratives n ON n.session_id = s.id
    ORDER BY s.started_at ASC NULLS LAST`;

  const fileRows = await sql`
    SELECT session_id, f, count(*) AS n
    FROM (SELECT session_id, unnest(files_affected) AS f FROM normalized_events) t
    GROUP BY session_id, f`;

  const topicRows = await sql`
    SELECT session_id, topic_fingerprint, count(*) AS n
    FROM moments
    WHERE topic_fingerprint IS NOT NULL AND topic_fingerprint <> ''
    GROUP BY session_id, topic_fingerprint`;

  const momentCounts = await sql`
    SELECT session_id, count(*) AS n FROM moments GROUP BY session_id`;

  const filesBySession = new Map<string, { file: string; count: number }[]>();
  const corpusFileSet = new Set<string>();
  for (const r of fileRows) {
    const rel = toRepoRelative(r.f as string, repoRoot);
    if (!rel) continue;
    corpusFileSet.add(rel);
    const list = filesBySession.get(r.session_id as string) ?? [];
    list.push({ file: rel, count: Number(r.n) });
    filesBySession.set(r.session_id as string, list);
  }

  const topicsBySession = new Map<string, { fingerprint: string; count: number }[]>();
  for (const r of topicRows) {
    const list = topicsBySession.get(r.session_id as string) ?? [];
    list.push({ fingerprint: r.topic_fingerprint as string, count: Number(r.n) });
    topicsBySession.set(r.session_id as string, list);
  }

  const momentCountBySession = new Map<string, number>();
  for (const r of momentCounts) momentCountBySession.set(r.session_id as string, Number(r.n));

  const aggregates: SessionAggregate[] = sessionRows.map((s: any) => ({
    id: s.id as string,
    date: s.started_at ? new Date(s.started_at).toISOString().slice(0, 10) : null,
    shape: (s.session_shape as string | null) ?? null,
    narrativeSummary: (s.summary as string | null) ?? "(no narrative)",
    discoveries: (s.discoveries as string[] | null) ?? [],
    stabilizedDirections: (s.stabilized_directions as string[] | null) ?? [],
    topFiles: (filesBySession.get(s.id as string) ?? [])
      .sort((a, b) => b.count - a.count)
      .slice(0, 12)
      .map((f) => f.file),
    topTopics: (topicsBySession.get(s.id as string) ?? [])
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    momentCount: momentCountBySession.get(s.id as string) ?? 0,
  }));

  return { projectId, repoRoot, aggregates, corpusFiles: [...corpusFileSet] };
}

// ── Seeding entry point ──────────────────────────────────────────────

export interface SeedResult {
  seeded: { featureId: string; feature: ValidatedFeature }[];
  rejected: RejectedFeature[];
  dryRun: boolean;
}

export async function seedFeatures(opts: { dryRun?: boolean } = {}): Promise<SeedResult> {
  const sql = getClient();

  const existing = await sql`SELECT count(*) AS n FROM features`;
  if (Number(existing[0].n) > 0) {
    throw new Error(
      `features table already has ${existing[0].n} rows — seeding is a one-shot bootstrap. Clear features/feature_files/feature_sessions first if you mean to re-seed.`,
    );
  }

  const { projectId, aggregates, corpusFiles } = await collectCorpusData();
  const sessionIds = aggregates.map((a) => a.id);

  process.stderr.write(
    `Seeding from ${aggregates.length} digested sessions, ${corpusFiles.length} distinct corpus files...\n`,
  );

  const output = await callSonnet(
    buildSeedFeaturesSystemPrompt(),
    buildSeedFeaturesUserPrompt(aggregates),
    SeedFeaturesOutputSchema,
  );

  const { accepted, rejected } = validateSeededFeatures(
    output.features as SeededFeatureProposal[],
    sessionIds,
    corpusFiles,
  );

  for (const r of rejected) {
    process.stderr.write(`  ✗ rejected "${r.name}": ${r.reason}\n`);
  }

  if (opts.dryRun) {
    return {
      seeded: accepted.map((f) => ({ featureId: "(dry-run)", feature: f })),
      rejected,
      dryRun: true,
    };
  }

  const seeded: { featureId: string; feature: ValidatedFeature }[] = [];
  for (const f of accepted) {
    const featureId = randomUUID();
    await sql`
      INSERT INTO features (id, project_id, name, description, current_understanding, constraints, known_unknowns, created_at)
      VALUES (${featureId}, ${projectId}, ${f.name}, ${f.description},
              ${f.currentUnderstanding}, ${JSON.stringify(f.constraints)},
              ${JSON.stringify(f.knownUnknowns)}, NOW())`;
    for (const glob of f.fileGlobs) {
      await sql`INSERT INTO feature_files (id, feature_id, glob, created_at)
        VALUES (${randomUUID()}, ${featureId}, ${glob}, NOW())`;
    }
    for (const sessionId of f.supportingSessionIds) {
      await sql`INSERT INTO feature_sessions (feature_id, session_id, role)
        VALUES (${featureId}, ${sessionId}, ${"evidence"})
        ON CONFLICT DO NOTHING`;
    }
    seeded.push({ featureId, feature: f });
    process.stderr.write(`  ✓ seeded "${f.name}" (${f.fileGlobs.join(", ")})\n`);
  }

  // Story-time: announce the seeding on the journal. Never fail the seed.
  try {
    const { getRepoContext } = await import("../mcp/instrument.js");
    const repoCtx = getRepoContext();
    await emitEvents(buildSeedEvents(seeded, repoCtx.repo, repoCtx.branch));
  } catch (err) {
    process.stderr.write(
      `  ⚠ could not emit feature:seeded events: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  return { seeded, rejected, dryRun: false };
}
