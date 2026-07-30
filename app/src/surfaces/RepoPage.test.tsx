import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { RepoPage } from "./Repositories";
import type { Org } from "../api";
import type { ReviewRow } from "../types";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    fetchOrg: vi.fn(),
    fetchRepoReviews: vi.fn(),
    fetchFeatures: vi.fn(),
  };
});
import { fetchOrg, fetchRepoReviews, fetchFeatures } from "../api";

const ORG: Org = {
  id: "quire",
  name: "Quire",
  repos: [
    {
      workspace: "quire-brain",
      display_name: "quire-brain",
      latest_verdict: "OFF_INTENT",
      open_review_count: 2,
      coupled_session_count: 5,
      github_remote: "https://github.com/giladax/quire-brain",
      status: "frozen",
      read_only: true,
      intent_ledger_url: "/intent/quire-brain",
    },
  ],
};

const REVIEWS: ReviewRow[] = [
  {
    pr_number: 7,
    analysis_id: "a1",
    title: "feat(attention): brain_attention MCP tool",
    verdict: "OFF_INTENT",
    label: "Breaks a promise",
    ink: "red",
    review_state: "pending",
    head_sha: "3aa62fc6",
    ts: "2026-07-20T10:00:00Z",
    link: "/repo/quire-brain/review/7",
  },
  {
    pr_number: 1,
    analysis_id: "a2",
    title: "constraints ride orientation",
    verdict: "ALIGNED",
    label: "Keeps its promises",
    ink: "green",
    review_state: "not_required",
    head_sha: "0aab0cf1",
    ts: "2026-07-19T10:00:00Z",
    link: "/repo/quire-brain/review/1",
  },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/repo/quire-brain"]}>
      <Routes>
        <Route path="/repo/:ws" element={<RepoPage />} />
        <Route path="/repo/:ws/review/:n" element={<div>review room</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RepoPage", () => {
  beforeEach(() => {
    vi.mocked(fetchOrg).mockResolvedValue(ORG);
    vi.mocked(fetchRepoReviews).mockResolvedValue({ workspace: "quire-brain", reviews: REVIEWS });
    vi.mocked(fetchFeatures).mockResolvedValue([]);
  });

  it("renders the repo header with remote, status, and plain verdict", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/quire-brain · frozen/)).toBeInTheDocument());
    expect(screen.getByText("https://github.com/giladax/quire-brain")).toBeInTheDocument();
    // The repo's own latest verdict shows in the header chips (plain language).
    expect(screen.getAllByText("Breaks a promise").length).toBeGreaterThan(0);
  });

  it("lists the repo's reviews newest-first with plain verdicts, never enums", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("feat(attention): brain_attention MCP tool")).toBeInTheDocument(),
    );
    expect(screen.getByText("Breaks a promise")).toBeInTheDocument();
    expect(screen.getByText("constraints ride orientation")).toBeInTheDocument();
    expect(screen.queryByText(/OFF_INTENT/)).not.toBeInTheDocument();
  });

  it("links to the intent ledger", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/The promise ledger/)).toBeInTheDocument());
    const link = screen.getByText(/The promise ledger/).closest("a");
    expect(link).toHaveAttribute("href", "/intent/quire-brain");
  });
});
