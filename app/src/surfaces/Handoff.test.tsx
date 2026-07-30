/** A4.5 Handoff surface tests.
 *
 *  Tests the two-door entry, staged task-card reveal, per-card decisions, and
 *  the signing act — all against mocked API calls. Covers the WorkspaceTasks
 *  "The work" section independently.
 *
 *  Pattern: mock at the module boundary (api.ts), never at fetch. Contracts
 *  are the backend shapes from the O4.5 docstring. */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Handoff, WorkspaceTasks } from "./Handoff";

// ── API mocks ────────────────────────────────────────────────────────

vi.mock("../api", () => ({
  fetchOrg: vi.fn().mockResolvedValue({
    id: "org-1",
    name: "Test Org",
    repos: [{ workspace: "demo-ws", display_name: "Demo Repo", latest_verdict: null,
              open_review_count: 0, coupled_session_count: 0, github_remote: null,
              status: "active", read_only: false, intent_ledger_url: "/ledger" }],
  }),
  saveIntentSource: vi.fn().mockResolvedValue({
    reference: "test-prd", path: "intent/test-prd.md", status: "draft",
    note: "saved",
  }),
  draftHandoff: vi.fn().mockResolvedValue({
    handoff_id: "HND-abc123",
    tasks: [
      {
        task_id: "TSK-001", workspace: "demo-ws", handoff_id: "HND-abc123",
        department: "dev", statement: "Build the refund flow", why: "Serves the refund promise",
        grounding_note: "", status: "proposed", closure_tier: "check_evidence",
        closure_note: null, signed_by: null,
        links: [
          { kind: "serves_promise", target_ref: "OB-001", target_label: "refund promise",
            evidence: "Users must be able to get refunds" },
          { kind: "builds_on_feature", target_ref: "feat-1", target_label: "Refund Engine",
            evidence: "extends Refund Engine — src/refund.py exists" },
        ],
      },
      {
        task_id: "TSK-002", workspace: "demo-ws", handoff_id: "HND-abc123",
        department: "qa", statement: "Write tests for the refund flow", why: "Cover the promise",
        grounding_note: "", status: "proposed", closure_tier: "test_inspection",
        closure_note: null, signed_by: null, links: [],
      },
      {
        task_id: "TSK-003", workspace: "demo-ws", handoff_id: "HND-abc123",
        department: "product", statement: "Verify refund UX with stakeholders", why: "Product sign-off",
        grounding_note: "No existing UX spec covers this gap", status: "proposed",
        closure_tier: "manual_note", closure_note: null, signed_by: null, links: [],
      },
    ],
    notes: [],
  }),
  approveHandoff: vi.fn().mockResolvedValue({ signed: 2, rejected: 1 }),
  fetchWorkspaceTasks: vi.fn().mockResolvedValue({
    workspace: "demo-ws",
    tasks: [
      {
        task_id: "TSK-001", workspace: "demo-ws", handoff_id: "HND-abc123",
        department: "dev", statement: "Build the refund flow", why: "Serves the promise",
        grounding_note: "", status: "open", closure_tier: "check_evidence",
        closure_note: null, signed_by: "Alice",
        links: [],
      },
      {
        task_id: "TSK-002", workspace: "demo-ws", handoff_id: "HND-abc123",
        department: "qa", statement: "Write tests for the refund flow", why: "",
        grounding_note: "", status: "closed", closure_tier: "test_inspection",
        closure_note: null, signed_by: "Alice",
        links: [{ kind: "closed_by_check", target_ref: "AN-42", target_label: "satisfies",
                  evidence: "tests detected" }],
      },
    ],
  }),
  closeTask: vi.fn().mockResolvedValue({ closed: true }),
}));

// ── Helpers ──────────────────────────────────────────────────────────

function renderHandoff(ws?: string) {
  return render(
    <MemoryRouter initialEntries={[ws ? `/handoff/${ws}` : "/handoff"]}>
      <Routes>
        <Route path="/handoff" element={<Handoff />} />
        <Route path="/handoff/:ws" element={<Handoff />} />
      </Routes>
    </MemoryRouter>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("Handoff surface — door choice", () => {
  it("renders the two-door landing with headline", async () => {
    renderHandoff();
    expect(await screen.findByText(/PRD becomes the team's week/i)).toBeTruthy();
    expect(screen.getByText(/Write a PRD/i)).toBeTruthy();
    expect(screen.getByText(/Paste or upload/i)).toBeTruthy();
  });

  it("shows both doors as disabled when no workspace is selected", async () => {
    renderHandoff();
    await screen.findByText(/Write a PRD/i);
    // Without a workspace, both door-cards should be disabled
    const cards = document.querySelectorAll(".hf-door-card");
    // When no ws param, workspace defaults to "" — doors disabled
    expect(cards.length).toBe(2);
    for (const c of Array.from(cards)) {
      expect((c as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("pre-selects the workspace from the URL param", async () => {
    renderHandoff("demo-ws");
    await screen.findByText(/PRD becomes the team's week/i);
    // With ws param, doors should be enabled
    const cards = document.querySelectorAll(".hf-door-card");
    for (const c of Array.from(cards)) {
      expect((c as HTMLButtonElement).disabled).toBe(false);
    }
  });
});

describe("Handoff surface — editor door", () => {
  it("opens the editor when Write a PRD is clicked", async () => {
    renderHandoff("demo-ws");
    await screen.findByText(/Write a PRD/i);
    fireEvent.click(screen.getByText(/Write a PRD/i));
    expect(await screen.findByText(/Write the PRD/i)).toBeTruthy();
    expect(document.querySelector(".hf-editor")).toBeTruthy();
  });

  it("disables the run button when editor is empty", async () => {
    renderHandoff("demo-ws");
    await screen.findByText(/Write a PRD/i);
    fireEvent.click(screen.getByText(/Write a PRD/i));
    await screen.findByText(/Save & generate/i);
    const btn = screen.getByText(/Save & generate/i).closest("button")!;
    expect(btn.disabled).toBe(true);
  });

  it("enables the run button when content is typed", async () => {
    renderHandoff("demo-ws");
    await screen.findByText(/Write a PRD/i);
    fireEvent.click(screen.getByText(/Write a PRD/i));
    await screen.findByText(/Save & generate/i);
    const ta = document.querySelector<HTMLTextAreaElement>(".hf-editor")!;
    fireEvent.change(ta, { target: { value: "Users must be able to reset their password." } });
    const btn = screen.getByText(/Save & generate/i).closest("button")!;
    expect(btn.disabled).toBe(false);
  });
});

describe("Handoff surface — upload door", () => {
  it("opens the paste view when Paste or upload is clicked", async () => {
    renderHandoff("demo-ws");
    await screen.findByText(/Paste or upload/i);
    fireEvent.click(screen.getByText(/Paste or upload/i));
    expect(await screen.findByText(/Paste the PRD/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/Paste your PRD/i)).toBeTruthy();
  });
});

describe("Handoff surface — review stage", () => {
  beforeEach(async () => {
    const { saveIntentSource, draftHandoff } = await import("../api");
    vi.mocked(saveIntentSource).mockClear();
    vi.mocked(draftHandoff).mockClear();
  });

  async function reachReviewStage() {
    renderHandoff("demo-ws");
    await screen.findByText(/Write a PRD/i);
    fireEvent.click(screen.getByText(/Write a PRD/i));
    await screen.findByText(/Save & generate/i);
    const ta = document.querySelector<HTMLTextAreaElement>(".hf-editor")!;
    fireEvent.change(ta, { target: { value: "# Test PRD\nUsers must get refunds." } });
    fireEvent.click(screen.getByText(/Save & generate/i));
    await screen.findByText(/team's week/i, { exact: false });
  }

  it("shows department groups after drafting", async () => {
    await reachReviewStage();
    // Wait for at least one dept header to appear (staggered reveal)
    await waitFor(() => {
      expect(screen.queryByText(/Development/i)).toBeTruthy();
    }, { timeout: 3000 });
  });

  it("renders task cards with accept/reject controls", async () => {
    await reachReviewStage();
    await waitFor(() => {
      const toggles = document.querySelectorAll(".hf-task-toggle");
      expect(toggles.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  });

  it("shows the signing block after all cards are revealed", async () => {
    await reachReviewStage();
    await waitFor(() => {
      expect(screen.queryByText(/signing act/i)).toBeTruthy();
    }, { timeout: 4000 });
  });

  it("shows receipt toggle on task cards", async () => {
    await reachReviewStage();
    await waitFor(() => {
      const toggles = document.querySelectorAll(".hf-receipt-toggle");
      expect(toggles.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  });

  it("expands receipts when receipt toggle is clicked", async () => {
    await reachReviewStage();
    await waitFor(() => {
      expect(document.querySelectorAll(".hf-receipt-toggle").length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    const firstToggle = document.querySelector<HTMLButtonElement>(".hf-receipt-toggle")!;
    fireEvent.click(firstToggle);
    await waitFor(() => {
      expect(document.querySelector(".hf-receipt-body")).toBeTruthy();
    });
    // The serves receipt should show (use queryAllBy to handle multiple matches)
    expect(screen.queryAllByText(/Serves/i).length).toBeGreaterThan(0);
  });
});

describe("Handoff surface — the settled week", () => {
  it("renders signed tasks grouped by department on the door stage", async () => {
    renderHandoff("demo-ws");
    // The workspace tasks mock has one open dev task + one closed qa task.
    await waitFor(() => {
      expect(screen.queryByText(/The signed week/i)).toBeTruthy();
    });
    expect(screen.queryByText(/Development — what to build/i)).toBeTruthy();
    expect(screen.queryByText(/Build the refund flow/i)).toBeTruthy();
  });

  it("shows the closing check as the receipt on a closed task", async () => {
    renderHandoff("demo-ws");
    await waitFor(() => {
      expect(screen.queryByText(/The signed week/i)).toBeTruthy();
    });
    expect(screen.queryAllByText(/Closed on evidence/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/AN-42/)).toBeTruthy();
  });

  it("offers a resume path when a proposed handoff exists", async () => {
    const { fetchWorkspaceTasks } = await import("../api");
    vi.mocked(fetchWorkspaceTasks).mockResolvedValueOnce({
      workspace: "demo-ws",
      tasks: [
        {
          task_id: "TSK-P1", workspace: "demo-ws", handoff_id: "HND-p",
          department: "dev", statement: "A proposed task", why: "",
          grounding_note: "", status: "proposed", closure_tier: "check_evidence",
          closure_note: null, signed_by: null, links: [],
        },
      ],
    });
    renderHandoff("demo-ws");
    await waitFor(() => {
      expect(screen.queryByText(/awaits your signature/i)).toBeTruthy();
    });
    fireEvent.click(screen.getByText(/Review & sign/i));
    // Lands in the review stage with the proposed card (statement is an
    // editable textarea → match by display value) and the signing block.
    await waitFor(() => {
      expect(screen.queryByDisplayValue(/A proposed task/i)).toBeTruthy();
    }, { timeout: 3000 });
    await waitFor(() => {
      expect(screen.queryByText(/signing act/i)).toBeTruthy();
    }, { timeout: 3000 });
  });
});

describe("WorkspaceTasks — The work section", () => {
  it("renders task rows with department badges", async () => {
    render(
      <MemoryRouter>
        <WorkspaceTasks workspace="demo-ws" />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.queryByText(/Build the refund flow/i)).toBeTruthy();
    });
    expect(document.querySelector(".hf-work-dept")).toBeTruthy();
  });

  it("shows open/closed status chips", async () => {
    render(
      <MemoryRouter>
        <WorkspaceTasks workspace="demo-ws" />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.queryAllByText(/open/i).length).toBeGreaterThan(0);
    });
    expect(screen.queryAllByText(/closed/i).length).toBeGreaterThan(0);
  });

  it("shows closed-on-evidence receipt for closed tasks", async () => {
    render(
      <MemoryRouter>
        <WorkspaceTasks workspace="demo-ws" />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.queryByText(/Closed on evidence/i)).toBeTruthy();
    });
  });

  it("renders a new-handoff link", async () => {
    render(
      <MemoryRouter>
        <WorkspaceTasks workspace="demo-ws" />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.queryByText(/New handoff/i)).toBeTruthy();
    });
  });
});
