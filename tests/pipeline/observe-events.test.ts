import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/llm/client.js", () => ({
  callHaiku: vi.fn(),
}));

import { observeEvents } from "../../src/pipeline/observe-events.js";
import { callHaiku } from "../../src/llm/client.js";
import type { ActivityEvent } from "../../src/adapters/types.js";

const mockedCallHaiku = vi.mocked(callHaiku);

function makeEvent(overrides: Partial<ActivityEvent> & { id: string; summary: string }): ActivityEvent {
  return {
    timestamp: new Date("2026-06-22T10:00:00Z"),
    category: "struggle",
    tags: [],
    actor: "ai",
    metadata: {},
    ...overrides,
  };
}

describe("observeEvents", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns observations from Haiku", async () => {
    mockedCallHaiku.mockResolvedValue({
      observations: [
        {
          statement: "Developers keep struggling with auth file imports",
          confidence: "high",
          supportingEventIds: ["e1", "e2"],
          suggestedTags: ["auth", "imports"],
        },
      ],
    });

    const events = [
      makeEvent({ id: "e1", summary: "Circular import in auth module", category: "struggle" }),
      makeEvent({ id: "e2", summary: "Failed to resolve auth imports", category: "struggle" }),
    ];

    const observations = await observeEvents(events);
    expect(observations).toHaveLength(1);
    expect(observations[0].statement).toContain("auth");
    expect(observations[0].supportingEventIds).toEqual(["e1", "e2"]);
    expect(observations[0].suggestedTags).toContain("auth");
    expect(mockedCallHaiku).toHaveBeenCalledOnce();
  });

  it("returns empty array for empty input", async () => {
    const observations = await observeEvents([]);
    expect(observations).toEqual([]);
    expect(mockedCallHaiku).not.toHaveBeenCalled();
  });

  it("handles Haiku returning no observations", async () => {
    mockedCallHaiku.mockResolvedValue({ observations: [] });

    const events = [
      makeEvent({ id: "e1", summary: "Some routine action", category: "action" }),
    ];

    const observations = await observeEvents(events);
    expect(observations).toEqual([]);
  });

  it("passes event summaries to Haiku prompt", async () => {
    mockedCallHaiku.mockResolvedValue({ observations: [] });

    const events = [
      makeEvent({ id: "e1", summary: "Auth issue found", category: "discovery" }),
    ];

    await observeEvents(events);

    const [, userPrompt] = mockedCallHaiku.mock.calls[0];
    expect(userPrompt).toContain("Auth issue found");
    expect(userPrompt).toContain("[e1]");
  });
});
