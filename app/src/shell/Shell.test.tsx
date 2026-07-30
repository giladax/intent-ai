import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Shell } from "./Shell";

const ORG = {
  id: "quire", name: "Quire",
  repos: [
    { workspace: "refund-agent", display_name: "refund-agent", latest_verdict: "OFF_INTENT", open_review_count: 4, coupled_session_count: 0, github_remote: null, status: "fixture", read_only: false, intent_ledger_url: "/intent/refund-agent" },
    { workspace: "intent-ai", display_name: "intent-ai", latest_verdict: null, open_review_count: 0, coupled_session_count: 26, github_remote: "https://github.com/x", status: "active", read_only: false, intent_ledger_url: "/intent/intent-ai" },
  ],
};

function mockFetch() {
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/org")) return { ok: true, json: async () => ORG } as Response;
    if (u.includes("/api/needs-you")) return { ok: true, json: async () => [{ id: "x" }, { id: "y" }, { id: "z" }] } as Response;
    if (u.includes("/api/vocab")) return { ok: true, json: async () => ({ verdicts: { OFF_INTENT: { label: "Breaks a promise", verb: "", ink: "red", severity: "critical" } }, unknown: { label: "Needs your review", verb: "", ink: "gray", severity: "medium" }, severityRank: {} }) } as Response;
    return { ok: true, json: async () => [] } as Response;
  });
}

describe("the familiar shell", () => {
  beforeEach(() => { vi.stubGlobal("fetch", mockFetch()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("renders the ruled navigation, in plain language", async () => {
    const { container } = render(<MemoryRouter><Shell><div /></Shell></MemoryRouter>);
    const nav = container.querySelector("nav")!;
    const navText = nav.textContent ?? "";
    // the IA the founder ruled — muscle-memory nav
    for (const label of ["Today", "Needs you", "Features", "Repositories", "Reviews", "Sessions", "Journal", "Channels"]) {
      expect(navText).toContain(label);
    }
    // plain language, not jargon: "Needs you" not "Docket"
    expect(navText).not.toContain("Docket");
  });

  it("shows the org's repos in the tree, from /api/org", async () => {
    const { container } = render(<MemoryRouter><Shell><div /></Shell></MemoryRouter>);
    await waitFor(() => expect(container.querySelectorAll(".ink-tree-item").length).toBe(2));
    const treeText = Array.from(container.querySelectorAll(".ink-tree-item")).map((e) => e.textContent).join(" ");
    expect(treeText).toContain("refund-agent");
    expect(treeText).toContain("intent-ai");
  });

  it("badges Needs you with the count of things awaiting the human", async () => {
    const { container } = render(<MemoryRouter><Shell><div /></Shell></MemoryRouter>);
    await waitFor(() => expect(container.querySelector(".nav-badge")?.textContent).toBe("3"));
  });
});
