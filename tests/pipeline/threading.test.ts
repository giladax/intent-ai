import { describe, it, expect } from "vitest";
import { parseClaudeCodeLog } from "../../src/adapters/claude-code.js";
import { normalize } from "../../src/pipeline/normalize.js";
import { expectedThreading } from "../eval/threading-criteria.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(
  __dirname,
  "../fixtures/threading-session.jsonl",
);

describe("causal threading", () => {
  let normalized: ReturnType<typeof normalize>;

  // Parse + normalize once
  it("parses fixture into 19 events", async () => {
    const raw = await parseClaudeCodeLog(fixturePath);
    expect(raw).toHaveLength(19);
    normalized = normalize(raw, "sess-threading");
    expect(normalized).toHaveLength(19);
  });

  it("assigns correct turnId for every event", () => {
    for (const expected of expectedThreading) {
      const event = normalized[expected.causalOrder];
      expect(event, `event at causalOrder ${expected.causalOrder}`).toBeDefined();
      expect(
        event.turnId.startsWith(expected.turnIdPrefix),
        `event ${expected.causalOrder}: turnId "${event.turnId}" should start with "${expected.turnIdPrefix}"`,
      ).toBe(true);
    }
  });

  it("assigns correct respondingTo for every event", () => {
    for (const expected of expectedThreading) {
      const event = normalized[expected.causalOrder];
      if (expected.respondingToCausalOrder === null) {
        expect(
          event.respondingTo,
          `event ${expected.causalOrder} should have no respondingTo`,
        ).toBeUndefined();
      } else {
        const targetEvent = normalized[expected.respondingToCausalOrder];
        expect(
          event.respondingTo,
          `event ${expected.causalOrder} should respondTo event ${expected.respondingToCausalOrder}`,
        ).toBe(targetEvent.id);
      }
    }
  });

  it("all events have a turnId", () => {
    for (const event of normalized) {
      expect(event.turnId, `event ${event.causalOrder} missing turnId`).toBeTruthy();
    }
  });
});
