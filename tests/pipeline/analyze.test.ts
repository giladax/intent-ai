import { describe, it, expect } from "vitest";
import { parseClaudeCodeLog } from "../../src/adapters/claude-code.js";
import { normalize } from "../../src/pipeline/normalize.js";
import { analyzeInteractions } from "../../src/pipeline/analyze.js";
import {
  expectedExchanges,
  expectedDirectives,
} from "../eval/threading-criteria.js";
import type { PipelineDirectives } from "../../src/adapters/types.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(
  __dirname,
  "../fixtures/threading-session.jsonl",
);

describe("analyzeInteractions", () => {
  let directives: PipelineDirectives;

  it("parses and normalizes the fixture", async () => {
    const raw = await parseClaudeCodeLog(fixturePath);
    const normalized = normalize(raw, "sess-threading");
    directives = analyzeInteractions(normalized);
    expect(directives).toBeDefined();
  });

  // ── Exchange count ──────────────────────────────────────────────────

  it("produces the correct number of exchanges", () => {
    expect(directives.exchangeSummary.totalExchanges).toBe(
      expectedExchanges.length,
    );
  });

  // ── Per-exchange flags ──────────────────────────────────────────────

  // We verify the directives flags match the expected criteria.
  // The exchange-level details are internal, so we test through the aggregate.

  it("detects question count correctly", () => {
    const expectedQuestions = expectedExchanges.filter(
      (e) => e.devAskedQuestion,
    ).length;
    expect(directives.exchangeSummary.questionCount).toBe(expectedQuestions);
  });

  it("detects reasoning count correctly", () => {
    const expectedReasoning = expectedExchanges.filter(
      (e) => e.devUsedReasoning,
    ).length;
    expect(directives.exchangeSummary.reasoningCount).toBe(expectedReasoning);
  });

  it("detects new topic count correctly", () => {
    const expectedNewTopics = expectedExchanges.filter(
      (e) => e.devIntroducedNewTopic,
    ).length;
    expect(directives.exchangeSummary.newTopicCount).toBe(expectedNewTopics);
  });

  it("detects short response count correctly", () => {
    const expectedShort = expectedExchanges.filter(
      (e) => e.devResponseChars < 15,
    ).length;
    expect(directives.exchangeSummary.shortResponseCount).toBe(expectedShort);
  });

  // ── Directives ──────────────────────────────────────────────────────

  it("sets detectPassiveAcceptance correctly", () => {
    expect(directives.promptSections.detectPassiveAcceptance).toBe(
      expectedDirectives.promptSections.detectPassiveAcceptance,
    );
  });

  it("sets trackDelegation correctly", () => {
    expect(directives.promptSections.trackDelegation).toBe(
      expectedDirectives.promptSections.trackDelegation,
    );
  });

  it("sets detectIgnoredProposals correctly", () => {
    expect(directives.promptSections.detectIgnoredProposals).toBe(
      expectedDirectives.promptSections.detectIgnoredProposals,
    );
  });

  it("sets isLearningExchange correctly", () => {
    expect(directives.promptSections.isLearningExchange).toBe(
      expectedDirectives.promptSections.isLearningExchange,
    );
  });

  // ── Ignored proposals detail ────────────────────────────────────────

  it("lists ignored proposals when options were not fully addressed", () => {
    // Exchange 2: AI proposed A and B, dev only picked A
    expect(directives.exchangeSummary.ignoredProposals.length).toBeGreaterThan(
      0,
    );
  });
});
