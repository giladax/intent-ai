# Org Platform Plan — GitHub-backed orgs, every PR reviewed, sessions as first-class uploads

> **For agentic workers:** execute slice-by-slice (subagent-driven-development). Every slice lands green and founder-visible. Task specs carry intent + invariants + gates, not verbatim code — the executor designs the code (briefs-leave-room).

**Goal:** An org is the top entity: it points at many GitHub repos in one view, adding a repo is paste-a-URL easy, every PR gets reviewed with org understanding, sessions are uploaded through one standard and matched per commit, and the org's alarms reach a real channel (Telegram first). This extends code review into org understanding — including sessions that carry *intent*, not just code. (Founder directive 2026-07-22, demo-critical.)

**Architecture:** The org layer composes what exists rather than replacing it: workspaces stay the per-repo approved contract; the GitHub adapter (`quire/adapters/github.py`) already fetches PRs and publishes comments; the onboarding wizard (Scan/Draft/Approve/First-results) becomes the paste-a-URL flow's engine; the alarms policy (deterministic, quote-backed, silent-on-healthy) gains delivery transports; U0's `session_checks` is the coupling substrate. Org data lives in Postgres (the ruled datastore). Analyses stay in the alignment SQLite store for the demo — the org view composes over existing API functions, no cross-store join (honest sequencing: store→Postgres remains completion-record follow-up 5, post-demo).

**Tech stack:** existing backend (FastAPI, SQLAlchemy/Postgres, Typer CLI, LangChain), GitHub REST via the existing adapter (GITHUB_TOKEN), python-telegram-bot or raw Bot API via httpx (executor's call), app/ React view.

## Founder summary (read this, skip the rest)

The demo path this plan builds, in order: **open the org view (your repos in one place) → paste a GitHub repo URL → the system scans it, drafts its promises, you approve → its PRs start getting reviewed automatically, verdicts land on GitHub and in the org view → upload the session that wrote a PR and the verdict says "Reasoned in session…" → a promise-breaking PR taps you on Telegram with the quote.** Optionally (⚑ B) one more beat: a product-direction session uploaded *as intent*, approved, and immediately governing the next PR. Four decisions are yours (⚑ A–D below).

## The coupling contract (the "standardize how we upload sessions" answer)

One envelope, three match kinds, fixed precedence — this section IS the standard; surfaces below implement it:

- **Envelope** (`SessionUpload`): `{provider: "claude-code" (extensible), format: "jsonl-v1", transcript: <file>, repo: "owner/name", branch?, commits?: [sha…], pr?: int, actor?, as_intent: bool=false}`. CC JSONL is format v1; other agents comply by producing the envelope, not by imitating CC.
- **Matching precedence** (established U0, binding rulings): explicit `pr`/`commits` → `kind="attached"`; `Claude-Session:` trailers found in the repo's commits → `kind="trailer"`; otherwise structural correlation → `kind="inferred"` **proposals only, never auto-promoted, no content similarity** (founder ruling A of the U-plan).
- **Persistence**: raw transcript stored FIRST (sha256-verified copy in the archive + a Postgres `session_uploads` row; uploaded transcripts are customer evidence — completion-record follow-up 6 graduates to a requirement at slice O3), then digested by the existing pipeline, then linked.

## Constitutional design: sessions as INTENT (the vision beat)

A session where a founder/PM works out product direction can become an intent source — without breaking any invariant. The mechanism is the approval act, generalized from `propose.py`/the wizard:

1. Upload with `as_intent: true` (any session — product discussion, not just code).
2. The system distills candidate **intent cards** from the transcript (statements with verbatim provenance quotes — same discipline as obligation mining).
3. A human approves/edits/rejects the cards (the wizard's Approve act, surfaced in the org view inbox). **The approval is the authority act.**
4. Approval writes an artifact: `workspaces/<ws>/intent/session-memos/<date>-<slug>.md` with frontmatter `{source_session, approved_by, approved_at, quotes}` — registered in `sources.yaml` as `authority: approved`.

Ladder integrity: the artifact enters the EXISTING approved-artifact rung like any PRD. The session itself never gains authority — it remains observed evidence and the provenance receipts. Code never creates intent (a session isn't code, and even a session mints nothing without approval). Quotes validate verbatim against the transcript forever.

## Slices (demo cut = O0→O1→O2→O3→O5, then ⚑ B decides if O4 joins the cut)

Gates named once: **[PY]** full backend pytest + both evals · **[APP]** app build + typecheck + its vitest · **[DEMO]** the slice's founder-visible proof captured (screenshot/API response/message).

### O0 — The org exists: model + view skeleton
**Files:** `backend/quire/db/` (new tables `orgs`, `org_repos`, `org_channels` via the pre-Alembic bootstrap pattern from U0, CENSUS.md updated), `backend/quire/org.py`, org router endpoints, `app/` org home view.
- [ ] Postgres: org (name; single org seeded for demo — ⚑ D), org_repos (github remote ↔ workspace ↔ status), org_channels (transport + config jsonb + purposes). Python single-writer; documented in CENSUS.md.
- [ ] Org home in the dashboard: repos as cards — latest verdict per repo, open-review count, coupled-session count, intent-ledger link. Composes over existing analysis/store readers (SQLite) + Postgres links; meaning before mechanics (cards read as sentences).
- [ ] Done when: founder sees the org view with the existing dogfood repos as its first residents. [PY][APP][DEMO]

### O1 — Hero moment: paste a GitHub URL
**Files:** `backend/quire/org_onboard.py` (URL → mirror → wizard), adapter gains `list_prs` (list/paginate PRs — today only `get_pr(n)` exists), org router + app/ add-repo flow.
- [ ] URL → owner/name → shallow mirror clone/fetch into `backend/.repos/<owner>__<name>` (gitignored cache; refreshed on sync) → wizard Scan/Draft run against the mirror (onboard.py already takes a path + skip-list overrides) → Approve act in the org view → workspace written with `provider: github`, bound to the org.
- [ ] First results: `list_prs` pulls recent PRs into the workspace registry and replays the last few through the analyzer — value visible in the same sitting (wizard act 4, now GitHub-fed).
- [ ] Auth: `GITHUB_TOKEN` from .env (⚑ C); public repos are the demo path; private-repo + GitHub App deferred to O6.
- [ ] Done when: founder pastes a URL and watches a repo become governed. [PY][APP][DEMO]

### O2 — Review every PR (continuous, seam for webhooks)
**Files:** `backend/quire/org_sync.py` (+ `quire org sync [--loop]` CLI; or wire into the existing watcher loop — executor's call), analysis persist gains the check event (absorbs U-plan U4).
- [ ] `PrEventSource` seam: `poll_events(repo, since) -> list[PrEvent]` via `list_prs` now; a webhook endpoint (O6) later maps GitHub payloads to the SAME `PrEvent` → same handler. No rework at swap time.
- [ ] Per new/updated head SHA: analyze (idempotency cache already skips repeats), publish the verdict comment via existing `--publish` marker-upsert, org view updates, and every completed check emits an `activity_events` row (`check:analyzed`, failure-safe) — **absorbs U4**; code-only PRs land in the river exactly like coupled ones, just thinner.
- [ ] Done when: a PR opened on a governed repo gets its verdict with no human action. [PY][DEMO]

### O3 — The session upload standard (absorbs U1 + U5)
**Files:** `backend/quire/sessions_api.py` (`POST /api/sessions/upload` multipart + `quire sessions upload` CLI, `sessions attach`, `sessions propose`), `backend/quire/correlate.py` (as specified in U-plan U1 — mechanical-only correlation), `session_uploads` table, org/PR surfaces gain the coupling line (U5).
- [ ] Implements the coupling contract above end-to-end: persist-first (sha256 + archive + row), digest, match by precedence. Failure isolation: a failed digest never loses the transcript.
- [ ] U1's attach/propose land here verbatim (inferred = proposals only; sentences like "Session … edited 4 of this PR's 6 files during its commit window").
- [ ] Surfaces (U5): PR verdict comment and org view carry "Reasoned in session …" (ruled language) with receipts on demand.
- [ ] Done when: founder uploads a transcript against a PR and the verdict surface shows the coupling. [PY][APP][DEMO]

### O4 — Sessions as intent (⚑ B: in or out of the demo cut)
**Files:** `backend/quire/propose_intent.py` (generalizes propose.py to transcripts), org view inbox Approve act, workspace `intent/session-memos/` artifact writer + sources.yaml registration; one eval case (EDD): a session-memo-governed obligation catches a violating PR; adversarial case: unapproved intent session governs nothing.
- [ ] Exactly the constitutional design above; approval UX reuses the wizard Approve surface; artifacts validate verbatim forever.
- [ ] Done when: a product-direction session becomes an approved intent source and the next analyze cites it. [PY][DEMO]

### O5 — The tap on the shoulder reaches Telegram
**Files:** `backend/quire/channels.py` (`Channel` protocol: `send(text, receipts)`; `TelegramChannel` first — ⚑ A), org_channels wiring, alarm delivery from the sync/watch loop.
- [ ] Alarms policy unchanged (deterministic, quote-backed, dedup, silent-on-healthy) — this slice is DELIVERY only. Message reads as a sentence with the quote; deep-link to the org view. Note: `comms.py` is the separate *ingestion* direction (export-based, quote-or-drop) — untouched here; live channel ingestion joins O6's subscription work.
- [ ] Done when: a promise-breaking PR produces a Telegram message with the receipt. [PY][DEMO]

### O6 — Post-demo platform hardening (not in the demo cut; recorded so nothing is lost)
GitHub App auth (private repos, installation tokens) + webhook endpoint onto the O2 seam + Slack transport + live channel subscriptions + `org_members`/auth + store→Postgres (completion follow-up 5) + object-storage transcript durability (follow-up 6, graduated).

## U-plan composition (explicit)

- **U1, U5 → absorbed into O3** (same interfaces, same rulings). **U4 → absorbed into O2.**
- **U2, U3 (sessions inform intent parsing / verdict evidence) stay in the U-plan**, sequenced after the demo cut — they deepen analysis quality; the demo needs the coupling visible (O3), not yet inside the parse. The U-plan doc gets a pointer note when O3 lands.

## ⚑ Founder decisions (recommend on each)

- **⚑ A — First transport: Telegram** (bot token + chat id, zero OAuth, minutes to live) with Slack as O6. Confirm.
- **⚑ B — Is O4 (sessions-as-intent) in the demo cut?** Recommend YES — it is the "extends code review into org understanding" beat that no code-review tool has; costs ~one slice.
- **⚑ C — Demo auth = personal GITHUB_TOKEN, public repos.** GitHub App (private repos, webhooks) is O6. Confirm.
- **⚑ D — Demo org identity = one seeded org, no login.** Members/auth are platform work (O6+). Confirm.
