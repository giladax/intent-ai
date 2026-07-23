import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AddRepo } from "./AddRepo";

/** Fixtures shaped exactly like the O1 endpoints' JSON (org_router.py):
 *  register → scan → draft → approve → first-results. No live GitHub. */
const SCAN_FIXTURE = {
  sources: [{ path: ".github/CONTRIBUTING.md", score: 0.74 }],
  commits: [{ sha: "abc123", message: "fix: update limits" }],
};

const DRAFT_FIXTURE = {
  workspace: "psf-requests",
  draft_dir: "/tmp/draft",
  obligations: [
    {
      obligation_id: "OB-001",
      kind: "promise",
      statement: "Every change to the public API must have a changelog entry.",
      source_quote: "All changes to the public API must be documented in CHANGELOG.",
      source_section: "Contributing",
      source_reference: ".github/CONTRIBUTING.md",
      revision: "draft-1",
    },
    {
      obligation_id: "OB-002",
      kind: "promise",
      statement: "Tests must pass before a pull request can be merged.",
      source_quote: "PRs must have all tests passing before merge.",
      source_section: "Testing",
      source_reference: ".github/CONTRIBUTING.md",
      revision: "draft-1",
    },
  ],
  bindings: [],
  notes: [],
};

const APPROVE_FIXTURE = {
  workspace_path: "/workspaces/psf-requests",
  id_map: { "OB-001": "PSFREQ-001", "OB-002": "PSFREQ-002" },
  status: "active",
};

const FIRST_RESULTS_FIXTURE = {
  prs_fetched: 10,
  replayed: 2,
  verdicts: [{ pr: 101, verdict: "UNKNOWN", analysis_id: "ana-1" }],
};

function makeFetch() {
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/register")) {
      // Small real-world latency so the honest "Cloning…" state is observable.
      await new Promise((r) => setTimeout(r, 60));
      return { ok: true, json: async () => ({ owner: "psf", name: "requests", workspace: "psf-requests", mirror_path: "/tmp", status: "scanning" }) } as Response;
    }
    if (u.includes("/scan"))
      return { ok: true, json: async () => SCAN_FIXTURE } as Response;
    if (u.includes("/draft"))
      return { ok: true, json: async () => DRAFT_FIXTURE } as Response;
    if (u.includes("/approve"))
      return { ok: true, json: async () => APPROVE_FIXTURE } as Response;
    if (u.includes("/first-results"))
      return { ok: true, json: async () => FIRST_RESULTS_FIXTURE } as Response;
    return { ok: true, json: async () => ({}) } as Response;
  });
}

/** Drives the flow from idle to the review (draft-cards) step. */
async function driveToReview() {
  fireEvent.change(screen.getByPlaceholderText(/github\.com\//i), {
    target: { value: "https://github.com/psf/requests" },
  });
  fireEvent.click(screen.getByRole("button", { name: /register/i }));
  await waitFor(
    () => expect(screen.getByText("Every change to the public API must have a changelog entry.")).toBeInTheDocument(),
    { timeout: 5000 },
  );
}

describe("AddRepo flow", () => {
  beforeEach(() => { vi.stubGlobal("fetch", makeFetch()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("starts with a URL input and a Register button", () => {
    render(<MemoryRouter><AddRepo onDone={() => {}} /></MemoryRouter>);
    expect(screen.getByPlaceholderText(/github\.com\//i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /register/i })).toBeInTheDocument();
    // The constitutional line, in plain words
    expect(screen.getByText(/Nothing governs without your signature/)).toBeInTheDocument();
  });

  it("shows an honest progress state while the clone is running", async () => {
    // Register never resolves — the honest "Cloning…" state must hold.
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    render(<MemoryRouter><AddRepo onDone={() => {}} /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/github\.com\//i), {
      target: { value: "https://github.com/psf/requests" },
    });
    fireEvent.click(screen.getByRole("button", { name: /register/i }));
    await waitFor(() => expect(screen.getByText("Cloning…")).toBeInTheDocument());
    expect(screen.getByText(/Reading the repository/)).toBeInTheDocument();
  });

  it("renders draft cards with plain statements and verbatim source receipts", async () => {
    render(<MemoryRouter><AddRepo onDone={() => {}} /></MemoryRouter>);
    await driveToReview();
    // Source receipt visible, verbatim
    expect(screen.getByText(/All changes to the public API must be documented/)).toBeInTheDocument();
    // Second card
    expect(screen.getByText("Tests must pass before a pull request can be merged.")).toBeInTheDocument();
    // Per-card accept/reject affordance exists
    expect(screen.getAllByRole("button", { name: /reject this promise/i }).length).toBe(2);
  });

  it("shows the signing button — the human's moment of authority", async () => {
    render(<MemoryRouter><AddRepo onDone={() => {}} /></MemoryRouter>);
    await driveToReview();
    expect(screen.getByRole("button", { name: /sign — make these promises/i })).toBeInTheDocument();
  });

  it("rejecting all cards disables the signing act", async () => {
    render(<MemoryRouter><AddRepo onDone={() => {}} /></MemoryRouter>);
    await driveToReview();
    for (const btn of screen.getAllByRole("button", { name: /reject this promise/i })) {
      fireEvent.click(btn);
    }
    expect(screen.getByRole("button", { name: /sign — make these promises/i })).toBeDisabled();
    expect(screen.getByText(/Accept at least one promise/)).toBeInTheDocument();
  });

  it("signing walks through approve + first checks to done", async () => {
    render(<MemoryRouter><AddRepo onDone={() => {}} /></MemoryRouter>);
    await driveToReview();
    fireEvent.click(screen.getByRole("button", { name: /sign — make these promises/i }));
    await waitFor(() => expect(screen.getByText("Repository added")).toBeInTheDocument(), { timeout: 5000 });
  });

  it("locks out jargon — no enum tokens or raw ids leak to the screen", async () => {
    render(<MemoryRouter><AddRepo onDone={() => {}} /></MemoryRouter>);
    await driveToReview();
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/OFF_INTENT|UNGOVERNED|CONTRADICTS_INTENT|POSSIBLE_DRIFT|OB-001|OB-002/);
  });
});
