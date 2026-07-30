import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Channels } from "./Misc";

// ── Fixtures ──────────────────────────────────────────────────────────

const CHANNEL_ROW = {
  id: "ch-1",
  transport: "telegram",
  config_public: { chat_id: "-100123456", token: "***" },
  purposes: ["alarms"],
};

function mockFetch(overrides?: Record<string, unknown>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    if (u === "/api/channels" && method === "GET") {
      return { ok: true, json: async () => overrides?.list ?? [] } as Response;
    }
    if (u === "/api/channels" && method === "POST") {
      return { ok: true, json: async () => ({ id: "new-ch", status: "ok" }) } as Response;
    }
    if (u.startsWith("/api/channels/") && u.endsWith("/test") && method === "POST") {
      return { ok: true, json: async () => overrides?.test ?? { ok: true, error: null } } as Response;
    }
    if (u.startsWith("/api/channels/") && method === "DELETE") {
      return { ok: true, json: async () => ({ deleted: true }) } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
}

describe("Channels room", () => {
  beforeEach(() => vi.stubGlobal("fetch", mockFetch()));
  afterEach(() => vi.unstubAllGlobals());

  it("shows empty state when no channels configured", async () => {
    render(<MemoryRouter><Channels /></MemoryRouter>);
    await waitFor(() => screen.getByText(/No channels yet/));
    expect(screen.getByText(/Add Telegram channel/)).toBeInTheDocument();
  });

  it("shows a channel row with transport and chat id", async () => {
    vi.stubGlobal("fetch", mockFetch({ list: [CHANNEL_ROW] }));
    render(<MemoryRouter><Channels /></MemoryRouter>);
    await waitFor(() => screen.getByText("telegram"));
    expect(screen.getByText(/-100123456/)).toBeInTheDocument();
    expect(screen.getByText(/alarms/i)).toBeInTheDocument();
  });

  it("opens add form with BotFather instructions when button clicked", async () => {
    render(<MemoryRouter><Channels /></MemoryRouter>);
    await waitFor(() => screen.getByText(/Add Telegram channel/));
    fireEvent.click(screen.getByText(/Add Telegram channel/));
    await waitFor(() => screen.getByText(/@BotFather/));
    expect(screen.getByPlaceholderText(/1234567890:ABCdef/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/-1001234567890/)).toBeInTheDocument();
  });

  it("cancels add form and returns to the add button", async () => {
    render(<MemoryRouter><Channels /></MemoryRouter>);
    await waitFor(() => screen.getByText(/Add Telegram channel/));
    fireEvent.click(screen.getByText(/Add Telegram channel/));
    await waitFor(() => screen.getByText(/@BotFather/));
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => screen.getByText(/Add Telegram channel/));
    expect(screen.queryByText(/@BotFather/)).not.toBeInTheDocument();
  });

  it("calls POST /api/channels with correct payload on save", async () => {
    const fakeFetch = mockFetch();
    vi.stubGlobal("fetch", fakeFetch);
    render(<MemoryRouter><Channels /></MemoryRouter>);
    await waitFor(() => screen.getByText(/Add Telegram channel/));
    fireEvent.click(screen.getByText(/Add Telegram channel/));
    await waitFor(() => screen.getByPlaceholderText(/1234567890:ABCdef/));

    fireEvent.change(screen.getByPlaceholderText(/1234567890:ABCdef/), {
      target: { value: "mytoken" },
    });
    fireEvent.change(screen.getByPlaceholderText(/-1001234567890/), {
      target: { value: "-100999" },
    });
    await act(async () => { fireEvent.click(screen.getByText("Save")); });

    const postCall = fakeFetch.mock.calls.find(
      (args: unknown[]) => args[0] === "/api/channels" && (args[1] as RequestInit | undefined)?.method === "POST"
    );
    expect(postCall).toBeTruthy();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.transport).toBe("telegram");
    expect(body.config.token).toBe("mytoken");
    expect(body.config.chat_id).toBe("-100999");
    expect(body.purposes).toContain("alarms");
  });

  it("shows validation error when saving without filling both fields", async () => {
    render(<MemoryRouter><Channels /></MemoryRouter>);
    await waitFor(() => screen.getByText(/Add Telegram channel/));
    fireEvent.click(screen.getByText(/Add Telegram channel/));
    await waitFor(() => screen.getByPlaceholderText(/1234567890:ABCdef/));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => screen.getByText(/required/i));
  });

  it("shows Sent checkmark when test message succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ list: [CHANNEL_ROW], test: { ok: true, error: null } })
    );
    render(<MemoryRouter><Channels /></MemoryRouter>);
    await waitFor(() => screen.getByText(/Send a test message/));
    await act(async () => { fireEvent.click(screen.getByText(/Send a test message/)); });
    await waitFor(() => screen.getByText(/Sent ✓/));
  });

  it("shows failure message when test send fails", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ list: [CHANNEL_ROW], test: { ok: false, error: "Unauthorized" } })
    );
    render(<MemoryRouter><Channels /></MemoryRouter>);
    await waitFor(() => screen.getByText(/Send a test message/));
    await act(async () => { fireEvent.click(screen.getByText(/Send a test message/)); });
    await waitFor(() => screen.getByText(/Failed: Unauthorized/));
  });

  it("calls DELETE endpoint when Remove clicked", async () => {
    const fakeFetch = mockFetch({ list: [CHANNEL_ROW] });
    vi.stubGlobal("fetch", fakeFetch);
    render(<MemoryRouter><Channels /></MemoryRouter>);
    await waitFor(() => screen.getByText("Remove"));
    await act(async () => { fireEvent.click(screen.getByText("Remove")); });
    const delCall = fakeFetch.mock.calls.find(
      (args: unknown[]) =>
        (args[0] as string).startsWith("/api/channels/") &&
        (args[1] as RequestInit | undefined)?.method === "DELETE"
    );
    expect(delCall).toBeTruthy();
  });

  it("subtitle reads plainly without jargon", async () => {
    render(<MemoryRouter><Channels /></MemoryRouter>);
    // The subtitle must be plain language (not an acronym or internal label)
    await waitFor(() => screen.getByText(/shoulder/i));
    expect(screen.getByText(/shoulder/i)).toBeInTheDocument();
  });
});
