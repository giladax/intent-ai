/**
 * Run all organize prompt variants against the same extracted fragments.
 * Compares tree structure produced by each.
 *
 * Usage: npx tsx tests/experiments/run-organize-variants.ts
 */
import "dotenv/config";
import { callHaiku } from "../../src/llm/client.js";
import { buildBrainOrganizePrompt, GraphPlanSchema } from "../../src/llm/prompts/brain-organize.js";
import { buildBrainOrganizePrompt as buildGen2a, GraphPlanSchema as Schema2a } from "../../src/llm/prompts/brain-organize-gen2a.js";
import { buildBrainOrganizePrompt as buildGen2b, GraphPlanSchema as Schema2b } from "../../src/llm/prompts/brain-organize-gen2b.js";
import { buildBrainOrganizePrompt as buildGen2c, GraphPlanSchema as Schema2c } from "../../src/llm/prompts/brain-organize-gen2c.js";
import { buildBrainExtractPrompt, SpecFragmentOutputSchema } from "../../src/llm/prompts/brain-extract.js";
import { callSonnet } from "../../src/llm/client.js";
import { getClient, closeDb } from "../../src/storage/connection.js";
import type { ExistingSpec, OrganizeSignals } from "../../src/llm/prompts/brain-organize.js";
import type { SpecFragment } from "../../src/llm/prompts/brain-extract.js";

const SESSION_IDS = [
  "c2cc3386-6bb1-4d7e-88c5-08688b7329c8",
  "bfd47498-d708-4cb1-a8ea-c024a4f3013d",
  "140b010e-9cf9-4514-8fba-ac3ffed21a5d",
];

async function extractFromSession(sessionId: string): Promise<SpecFragment[]> {
  const sql = getClient();
  const [narrative] = await sql`SELECT summary, abandoned_directions FROM narratives WHERE session_id = ${sessionId}`;
  if (!narrative) throw new Error(`No narrative for ${sessionId}`);
  const arcs = await sql`SELECT title, resolution FROM narrative_arcs WHERE narrative_id = (SELECT id FROM narratives WHERE session_id = ${sessionId})`;
  const moments = await sql`SELECT id, type, statement, agency, significance FROM moments WHERE session_id = ${sessionId} ORDER BY id`;
  const outcomes = await sql`SELECT o.statement, COALESCE(array_agg(of.file_path) FILTER (WHERE of.file_path IS NOT NULL), '{}') as files FROM outcomes o LEFT JOIN outcome_files of ON of.outcome_id = o.id WHERE o.session_id = ${sessionId} GROUP BY o.id, o.statement`;
  const fileRows = await sql`SELECT DISTINCT unnest(files_affected) as file_path FROM normalized_events WHERE session_id = ${sessionId} AND files_affected IS NOT NULL`;

  const input = {
    sessionNarrative: {
      summary: narrative.summary,
      arcs: arcs.map((a: any) => ({ title: a.title, resolution: a.resolution || "open" })),
      abandonedDirections: narrative.abandoned_directions || [],
    },
    moments: moments.map((m: any) => ({ id: m.id, type: m.type, statement: m.statement, agency: m.agency || "collaborative", significance: m.significance || "" })),
    outcomes: outcomes.map((o: any) => ({ statement: o.statement, files: o.files.filter((f: string) => f) })),
    filesTouched: fileRows.map((r: any) => r.file_path),
  };

  const { system, user } = buildBrainExtractPrompt(input);
  const result = await callSonnet(system, user, SpecFragmentOutputSchema);
  return result.fragments;
}

function printTree(plan: any, label: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${label}`);
  console.log("=".repeat(60));

  // Collect roots and children
  const roots = new Set<string>();
  const children = new Map<string, string[]>(); // parent -> children
  const allSpecs = new Set<string>();

  for (const a of plan.assignments) {
    allSpecs.add(a.targetSpec);
    if (a.parentSpec) {
      const list = children.get(a.parentSpec) || [];
      if (!list.includes(a.targetSpec)) list.push(a.targetSpec);
      children.set(a.parentSpec, list);
    } else {
      roots.add(a.targetSpec);
    }
  }

  // Merges
  if (plan.merges?.length > 0) {
    console.log(`\n  Merges: ${plan.merges.map((m: any) => `${m.specs.join(" + ")} → ${m.intoName}`).join(", ")}`);
  }

  // Remove children from roots
  for (const [, kids] of children) {
    for (const k of kids) roots.delete(k);
  }

  // Print tree
  console.log("");
  for (const root of roots) {
    console.log(`  ${root}`);
    const kids = children.get(root) || [];
    for (const kid of kids) {
      console.log(`    └── ${kid}`);
      const grandkids = children.get(kid) || [];
      for (const gk of grandkids) {
        console.log(`        └── ${gk}`);
      }
    }
  }

  // Stats
  const childCount = [...children.values()].reduce((sum, arr) => sum + arr.length, 0);
  console.log(`\n  Roots: ${roots.size} | Children: ${childCount} | Total specs: ${allSpecs.size}`);

  // ConceptualMap if present
  if (plan.conceptualMap?.length > 0) {
    console.log(`\n  ConceptualMap:`);
    for (const g of plan.conceptualMap) {
      console.log(`    ${g.name}: ${g.children?.join(", ") || "(no children)"}`);
    }
  }
}

async function main() {
  console.log("Extracting fragments from 3 sessions...");
  const fragmentArrays = await Promise.all(SESSION_IDS.map(extractFromSession));
  const fragments = fragmentArrays.flat();
  console.log(`Extracted ${fragments.length} fragments.`);

  // No existing specs — cold start for fair comparison
  const existingSpecs: ExistingSpec[] = [];
  const signals: OrganizeSignals = { sharedFileRatios: [] };

  const variants = [
    { label: "Gen1: Current (conceptualMap)", build: buildBrainOrganizePrompt, schema: GraphPlanSchema },
    { label: "Gen2A: Two-Pass", build: buildGen2a, schema: Schema2a },
    { label: "Gen2B: Level Schema", build: buildGen2b, schema: Schema2b },
    { label: "Gen2C: Few-Shot", build: buildGen2c, schema: Schema2c },
  ];

  // Run all variants in parallel
  console.log(`\nRunning ${variants.length} variants in parallel...`);
  const results = await Promise.all(
    variants.map(async (v) => {
      try {
        const { system, user } = v.build(existingSpecs, fragments, signals);
        const plan = await callHaiku(system, user, v.schema);
        return { label: v.label, plan, error: null };
      } catch (err: any) {
        return { label: v.label, plan: null, error: err.message };
      }
    }),
  );

  // Print results
  for (const r of results) {
    if (r.error) {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`  ${r.label} — ERROR: ${r.error}`);
    } else {
      printTree(r.plan, r.label);
    }
  }

  await closeDb();
}

main().catch(console.error);
