import { describe, it, expect } from "vitest";
import { TransitionsOutputSchema } from "../../src/llm/prompts/transitions.js";

describe("transition/outcome confidence honesty", () => {
  it("omitted confidence is null, never a default", () => {
    const out = TransitionsOutputSchema.parse({
      transitions: [{ fromStatement: "a", toStatement: "b", reason: "r" }],
      outcomes: [{ statement: "done" }],
    });
    expect(out.transitions[0].confidence).toBeNull();
    expect(out.outcomes[0].confidence).toBeNull();
  });
  it("emitted confidence passes through", () => {
    const out = TransitionsOutputSchema.parse({ transitions: [], outcomes: [{ statement: "d", confidence: "low" }] });
    expect(out.outcomes[0].confidence).toBe("low");
  });
});
