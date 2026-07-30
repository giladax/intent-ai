import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FeaturePage } from "./FeaturePage";
import type { OrgFeatureDetail } from "../types";

// Mock only the aggregation fetch — the page is a renderer over the
// OrgFeatureDetail contract; the fixture below IS that contract.
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, fetchOrgFeatureDetail: vi.fn() };
});
import { fetchOrgFeatureDetail } from "../api";
const mockedFetch = vi.mocked(fetchOrgFeatureDetail);

/** Fixture shaped like OrgFeatureDetail — the contract the page renders from,
 *  populated with mock-05's real content. */
const FEATURE_FIXTURE: OrgFeatureDetail = {
  id: "feat-refund-limits",
  name: "Refund limits",
  repo: "refund-agent",
  repoWorkspace: "refund-agent",
  summary: "How much money we can refund, and the safety checks that keep it correct.",
  statusLabel: "Breaks a promise",
  statusInk: "red",
  promiseCount: 3,
  brokenCount: 1,
  sessionCount: 9,
  fileCount: 4,
  lastChange: "2026-07-22T10:00:00Z",
  promises: [
    {
      id: "ob-001",
      statement: "The safety check must match the allowed refund amount.",
      status: "broken",
      statusLabel: "Broken",
      statusInk: "red",
      explanation:
        "The allowed amount was raised to $100, but the safety check still stops at $50. They don't match, so some correct refunds are now blocked by mistake.",
      sourceRef: "refund-policy.md, line 14",
      reviewLink: "/repo/refund-agent/review/101",
    },
    {
      id: "ob-002",
      statement: "Every refund is saved to the log.",
      status: "kept",
      statusLabel: "Kept",
      statusInk: "green",
      explanation: "Working as promised. The last 40 refunds were all written to the audit log.",
      sourceRef: "audit.py",
      reviewLink: "/repo/refund-agent/review/98",
    },
    {
      id: "ob-003",
      statement: "Tell the customer when a refund is sent.",
      status: "no_rule",
      statusLabel: "No rule yet",
      statusInk: "gray",
      explanation:
        "The code seems to do this, but no promise is watching it — so if it stops working, nobody would be told.",
    },
  ],
  whyCard: {
    summary:
      "Two hours ago, in a coding session, the AI raised the limit to $100 and kept the $50 check on purpose — it thought the two were separate things. It never went back to update the check.",
    sessionLink: "/session/sess-001",
    sessionSteps: 32,
  },
  timeline: [
    { id: "ev-1", title: "Pull request 101 changed the limit and broke a promise", meta: "2 hours ago · by the coding agent", ink: "red" },
    { id: "ev-2", title: "Coding session: raise the refund cap to $100", meta: "2 hours ago · 32 steps · reasoning saved", ink: "blue" },
    { id: "ev-3", title: "Pull request 98 kept every promise", meta: "3 days ago", ink: "green" },
  ],
  relatedFeatures: [
    { id: "feat-audit", name: "Audit log", ink: "green" },
    { id: "feat-messages", name: "Customer messages", ink: "gray" },
  ],
  mentionedIn: { sessions: 4, threads: 2, specs: 1 },
};

describe("FeaturePage", () => {
  beforeEach(() => { mockedFetch.mockResolvedValue(FEATURE_FIXTURE); });
  afterEach(() => { vi.clearAllMocks(); });

  it("renders the feature name and summary in the header", async () => {
    render(<MemoryRouter><FeaturePage featureId="feat-refund-limits" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("heading", { name: /Refund limits/i })).toBeInTheDocument());
    expect(screen.getByText(/How much money we can refund/)).toBeInTheDocument();
  });

  it("renders the status badge in plain language — not an enum", async () => {
    render(<MemoryRouter><FeaturePage featureId="feat-refund-limits" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Breaks a promise")).toBeInTheDocument());
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/OFF_INTENT|UNGOVERNED|CONTRADICTS_INTENT|UNKNOWN/);
  });

  it("shows all three promise cards with plain-language status labels", async () => {
    render(<MemoryRouter><FeaturePage featureId="feat-refund-limits" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("The safety check must match the allowed refund amount.")).toBeInTheDocument());
    expect(screen.getByText("Every refund is saved to the log.")).toBeInTheDocument();
    expect(screen.getByText("Tell the customer when a refund is sent.")).toBeInTheDocument();
    // Plain-language badges from the contract, never enums
    expect(screen.getByText("Broken")).toBeInTheDocument();
    expect(screen.getByText("Kept")).toBeInTheDocument();
    expect(screen.getByText("No rule yet")).toBeInTheDocument();
    // Receipts on demand: source footnotes render
    expect(screen.getByText("refund-policy.md, line 14")).toBeInTheDocument();
  });

  it("shows the why card with the session explanation", async () => {
    render(<MemoryRouter><FeaturePage featureId="feat-refund-limits" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Why the code is like this")).toBeInTheDocument());
    expect(screen.getByText(/raised the limit to \$100 and kept the \$50 check on purpose/)).toBeInTheDocument();
    expect(screen.getByText(/Open the coding session \(32 steps\)/)).toBeInTheDocument();
  });

  it("shows the recent activity timeline", async () => {
    render(<MemoryRouter><FeaturePage featureId="feat-refund-limits" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("What happened recently")).toBeInTheDocument());
    expect(screen.getByText("Pull request 101 changed the limit and broke a promise")).toBeInTheDocument();
  });

  it("shows the props row — plain counts", async () => {
    render(<MemoryRouter><FeaturePage featureId="feat-refund-limits" /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText(/coding session/).length).toBeGreaterThan(0));
    expect(screen.getByText(/1 broken/)).toBeInTheDocument();
  });

  it("shows the right rail with the repo link and related features", async () => {
    render(<MemoryRouter><FeaturePage featureId="feat-refund-limits" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Part of")).toBeInTheDocument());
    expect(screen.getByText("Audit log")).toBeInTheDocument();
    expect(screen.getByText("Customer messages")).toBeInTheDocument();
    expect(screen.getByText(/4 coding sessions/)).toBeInTheDocument();
  });

  it("uses repoWorkspace (workspace key slug) for /repo/ links, not the display name", async () => {
    // The fixture has repoWorkspace: "refund-agent" — the lowercase-hyphenated workspace key.
    // Both the breadcrumb and the "Part of" rail link must route to /repo/refund-agent.
    // This guards against the bug where the display name ("Refund Agent") was used instead,
    // which would 404 once the /repo/:ws route went live.
    render(<MemoryRouter><FeaturePage featureId="feat-refund-limits" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Part of")).toBeInTheDocument());
    const links = document.querySelectorAll("a[href]");
    const repoLinks = Array.from(links).filter(
      (l) => l.getAttribute("href")?.includes("/repo/")
    );
    expect(repoLinks.length).toBeGreaterThan(0);
    for (const link of repoLinks) {
      const href = link.getAttribute("href") ?? "";
      // Workspace keys are lowercase-hyphenated slugs — never uppercase or spaces.
      expect(href).not.toMatch(/[A-Z ]/);
      expect(href).toContain("/repo/refund-agent");
    }
  });

  it("renders a quiet not-found state when the fetch fails", async () => {
    mockedFetch.mockRejectedValue(new Error("404"));
    render(<MemoryRouter><FeaturePage featureId="nope" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Feature not found")).toBeInTheDocument());
  });
});
