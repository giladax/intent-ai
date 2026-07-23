import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { IntentReview } from "./IntentReview";

vi.mock("../api", () => ({
  fetchIntentCards: vi.fn(),
  approveIntentCards: vi.fn(),
}));

import { fetchIntentCards, approveIntentCards } from "../api";

const CARDS = {
  upload_id: "up-1",
  session_id: "founder-sess-1",
  repo: "company/refund-agent",
  cards: [
    {
      statement: "Premium low-risk customers may get automatic refunds up to $250",
      source_quote: "raise the premium automatic-refund ceiling from $100 to $250",
      speaker: "founder",
    },
    {
      statement: "High-risk always needs a human",
      source_quote: "high-risk refund requests always require human approval",
      speaker: "founder",
    },
  ],
  notes: ["a dropped candidate: quote not found verbatim in transcript — dropped"],
};

function renderReview() {
  return render(
    <MemoryRouter initialEntries={["/intent-review/up-1"]}>
      <Routes>
        <Route path="/intent-review/:id" element={<IntentReview />} />
        <Route path="/repo/:ws" element={<div>Repo page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("IntentReview — sessions as intent (O4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchIntentCards).mockResolvedValue(CARDS as never);
    vi.mocked(approveIntentCards).mockResolvedValue({
      signed: 2,
      reference: "session-memo-2026-07-23-premium",
      path: "intent/session-memos/2026-07-23-premium.md",
      workspace: "refund-agent",
      statements: CARDS.cards.map((c) => c.statement),
    } as never);
  });

  it("shows distilled cards with their verbatim quotes", async () => {
    renderReview();
    await screen.findByText(/A session proposes intent/i);
    expect(
      screen.getByText(/Premium low-risk customers may get automatic refunds up to \$250/i),
    ).toBeTruthy();
    // The verbatim quote is the receipt.
    expect(
      screen.getByText(/raise the premium automatic-refund ceiling from \$100 to \$250/i),
    ).toBeTruthy();
    // Dropped candidates are surfaced honestly.
    expect(screen.getByText(/did not resolve verbatim/i)).toBeTruthy();
  });

  it("signs the accepted cards and lands on the settled state", async () => {
    renderReview();
    await screen.findByText(/A session proposes intent/i);

    // Fill the signing name and sign.
    const nameInput = screen.getByLabelText(/Your name/i);
    fireEvent.change(nameInput, { target: { value: "gilad" } });
    fireEvent.click(screen.getByText(/Sign — approve this intent/i));

    await waitFor(() => {
      expect(vi.mocked(approveIntentCards)).toHaveBeenCalledOnce();
    });
    // Both cards accepted by default → approve called with accept:true.
    const call = vi.mocked(approveIntentCards).mock.calls[0];
    expect(call[1]).toBe("gilad");
    expect(call[2].every((c) => c.accept)).toBe(true);

    await screen.findByText(/the intent is now approved/i);
  });

  it("rejecting a card excludes it from the signature", async () => {
    renderReview();
    await screen.findByText(/A session proposes intent/i);

    // Reject the second card (the two toggles are the accept/reject buttons).
    const toggles = screen
      .getAllByRole("button")
      .filter((b) => /Accepted|Rejected/i.test(b.textContent ?? ""));
    expect(toggles).toHaveLength(2);
    fireEvent.click(toggles[1]);
    // The rejected card now reads "Rejected".
    await screen.findByText(/Rejected/i);

    const nameInput = screen.getByLabelText(/Your name/i);
    fireEvent.change(nameInput, { target: { value: "gilad" } });
    fireEvent.click(screen.getByRole("button", { name: /Sign — approve this intent/i }));

    await waitFor(() => {
      expect(vi.mocked(approveIntentCards)).toHaveBeenCalled();
    });
    const cards = vi.mocked(approveIntentCards).mock.calls[0][2];
    expect(cards[0].accept).toBe(true);
    expect(cards[1].accept).toBe(false);
  });
});
