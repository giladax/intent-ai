import { describe, it, expect } from "vitest";
import {
  toRepoRelative,
  validateSeededFeatures,
  buildSeedEvents,
  type SeededFeatureProposal,
  type ValidatedFeature,
} from "../../src/pipeline/seed-features.js";

const REPO = "/Users/giladkoch/dev/intent-ai";

describe("toRepoRelative", () => {
  it("strips the repo root prefix from absolute paths", () => {
    expect(toRepoRelative(`${REPO}/src/mcp/server.ts`, REPO)).toBe("src/mcp/server.ts");
  });

  it("leaves already-relative paths untouched", () => {
    expect(toRepoRelative("src/mcp/server.ts", REPO)).toBe("src/mcp/server.ts");
  });

  it("handles paths whose leading slash was stripped upstream", () => {
    expect(toRepoRelative("Users/giladkoch/dev/intent-ai/src/a.ts", REPO)).toBe("src/a.ts");
  });

  it("returns null for paths outside the repo", () => {
    expect(toRepoRelative("/tmp/other/file.ts", REPO)).toBeNull();
  });
});

function proposal(over: Partial<SeededFeatureProposal> & { name: string }): SeededFeatureProposal {
  return {
    description: "desc",
    currentUnderstanding: "It does a thing [s:aaaaaaaa]. It also verifies [s:aaaaaaaa].",
    constraints: [],
    knownUnknowns: [],
    fileGlobs: ["src/mcp/**"],
    supportingSessionIds: ["aaaaaaaa-1111-2222-3333-444444444444"],
    ...over,
  };
}

const SESSIONS = [
  "aaaaaaaa-1111-2222-3333-444444444444",
  "bbbbbbbb-1111-2222-3333-444444444444",
];
const CORPUS_FILES = [
  "src/mcp/server.ts",
  "src/storage/queries.ts",
  "docs/prd.md",
];

describe("validateSeededFeatures", () => {
  it("accepts a well-grounded proposal", () => {
    const { accepted, rejected } = validateSeededFeatures([proposal({ name: "MCP Brain Server" })], SESSIONS, CORPUS_FILES);
    expect(rejected).toEqual([]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].fileGlobs).toEqual(["src/mcp/**"]);
  });

  it("drops globs that match no corpus file", () => {
    const { accepted } = validateSeededFeatures(
      [proposal({ name: "F", fileGlobs: ["src/mcp/**", "src/nonexistent/**"] })],
      SESSIONS,
      CORPUS_FILES,
    );
    expect(accepted[0].fileGlobs).toEqual(["src/mcp/**"]);
  });

  it("rejects a feature whose globs all miss the corpus", () => {
    const { accepted, rejected } = validateSeededFeatures(
      [proposal({ name: "F", fileGlobs: ["src/nonexistent/**"] })],
      SESSIONS,
      CORPUS_FILES,
    );
    expect(accepted).toEqual([]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toContain("glob");
  });

  it("drops unknown supporting session ids and rejects when none remain", () => {
    const { accepted, rejected } = validateSeededFeatures(
      [proposal({ name: "F", supportingSessionIds: ["99999999-0000-0000-0000-000000000000"] })],
      SESSIONS,
      CORPUS_FILES,
    );
    expect(accepted).toEqual([]);
    expect(rejected[0].reason).toContain("session");
  });

  it("rejects understanding whose citations do not resolve to supporting sessions", () => {
    const { rejected } = validateSeededFeatures(
      [
        proposal({
          name: "F",
          currentUnderstanding: "Claims something [s:deadbeef].",
        }),
      ],
      SESSIONS,
      CORPUS_FILES,
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toContain("citation");
  });

  it("rejects understanding with no citation at all (provenance rule)", () => {
    const { rejected } = validateSeededFeatures(
      [proposal({ name: "F", currentUnderstanding: "Uncited claims about the system." })],
      SESSIONS,
      CORPUS_FILES,
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toContain("citation");
  });
});

describe("buildSeedEvents", () => {
  const validated: ValidatedFeature = {
    name: "MCP Brain Server",
    description: "Serves feature context to agents.",
    currentUnderstanding: "Serves context [s:aaaaaaaa].",
    constraints: ["stdio transport only"],
    knownUnknowns: [],
    fileGlobs: ["src/mcp/**"],
    supportingSessionIds: ["aaaaaaaa-1111-2222-3333-444444444444"],
  };

  it("builds a feature:seeded activity event per feature", () => {
    const events = buildSeedEvents([{ feature: validated, featureId: "f-1" }], "intent-ai", "feat/repo-brain");
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.category).toBe("feature:seeded");
    expect(e.actor).toBe("system");
    expect(e.summary).toContain("MCP Brain Server");
    expect(e.metadata.featureId).toBe("f-1");
    expect(e.metadata.supportingSessionIds).toEqual(validated.supportingSessionIds);
    expect(e.repo).toBe("intent-ai");
    expect(e.branch).toBe("feat/repo-brain");
    expect(e.files).toEqual(["src/mcp/**"]);
  });
});
