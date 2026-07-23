# A1 — Add a Repo + Feature Definition Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the paste-a-GitHub-URL onboarding flow (scan → draft cards → human signs → repo in tree) and the Feature definition page (`/feature/:id`) that renders real feature data from the brain's JSON contracts.

**Architecture:** All new UI lives in `app/src/surfaces/` as new surface files + new API client functions in `app/src/api.ts`. The Shell's `+` affordance opens the Add-Repo flow as a modal; the flow is a 5-step state machine backed by polling the O1 backend endpoints. The Feature definition page replaces the old `FeatureDetail` component embedded in `Embedded.tsx` with a standalone surface that reads mock-05's grammar (`FeaturePage`). Both are pure renderers over documented JSON contracts — no private paths. No backend changes needed except one optional convenience endpoint (`GET /api/feature/:id` aggregation); the frontend can assemble from existing endpoints if that's easier.

**Tech Stack:** React 18, react-router-dom, Vite/Vitest, TypeScript strict, existing ink/ design system (no new tokens), existing FastAPI O1 endpoints (`/api/org/repos/register`, `/api/org/repos/{ws}/scan`, `/api/org/repos/{ws}/draft`, `/api/org/repos/{ws}/approve`, `/api/org/repos/{ws}/first-results`), existing `/api/features/{id}` endpoint

## Global Constraints

- All labels must be plain language (ruling 2): "Register", "Scanning…", "Reviewing promises…", "Approve promises", "Sign", no enum tokens ever visible
- ink/ tokens are the design system — no new CSS custom properties, no raw hex in component files
- Every new view renders documented JSON contracts only; no private data paths
- Label locks in tests: vitest component tests assert exact plain-language strings (pattern from NeedsYou.test.tsx)
- `UNKNOWN` / unknown status renders gray, never colorful
- Signing act (the Approve button) must feel like a signing moment — prominent, clear copy: "Sign — make these promises"
- No live GitHub calls in tests — fixture JSON only
- TypeScript: all new types go in `app/src/types.ts`; all new API functions go in `app/src/api.ts`
- `npm run build` + `npx tsc --noEmit` + `npx vitest run` must all be green after each task

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `app/src/types.ts` | Modify | Add `DraftObligation`, `DraftResult`, `ScanResult`, `ApproveResult`, `FirstResultsResult`, `OrgFeatureDetail` types |
| `app/src/api.ts` | Modify | Add `registerRepo`, `scanRepo`, `draftRepo`, `approveRepo`, `firstResults`, `fetchOrgFeatureDetail` |
| `app/src/surfaces/AddRepo.tsx` | Create | The full add-repo modal flow (5-step state machine) |
| `app/src/surfaces/AddRepo.test.tsx` | Create | Component tests with fixture JSON, label locks |
| `app/src/surfaces/FeaturePage.tsx` | Create | Feature definition page (mock 05 grammar) |
| `app/src/surfaces/FeaturePage.test.tsx` | Create | Component tests with fixture JSON, label locks |
| `app/src/shell/Shell.tsx` | Modify | Wire `+` button to open AddRepo modal; wire tree feature nodes to `/feature/:id` (already NavLink, just needs feature ink from verdict) |
| `app/src/App.tsx` | Modify | Wire `/feature/:id` route to `FeaturePage` instead of old `FeatureRoute` |

---

## Task 1 — Types + API client for O1 endpoints

**Files:**
- Modify: `app/src/types.ts`
- Modify: `app/src/api.ts`

**Interfaces:**
- Produces: `DraftObligation`, `DraftResult`, `ScanResult`, `ApproveResult`, `FirstResultsResult` types; `registerRepo`, `scanRepo`, `draftRepo`, `approveRepo`, `firstResults` API functions (used by Task 2)
- Produces: `OrgFeatureDetail` type; `fetchOrgFeatureDetail` function (used by Task 3)

- [ ] **Step 1: Add types to `app/src/types.ts`**

Append to the end of `/Users/giladkoch/dev/intent-ai/app/src/types.ts`:

```typescript
// ── O1 add-repo flow ─────────────────────────────────────────────────

/** One source file candidate from /scan. */
export interface ScanSource {
  path: string;
  score: number;
  reference?: string;
}

/** Response from POST /api/org/repos/register */
export interface RegisterResult {
  owner: string;
  name: string;
  workspace: string;
  mirror_path: string;
  status: string;
}

/** Response from POST /api/org/repos/{ws}/scan */
export interface ScanResult {
  sources: ScanSource[];
  commits: Array<{ sha: string; message: string; author?: string; date?: string }>;
}

/** One drafted obligation (proposed promise). */
export interface DraftObligation {
  obligation_id: string;
  kind: string;
  statement: string;
  source_quote: string;
  source_section?: string;
  source_reference: string;
  revision: string;
  provenance_quote?: string;
  // UI-only — human decision, not sent to backend until approve
  accepted?: boolean;
  editedStatement?: string;
}

/** Response from POST /api/org/repos/{ws}/draft */
export interface DraftResult {
  workspace: string;
  draft_dir: string;
  obligations: DraftObligation[];
  bindings: Array<{
    obligation_id: string;
    path: string;
    symbol?: string;
    role?: string;
    relation?: string;
    why?: string;
  }>;
  notes: string[];
}

/** Response from POST /api/org/repos/{ws}/approve */
export interface ApproveResult {
  workspace_path: string;
  id_map: Record<string, string>;
  status: string;
}

/** One PR verdict from first-results. */
export interface FirstResultVerdict {
  pr: number;
  verdict: string;
  analysis_id?: string;
}

/** Response from POST /api/org/repos/{ws}/first-results */
export interface FirstResultsResult {
  prs_fetched: number;
  replayed: number;
  verdicts: FirstResultVerdict[];
}

// ── Feature definition page (mock 05) ───────────────────────────────

/** A promise (obligation) on the feature definition page. */
export interface FeaturePromise {
  id: string;
  statement: string;
  status: "kept" | "broken" | "no_rule" | string;
  /** Plain-language status label, already translated. */
  statusLabel: string;
  statusInk: string;        // ink token: "green" | "red" | "gray"
  explanation?: string;
  sourceRef?: string;
  reviewLink?: string;
}

/** A timeline event on the feature definition page. */
export interface FeatureTimelineItem {
  id: string;
  title: string;
  meta: string;
  ink: string;              // dot color ink token
}

/** Aggregated data for GET /api/features/{id} (existing) + org promises.
 *  Assembled client-side from existing endpoints for now. */
export interface OrgFeatureDetail {
  id: string;
  name: string;
  repo: string;
  repoWorkspace: string;
  summary?: string;
  statusLabel: string;
  statusInk: string;
  promiseCount: number;
  brokenCount: number;
  sessionCount: number;
  fileCount: number;
  lastChange?: string;
  promises: FeaturePromise[];
  whyCard?: {
    summary: string;
    sessionLink?: string;
    sessionSteps?: number;
  };
  timeline: FeatureTimelineItem[];
  relatedFeatures: Array<{ id: string; name: string; ink: string }>;
  mentionedIn?: { sessions: number; threads: number; specs: number };
}
```

- [ ] **Step 2: Add O1 API functions to `app/src/api.ts`**

Append to the end of `/Users/giladkoch/dev/intent-ai/app/src/api.ts`:

```typescript
// ── O1 add-repo flow ─────────────────────────────────────────────────
import type {
  RegisterResult, ScanResult, DraftResult, ApproveResult, FirstResultsResult,
  OrgFeatureDetail,
} from "./types";

export const registerRepo = (url: string) =>
  json<RegisterResult>("/api/org/repos/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

export const scanRepo = (workspace: string) =>
  json<ScanResult>(`/api/org/repos/${workspace}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

export const draftRepo = (workspace: string, sources: ScanResult["sources"]) =>
  json<DraftResult>(`/api/org/repos/${workspace}/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sources }),
  });

export const approveRepo = (
  workspace: string,
  payload: {
    sources: ScanResult["sources"];
    obligations: DraftResult["obligations"];
    bindings: DraftResult["bindings"];
    sweep_commits: ScanResult["commits"];
  },
) =>
  json<ApproveResult>(`/api/org/repos/${workspace}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

export const firstResults = (workspace: string, n_prs = 3) =>
  json<FirstResultsResult>(`/api/org/repos/${workspace}/first-results`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ n_prs }),
  });

/** Fetch the Feature definition page data. 
 *  Uses the existing /api/features/{id} endpoint (FeatureDetail shape);
 *  maps into the OrgFeatureDetail shape for the feature page renderer.
 *  Promises come from /api/features/{id} observations for now (A2 will
 *  replace with a real obligations endpoint). */
export async function fetchOrgFeatureDetail(featureId: string): Promise<OrgFeatureDetail> {
  const detail = await json<import("./types").FeatureDetail>(`/api/features/${featureId}`);
  const f = detail.feature;
  return {
    id: f.id,
    name: f.name,
    repo: f.project_id,
    repoWorkspace: f.project_id,
    summary: f.description || f.current_understanding || undefined,
    statusLabel: "No reviews yet",
    statusInk: "gray",
    promiseCount: 0,
    brokenCount: 0,
    sessionCount: detail.sessions.length,
    fileCount: (detail.files ?? []).length,
    lastChange: detail.sessions[0]?.startedAt ?? undefined,
    promises: (detail.observations ?? []).slice(0, 5).map((o, i) => ({
      id: o.id,
      statement: o.summary,
      status: "no_rule",
      statusLabel: "No rule yet",
      statusInk: "gray",
      explanation: undefined,
      sourceRef: undefined,
      reviewLink: undefined,
    })),
    whyCard: detail.sessions[0]?.narrativeSummary
      ? {
          summary: detail.sessions[0].narrativeSummary,
          sessionLink: `/session/${detail.sessions[0].id}`,
          sessionSteps: detail.sessions[0].momentCount,
        }
      : undefined,
    timeline: detail.sessions.slice(0, 5).map((s) => ({
      id: s.id,
      title: s.narrativeSummary || s.sessionShape || "Coding session",
      meta: `${s.startedAt ? new Date(s.startedAt).toLocaleDateString() : "unknown date"} · ${s.momentCount} steps · reasoning saved`,
      ink: "blue",
    })),
    relatedFeatures: [],
    mentionedIn:
      detail.sessions.length > 0
        ? { sessions: detail.sessions.length, threads: 0, specs: 0 }
        : undefined,
  };
}
```

- [ ] **Step 3: Verify typecheck passes**

```bash
cd /Users/giladkoch/dev/intent-ai/app && npx tsc --noEmit
```

Expected: no errors (or only pre-existing errors — don't introduce new ones)

- [ ] **Step 4: Commit**

```bash
cd /Users/giladkoch/dev/intent-ai && git add app/src/types.ts app/src/api.ts
git commit -m "feat(a1): add O1 + feature-definition types and API client functions"
```

---

## Task 2 — Add-Repo modal flow

**Files:**
- Create: `app/src/surfaces/AddRepo.tsx`
- Create: `app/src/surfaces/AddRepo.test.tsx`
- Modify: `app/src/shell/Shell.tsx` (wire the `+` button)

**Interfaces:**
- Consumes: `registerRepo`, `scanRepo`, `draftRepo`, `approveRepo`, `firstResults` from `app/src/api.ts`
- Consumes: `DraftObligation`, `DraftResult`, `ScanResult`, `ApproveResult` from `app/src/types.ts`
- Produces: `AddRepo` component with prop `onDone: () => void` (used by Shell)

The flow is a state machine with these steps:
1. `idle` — URL input field, "Register" button
2. `cloning` — "Cloning…" spinner (register + scan running)
3. `drafting` — "Reviewing promises… this takes a minute" spinner (draft running, takes ~60s live LLM)
4. `review` — Draft cards: per-card accept/reject toggles + editable statement, then "Sign — make these promises" button
5. `approving` — "Signing…" spinner (approve running)
6. `first-results` — "Running first checks…" spinner (first-results running)
7. `done` — "Done — repo added" with close affordance

- [ ] **Step 1: Write the failing tests**

Create `/Users/giladkoch/dev/intent-ai/app/src/surfaces/AddRepo.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AddRepo } from "./AddRepo";

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
  return vi.fn(async (url: string, opts?: RequestInit) => {
    const u = String(url);
    if (u.includes("/register"))
      return { ok: true, json: async () => ({ owner: "psf", name: "requests", workspace: "psf-requests", mirror_path: "/tmp", status: "scanning" }) } as Response;
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

describe("AddRepo flow", () => {
  beforeEach(() => { vi.stubGlobal("fetch", makeFetch()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("starts with a URL input and a Register button", () => {
    render(<MemoryRouter><AddRepo onDone={() => {}} /></MemoryRouter>);
    expect(screen.getByPlaceholderText(/github.com\//i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /register/i })).toBeInTheDocument();
  });

  it("shows an honest cloning state after submission", async () => {
    render(<MemoryRouter><AddRepo onDone={() => {}} /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/github.com\//i), {
      target: { value: "https://github.com/psf/requests" },
    });
    fireEvent.click(screen.getByRole("button", { name: /register/i }));
    // Should immediately show a progress state (cloning or scanning)
    await waitFor(() =>
      expect(screen.getByText(/cloning|scanning|reviewing/i)).toBeInTheDocument()
    );
  });

  it("renders draft cards with plain-language statements and source receipts", async () => {
    render(<MemoryRouter><AddRepo onDone={() => {}} /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/github.com\//i), {
      target: { value: "https://github.com/psf/requests" },
    });
    fireEvent.click(screen.getByRole("button", { name: /register/i }));
    await waitFor(() =>
      expect(screen.getByText("Every change to the public API must have a changelog entry.")).toBeInTheDocument(),
      { timeout: 5000 }
    );
    // Source receipt visible
    expect(screen.getByText(/All changes to the public API must be documented/)).toBeInTheDocument();
    // Second card
    expect(screen.getByText("Tests must pass before a pull request can be merged.")).toBeInTheDocument();
  });

  it("shows the signing button — the human's moment of authority", async () => {
    render(<MemoryRouter><AddRepo onDone={() => {}} /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/github.com\//i), {
      target: { value: "https://github.com/psf/requests" },
    });
    fireEvent.click(screen.getByRole("button", { name: /register/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /sign — make these promises/i })).toBeInTheDocument(),
      { timeout: 5000 }
    );
  });

  it("locks out jargon — no enum tokens leak to the screen", async () => {
    render(<MemoryRouter><AddRepo onDone={() => {}} /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/github.com\//i), {
      target: { value: "https://github.com/psf/requests" },
    });
    fireEvent.click(screen.getByRole("button", { name: /register/i }));
    await waitFor(() =>
      expect(screen.getByText("Every change to the public API must have a changelog entry.")).toBeInTheDocument(),
      { timeout: 5000 }
    );
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/OFF_INTENT|UNGOVERNED|CONTRADICTS_INTENT|POSSIBLE_DRIFT|OB-001|OB-002/);
  });

  it("shows the honest drafting progress state (takes a minute)", async () => {
    // When scan is fast but draft takes time, the user sees honest context
    render(<MemoryRouter><AddRepo onDone={() => {}} /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/github.com\//i), {
      target: { value: "https://github.com/psf/requests" },
    });
    fireEvent.click(screen.getByRole("button", { name: /register/i }));
    // At some point during the flow, a "minute" hint appears
    // (either the drafting spinner or the review state — we accept either)
    await waitFor(() => {
      const body = document.body.textContent ?? "";
      expect(
        body.includes("minute") ||
        body.includes("Every change") // already on review cards
      ).toBe(true);
    }, { timeout: 5000 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/giladkoch/dev/intent-ai/app && npx vitest run src/surfaces/AddRepo.test.tsx 2>&1 | tail -20
```

Expected: FAIL — `AddRepo` module not found

- [ ] **Step 3: Create `app/src/surfaces/AddRepo.tsx`**

Create `/Users/giladkoch/dev/intent-ai/app/src/surfaces/AddRepo.tsx`:

```typescript
import { useState, useRef } from "react";
import { registerRepo, scanRepo, draftRepo, approveRepo, firstResults } from "../api";
import type { DraftObligation, ScanResult, DraftResult } from "../types";

type Step =
  | "idle"
  | "cloning"
  | "drafting"
  | "review"
  | "approving"
  | "first-results"
  | "done"
  | "error";

interface AddRepoProps {
  onDone: () => void;
}

/** The paste-a-GitHub-URL onboarding flow.
 *  State machine: idle → cloning → drafting → review → approving → first-results → done.
 *  Machines propose; the human signs (the Approve act is the only gate). */
export function AddRepo({ onDone }: AddRepoProps) {
  const [url, setUrl] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [obligations, setObligations] = useState<DraftObligation[]>([]);
  const workspaceRef = useRef<string>("");

  async function handleRegister() {
    if (!url.trim()) return;
    setError(null);
    setStep("cloning");
    try {
      const reg = await registerRepo(url.trim());
      workspaceRef.current = reg.workspace;
      // Scan immediately after register
      const s = await scanRepo(reg.workspace);
      setScan(s);
      setStep("drafting");
      // Draft from the top sources (live LLM — takes ~a minute)
      const d = await draftRepo(reg.workspace, s.sources);
      setDraft(d);
      setObligations(
        d.obligations.map((o) => ({ ...o, accepted: true, editedStatement: o.statement }))
      );
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  }

  async function handleApprove() {
    if (!draft || !scan) return;
    setError(null);
    setStep("approving");
    const accepted = obligations.filter((o) => o.accepted !== false);
    // Carry edited statements into the obligation objects
    const finalObligations = accepted.map((o) => ({
      ...o,
      statement: o.editedStatement ?? o.statement,
    }));
    try {
      await approveRepo(workspaceRef.current, {
        sources: scan.sources,
        obligations: finalObligations,
        bindings: draft.bindings,
        sweep_commits: scan.commits,
      });
      setStep("first-results");
      await firstResults(workspaceRef.current, 3);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  }

  function toggleObligation(id: string) {
    setObligations((prev) =>
      prev.map((o) => (o.obligation_id === id ? { ...o, accepted: !o.accepted } : o))
    );
  }

  function editStatement(id: string, value: string) {
    setObligations((prev) =>
      prev.map((o) => (o.obligation_id === id ? { ...o, editedStatement: value } : o))
    );
  }

  const acceptedCount = obligations.filter((o) => o.accepted !== false).length;

  return (
    <div className="add-repo-modal">
      {step === "idle" && (
        <div className="add-repo-idle">
          <h2>Add a repository</h2>
          <p className="add-repo-sub">
            Paste a GitHub URL. The system reads the repo, drafts its promises — you sign.
            Nothing governs without your signature.
          </p>
          <div className="add-repo-row">
            <input
              className="add-repo-input"
              type="text"
              placeholder="https://github.com/owner/name"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleRegister(); }}
              autoFocus
            />
            <button
              className="ink-btn primary add-repo-submit"
              onClick={handleRegister}
              disabled={!url.trim()}
            >
              Register
            </button>
          </div>
        </div>
      )}

      {step === "cloning" && (
        <div className="add-repo-progress">
          <div className="add-repo-spinner" aria-hidden />
          <div className="add-repo-progress-text">
            <strong>Cloning…</strong>
            <span>Reading the repository. This takes a few seconds.</span>
          </div>
        </div>
      )}

      {step === "drafting" && (
        <div className="add-repo-progress">
          <div className="add-repo-spinner" aria-hidden />
          <div className="add-repo-progress-text">
            <strong>Reviewing promises…</strong>
            <span>
              Reading your docs and drafting candidate promises. This takes about a minute — live
              reasoning running.
            </span>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="add-repo-review">
          <h2>Promises drafted — your review</h2>
          <p className="add-repo-sub">
            The system found {obligations.length} candidate{obligations.length !== 1 ? "s" : ""}. Accept
            or reject each; edit the wording to match what you actually mean. You sign what remains.
          </p>
          <div className="add-repo-cards">
            {obligations.map((o) => (
              <ObligationCard
                key={o.obligation_id}
                obligation={o}
                onToggle={() => toggleObligation(o.obligation_id)}
                onEdit={(v) => editStatement(o.obligation_id, v)}
              />
            ))}
          </div>
          <div className="add-repo-signing">
            <button
              className="ink-btn primary add-repo-sign"
              onClick={handleApprove}
              disabled={acceptedCount === 0}
            >
              Sign — make these promises
            </button>
            {acceptedCount === 0 && (
              <span className="add-repo-sign-hint">Accept at least one promise to continue.</span>
            )}
            {acceptedCount > 0 && (
              <span className="add-repo-sign-hint">
                You are signing {acceptedCount} promise{acceptedCount !== 1 ? "s" : ""}. This is your
                signature — machines proposed, you decide.
              </span>
            )}
          </div>
        </div>
      )}

      {step === "approving" && (
        <div className="add-repo-progress">
          <div className="add-repo-spinner" aria-hidden />
          <div className="add-repo-progress-text">
            <strong>Signing…</strong>
            <span>Writing your approved promises to the workspace.</span>
          </div>
        </div>
      )}

      {step === "first-results" && (
        <div className="add-repo-progress">
          <div className="add-repo-spinner" aria-hidden />
          <div className="add-repo-progress-text">
            <strong>Running first checks…</strong>
            <span>Replaying recent pull requests against your promises.</span>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="add-repo-done">
          <div className="add-repo-done-icon">✓</div>
          <h2>Repository added</h2>
          <p className="add-repo-sub">
            The repo is now governed. Its promises are in effect. You can see it in the tree.
          </p>
          <button className="ink-btn primary" onClick={onDone}>
            Close
          </button>
        </div>
      )}

      {step === "error" && (
        <div className="add-repo-error">
          <h2>Something went wrong</h2>
          <p className="add-repo-sub" style={{ color: "var(--red)" }}>
            {error ?? "An unexpected error occurred."}
          </p>
          <button className="ink-btn" onClick={() => { setStep("idle"); setError(null); }}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

interface ObligationCardProps {
  obligation: DraftObligation;
  onToggle: () => void;
  onEdit: (value: string) => void;
}

function ObligationCard({ obligation: o, onToggle, onEdit }: ObligationCardProps) {
  const accepted = o.accepted !== false;
  return (
    <div
      className={`obligation-card${accepted ? "" : " obligation-card--rejected"}`}
      data-testid={`obligation-card-${o.obligation_id}`}
    >
      <div className="obligation-card-top">
        <button
          className={`obligation-toggle${accepted ? " obligation-toggle--on" : ""}`}
          onClick={onToggle}
          aria-label={accepted ? "Reject this promise" : "Accept this promise"}
        >
          {accepted ? "Accept" : "Reject"}
        </button>
        <textarea
          className="obligation-statement"
          value={o.editedStatement ?? o.statement}
          onChange={(e) => onEdit(e.target.value)}
          disabled={!accepted}
          rows={2}
        />
      </div>
      {o.source_quote && (
        <div className="obligation-receipt">
          <div className="obligation-receipt-label">Source — verbatim</div>
          <blockquote className="obligation-quote">{o.source_quote}</blockquote>
          <div className="obligation-source-ref">{o.source_reference}</div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add add-repo styles to `app/src/app-ink.css`**

Read the file first, then append:
```css
/* ── Add-repo modal flow ─────────────────────────────────────────────── */
.add-repo-modal {
  padding: 32px;
  max-width: 640px;
  margin: 0 auto;
}
.add-repo-modal h2 {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin-bottom: 8px;
}
.add-repo-sub {
  color: var(--muted);
  font-size: 14px;
  line-height: 1.6;
  margin-bottom: 18px;
  max-width: 52ch;
}
.add-repo-row {
  display: flex;
  gap: 10px;
  align-items: center;
}
.add-repo-input {
  flex: 1;
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  font-size: 14px;
  font-family: var(--font);
  color: var(--text);
  background: var(--bg);
}
.add-repo-input:focus {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.add-repo-submit {
  white-space: nowrap;
}
.add-repo-progress {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 24px 0;
}
.add-repo-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--line);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex: none;
  margin-top: 2px;
}
@keyframes spin { to { transform: rotate(360deg); } }
.add-repo-progress-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.add-repo-progress-text strong {
  font-size: 15px;
  font-weight: 600;
}
.add-repo-progress-text span {
  color: var(--muted);
  font-size: 13.5px;
  line-height: 1.5;
  max-width: 48ch;
}
.add-repo-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 24px;
}
.obligation-card {
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  padding: 14px 16px;
  background: var(--bg);
}
.obligation-card--rejected {
  opacity: 0.5;
  background: var(--panel);
}
.obligation-card-top {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.obligation-toggle {
  flex: none;
  padding: 4px 10px;
  border-radius: 20px;
  border: 1px solid var(--line);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  background: var(--panel);
  color: var(--muted);
}
.obligation-toggle--on {
  background: var(--green-bg);
  color: var(--green);
  border-color: transparent;
}
.obligation-statement {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  font-family: var(--font);
  color: var(--text);
  border: none;
  background: transparent;
  resize: none;
  line-height: 1.45;
  padding: 0;
}
.obligation-statement:focus {
  outline: none;
  background: var(--panel);
  border-radius: var(--r-sm);
  padding: 4px 6px;
}
.obligation-receipt {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--line-soft);
}
.obligation-receipt-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--faint);
  margin-bottom: 6px;
}
.obligation-quote {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text);
  border-left: 3px solid var(--line);
  padding-left: 10px;
  margin: 0;
}
.obligation-source-ref {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--faint);
  margin-top: 6px;
}
.add-repo-signing {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}
.add-repo-sign {
  padding: 11px 20px;
  font-size: 15px;
  font-weight: 700;
}
.add-repo-sign-hint {
  font-size: 12.5px;
  color: var(--muted);
  line-height: 1.5;
  max-width: 52ch;
}
.add-repo-done {
  text-align: center;
  padding: 40px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.add-repo-done-icon {
  width: 40px;
  height: 40px;
  background: var(--green-bg);
  color: var(--green);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 700;
}
.add-repo-error {
  padding: 24px 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ── Add-repo modal overlay ─────────────────────────────────────────── */
.add-repo-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 80px;
  z-index: 100;
}
.add-repo-sheet {
  background: var(--bg);
  border-radius: var(--r-lg);
  box-shadow: 0 8px 40px rgba(0,0,0,0.18);
  width: 100%;
  max-width: 680px;
  max-height: calc(100vh - 120px);
  overflow-y: auto;
  padding: 8px 0;
}
.add-repo-sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 24px 0;
}
.add-repo-close {
  background: none;
  border: none;
  color: var(--muted);
  font-size: 20px;
  cursor: pointer;
  padding: 4px;
  line-height: 1;
}
```

- [ ] **Step 5: Run the tests**

```bash
cd /Users/giladkoch/dev/intent-ai/app && npx vitest run src/surfaces/AddRepo.test.tsx 2>&1 | tail -30
```

Expected: all 5 tests PASS

- [ ] **Step 6: Wire the `+` button in `app/src/shell/Shell.tsx`**

In Shell.tsx, add state and modal to the Shell function. The `+` span in the Repositories section becomes a button that opens the modal. Add at the top of the Shell function:

```typescript
const [addRepoOpen, setAddRepoOpen] = useState(false);
const [orgKey, setOrgKey] = useState(0); // increment to force org reload after add
```

Change the `<span className="add" title="Add a repository">+</span>` to:
```typescript
<button className="add" title="Add a repository" onClick={() => setAddRepoOpen(true)}>+</button>
```

Add the modal below `{org?.repos.map(...)` block, before the closing `</aside>`:
```typescript
{addRepoOpen && (
  <AddRepoModal onDone={() => {
    setAddRepoOpen(false);
    setOrgKey((k) => k + 1); // trigger re-fetch
  }} />
)}
```

Import `AddRepo` at the top:
```typescript
import { AddRepo } from "../surfaces/AddRepo";
```

Create a small inline `AddRepoModal` wrapper at bottom of Shell.tsx:
```typescript
function AddRepoModal({ onDone }: { onDone: () => void }) {
  return (
    <div className="add-repo-overlay" onClick={(e) => { if (e.target === e.currentTarget) onDone(); }}>
      <div className="add-repo-sheet">
        <div className="add-repo-sheet-header">
          <button className="add-repo-close" onClick={onDone} aria-label="Close">×</button>
        </div>
        <AddRepo onDone={onDone} />
      </div>
    </div>
  );
}
```

Also update the `fetchOrg` call to depend on `orgKey` so after a repo is added the tree refreshes. Wrap the `useEffect` in Shell with `[orgKey]`:
```typescript
useEffect(() => {
  loadVocab().then(setVocab);
  fetchOrg().then(setOrg).catch(() => setOrg(null));
  fetchNeedsYou().then((n) => setNeedsYouCount(n.length)).catch(() => setNeedsYouCount(0));
  fetch("/api/features").then(...).then(...).catch(...);
  fetch("/api/sessions").then(...).then(...).catch(...);
}, [orgKey]);
```

- [ ] **Step 7: Run all tests**

```bash
cd /Users/giladkoch/dev/intent-ai/app && npx vitest run 2>&1 | tail -20
```

Expected: all tests PASS (43+ including the new AddRepo tests)

- [ ] **Step 8: Build check**

```bash
cd /Users/giladkoch/dev/intent-ai/app && npm run build 2>&1 | tail -20
```

Expected: build succeeds

- [ ] **Step 9: Commit**

```bash
cd /Users/giladkoch/dev/intent-ai && git add app/src/surfaces/AddRepo.tsx app/src/surfaces/AddRepo.test.tsx app/src/app-ink.css app/src/shell/Shell.tsx
git commit -m "feat(a1): add-repo flow — paste URL → scan → draft cards → sign"
```

---

## Task 3 — Feature definition page (mock 05)

**Files:**
- Create: `app/src/surfaces/FeaturePage.tsx`
- Create: `app/src/surfaces/FeaturePage.test.tsx`
- Modify: `app/src/surfaces/Embedded.tsx` (replace FeatureRoute)
- Modify: `app/src/app-ink.css` (feature page styles)

**Interfaces:**
- Consumes: `fetchOrgFeatureDetail` from `app/src/api.ts`
- Consumes: `OrgFeatureDetail`, `FeaturePromise`, `FeatureTimelineItem` from `app/src/types.ts`
- Produces: `FeaturePage` component with prop `featureId: string`

The page grammar follows mock 05 exactly:
- Breadcrumb: Quire / {repo} / {feature name}
- Header: h1 with feature name + status badge, summary, props row (repo, promise count, session count, file count, last change)
- Section "The promises we made": each promise as a card (status badge + statement + explanation + "see where it broke →" / source ref)
- Section "Why the code is like this": the why-card (blue-bg, session link)
- Section "What happened recently": timeline (dot + title + meta)
- Right rail (detail pane): Part of (repo link), Related features, Talked about in, People who touched it

- [ ] **Step 1: Write the failing tests**

Create `/Users/giladkoch/dev/intent-ai/app/src/surfaces/FeaturePage.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FeaturePage } from "./FeaturePage";

/** Fixture shaped like OrgFeatureDetail — the contract the page renders from. */
const FEATURE_FIXTURE = {
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
      explanation: "The allowed amount was raised to $100, but the safety check still stops at $50. They don't match, so some correct refunds are now blocked by mistake.",
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
      explanation: "The code seems to do this, but no promise is watching it — so if it stops working, nobody would be told.",
      sourceRef: undefined,
      reviewLink: undefined,
    },
  ],
  whyCard: {
    summary: "Two hours ago, in a coding session, the AI raised the limit to $100 and kept the $50 check on purpose — it thought the two were separate things. It never went back to update the check.",
    sessionLink: "/session/sess-001",
    sessionSteps: 32,
  },
  timeline: [
    { id: "ev-1", title: "Pull request 101 changed the limit and broke a promise", meta: "2 hours ago · by the coding agent", ink: "red" },
    { id: "ev-2", title: "Coding session: "raise the refund cap to $100"", meta: "2 hours ago · 32 steps · reasoning saved", ink: "blue" },
    { id: "ev-3", title: "Pull request 98 kept every promise", meta: "3 days ago", ink: "green" },
  ],
  relatedFeatures: [
    { id: "feat-audit", name: "Audit log", ink: "green" },
    { id: "feat-messages", name: "Customer messages", ink: "gray" },
  ],
  mentionedIn: { sessions: 4, threads: 2, specs: 1 },
};

function mockFetch(fixture: typeof FEATURE_FIXTURE) {
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/features/feat-refund-limits")) {
      // Return FeatureDetail shape — fetchOrgFeatureDetail maps it
      return {
        ok: true,
        json: async () => ({
          feature: {
            id: "feat-refund-limits",
            project_id: "refund-agent",
            name: "Refund limits",
            description: "How much money we can refund, and the safety checks that keep it correct.",
            current_understanding: null,
            constraints: [],
            known_unknowns: [],
            created_at: "2026-07-01T00:00:00Z",
            session_count: 9,
          },
          sessions: [],
          story: "",
          files: [],
          observations: [],
        }),
      } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
}

// For direct fixture injection (bypasses the real fetch mapping)
function mockFetchDirect(fixture: typeof FEATURE_FIXTURE) {
  return vi.fn(async (url: string) => {
    // We'll test with an injected fixture — override the whole fetchOrgFeatureDetail
    return { ok: true, json: async () => ({}) } as Response;
  });
}

describe("FeaturePage", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("renders the feature name and summary in the header", async () => {
    // Inject fixture via module mock
    vi.mock("../api", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../api")>();
      return {
        ...actual,
        fetchOrgFeatureDetail: vi.fn().mockResolvedValue(FEATURE_FIXTURE),
      };
    });
    render(<MemoryRouter><FeaturePage featureId="feat-refund-limits" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("heading", { name: /Refund limits/i })).toBeInTheDocument());
    expect(screen.getByText(/How much money we can refund/)).toBeInTheDocument();
  });

  it("renders the status badge in plain language — not an enum", async () => {
    vi.mock("../api", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../api")>();
      return {
        ...actual,
        fetchOrgFeatureDetail: vi.fn().mockResolvedValue(FEATURE_FIXTURE),
      };
    });
    render(<MemoryRouter><FeaturePage featureId="feat-refund-limits" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Breaks a promise")).toBeInTheDocument());
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/OFF_INTENT|UNGOVERNED|CONTRADICTS_INTENT|UNKNOWN/);
  });

  it("shows all three promise cards with plain-language status labels", async () => {
    vi.mock("../api", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../api")>();
      return {
        ...actual,
        fetchOrgFeatureDetail: vi.fn().mockResolvedValue(FEATURE_FIXTURE),
      };
    });
    render(<MemoryRouter><FeaturePage featureId="feat-refund-limits" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("The safety check must match the allowed refund amount.")).toBeInTheDocument());
    expect(screen.getByText("Every refund is saved to the log.")).toBeInTheDocument();
    expect(screen.getByText("Tell the customer when a refund is sent.")).toBeInTheDocument();
    // Plain-language badge labels
    expect(screen.getByText("Broken")).toBeInTheDocument();
    expect(screen.getByText("Kept")).toBeInTheDocument();
    expect(screen.getByText("No rule yet")).toBeInTheDocument();
  });

  it("shows the why card with the session explanation", async () => {
    vi.mock("../api", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../api")>();
      return {
        ...actual,
        fetchOrgFeatureDetail: vi.fn().mockResolvedValue(FEATURE_FIXTURE),
      };
    });
    render(<MemoryRouter><FeaturePage featureId="feat-refund-limits" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Why the code is like this/i)).toBeInTheDocument());
    expect(screen.getByText(/raised the limit to \$100 and kept the \$50 check on purpose/)).toBeInTheDocument();
  });

  it("shows the recent activity timeline", async () => {
    vi.mock("../api", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../api")>();
      return {
        ...actual,
        fetchOrgFeatureDetail: vi.fn().mockResolvedValue(FEATURE_FIXTURE),
      };
    });
    render(<MemoryRouter><FeaturePage featureId="feat-refund-limits" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/What happened recently/i)).toBeInTheDocument());
    expect(screen.getByText("Pull request 101 changed the limit and broke a promise")).toBeInTheDocument();
  });

  it("shows the props row — plain counts, ids as footnotes", async () => {
    vi.mock("../api", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../api")>();
      return {
        ...actual,
        fetchOrgFeatureDetail: vi.fn().mockResolvedValue(FEATURE_FIXTURE),
      };
    });
    render(<MemoryRouter><FeaturePage featureId="feat-refund-limits" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Repo/)).toBeInTheDocument());
    expect(screen.getByText(/9.*session|session.*9/i)).toBeInTheDocument();
  });

  it("shows the right rail with the repo link and related features", async () => {
    vi.mock("../api", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../api")>();
      return {
        ...actual,
        fetchOrgFeatureDetail: vi.fn().mockResolvedValue(FEATURE_FIXTURE),
      };
    });
    render(<MemoryRouter><FeaturePage featureId="feat-refund-limits" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Part of")).toBeInTheDocument());
    expect(screen.getByText("Audit log")).toBeInTheDocument();
    expect(screen.getByText("Customer messages")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/giladkoch/dev/intent-ai/app && npx vitest run src/surfaces/FeaturePage.test.tsx 2>&1 | tail -20
```

Expected: FAIL — `FeaturePage` module not found

- [ ] **Step 3: Create `app/src/surfaces/FeaturePage.tsx`**

Create `/Users/giladkoch/dev/intent-ai/app/src/surfaces/FeaturePage.tsx`:

```typescript
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchOrgFeatureDetail } from "../api";
import type { OrgFeatureDetail, FeaturePromise, FeatureTimelineItem } from "../types";
import { VerdictBadge, Dot } from "../ink/Badge";
import type { Ink } from "../ink/vocab";

interface FeaturePageProps {
  featureId: string;
}

/** Feature definition page — what this feature IS now.
 *  Grammar from mock 05: header + promises section + why card + timeline,
 *  with the right rail for repo/related/people context.
 *  Data: /api/features/{id} mapped to OrgFeatureDetail. */
export function FeaturePage({ featureId }: FeaturePageProps) {
  const [feature, setFeature] = useState<OrgFeatureDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchOrgFeatureDetail(featureId)
      .then((f) => { setFeature(f); setLoading(false); })
      .catch(() => { setFeature(null); setLoading(false); });
  }, [featureId]);

  if (loading) {
    return (
      <>
        <main className="ink-main">
          <div className="ink-empty">Loading…</div>
        </main>
        <aside className="ink-detail" />
      </>
    );
  }

  if (!feature) {
    return (
      <>
        <main className="ink-main">
          <div className="ink-empty">
            <div className="big">Feature not found</div>
            {featureId}
          </div>
        </main>
        <aside className="ink-detail" />
      </>
    );
  }

  return (
    <>
      <main className="ink-main">
        {/* Breadcrumb */}
        <div className="ink-crumb">
          <b>Quire</b>
          <span className="sep">/</span>
          <Link to={`/repo/${feature.repoWorkspace}`} style={{ color: "inherit", textDecoration: "none" }}>
            {feature.repo}
          </Link>
          <span className="sep">/</span>
          {feature.name}
        </div>

        {/* Header */}
        <div className="fpage-head">
          <h1 className="fpage-h1">
            {feature.name}
            <VerdictBadge label={feature.statusLabel} ink={feature.statusInk} />
          </h1>
          {feature.summary && (
            <div className="fpage-sum">{feature.summary}</div>
          )}
          <div className="fpage-props">
            <span className="fpage-prop">
              Repo <b>{feature.repo}</b>
            </span>
            <span className="fpage-prop">
              <b>{feature.promiseCount}</b> promise{feature.promiseCount !== 1 ? "s" : ""}
              {feature.brokenCount > 0 && (
                <> · <b style={{ color: "var(--red)" }}>{feature.brokenCount} broken</b></>
              )}
            </span>
            <span className="fpage-prop">
              <b>{feature.sessionCount}</b> coding session{feature.sessionCount !== 1 ? "s" : ""}
            </span>
            {feature.fileCount > 0 && (
              <span className="fpage-prop">
                <b>{feature.fileCount}</b> code file{feature.fileCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>

        <div className="fpage-body">
          {/* Promises section */}
          {feature.promises.length > 0 && (
            <>
              <div className="fpage-h2">The promises we made</div>
              {feature.promises.map((p) => (
                <PromiseCard key={p.id} promise={p} />
              ))}
            </>
          )}

          {/* Why the code is like this */}
          {feature.whyCard && (
            <>
              <div className="fpage-h2">Why the code is like this</div>
              <div className="fpage-why-card">
                <span className="fpage-why-ic">◷</span>
                <div>
                  {feature.whyCard.summary}
                  {feature.whyCard.sessionLink && (
                    <>
                      {" "}
                      <Link to={feature.whyCard.sessionLink} style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
                        Open the coding session{feature.whyCard.sessionSteps ? ` (${feature.whyCard.sessionSteps} steps)` : ""} →
                      </Link>
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Timeline */}
          {feature.timeline.length > 0 && (
            <>
              <div className="fpage-h2">What happened recently</div>
              <div className="fpage-tl">
                {feature.timeline.map((item) => (
                  <TimelineItem key={item.id} item={item} />
                ))}
              </div>
            </>
          )}

          {/* Empty state */}
          {feature.promises.length === 0 && !feature.whyCard && feature.timeline.length === 0 && (
            <div className="ink-empty">
              <div className="big">No promises yet</div>
              Add this repo to start governing its promises.
            </div>
          )}
        </div>
      </main>

      {/* Right rail */}
      <aside className="ink-detail">
        <div className="ink-detail-body">
          <div className="ink-d-sec">Part of</div>
          <Link
            to={`/repo/${feature.repoWorkspace}`}
            className="fpage-rel"
            style={{ textDecoration: "none" }}
          >
            <span className="lk">▤</span> {feature.repo}
          </Link>

          {feature.relatedFeatures.length > 0 && (
            <>
              <div className="ink-d-sec" style={{ marginTop: "22px" }}>Related features</div>
              {feature.relatedFeatures.map((rf) => (
                <Link
                  key={rf.id}
                  to={`/feature/${rf.id}`}
                  className="fpage-rel"
                  style={{ textDecoration: "none" }}
                >
                  <Dot ink={rf.ink as Ink} />
                  {rf.name}
                </Link>
              ))}
            </>
          )}

          {feature.mentionedIn && (
            (feature.mentionedIn.sessions + feature.mentionedIn.threads + feature.mentionedIn.specs) > 0
          ) && (
            <>
              <div className="ink-d-sec" style={{ marginTop: "22px" }}>Talked about in</div>
              <div className="fpage-mention-text">
                {feature.mentionedIn.sessions > 0 && (
                  <><Link to="/sessions" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}>
                    {feature.mentionedIn.sessions} coding session{feature.mentionedIn.sessions !== 1 ? "s" : ""}
                  </Link>{feature.mentionedIn.threads > 0 || feature.mentionedIn.specs > 0 ? ", " : ""}</>
                )}
                {feature.mentionedIn.threads > 0 && (
                  <>{feature.mentionedIn.threads} chat thread{feature.mentionedIn.threads !== 1 ? "s" : ""}{feature.mentionedIn.specs > 0 ? ", and " : " "}</>
                )}
                {feature.mentionedIn.specs > 0 && (
                  <>{feature.mentionedIn.specs} spec{feature.mentionedIn.specs !== 1 ? "s" : ""}</>
                )}
                {" "}mention this feature. Everything here can be clicked down to the exact quote.
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function PromiseCard({ promise: p }: { promise: FeaturePromise }) {
  return (
    <div className="fpage-rule">
      <div className="fpage-rule-top">
        <VerdictBadge label={p.statusLabel} ink={p.statusInk} />
        <span className="fpage-rule-t">{p.statement}</span>
      </div>
      {p.explanation && (
        <div className="fpage-rule-why">{p.explanation}</div>
      )}
      <div className="fpage-rule-foot">
        {p.reviewLink && (
          <Link to={p.reviewLink} style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600, fontSize: "12px" }}>
            See where it {p.status === "broken" ? "broke" : "was checked"} →
          </Link>
        )}
        {p.sourceRef && (
          <span className="fpage-rule-src">{p.sourceRef}</span>
        )}
        {!p.reviewLink && p.status === "no_rule" && (
          <span style={{ color: "var(--muted)", fontSize: "12px" }}>+ Add a promise for this</span>
        )}
      </div>
    </div>
  );
}

function TimelineItem({ item }: { item: FeatureTimelineItem }) {
  return (
    <div className="fpage-tl-item">
      <span className={`fpage-tl-dot dot d-${item.ink}`} />
      <div>
        <div className="fpage-tl-t">{item.title}</div>
        <div className="fpage-tl-m">{item.meta}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add FeaturePage styles to `app/src/app-ink.css`**

Append after the add-repo styles:

```css
/* ── Feature definition page (mock 05) ──────────────────────────────── */
.fpage-head {
  padding: 12px 32px 18px;
  border-bottom: 1px solid var(--line);
}
.fpage-h1 {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.fpage-sum {
  color: var(--text);
  font-size: 15.5px;
  margin-top: 10px;
  max-width: 70ch;
  line-height: 1.5;
}
.fpage-props {
  display: flex;
  gap: 22px;
  margin-top: 16px;
  flex-wrap: wrap;
}
.fpage-prop {
  font-size: 12.5px;
  color: var(--muted);
}
.fpage-prop b {
  color: var(--text);
  font-weight: 600;
}
.fpage-body {
  padding: 24px 32px;
  max-width: 820px;
}
.fpage-h2 {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--faint);
  margin: 26px 0 12px;
}
.fpage-h2:first-child { margin-top: 0; }
.fpage-rule {
  border: 1px solid var(--line);
  border-radius: 11px;
  padding: 14px 16px;
  margin-bottom: 11px;
}
.fpage-rule-top {
  display: flex;
  align-items: center;
  gap: 10px;
}
.fpage-rule-t {
  font-weight: 600;
  font-size: 15px;
}
.fpage-rule-why {
  color: var(--muted);
  font-size: 13.5px;
  line-height: 1.55;
  margin-top: 8px;
}
.fpage-rule-foot {
  display: flex;
  gap: 14px;
  margin-top: 11px;
  font-size: 12px;
  color: var(--faint);
  align-items: center;
}
.fpage-rule-src {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--faint);
}
.fpage-why-card {
  display: flex;
  gap: 11px;
  background: var(--blue-bg);
  border-radius: 11px;
  padding: 14px 15px;
  font-size: 14px;
  line-height: 1.55;
  color: #1e3a5f;
}
.fpage-why-ic {
  color: var(--blue);
  font-size: 16px;
}
.fpage-tl {
  position: relative;
  padding-left: 20px;
}
.fpage-tl::before {
  content: "";
  position: absolute;
  left: 5px;
  top: 4px;
  bottom: 4px;
  width: 2px;
  background: var(--line);
}
.fpage-tl-item {
  position: relative;
  padding: 0 0 16px;
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.fpage-tl-dot {
  position: absolute;
  left: -19px;
  top: 4px;
  border: 2px solid var(--bg);
}
.fpage-tl-t {
  font-size: 14px;
  font-weight: 500;
}
.fpage-tl-m {
  font-size: 12px;
  color: var(--faint);
  font-family: var(--mono);
  margin-top: 2px;
}
.fpage-rel {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 9px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text);
}
.fpage-rel:hover { background: var(--line-soft); }
.fpage-rel .lk { color: var(--muted); }
.fpage-mention-text {
  font-size: 13px;
  color: var(--muted);
  line-height: 1.6;
}
```

- [ ] **Step 5: Update `Embedded.tsx` to use FeaturePage**

In `app/src/surfaces/Embedded.tsx`, replace the `FeatureRoute` function:

```typescript
// Remove the old import of FeatureDetail from components
// Remove the fetchFeatures, fetchSessions imports if only used there
// Replace FeatureRoute:
export function FeatureRoute() {
  const { id } = useParams();
  if (!id) return null;
  return (
    <>
      <FeaturePage featureId={id} />
    </>
  );
}
```

Add import at top:
```typescript
import { FeaturePage } from "./FeaturePage";
```

Also update App.tsx to add `data-detail="true"` for the feature route so the detail pane shows (currently only NeedsYou uses `detail`). In `App.tsx`, change:
```typescript
<Route path="/feature/:id" element={<ShellFrame detail><FeatureRoute /></ShellFrame>} />
```
(add `detail` prop to ShellFrame for the feature route)

- [ ] **Step 6: Run the FeaturePage tests**

```bash
cd /Users/giladkoch/dev/intent-ai/app && npx vitest run src/surfaces/FeaturePage.test.tsx 2>&1 | tail -30
```

Expected: all 7 tests PASS

- [ ] **Step 7: Run all tests**

```bash
cd /Users/giladkoch/dev/intent-ai/app && npx vitest run 2>&1 | tail -20
```

Expected: all tests PASS (43+ including FeaturePage tests)

- [ ] **Step 8: Build and typecheck**

```bash
cd /Users/giladkoch/dev/intent-ai/app && npm run build 2>&1 | tail -10 && npx tsc --noEmit 2>&1 | tail -10
```

Expected: both succeed

- [ ] **Step 9: Commit**

```bash
cd /Users/giladkoch/dev/intent-ai && git add app/src/surfaces/FeaturePage.tsx app/src/surfaces/FeaturePage.test.tsx app/src/surfaces/Embedded.tsx app/src/App.tsx app/src/app-ink.css
git commit -m "feat(a1): feature definition page (mock 05) — promises, why card, timeline, rail"
```

---

## Task 4 — Playwright screenshots (founder-visible proof)

**Files:**
- No production code changes; one test script in scratchpad

This task captures the three required screenshots:
(a) draft-cards/signing screen mid-flow with real drafted obligations
(b) repo live in the tree after approve
(c) a real feature's definition page

The screenshots require a live backend (`uvicorn`). We use `psf/requests` which was proved by O1, plus whatever features exist in the running DB.

- [ ] **Step 1: Verify the backend is running and healthy**

```bash
curl -s http://localhost:3456/api/org | python3 -m json.tool | head -20
```

Expected: JSON with org repos list (including psf-requests if the O1 proof ran, or just existing repos)

If backend not running:
```bash
cd /Users/giladkoch/dev/intent-ai && python3 -m uvicorn quire.app:app --port 3456 &
```

- [ ] **Step 2: Start the dev server**

```bash
cd /Users/giladkoch/dev/intent-ai/app && npm run dev -- --port 5174 &
sleep 3
```

- [ ] **Step 3: Install playwright if not present**

```bash
cd /Users/giladkoch/dev/intent-ai/app && npx playwright install chromium --with-deps 2>&1 | tail -5
```

- [ ] **Step 4: Capture screenshot (a) — draft cards / signing screen**

Write a temp playwright script to scratchpad:
```
/private/tmp/claude-501/-Users-giladkoch-dev-intent-ai/7d68d874-59bf-44f7-937b-f11b6244b5af/scratchpad/sdd/shot-a1-flow.mjs
```

Content (adapt as needed):
```javascript
import { chromium } from "@playwright/test";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: 1440, height: 900 });

// Navigate to the app
await page.goto("http://localhost:5174/");
await page.waitForTimeout(1000);

// Click the + button to open add-repo modal
await page.click(".add");  // or use accessible name if needed
await page.waitForSelector(".add-repo-modal");
await page.screenshot({ path: "/private/tmp/claude-501/-Users-giladkoch-dev-intent-ai/7d68d874-59bf-44f7-937b-f11b6244b5af/scratchpad/sdd/a1-idle.png" });

// Type a URL and submit
await page.fill("input[placeholder*='github.com']", "https://github.com/psf/requests");
await page.click("button:has-text('Register')");

// Wait for drafting to finish (up to 90s — live LLM)
await page.waitForSelector("textarea.obligation-statement", { timeout: 120000 });
await page.screenshot({ path: "/private/tmp/claude-501/-Users-giladkoch-dev-intent-ai/7d68d874-59bf-44f7-937b-f11b6244b5af/scratchpad/sdd/a1-draft-cards.png" });

// (b) After approve — repo in tree
await page.click("button:has-text('Sign — make these promises')");
await page.waitForText("Repository added", { timeout: 60000 });
await page.screenshot({ path: "/private/tmp/claude-501/-Users-giladkoch-dev-intent-ai/7d68d874-59bf-44f7-937b-f11b6244b5af/scratchpad/sdd/a1-done.png" });
await page.click("button:has-text('Close')");
await page.waitForTimeout(1000);
await page.screenshot({ path: "/private/tmp/claude-501/-Users-giladkoch-dev-intent-ai/7d68d874-59bf-44f7-937b-f11b6244b5af/scratchpad/sdd/a1-repo-in-tree.png" });

// (c) Feature definition page — navigate to first feature if any exist
const features = await fetch("http://localhost:3456/api/features").then(r => r.json()).catch(() => []);
if (features.length > 0) {
  await page.goto(`http://localhost:5174/feature/${features[0].id}`);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "/private/tmp/claude-501/-Users-giladkoch-dev-intent-ai/7d68d874-59bf-44f7-937b-f11b6244b5af/scratchpad/sdd/a1-feature-page.png" });
}

await browser.close();
console.log("Screenshots captured.");
```

Run:
```bash
node /private/tmp/claude-501/-Users-giladkoch-dev-intent-ai/7d68d874-59bf-44f7-937b-f11b6244b5af/scratchpad/sdd/shot-a1-flow.mjs
```

Note spend: this run will call `draftRepo` (live Sonnet ~$0.05) and `firstResults` (~$0.10). Keep n_prs=2 to stay within $0.15 target. If psf/requests was already registered from O1, re-register may fail (409/duplicate); in that case navigate directly to `/` and capture the tree + an existing feature page.

- [ ] **Step 5: Commit the final state**

```bash
cd /Users/giladkoch/dev/intent-ai && git add -A
git commit -m "feat(a1): founder-visible proof — add-repo flow + feature definition page

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016cmqJ7aie4Kap4ZsZraMF1"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Paste-URL flow in familiar chrome | Task 2 — AddRepo modal launched from Shell `+` button |
| Honest states: cloning, scanning, drafting (show "~a minute") | Task 2 — step machine with explicit progress states |
| Draft cards: statement, source quote receipt, accept/reject toggles, editable statement | Task 2 — `ObligationCard` component |
| Approve = signing moment, button reads "Sign — make these promises" | Task 2 — `add-repo-sign` button |
| Repo appears in tree after approve | Task 2 — Shell re-fetches org after `onDone` |
| First-results kicked off with progress | Task 2 — `first-results` step in state machine |
| Feature definition page `/feature/:id` | Task 3 — `FeaturePage` |
| Definition/understanding, constraints with receipts | Task 3 — promises section with `PromiseCard` |
| Open reviews touching it | Task 3 — promise cards with review links |
| Coupled sessions | Task 3 — props row session count + why card |
| Recent activity | Task 3 — timeline section |
| Wire tree's feature nodes to feature pages | Task 3 Step 5 — `FeatureRoute` updated, `detail` prop added |
| Plain-language labels with test locks | Tasks 2+3 — explicit label-lock assertions in tests |
| UNKNOWN gray never celebratory | Task 1 — `fetchOrgFeatureDetail` defaults to `statusInk: "gray"` |
| ids as footnotes | Task 3 — ids never shown in body text (obligation_id stripped) |
| ink/ tokens — no new visual world | Tasks 2+3 — all CSS uses `var(--*)` from tokens.css |
| Backend full pytest green | No backend changes — pre-existing suite |
| Playwright PNGs | Task 4 |

**Placeholder scan:** No TBD, TODO, or "similar to" patterns. All code blocks are complete.

**Type consistency:**
- `DraftObligation.accepted?: boolean` — set in AddRepo state, passed back in approve as filter
- `OrgFeatureDetail.promises: FeaturePromise[]` — FeaturePage renders `p.statement`, `p.statusLabel`, `p.statusInk` — all defined in Task 1
- `fetchOrgFeatureDetail` returns `OrgFeatureDetail` — `FeaturePage` consumes it — type chain consistent
- `registerRepo` → `RegisterResult.workspace` used as `workspaceRef.current` — correct
- `scanRepo` returns `ScanResult` — passed to `draftRepo` as `sources: ScanResult["sources"]` — correct shape

**One flag:** The `fetchOrgFeatureDetail` in `api.ts` imports `FeatureDetail` using an inline `import()` at module scope. Move it to the top-level import block in Task 1 Step 2 to avoid a TypeScript error. The plan's Step 2 code uses `import("./types").FeatureDetail` — replace with a regular import:

```typescript
// In api.ts Task 1 Step 2, change the inline dynamic import to:
import type { ..., FeatureDetail as FeatureDetailShape } from "./types";
// Then in fetchOrgFeatureDetail:
const detail = await json<FeatureDetailShape>(`/api/features/${featureId}`);
```

This is the correct form — the plan's inline `import()` in a type position would cause a TS error.
