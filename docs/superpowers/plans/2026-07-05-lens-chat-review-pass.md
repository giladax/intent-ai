# Lens-Chat Review Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix seven review findings on the lens-chat UI (arrival re-show, label clamp, reduced-motion, date in meta-top, speaker format, type dedup, error mapping) and ship a verified commit.

**Architecture:** All changes stay within three files — `LensChatMain.tsx` (arrival state logic, speaker format, meta-top date, error mapping), `app-ink.css` (reduced-motion coverage for lc-* animations), and `server.ts` (label sanitize/clamp). One new type consolidation (drop duplicate `LensArrivalData` from `api.ts`). One new test file for the label-clamp utility function.

**Tech Stack:** React 18, TypeScript, Vitest (project root), Playwright (playwright-core + chromium channel:chrome), Express/Node server.

## Global Constraints

- Baseline: 660 tests pass, 9 root tsc errors (pre-existing — do not introduce new ones), `npm run typecheck:ui` green.
- Do NOT break any existing test.
- Do NOT use classes — pipeline steps are exported functions.
- ESM imports use `.js` extension.
- Commit trailers must be exactly:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CT7KvNTVAGKSLmyGKVvVpM
  ```
- After all code changes: `cd src/web/ui && npm run build` must succeed.
- Screenshot must land at `.superpowers/sdd/shots-lens-chat-impl/05-arrival-reshow.png`.
- Append a fix report section to `.superpowers/sdd/lens-chat-impl-report.md`.
- `git pull --rebase --autostash origin feat/repo-brain && git push origin feat/repo-brain` after commit.

---

## File Map

| File | Change |
|---|---|
| `src/web/ui/src/components/LensChatMain.tsx` | Arrival re-show fix (IMPORTANT-1); speaker line format (minor 4); meta-top date (minor 3); error mapping (minor 7) |
| `src/web/ui/src/api.ts` | Remove duplicate `LensArrivalData` interface (minor 6) |
| `src/web/ui/src/types.ts` | No change — `LensArrivalData` already lives here |
| `src/web/ui/src/app-ink.css` | Add `lc-breathe`, `lc-stampin`, `lc-needpulse`, `lc-ripple` to `prefers-reduced-motion` block (minor 5) |
| `src/web/server.ts` | Sanitize/clamp `lensScope.timeRange.label` before it reaches the system prompt (minor 2) |
| `tests/web/lens-label-clamp.test.ts` | New: unit tests for the label-clamp helper |

---

## Task 1: Fix arrival re-show on scope clear (IMPORTANT-1)

**Files:**
- Modify: `src/web/ui/src/components/LensChatMain.tsx`

**Interfaces:**
- Consumes: `focusedLens: LensType`, `messages: ChatMessage[]` (component state)
- Produces: derived `arrivalDissolved` boolean — `true` only when `focusedLens !== null && messages.length > 0`

**Context:**

Current code has one-way state: `arrivalDissolved` is set to `true` when a lens is first focused and never resets. The reviewer wants it derived from props instead:
- `arrivalDissolved` should be `focusedLens !== null && messages.length > 0`
- This means: when scope is cleared (`focusedLens` becomes `null`), arrival re-appears immediately.
- When a lens is focused but no messages yet, the arrival brief still shows (with `lc-dissolve` animation class for the pending-dissolve state).
- When a lens is focused AND messages exist, arrival is gone.

The current dissolve `useEffect` (lines 110–115) becomes unnecessary — remove it.

- [ ] **Step 1: Remove the `arrivalDissolved` state and its `useEffect`**

In `src/web/ui/src/components/LensChatMain.tsx`, delete:
```tsx
const [arrivalDissolved, setArrivalDissolved] = useState(false);
```
and the `useEffect` block starting at line 110:
```tsx
  // When a lens is focused for the first time, dissolve the arrival turn.
  useEffect(() => {
    if (focusedLens !== null && !arrivalDissolved) {
      const t = setTimeout(() => setArrivalDissolved(true), 420);
      return () => clearTimeout(t);
    }
  }, [focusedLens, arrivalDissolved]);
```

- [ ] **Step 2: Add derived `arrivalDissolved` constant**

After the remaining `useEffect` (scroll to bottom), add:

```tsx
  // Arrival dissolved = lens is focused AND conversation has started.
  // Clearing scope (focusedLens → null) brings the arrival brief back.
  // Focusing a lens with no messages keeps arrival visible (dissolve-pending).
  const arrivalDissolved = focusedLens !== null && messages.length > 0;
```

- [ ] **Step 3: Run typecheck to confirm no new errors**

```bash
cd /Users/giladkoch/dev/intent-ai/src/web/ui && npm run typecheck:ui
```
Expected: 0 errors (same as baseline).

- [ ] **Step 4: Run tests**

```bash
cd /Users/giladkoch/dev/intent-ai && npm test
```
Expected: 660 tests pass (same baseline).

---

## Task 2: Server-side label clamp (minor 2)

**Files:**
- Modify: `src/web/server.ts`
- Create: `tests/web/lens-label-clamp.test.ts`

**Interfaces:**
- Consumes: raw `lensScope.timeRange.label: string | undefined` from `req.body`
- Produces: sanitized `label: string` — allowlisted ("today" → "today", "this week" → "this week") or stripped to `/[a-z0-9 \-]/gi` and max 32 chars

**Context:**

In `server.ts`, the `/api/chat` handler uses `lensScope.timeRange.label` directly in the system prompt string (lines 1355 and 1363/1368). A malicious or broken client could inject arbitrary text into the LLM system prompt. We need a sanitize function applied before the label reaches the prompt string.

The `buildLensScopeContext` utility in `src/web/lens-chat-utils.ts` can serve as the testable home for this helper.

- [ ] **Step 1: Add `sanitizeLensLabel` to `src/web/lens-chat-utils.ts`**

Open `/Users/giladkoch/dev/intent-ai/src/web/lens-chat-utils.ts` and append:

```typescript
const LABEL_ALLOWLIST = new Set(["today", "this week"]);
const MAX_LABEL_LEN = 32;

/**
 * Server-side guard: allowlist known labels, else strip to safe chars + clamp.
 * Never throws; always returns a string safe for LLM system prompt inclusion.
 */
export function sanitizeLensLabel(raw: string | null | undefined): string {
  if (!raw) return "selected period";
  const lower = raw.toLowerCase().trim();
  if (LABEL_ALLOWLIST.has(lower)) return lower;
  // Strip to alphanumeric + space + hyphen, clamp to 32 chars.
  return raw.replace(/[^a-z0-9 \-]/gi, "").slice(0, MAX_LABEL_LEN).trim() || "selected period";
}
```

- [ ] **Step 2: Write failing tests for `sanitizeLensLabel`**

Create `/Users/giladkoch/dev/intent-ai/tests/web/lens-label-clamp.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { sanitizeLensLabel } from "../../src/web/lens-chat-utils.js";

describe("sanitizeLensLabel", () => {
  it("passes through 'today' as-is", () => {
    expect(sanitizeLensLabel("today")).toBe("today");
  });

  it("passes through 'this week' as-is", () => {
    expect(sanitizeLensLabel("this week")).toBe("this week");
  });

  it("strips non-alphanumeric characters", () => {
    const result = sanitizeLensLabel("injected</script>evil");
    expect(result).not.toContain("<");
    expect(result).not.toContain(">");
    expect(result).not.toContain("/");
  });

  it("clamps to 32 characters", () => {
    const long = "a".repeat(100);
    expect(sanitizeLensLabel(long).length).toBeLessThanOrEqual(32);
  });

  it("returns 'selected period' for null/undefined/empty", () => {
    expect(sanitizeLensLabel(null)).toBe("selected period");
    expect(sanitizeLensLabel(undefined)).toBe("selected period");
    expect(sanitizeLensLabel("")).toBe("selected period");
  });

  it("returns 'selected period' when only forbidden chars remain", () => {
    expect(sanitizeLensLabel("!@#$%^&*()")).toBe("selected period");
  });

  it("is case-insensitive for allowlist", () => {
    expect(sanitizeLensLabel("TODAY")).toBe("today");
    expect(sanitizeLensLabel("This Week")).toBe("this week");
  });
});
```

- [ ] **Step 3: Run tests, confirm new tests fail**

```bash
cd /Users/giladkoch/dev/intent-ai && npm test -- tests/web/lens-label-clamp.test.ts
```
Expected: `sanitizeLensLabel is not a function` (or similar import error).

- [ ] **Step 4: Confirm the implementation passes the tests**

```bash
cd /Users/giladkoch/dev/intent-ai && npm test -- tests/web/lens-label-clamp.test.ts
```
Expected: 7 tests pass.

- [ ] **Step 5: Wire `sanitizeLensLabel` into `server.ts`**

Import the helper at the top of the timeline-scope block in `server.ts`. Find the section (around line 1350):

```typescript
} else if (lensScope?.timeRange) {
  // Timeline-scoped: summarize recent events in the given window
  const sql = getClient();
  const since = lensScope.timeRange.since;
  const until = lensScope.timeRange.until;
  const label = lensScope.timeRange.label ?? "selected period";
```

Change to:

```typescript
} else if (lensScope?.timeRange) {
  // Timeline-scoped: summarize recent events in the given window
  const sql = getClient();
  const since = lensScope.timeRange.since;
  const until = lensScope.timeRange.until;
  const { sanitizeLensLabel } = await import("./lens-chat-utils.js");
  const label = sanitizeLensLabel(lensScope.timeRange.label);
```

Note: `server.ts` already uses dynamic `import()` for other utilities (e.g., `runPipeline`). A dynamic import is fine here to avoid touching the top-level import list and risking unintended side effects.

- [ ] **Step 6: Run full test suite**

```bash
cd /Users/giladkoch/dev/intent-ai && npm test
```
Expected: 667 tests pass (660 baseline + 7 new).

---

## Task 3: Meta-top date (minor 3)

**Files:**
- Modify: `src/web/ui/src/components/LensChatMain.tsx`

**Context:**

The meta-top line currently reads `intent-ai · feat/repo-brain`. The reviewer wants it extended to include the live date in "sat jul 5" style (lowercase, abbreviated day + month + day number).

The date should be computed once at component render time using `new Date()` — no effect needed.

- [ ] **Step 1: Add date formatting helper inline in `LensChatMain.tsx`**

Near the top of the `LensChatMain` function body (before the `verdictText` line), add:

```tsx
  const now = new Date();
  const metaDate = now.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).toLowerCase().replace(",", "");
  // → "sat jul 5" (locale-formatted, lowercase)
```

- [ ] **Step 2: Update the meta-top JSX**

Find:
```tsx
      <div className="lc-meta-top lc-rise" style={{ animationDelay: "0.6s" }}>
        intent-ai · feat/repo-brain
      </div>
```

Replace with:
```tsx
      <div className="lc-meta-top lc-rise" style={{ animationDelay: "0.6s" }}>
        intent-ai · feat/repo-brain · {metaDate}
      </div>
```

- [ ] **Step 3: Run typecheck**

```bash
cd /Users/giladkoch/dev/intent-ai/src/web/ui && npm run typecheck:ui
```
Expected: 0 errors.

---

## Task 4: Conversation speaker line format (minor 4)

**Files:**
- Modify: `src/web/ui/src/components/LensChatMain.tsx`

**Context:**

Per `DESIGN.md`: *"The speaker line names the scope: `BRAIN · LENS: FEATURE / MCP SERVER`."*

Currently the brain's conversation speaker line reads: `brain · <scopeLabel>` or `brain · now` (unscoped).

The required format is:
- **Scoped (feature lens):** `brain · lens: feature / <FEATURE NAME>`
- **Scoped (timeline lens):** `brain · lens: timeline / <TODAY or THIS WEEK>`
- **Unscoped:** `brain · just now` (no change needed for unscoped)

The `scopeLabel` constant currently holds the ◉-prefixed version for the ask-bar tag. We need a separate `speakerScope` for the conversation speaker line.

- [ ] **Step 1: Add `speakerScope` derived value**

After the existing `scopeLabel` const (around line 130), add:

```tsx
  const speakerScope = focusedLens === "feature" && selectedFeatureName
    ? `lens: feature / ${selectedFeatureName.toUpperCase()}`
    : focusedLens === "timeline" && selectedTimeRange
    ? `lens: timeline / ${selectedTimeRange === "today" ? "TODAY" : "THIS WEEK"}`
    : null;
```

- [ ] **Step 2: Update the conversation brain turn speaker line**

Find (in the `messages.map` section):
```tsx
            <div className="lc-speaker">
              brain{focusedLens && scopeLabel ? <> · <span className="lc-scope">{scopeLabel}</span></> : " · now"}
            </div>
```

Replace with:
```tsx
            <div className="lc-speaker">
              brain{speakerScope ? <> · <span className="lc-scope">{speakerScope}</span></> : " · just now"}
            </div>
```

- [ ] **Step 3: Run typecheck**

```bash
cd /Users/giladkoch/dev/intent-ai/src/web/ui && npm run typecheck:ui
```
Expected: 0 errors.

---

## Task 5: Reduced-motion coverage for lc-* animations (minor 5)

**Files:**
- Modify: `src/web/ui/src/app-ink.css`

**Context:**

The existing `prefers-reduced-motion` block at lines 1020–1028 covers `lc-rise`, `lc-dissolve`, and `lc-word` via the `[class*="lc-rise"]` etc. attribute selectors. But `lc-breathe`, `lc-stampin`, `lc-needpulse`, and `lc-ripple` animations are not covered. These are used by:
- `.lc-brand-dot` → `lc-breathe`
- `.lc-pulse` → `lc-breathe`
- `.lc-stamp` → `lc-stampin`
- `.lc-needs` → `lc-needpulse`
- (ripple: referenced in DESIGN.md for the post-approval rail ripple; CSS keyframe defined but not yet applied to a class — still needs the motion rule to be future-proof)

- [ ] **Step 1: Extend the `prefers-reduced-motion` block**

In `src/web/ui/src/app-ink.css`, find the existing reduced-motion block (lines 1020–1028):

```css
@media (prefers-reduced-motion: reduce) {
  [class*="lc-rise"],
  [class*="lc-dissolve"],
  [class*="lc-word"] {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Replace with:

```css
@media (prefers-reduced-motion: reduce) {
  [class*="lc-rise"],
  [class*="lc-dissolve"],
  [class*="lc-word"] {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }

  /* Continuous / physics animations — collapse to settled state */
  .lc-brand-dot,
  .lc-pulse {
    animation: none !important;
    opacity: 1 !important;
    transform: scale(1) !important;
  }

  .lc-stamp {
    animation: none !important;
    opacity: 1 !important;
    transform: rotate(-8deg) scale(1) !important;
  }

  .lc-needs {
    animation: none !important;
    box-shadow: 0 0 0 3px rgba(180, 104, 30, 0.35) !important;
  }

  /* lc-ripple: not yet applied to a class but future-proof */
  [class*="lc-ripple"] {
    animation: none !important;
    box-shadow: none !important;
  }
}
```

---

## Task 6: Consolidate duplicate `LensArrivalData` (minor 6)

**Files:**
- Modify: `src/web/ui/src/api.ts`

**Context:**

`LensArrivalData` is defined in both:
1. `src/web/ui/src/types.ts` (lines 407–412) — the canonical location
2. `src/web/ui/src/api.ts` (lines 139–144) — the fetch function file

`LensChatView.tsx` imports from `../types` (line 8). `api.ts` exports its own inline version. The fix: remove the inline interface from `api.ts` and import from `./types` instead.

- [ ] **Step 1: Update `api.ts` — remove inline interface, add import**

Find in `src/web/ui/src/api.ts` at the top (imports section, currently lines 1–16):

```typescript
import type {
  Project,
  Feature,
  ...
  Provenance,
} from "./types";
```

Add `LensArrivalData` to the import list:

```typescript
import type {
  Project,
  Feature,
  Session,
  FeatureDetail,
  FeatureFile,
  PendingObservation,
  SessionDetail,
  SessionEventsWithWindows,
  ArchiveResponse,
  ChatMessage,
  JournalResponse,
  JournalParams,
  StatsOverview,
  Provenance,
  LensArrivalData,
} from "./types";
```

Then remove the inline interface (lines 139–144):

```typescript
// Lens arrival brief — the verdict sentence source
export interface LensArrivalData {
  pendingCount: number;
  recentEvents: number;
  activeDays: number;
  totals: { sessions: number; events: number; moments: number };
}
```

Keep the `fetchLensArrival` function intact; it just needs to re-export the type. Since `api.ts` currently exports `LensArrivalData` inline, any consumers who import it from `api.ts` will break. Check:

```bash
grep -rn "from.*api.*LensArrivalData\|import.*LensArrivalData.*api" /Users/giladkoch/dev/intent-ai/src/web/ui/src/
```

If any file imports `LensArrivalData` from `api.ts`, update those imports to use `types.ts` instead. (Expected: none — `LensChatView.tsx` already imports from `types`.)

Add a re-export line after the import for backwards-compat (optional — only needed if external code imports it from api):

```typescript
export type { LensArrivalData };
```

Place this right after the import block.

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/giladkoch/dev/intent-ai/src/web/ui && npm run typecheck:ui
```
Expected: 0 errors.

- [ ] **Step 3: Run full test suite**

```bash
cd /Users/giladkoch/dev/intent-ai && npm test
```
Expected: 667 tests pass (same count — no new tests for this task).

---

## Task 7: Human error message on stream drop (minor 7)

**Files:**
- Modify: `src/web/ui/src/components/LensChatMain.tsx`

**Context:**

Currently on stream error (lines 163–167):
```tsx
    } catch (err) {
      appendToLast(`The Brain couldn't answer: ${err instanceof Error ? err.message : String(err)}`, true);
    }
```

This exposes raw fetch/TypeError messages like `"Failed to fetch"`, `"NetworkError when attempting to fetch resource."`, `"TypeError: Failed to fetch"` to the user. The fix: map raw errors to the user-friendly string `"The Brain lost the thread — ask again."` and `console.error` the raw error.

Also the in-stream error event (line 164) shows raw server content:
```tsx
        else if (event.type === "error") appendToLast(`The Brain couldn't answer: ${event.content}`, true);
```

That one can stay technical (it's a server-originated error event, not a network drop) but should also be mapped.

- [ ] **Step 1: Update the catch block in `LensChatMain.tsx`**

Find:
```tsx
    } catch (err) {
      appendToLast(`The Brain couldn't answer: ${err instanceof Error ? err.message : String(err)}`, true);
    }
```

Replace with:
```tsx
    } catch (err) {
      console.error("[LensChatMain] stream error:", err);
      appendToLast("The Brain lost the thread — ask again.", true);
    }
```

- [ ] **Step 2: Update the in-stream error event**

Find:
```tsx
        else if (event.type === "error") appendToLast(`The Brain couldn't answer: ${event.content}`, true);
```

Replace with:
```tsx
        else if (event.type === "error") {
          console.error("[LensChatMain] stream event error:", event.content);
          appendToLast("The Brain lost the thread — ask again.", true);
        }
```

- [ ] **Step 3: Run typecheck**

```bash
cd /Users/giladkoch/dev/intent-ai/src/web/ui && npm run typecheck:ui
```
Expected: 0 errors.

---

## Task 8: Build, Playwright verification, and commit

**Files:**
- Build: `src/web/ui/` (vite build)
- Screenshot: `.superpowers/sdd/shots-lens-chat-impl/05-arrival-reshow.png`
- Report append: `.superpowers/sdd/lens-chat-impl-report.md`

- [ ] **Step 1: Build the UI**

```bash
cd /Users/giladkoch/dev/intent-ai/src/web/ui && npm run build
```
Expected: "built in Xs" — no errors.

- [ ] **Step 2: Run full test suite one last time**

```bash
cd /Users/giladkoch/dev/intent-ai && npm test
```
Expected: 667 tests pass.

- [ ] **Step 3: Playwright verification — arrival re-show**

Start the web server in the background on port 3466:

```bash
cd /Users/giladkoch/dev/intent-ai && npx tsx src/cli/index.ts web --port 3466 &
sleep 4  # give the server time to start
```

Run a Playwright script (inline Node script):

```javascript
// save as /tmp/verify-arrival-reshow.mjs
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
await page.setViewportSize({ width: 1400, height: 900 });

// Navigate to the lens-chat view
await page.goto("http://localhost:3466", { waitUntil: "networkidle" });

// Wait for arrival to render
await page.waitForSelector(".lc-verdict", { timeout: 8000 });

// Click the Feature lens to focus it
await page.click(".lc-lens--feature");
await page.waitForTimeout(600);  // wait for animation

// Do NOT type anything — conversation is empty

// Click the scope tag × to clear scope (or click the lens again to toggle off)
// Check if scope tag is present
const scopeTag = await page.$(".lc-scopetag");
if (scopeTag) {
  await scopeTag.click();
} else {
  // Toggle off by clicking the focused lens
  await page.click(".lc-lens--focused");
}
await page.waitForTimeout(300);

// Verify arrival is visible again
const arrivalVisible = await page.isVisible(".lc-verdict");
if (!arrivalVisible) {
  console.error("FAIL: arrival not visible after scope clear");
  process.exit(1);
}
console.log("PASS: arrival visible after scope clear");

// Screenshot
mkdirSync(".superpowers/sdd/shots-lens-chat-impl", { recursive: true });
await page.screenshot({ path: ".superpowers/sdd/shots-lens-chat-impl/05-arrival-reshow.png" });
console.log("Screenshot saved: .superpowers/sdd/shots-lens-chat-impl/05-arrival-reshow.png");

await browser.close();
process.exit(0);
```

Run it:

```bash
cd /Users/giladkoch/dev/intent-ai && node /tmp/verify-arrival-reshow.mjs
```

Expected output:
```
PASS: arrival visible after scope clear
Screenshot saved: .superpowers/sdd/shots-lens-chat-impl/05-arrival-reshow.png
```

Kill the background server:
```bash
kill %1 2>/dev/null || pkill -f "tsx src/cli/index.ts web --port 3466"
```

- [ ] **Step 4: Append fix report to `lens-chat-impl-report.md`**

Append a new section to `/Users/giladkoch/dev/intent-ai/.superpowers/sdd/lens-chat-impl-report.md`:

```markdown

---

## Review Pass — 2026-07-05

**Commit:** <hash>
**Tests:** 667 pass (+7 new: lens-label-clamp.test.ts)

### Findings Fixed

| # | Finding | Fix |
|---|---------|-----|
| IMPORTANT-1 | Arrival never re-shows after scope clear | `arrivalDissolved` derived from `focusedLens !== null && messages.length > 0`; `useState`+`useEffect` removed |
| 2 | `lensScope.timeRange.label` unvalidated in LLM prompt | `sanitizeLensLabel()` in `lens-chat-utils.ts`; dynamic-imported in `server.ts` timeline branch |
| 3 | Meta-top missing date | Live `toLocaleDateString` date appended: "intent-ai · feat/repo-brain · sat jul 5" |
| 4 | Speaker line wrong format | `speakerScope` derived → "brain · LENS: FEATURE / <NAME>" format |
| 5 | Reduced-motion gaps | `.lc-brand-dot`, `.lc-pulse`, `.lc-stamp`, `.lc-needs`, `[class*=lc-ripple]` added to `prefers-reduced-motion` block |
| 6 | Duplicate `LensArrivalData` | Inline interface removed from `api.ts`; imported from `types.ts` + re-exported |
| 7 | Raw error messages shown to user | Catch block maps to "The Brain lost the thread — ask again." + `console.error` |

### Arrival Re-show Verification

- Server: port 3466
- Action: focus Feature lens → ask nothing → clear scope
- Result: `.lc-verdict` visible — PASS
- Screenshot: `.superpowers/sdd/shots-lens-chat-impl/05-arrival-reshow.png`
```

- [ ] **Step 5: Commit all changes**

```bash
cd /Users/giladkoch/dev/intent-ai
git add src/web/ui/src/components/LensChatMain.tsx
git add src/web/ui/src/api.ts
git add src/web/ui/src/app-ink.css
git add src/web/server.ts
git add src/web/lens-chat-utils.ts
git add tests/web/lens-label-clamp.test.ts
git add src/web/ui/dist
git add -f .superpowers/sdd/shots-lens-chat-impl/05-arrival-reshow.png
git add -f .superpowers/sdd/lens-chat-impl-report.md
```

Commit:

```bash
git commit -m "$(cat <<'EOF'
fix(web): lens-chat review pass — arrival re-shows on scope clear, label clamp, reduced-motion, polish

- IMPORTANT-1: arrivalDissolved is now derived (focusedLens && messages.length > 0);
  clearing scope with empty conversation returns to arrival brief
- minor 2: sanitizeLensLabel() in lens-chat-utils.ts — allowlist today/this-week, strip
  non-[a-z0-9 -] chars, clamp to 32; wired into /api/chat timeline branch
- minor 3: meta-top line shows live date (sat jul 5 style, lowercase)
- minor 4: brain speaker line format → "brain · LENS: FEATURE / <NAME>" per DESIGN.md
- minor 5: prefers-reduced-motion covers lc-breathe, lc-stampin, lc-needpulse, lc-ripple
- minor 6: LensArrivalData consolidated to types.ts; removed duplicate from api.ts
- minor 7: stream drop maps to "The Brain lost the thread — ask again." + console.error

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CT7KvNTVAGKSLmyGKVvVpM
EOF
)"
```

- [ ] **Step 6: Push**

```bash
cd /Users/giladkoch/dev/intent-ai && git pull --rebase --autostash origin feat/repo-brain && git push origin feat/repo-brain
```

Expected: `feat/repo-brain -> feat/repo-brain` success.
