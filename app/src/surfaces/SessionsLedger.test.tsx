import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SessionsLedger } from "./SessionsLedger";
import * as api from "../api";
import type { SessionsLedgerData } from "../api";

const LEDGER: SessionsLedgerData = {
  sessions: [
    {
      session_id: "sx-demo-session-001",
      workspace: "giladax-swiftrefunds",
      repo: "giladax/swiftrefunds",
      actor: "dana",
      title: "Raise the premium limit",
      summary: "Raised the premium auto-approval limit to $250.",
      when: "2026-07-18T14:22:00Z",
      turns: 3,
      files_touched: 1,
      decisions: 1,
      pr: 2,
      verdict: { label: "Breaks a promise it touches", ink: "red", pr: 2 },
      link: "/session/sx-demo-session-001",
    },
  ],
  totals: { sessions: 1, turns: 3, files_touched: 1 },
  by_repo: [
    { repo: "giladax/swiftrefunds", workspace: "giladax-swiftrefunds", sessions: 1, turns: 3, files_touched: 1 },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/sessions"]}>
      <SessionsLedger />
    </MemoryRouter>,
  );
}

describe("SessionsLedger", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lists sessions with effort figures and the coupled verdict", async () => {
    vi.spyOn(api, "fetchSessionsLedger").mockResolvedValue(LEDGER);
    vi.spyOn(api, "fetchSessions").mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText("Raise the premium limit")).toBeInTheDocument());
    expect(screen.getByText(/dana · giladax\/swiftrefunds/)).toBeInTheDocument();
    expect(screen.getByText("Breaks a promise it touches")).toBeInTheDocument();
    const row = screen.getByText("Raise the premium limit").closest("a");
    expect(row).toHaveAttribute("href", "/session/sx-demo-session-001");
  });

  it("shows the org effort distribution, honestly labelled", async () => {
    vi.spyOn(api, "fetchSessionsLedger").mockResolvedValue(LEDGER);
    vi.spyOn(api, "fetchSessions").mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText("sessions")).toBeInTheDocument());
    expect(screen.getByText("agent turns")).toBeInTheDocument();
    expect(screen.getByText(/effort proxy, not spend/)).toBeInTheDocument();
    expect(screen.queryByText(/estimated cost|spent \$/i)).not.toBeInTheDocument();
  });

  it("keeps an honest empty state", async () => {
    vi.spyOn(api, "fetchSessionsLedger").mockResolvedValue({
      sessions: [], totals: { sessions: 0, turns: 0, files_touched: 0 }, by_repo: [],
    });
    vi.spyOn(api, "fetchSessions").mockResolvedValue([]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("No sessions in the ledger yet")).toBeInTheDocument(),
    );
  });
});
