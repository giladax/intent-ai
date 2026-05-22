import "dotenv/config";
import { designScope } from "./tests/eval/session-criteria.js";
import { runOrganismBatch } from "./src/eval/runner.js";
import type { Organism } from "./src/eval/chromosomes/types.js";
import type { FitnessResult } from "./src/eval/fitness.js";

// ── Chr 1: Instructions ─────────────────────────────────────────────
import { hunter, scorer } from "./src/eval/chromosomes/chr1-instructions.js";

// ── Chr 2: Formats ──────────────────────────────────────────────────
import { threaded, behavioral } from "./src/eval/chromosomes/chr2-formats.js";

// ── Chr 3: Synthesis ────────────────────────────────────────────────
import {
  exchangePairs,
  fullPrecompute,
} from "./src/eval/chromosomes/chr3-synthesis.js";

// ── Chr 4: Data Selection ───────────────────────────────────────────
import {
  conversationOnly,
  conversationActions,
} from "./src/eval/chromosomes/chr4-data.js";

// ── Organism Definitions ────────────────────────────────────────────

const organismAlpha: Organism = {
  name: "alpha (current)",
  instructions: hunter,
  format: threaded,
  synthesis: exchangePairs,
  dataSelection: conversationActions,
};

const organismBeta: Organism = {
  name: "beta (pre-comp)",
  instructions: scorer,
  format: threaded,
  synthesis: fullPrecompute,
  dataSelection: conversationActions,
};

const organismGamma: Organism = {
  name: "gamma (behavioral)",
  instructions: hunter,
  format: behavioral,
  synthesis: fullPrecompute,
  dataSelection: conversationActions,
};

const organismDelta: Organism = {
  name: "delta (minimal)",
  instructions: scorer,
  format: behavioral,
  synthesis: fullPrecompute,
  dataSelection: conversationOnly,
};

const FIXTURE_PATH = "tests/eval/fixtures/scope-design.jsonl";

async function main() {
  const organisms = [organismAlpha, organismBeta, organismGamma, organismDelta];

  console.log("=== Gen 0: Chromosome Evaluation ===");
  console.log(`Fixture: ${designScope.fixture}`);
  console.log(`Organisms: ${organisms.map((o) => o.name).join(", ")}`);
  console.log("");

  const results = await runOrganismBatch(
    organisms,
    FIXTURE_PATH,
    designScope,
  );

  printComparisonTable(results);
  printDetailedResults(results);
}

function printComparisonTable(results: FitnessResult[]) {
  const pct = (n: number) => `${Math.round(n * 100)}%`.padStart(6);

  // Header
  const colWidth = 16;
  const pad = (s: string) => s.padEnd(colWidth);

  console.log("");
  console.log(
    "=== Gen 0 Results =====================================================",
  );
  console.log(`Fixture: scope-design.jsonl`);
  console.log("");

  // Column headers
  const header =
    "             " +
    results.map((r) => pad(r.chromosomeName.slice(0, colWidth))).join("  ");
  console.log(header);

  const line =
    "             " +
    results.map(() => pad("────────────────")).join("  ");
  console.log(line);

  // Rows
  const rows: [string, (r: FitnessResult) => string][] = [
    ["Moments:  ", (r) => pct(r.scores.momentsDetected)],
    ["Precis.:  ", (r) => pct(r.scores.momentsCorrect)],
    ["Narr.Q:   ", (r) => pct(r.scores.narrativeMusts)],
    ["Narr.P:   ", (r) => pct(r.scores.narrativeMustNots)],
    ["Direct.:  ", (r) => pct(r.scores.directivesCorrect)],
    ["TOTAL:    ", (r) => pct(r.totalScore)],
    [
      "Tokens:   ",
      (r) => {
        const k = Math.round(r.tokensUsed / 1000);
        return `${k}K`.padStart(6);
      },
    ],
    ["Cost:     ", (r) => `$${r.costEstimate.toFixed(2)}`.padStart(6)],
  ];

  for (const [label, fn] of rows) {
    const values = results.map((r) => pad(fn(r))).join("  ");
    console.log(`  ${label}${values}`);
  }

  console.log("");
}

function printDetailedResults(results: FitnessResult[]) {
  for (const r of results) {
    console.log(`--- ${r.chromosomeName} ---`);

    if (r.details.missingMoments.length > 0) {
      console.log("  Missing moments:");
      for (const m of r.details.missingMoments) {
        console.log(`    x ${m}`);
      }
    }

    if (r.details.falsePositives.length > 0) {
      console.log("  False positives:");
      for (const fp of r.details.falsePositives) {
        console.log(`    x ${fp}`);
      }
    }

    if (r.details.missingNarrativePhrases.length > 0) {
      console.log("  Missing narrative phrases:");
      for (const p of r.details.missingNarrativePhrases) {
        console.log(`    x "${p}"`);
      }
    }

    if (r.details.badNarrativePhrases.length > 0) {
      console.log("  Bad narrative phrases:");
      for (const p of r.details.badNarrativePhrases) {
        console.log(`    x "${p}"`);
      }
    }

    console.log("");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
