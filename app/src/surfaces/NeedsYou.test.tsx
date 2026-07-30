import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NeedsYou } from "./NeedsYou";
import type { NeedsYouItem } from "../api";

/** Fixture shaped exactly like GET /api/needs-you (quire/org_store.get_needs_you).
 *  This is the contract the room renders from — list AND detail, one shape. */
const FIXTURE: NeedsYouItem[] = [
  {
    id: "n-crit", kind: "review", verdict: "OFF_INTENT",
    label: "Breaks a promise", ink: "red", severity: "critical",
    title: "Breaks a promise — PR 101 on refund-agent",
    repo: "refund-agent", pr_number: 101, link: "/review/n-crit",
    ts: "2026-07-22T10:00:00Z",
    promise: { obligation_id: "OB-101", relation: "contradicts", reasoning: "The guard still blocks at $50 while the policy allows $100. They no longer match.", statement: "Premium-tier customers with a low risk score may receive automatic refunds up to $100 without human involvement." },
    why: { summary: "The agent raised the policy and kept the guard on purpose." },
  },
  {
    id: "n-cov", kind: "review", verdict: "UNGOVERNED",
    label: "No promise covers it", ink: "blue", severity: "medium",
    title: "No promise covers it — PR 42 on intent-ai",
    repo: "intent-ai", pr_number: 42, link: "/review/n-cov",
    ts: "2026-07-21T12:00:00Z", promise: null, why: null,
  },
];

function mockFetch(items: NeedsYouItem[]) {
  return vi.fn(async (url: string) => {
    if (String(url).includes("/api/needs-you")) {
      return { ok: true, json: async () => items } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
}

describe("NeedsYou room", () => {
  beforeEach(() => { vi.stubGlobal("fetch", mockFetch(FIXTURE)); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("renders the list from the contract and lights the loudest first", async () => {
    render(<MemoryRouter initialEntries={["/needs-you"]}><NeedsYou /></MemoryRouter>);
    // both ruled plain labels appear (list + auto-opened detail pane)
    await waitFor(() => expect(screen.getAllByText("Breaks a promise").length).toBeGreaterThan(0));
    expect(screen.getByText("No promise covers it")).toBeInTheDocument();
    // the row's repo/PR footnote reads plainly
    expect(screen.getAllByText(/refund-agent/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/PR 101/).length).toBeGreaterThan(0);
  });

  it("locks out jargon — no enum tokens leak to the screen", async () => {
    render(<MemoryRouter initialEntries={["/needs-you"]}><NeedsYou /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText("Breaks a promise").length).toBeGreaterThan(0));
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/OFF_INTENT|UNGOVERNED|CONTRADICTS_INTENT|POSSIBLE_DRIFT/);
  });

  it("shows the quiet state when nothing needs you", async () => {
    vi.stubGlobal("fetch", mockFetch([]));
    render(<MemoryRouter initialEntries={["/needs-you"]}><NeedsYou /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Nothing needs you")).toBeInTheDocument());
  });

  it("surfaces the receipt and 'why the author did it' in the detail pane", async () => {
    render(<MemoryRouter initialEntries={["/needs-you?item=n-crit"]}><NeedsYou /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Why the author did it")).toBeInTheDocument());
    expect(screen.getByText(/kept the guard on purpose/)).toBeInTheDocument();
    expect(screen.getByText("The promise it touched")).toBeInTheDocument();
    // the signing act reads what it does, in plain words
    expect(screen.getByText("Sign off")).toBeInTheDocument();
    expect(screen.getByText("Send back")).toBeInTheDocument();
    // statement is the headline — plain sentence, not the obligation ID
    expect(screen.getByText(/Premium-tier customers/)).toBeInTheDocument();
  });
});
