import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ReviewRoom } from "./Review";
import type { ReviewDetail } from "../types";

// The review room is a renderer over the GET /api/reviews/{ws}/{n} contract —
// the fixture below IS that contract.
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, fetchReview: vi.fn() };
});
import { fetchReview } from "../api";
const mockedFetch = vi.mocked(fetchReview);

const REVIEW: ReviewDetail = {
  workspace: "quire-brain",
  pr_number: 7,
  analysis_id: "abc123",
  title: "feat(attention): brain_attention MCP tool",
  verdict: "OFF_INTENT",
  label: "Breaks a promise",
  ink: "red",
  verdict_sentence: "Breaks a promise. This change adds a new tool agents can call.",
  head_sha: "3aa62fc6e2aa",
  base_sha: "0000000",
  analyzer_version: "v0.7",
  observed_at: "2026-07-20T10:00:00Z",
  review_state: "pending",
  reviewer: "",
  review_note: "",
  counts: { broken: 1, partial: 0, kept: 0, not_verified: 3 },
  files: [
    {
      path: "src/mcp/server.ts",
      additions: 67,
      deletions: 0,
      patch: "--- /dev/null\n+++ b/src/mcp/server.ts\n@@ -0,0 +1,2 @@\n+  server.tool(\n+    \"brain_attention\",\n",
      notes: ["note-1"],
    },
    { path: "tests/mcp/attention.test.ts", additions: 95, deletions: 0, patch: "", notes: [] },
  ],
  file_notes: [
    {
      id: "note-1",
      path: "src/mcp/server.ts",
      obligation_id: "QUIREB-206",
      label: "Breaks this promise",
      ink: "red",
      statement: "Only Feature tools are served on the MCP surface.",
      reasoning: "This adds a tool to the served MCP surface a promise governs.",
      source_ref: "QUIREB-206",
    },
  ],
  promises: [
    {
      obligation_id: "QUIREB-206",
      statement: "Only Feature tools are served",
      relation: "contradicts",
      label: "Breaks this promise",
      ink: "red",
      confidence: 0.9,
      reasoning: "The served MCP surface must speak Feature only.",
      citations: [
        { reference: "src/mcp/server.ts", lines: [597, 599], excerpt: "server.tool(\"brain_attention\"", valid: true },
      ],
    },
  ],
  gap: { has_gap: true, summary: "Nothing verifies it.", items: ["QUIREB-206 has no test bound to verify it."] },
  why: {
    summary: "The agent built it additive on purpose — existing tools untouched.",
    claims: ["additive"],
    session: null,
  },
  intent_ledger_url: "/intent/quire-brain",
};

function renderRoom() {
  return render(
    <MemoryRouter initialEntries={["/repo/quire-brain/review/7"]}>
      <Routes>
        <Route path="/repo/:ws/review/:n" element={<ReviewRoom />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ReviewRoom", () => {
  // Each test sets its own mock return; no mockReset() in beforeEach — under
  // vitest 4 that reset spuriously flags an expected rejection as unhandled.

  it("renders the plain verdict sentence and human title, never the raw enum", async () => {
    mockedFetch.mockResolvedValue(REVIEW);
    renderRoom();
    await waitFor(() => expect(screen.getByText(/brain_attention MCP tool/)).toBeInTheDocument());
    expect(screen.getByText(/Breaks a promise\. This change adds a new tool/)).toBeInTheDocument();
    // The raw enum never surfaces in the human copy.
    expect(screen.queryByText(/OFF_INTENT/)).not.toBeInTheDocument();
  });

  it("shows changed files with deltas and the file-level promise note", async () => {
    mockedFetch.mockResolvedValue(REVIEW);
    renderRoom();
    await waitFor(() => expect(screen.getByText("src/mcp/server.ts")).toBeInTheDocument());
    expect(screen.getByText("+67")).toBeInTheDocument();
    // The inline note anchors a promise to the changed file, verbatim.
    expect(screen.getByText(/Only Feature tools are served on the MCP surface/)).toBeInTheDocument();
  });

  it("carries the rail: promise receipt, the gap, and why the author did it", async () => {
    mockedFetch.mockResolvedValue(REVIEW);
    renderRoom();
    await waitFor(() => expect(screen.getByText("Promises checked")).toBeInTheDocument());
    expect(screen.getByText(/server.tool\("brain_attention"/)).toBeInTheDocument(); // verbatim receipt
    expect(screen.getByText("The gap")).toBeInTheDocument();
    expect(screen.getByText(/QUIREB-206 has no test bound/)).toBeInTheDocument();
    expect(screen.getByText("Why the author did it")).toBeInTheDocument();
    expect(screen.getByText(/additive on purpose/)).toBeInTheDocument();
    // No coupled session → honest absent state, not a fabricated walk link.
    expect(screen.getByText(/No coding session is attached/)).toBeInTheDocument();
  });

  it("the signing ceremony: choosing an act opens the name/role sign block", async () => {
    mockedFetch.mockResolvedValue(REVIEW);
    renderRoom();
    await waitFor(() => expect(screen.getByText("Your call")).toBeInTheDocument());
    // A not-covered/unverified review offers "Draw the missing promise & sign".
    fireEvent.click(screen.getByText("Wave it through"));
    // The ceremony asks for a name before it lets you sign.
    const nameInput = await screen.findByPlaceholderText("Your name");
    expect(nameInput).toBeInTheDocument();
    fireEvent.change(nameInput, { target: { value: "Gilad" } });
    fireEvent.click(screen.getByText(/Sign — wave it through/i));
    await waitFor(() => expect(screen.getByText(/You signed:/)).toBeInTheDocument());
  });

  it("renders the honest empty state when the review is missing", async () => {
    // A rejected fetch → the honest "no such review" state.
    mockedFetch.mockImplementation(() => Promise.reject(new Error("404")));
    renderRoom();
    await waitFor(() => expect(screen.getByText("No such review")).toBeInTheDocument());
  });
});
