import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Timeline } from "./Timeline";
import * as api from "../api";
import type { TimelineData } from "../api";

const EMPTY_DATA: TimelineData = {
  window: { days: 30, since: "2026-06-23T00:00:00Z", until: "2026-07-23T00:00:00Z" },
  rows: [],
  empty: true,
};

const RICH_DATA: TimelineData = {
  window: { days: 30, since: "2026-06-23T00:00:00Z", until: "2026-07-23T00:00:00Z" },
  rows: [
    {
      feature_id: "f1",
      feature_name: "Brain MCP",
      repo: "intent-ai",
      repo_workspace: "intent-ai",
      first_activity: "2026-07-01T10:00:00Z",
      last_activity: "2026-07-20T15:00:00Z",
      event_count: 12,
      marks: [
        {
          kind: "activity",
          ts: "2026-07-01T10:00:00Z",
          label: "Work on this feature — Jul 1",
          ink: "blue",
          link: "/feature/f1",
          detail: "Reasoned about the MCP tool definitions.",
        },
        {
          kind: "check",
          ts: "2026-07-10T12:00:00Z",
          label: "Check on PR #7: Kept all promises — Jul 10",
          ink: "green",
          link: "/repo/intent-ai/review/7",
          detail: "All obligations satisfied.",
        },
        {
          kind: "session",
          ts: "2026-07-15T09:00:00Z",
          label: "Session reasoned about this feature — Jul 15",
          ink: "blue",
          link: "/session/s1",
          detail: "Discussed the brain_feature_context tool.",
        },
      ],
    },
  ],
  empty: false,
};

function renderTimeline() {
  return render(
    <MemoryRouter initialEntries={["/timeline"]}>
      <Timeline />
    </MemoryRouter>
  );
}

describe("Timeline surface", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading state initially", () => {
    vi.spyOn(api, "fetchTimeline").mockReturnValue(new Promise(() => {}));
    renderTimeline();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows empty state when no rows", async () => {
    vi.spyOn(api, "fetchTimeline").mockResolvedValue(EMPTY_DATA);
    renderTimeline();
    await waitFor(() => {
      expect(screen.getByText(/No activity in this window/i)).toBeInTheDocument();
    });
  });

  it("renders feature rows when data present", async () => {
    vi.spyOn(api, "fetchTimeline").mockResolvedValue(RICH_DATA);
    renderTimeline();
    await waitFor(() => {
      expect(screen.getByText("Brain MCP")).toBeInTheDocument();
    });
  });

  it("shows repo name under feature name", async () => {
    vi.spyOn(api, "fetchTimeline").mockResolvedValue(RICH_DATA);
    renderTimeline();
    await waitFor(() => {
      expect(screen.getByText("intent-ai")).toBeInTheDocument();
    });
  });

  it("shows error state when fetch fails", async () => {
    vi.spyOn(api, "fetchTimeline").mockRejectedValue(new Error("network error"));
    renderTimeline();
    await waitFor(() => {
      expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
    });
  });

  it("renders mark buttons for each mark", async () => {
    vi.spyOn(api, "fetchTimeline").mockResolvedValue(RICH_DATA);
    renderTimeline();
    await waitFor(() => {
      // 3 marks → 3 tl-mark buttons
      const marks = document.querySelectorAll(".tl-mark");
      expect(marks.length).toBe(3);
    });
  });

  it("renders the Timeline header with 'Timeline' title", async () => {
    vi.spyOn(api, "fetchTimeline").mockResolvedValue(RICH_DATA);
    renderTimeline();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /timeline/i })).toBeInTheDocument();
    });
  });

  it("renders window picker buttons", async () => {
    vi.spyOn(api, "fetchTimeline").mockResolvedValue(EMPTY_DATA);
    renderTimeline();
    await waitFor(() => {
      expect(screen.getByText("7d")).toBeInTheDocument();
      expect(screen.getByText("30d")).toBeInTheDocument();
      expect(screen.getByText("90d")).toBeInTheDocument();
    });
  });
});
