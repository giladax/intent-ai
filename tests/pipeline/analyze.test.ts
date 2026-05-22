import { describe, it, expect, vi } from "vitest";
import { parseClaudeCodeLog } from "../../src/adapters/claude-code.js";
import { normalize } from "../../src/pipeline/normalize.js";
import { analyzeInteractions } from "../../src/pipeline/analyze.js";
import type { PipelineDirectives } from "../../src/adapters/types.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Mock the Haiku classifier to return deterministic results
vi.mock("../../src/pipeline/classify-exchanges.js", () => ({
  classifyExchanges: vi.fn(async (exchanges: unknown[]) => {
    // Return a classification for each exchange based on simple heuristics
    // This mirrors what Haiku would return but is deterministic for testing
    return (exchanges as { devEvent: { content: { detail: string } }; aiTurnEvents: { category: string; content: { detail: string } }[] }[]).map((ex) => {
      const devText = ex.devEvent.content.detail;
      const isShort = devText.length < 15;
      const hasQuestion = devText.includes("?");
      const isChallenge = devText.toLowerCase().includes("actually") || devText.toLowerCase().includes("instead");

      return {
        engagement: isShort ? "passive" : isChallenge ? "challenging" : "active",
        intent: hasQuestion ? "question" : isShort ? "acceptance" : isChallenge ? "challenge" : "refinement",
        agency: isShort ? "ai" : isChallenge ? "developer" : "collaborative",
        candidateType: isChallenge ? "rejection" : null,
      };
    });
  }),
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(
  __dirname,
  "../fixtures/threading-session.jsonl",
);

describe("analyzeInteractions", () => {
  let directives: PipelineDirectives;

  it("parses, normalizes, and analyzes the fixture", async () => {
    const raw = await parseClaudeCodeLog(fixturePath);
    const normalized = normalize(raw, "sess-threading");
    directives = await analyzeInteractions(normalized);
    expect(directives).toBeDefined();
  });

  it("produces exchanges", () => {
    expect(directives.exchangeSummary.totalExchanges).toBeGreaterThan(0);
  });

  it("computes directive flags", () => {
    expect(typeof directives.promptSections.detectPassiveAcceptance).toBe("boolean");
    expect(typeof directives.promptSections.trackDelegation).toBe("boolean");
    expect(typeof directives.promptSections.detectIgnoredProposals).toBe("boolean");
    expect(typeof directives.promptSections.isLearningExchange).toBe("boolean");
  });

  it("counts exchanges correctly", () => {
    expect(directives.exchangeSummary.totalExchanges).toBe(4);
  });

  it("detects passive exchanges (short responses)", () => {
    // "ok" and "let's do A" are short responses in the fixture
    expect(directives.exchangeSummary.shortResponseCount).toBeGreaterThan(0);
  });

  it("detects learning exchanges (questions)", () => {
    // First exchange is a question: "How does the auth middleware work?"
    expect(directives.exchangeSummary.questionCount).toBeGreaterThan(0);
    expect(directives.promptSections.isLearningExchange).toBe(true);
  });
});
