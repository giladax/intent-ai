/**
 * Run Gen3: Route → Decide pipeline against real data.
 * Compares against Gen2B (Decide-only) baseline.
 *
 * Usage: npx tsx tests/experiments/run-gen3.ts
 */
import "dotenv/config";
import { callHaiku, callSonnet } from "../../src/llm/client.js";
import { buildBrainExtractPrompt, SpecFragmentOutputSchema } from "../../src/llm/prompts/brain-extract.js";
import {
  buildBrainRoutePrompt,
  computeFileMatchScores,
  RouteOutputSchema,
  type SpecCard,
  type FragmentForRouting,
} from "../../src/llm/prompts/brain-route.js";
import {
  buildBrainOrganizeGen3Prompt,
  GraphPlanSchema as Gen3Schema,
} from "../../src/llm/prompts/brain-organize-gen3.js";
import {
  buildBrainOrganizePrompt as buildGen2b,
  GraphPlanSchema as Gen2bSchema,
} from "../../src/llm/prompts/brain-organize-gen2b.js";
import { getClient, closeDb } from "../../src/storage/connection.js";
import type { SpecFragment } from "../../src/llm/prompts/brain-extract.js";
import type { ExistingSpec, OrganizeSignals } from "../../src/llm/prompts/brain-organize.js";

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

  const roots = new Set<string>();
  const children = new Map<string, string[]>();

  for (const a of plan.assignments) {
    if (a.parentSpec) {
      const list = children.get(a.parentSpec) || [];
      if (!list.includes(a.targetSpec)) list.push(a.targetSpec);
      children.set(a.parentSpec, list);
    } else if (a.level === "root" || !a.parentSpec) {
      roots.add(a.targetSpec);
    }
  }

  for (const m of plan.merges || []) {
    if (m.parentSpec) {
      const list = children.get(m.parentSpec) || [];
      if (!list.includes(m.intoName)) list.push(m.intoName);
      children.set(m.parentSpec, list);
    } else {
      roots.add(m.intoName);
    }
  }

  // Remove children from roots
  for (const [, kids] of children) {
    for (const k of kids) roots.delete(k);
  }

  if (plan.merges?.length > 0) {
    console.log(`\n  Merges: ${plan.merges.map((m: any) => `${m.specs.join(" + ")} → ${m.intoName}`).join(", ")}`);
  }

  console.log("");
  for (const root of roots) {
    console.log(`  ${root}`);
    const kids = children.get(root) || [];
    for (const kid of kids) {
      console.log(`    └── ${kid}`);
    }
  }

  const childCount = [...children.values()].reduce((sum, arr) => sum + arr.length, 0);
  console.log(`\n  Roots: ${roots.size} | Children: ${childCount}`);
}

async function main() {
  console.log("Extracting fragments from 3 sessions...");
  const fragmentArrays = await Promise.all(SESSION_IDS.map(extractFromSession));
  const fragments = fragmentArrays.flat();
  console.log(`Extracted ${fragments.length} fragments.\n`);

  // Cold start — no existing specs, build spec cards from nothing
  // For cold start, we skip routing and go straight to Decide
  // For a warm start test, we'd load existing specs from DB

  const existingSpecs: ExistingSpec[] = [];
  const signals: OrganizeSignals = { sharedFileRatios: [] };
  const specCards: SpecCard[] = [];

  // ── Gen2B baseline (no routing) ────────────────────────────────
  console.log("Running Gen2B (baseline, no routing)...");
  const { system: sys2b, user: usr2b } = buildGen2b(existingSpecs, fragments, signals);
  const plan2b = await callHaiku(sys2b, usr2b, Gen2bSchema);
  printTree(plan2b, "Gen2B: Level Schema (no routing)");

  // ── Gen3: Route → Decide ───────────────────────────────────────
  console.log("\nRunning Gen3 (Route → Decide)...");

  // Step 1: Compute file match scores (deterministic)
  const fileMatches = new Map<number, ReturnType<typeof computeFileMatchScores>>();
  for (let i = 0; i < fragments.length; i++) {
    const scores = computeFileMatchScores(
      fragments[i].fileRefs.map(r => r.path),
      specCards,
    );
    fileMatches.set(i, scores);
  }

  // Step 2: Prepare fragments for routing
  const fragmentsForRouting: FragmentForRouting[] = fragments.map((f, i) => ({
    index: i,
    nameHint: f.nameHint,
    insightSummaries: f.insights.map(ins => ins.statement),
    files: f.fileRefs.map(r => r.path),
  }));

  // Step 3: Route (Haiku × 1)
  // On cold start with no specs, routing has nothing to match against.
  // In this case, we synthesize ad-hoc cards from fragment name hints
  // so the router can at least group fragments by similarity.
  let routeData;
  if (specCards.length === 0) {
    // Cold start: create synthetic cards from fragment clusters
    // We'll let the Decide step handle cold start directly
    // but still give it the Gen3 prompt format with empty routing
    console.log("  Cold start — no specs to route against.");
    console.log("  Falling back to Gen3 Decide with empty routing data...");
    routeData = { routes: fragments.map((_, i) => ({
      fragmentIndex: i,
      topMatches: [],
      newTopicNeeded: true,
      newTopicHint: fragments[i].nameHint,
    }))};
  } else {
    const { system: routeSys, user: routeUsr } = buildBrainRoutePrompt(specCards, fragmentsForRouting, fileMatches);
    console.log("  Routing fragments...");
    routeData = await callHaiku(routeSys, routeUsr, RouteOutputSchema);
    console.log(`  Routed ${routeData.routes.length} fragments.`);

    // Print routing results
    for (const r of routeData.routes) {
      const matches = r.topMatches.filter(m => m.relevance !== "none");
      console.log(`    Fragment ${r.fragmentIndex}: ${matches.map(m => `${m.specName}(${m.relevance})`).join(", ")}${r.newTopicNeeded ? ` + NEW: ${r.newTopicHint}` : ""}`);
    }
  }

  // Step 4: Decide (Haiku × 1, Gen2B schema with routing data)
  const { system: sys3, user: usr3 } = buildBrainOrganizeGen3Prompt(specCards, fragments, routeData);
  const plan3 = await callHaiku(sys3, usr3, Gen3Schema);
  printTree(plan3, "Gen3: Route → Decide (with routing data)");

  // ── Comparison ─────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("  COMPARISON");
  console.log("=".repeat(60));

  const count2b = {
    roots: new Set(plan2b.assignments.filter((a: any) => a.level === "root").map((a: any) => a.targetSpec)).size,
    children: plan2b.assignments.filter((a: any) => a.level === "child").length,
  };
  const count3 = {
    roots: new Set(plan3.assignments.filter((a: any) => a.level === "root").map((a: any) => a.targetSpec)).size,
    children: plan3.assignments.filter((a: any) => a.level === "child").length,
  };

  console.log(`\n  Gen2B: ${count2b.roots} roots, ${count2b.children} children`);
  console.log(`  Gen3:  ${count3.roots} roots, ${count3.children} children`);

  await closeDb();
}

main().catch(console.error);
