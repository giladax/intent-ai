import { describe, it, expect } from "vitest";
import { dedupCriteria } from "./dedup-criteria.js";

// Import the dedup function we'll create
// For now, test the scoring function directly
import { computeSimilarity } from "../../src/pipeline/dedup.js";

describe("insight deduplication", () => {
  describe("similarity scoring", () => {
    for (const tc of dedupCriteria) {
      it(tc.name, () => {
        // For each duplicate pair, similarity should be > 0.7
        for (const [i, j] of tc.duplicatePairs) {
          const score = computeSimilarity(tc.insights[i].statement, tc.insights[j].statement);
          expect(score, `"${tc.insights[i].statement.slice(0, 50)}" vs "${tc.insights[j].statement.slice(0, 50)}"`).toBeGreaterThan(0.7);
        }

        // For non-duplicate pairs, similarity should be < 0.7
        for (let i = 0; i < tc.insights.length; i++) {
          for (let j = i + 1; j < tc.insights.length; j++) {
            const isDupePair = tc.duplicatePairs.some(
              ([a, b]) => (a === i && b === j) || (a === j && b === i)
            );
            if (!isDupePair) {
              const score = computeSimilarity(tc.insights[i].statement, tc.insights[j].statement);
              expect(score, `should NOT match: "${tc.insights[i].statement.slice(0, 50)}" vs "${tc.insights[j].statement.slice(0, 50)}"`).toBeLessThan(0.7);
            }
          }
        }
      });
    }
  });
});
