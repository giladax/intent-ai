import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SessionExperience } from "./SessionExperience";
import * as api from "../api";
import type { SessionExperienceData } from "../api";

const DATA: SessionExperienceData = {
  session_id: "sx-demo-session-001",
  header: {
    title: "Raise the premium limit",
    summary: "Raised the premium auto-approval limit to $250.",
    repo: "giladax/swiftrefunds",
    workspace: "giladax-swiftrefunds",
    actor: "dana",
    pr: 2,
    started_at: "2026-07-18T14:22:00Z",
    ended_at: "2026-07-18T14:25:00Z",
    effort: {
      prompts: 1, assistant_turns: 3, tool_calls: 3,
      files_touched: 1, duration_seconds: 180,
    },
  },
  turns: [
    { index: 0, role: "user", ts: "2026-07-18T14:22:00Z",
      text: "Raise the premium auto-approval limit to $250. Policy-only change." },
    { index: 1, role: "assistant", ts: "2026-07-18T14:23:00Z",
      blocks: [
        { type: "text", text: "Updating the limit now." },
        { type: "tool", id: "toolu_1", name: "Edit", summary: "Edited policy.py",
          result_note: "File updated successfully.",
          input_display: "{}",
          result_display: "File updated successfully.",
          file_change: {
            path: "swiftrefunds/policy.py", kind: "edit",
            diff: "@@ -1 +1 @@\n-    TIER_PREMIUM: 100.00,\n+    TIER_PREMIUM: 250.00,",
            additions: 1, deletions: 1,
          } },
        { type: "tool", id: "toolu_2", name: "Bash", summary: "Ran pytest --tb=short",
          result_note: "34 passed, 1 warning in 0.24s",
          input_display: "{\"command\": \"pytest --tb=short\"}",
          result_display: "34 passed, 1 warning in 0.24s",
          file_change: null },
      ],
      files_changed: [{ path: "swiftrefunds/policy.py", additions: 1, deletions: 1 }] },
    { index: 2, role: "assistant", ts: "2026-07-18T14:25:00Z",
      blocks: [
        { type: "text",
          text: "All green. I noted there is no end-to-end test; tracking that guard update separately." },
      ],
      files_changed: [] },
  ],
  quotes: [
    { quote: "tracking that guard update separately", kind: "moment",
      why: "decision — deferred the guard boundary work",
      anchor: { turn: 2, block: 0, start: 47, end: 84 } },
  ],
  produced: [
    { kind: "intent_memo", reference: "session-memo-abc", title: "Premium direction",
      workspace: "giladax-swiftrefunds", link: "/intent/giladax-swiftrefunds" },
  ],
  referenced_by: [
    { kind: "review", workspace: "giladax-swiftrefunds", pr_number: 2,
      title: "feat: raise premium auto-approval limit to $250",
      label: "Breaks a promise it touches", ink: "red", verdict: "OFF_INTENT",
      via: "attached", link: "/repo/giladax-swiftrefunds/review/2" },
  ],
  digest: {
    title: "Raise the premium limit",
    summary: "Raised the premium auto-approval limit to $250.",
    decisions: [{ choice: "No guard edits needed", why: "policy is the source of truth", rejected: "" }],
    reasoning: "…",
    pr: 2,
  },
  notes: [],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/session/sx-demo-session-001"]}>
      <Routes>
        <Route path="/session/:id" element={<SessionExperience />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SessionExperience", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders the prompt as first-class manuscript with the crafted words", async () => {
    vi.spyOn(api, "fetchSessionExperience").mockResolvedValue(DATA);
    renderPage();
    await waitFor(() => expect(screen.getByText(/Raise the premium auto-approval limit/)).toBeInTheDocument());
    // the prompt card chrome: You + timestamp meta
    expect(screen.getByText("You")).toBeInTheDocument();
    // masthead + deck
    expect(screen.getByRole("heading", { name: "Raise the premium limit" })).toBeInTheDocument();
  });

  it("shows honest effort figures — no invented dollars", async () => {
    vi.spyOn(api, "fetchSessionExperience").mockResolvedValue(DATA);
    renderPage();
    await waitFor(() => expect(screen.getByText("tool calls")).toBeInTheDocument());
    expect(screen.getByText("3 min")).toBeInTheDocument();
    // the footer names the framing honestly instead of inventing dollars
    expect(screen.getByText(/spend integration is roadmap/)).toBeInTheDocument();
    expect(screen.queryByText(/estimated cost|spent \$/i)).not.toBeInTheDocument();
  });

  it("collapses tool calls to designed chips and expands to the deep dive", async () => {
    vi.spyOn(api, "fetchSessionExperience").mockResolvedValue(DATA);
    renderPage();
    await waitFor(() => expect(screen.getByText("Ran pytest --tb=short")).toBeInTheDocument());
    // collapsed: result note visible, raw input hidden
    expect(screen.getByText("34 passed, 1 warning in 0.24s")).toBeInTheDocument();
    expect(screen.queryByText(/"command"/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Ran pytest --tb=short"));
    expect(screen.getByText(/"command"/)).toBeInTheDocument();
  });

  it("shows the git change as an inline artifact with its diff", async () => {
    vi.spyOn(api, "fetchSessionExperience").mockResolvedValue(DATA);
    renderPage();
    await waitFor(() => expect(screen.getByText("Edited policy.py")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Edited policy.py"));
    expect(screen.getByText("swiftrefunds/policy.py")).toBeInTheDocument();
    expect(screen.getByText(/TIER_PREMIUM: 250\.00,/)).toBeInTheDocument();
  });

  it("marks the extracted quote in the conversation and lists it as a receipt", async () => {
    vi.spyOn(api, "fetchSessionExperience").mockResolvedValue(DATA);
    renderPage();
    await waitFor(() => expect(screen.getByText(/held as evidence/)).toBeInTheDocument());
    const mark = document.getElementById("sx-mark-0");
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toContain("tracking that guard update separately");
  });

  it("shows both artifact relations: produced → and referenced by ←", async () => {
    vi.spyOn(api, "fetchSessionExperience").mockResolvedValue(DATA);
    renderPage();
    await waitFor(() => expect(screen.getByText("Referenced by ←")).toBeInTheDocument());
    expect(screen.getByText("Breaks a promise it touches")).toBeInTheDocument();
    expect(screen.getByText(/coupled by attached/)).toBeInTheDocument();
    expect(screen.getByText("This session produced →")).toBeInTheDocument();
    expect(screen.getByText("Premium direction")).toBeInTheDocument();
    // the review link is a real deep link
    const link = screen.getByText("Breaks a promise it touches").closest("a");
    expect(link).toHaveAttribute("href", "/repo/giladax-swiftrefunds/review/2");
  });

  it("degrades honestly when the session is unknown", async () => {
    vi.spyOn(api, "fetchSessionExperience").mockRejectedValue(new Error("404"));
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("Quire has no record of this session")).toBeInTheDocument(),
    );
  });
});
