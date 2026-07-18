# Quality loop — review log for alignment/

Recurring agent review (engineering quality + product-surface language).
Each entry: date, reviewed SHA, findings, fixes applied. The loop skips
ticks with no new commits past `last-reviewed`.

last-reviewed: e515b99

## 2026-07-17 — bootstrap (reviewed SHA: 8fb61ca)

This entry records the baseline rather than a new review: 8fb61ca is
itself the application of a full dual-agent review of the whole package
(reports in docs/reviews/2026-07-17-engineering-review.md and
2026-07-17-language-audit.md — 10+10 Tier-1 items, ~50 Tier-2 items, all
applied; 85 tests green; JS syntax-checked; vocabulary purge verified).
No new agent dispatched this tick — the tip commit is the reviewed state.

Open backlog carried forward (not yet applied anywhere): none — both
review Tier-2 lists were applied in 8fb61ca. Future findings accumulate
here.

## 2026-07-18 — tick over 8fb61ca..fef74cd (agent stalled; completed by hand)

Review agent applied Tier-1 polish before a watchdog stall: mirror.py —
pluralization helper ("1 promise" not "promise(s)"), "worst" red-flag now
means worst (contradiction outranks partial regardless of order),
NO_MATERIAL_IMPACT comparison via enum value; mirror.html — consistent
CONTRADICTED casing, verdict_display in the human-queue, obligation id
escaped; propose.py — extract_doc_paths simplified (char class already
excludes quoting chars). Verified after the stall: 92 tests green, all
three pages' JS syntax-checked. Backlog surfaced before stalling: none
logged. Known follow-up (next tick): mirror.html duplicates esc() a third
time — extract shared static/app.js.

## 2026-07-18 — tick over fef74cd..3ff6a97 (graph heuristics)

Engineering findings/fixes (Tier 1, applied):
- api.py `/ask`: the bare `except Exception` around router construction
  silently swallowed everything — the regex fallback IS the right offline
  behavior, but a typo'd import or bad config looked identical to "no API
  key". Now logs a warning with the exception type/message (logger added
  to the module). Kept `except Exception` scope: ChatAnthropic
  construction can raise several unrelated error types.
- mirror.py `classify_question`: a router failure AT CALL TIME (network
  drop after construction succeeded) propagated and 500'd the question.
  Now degrades to the same regex fallback, logged with traceback. Test
  added (`test_router_runtime_failure_falls_back_to_regex`).
- grouping.py: magic `0.6` hint floor named `_HINT_SAME_COS` with
  rationale relative to `_TEXT_EDGE_MIN`; the `"A|B"` pair-key convention
  was built independently in two modules (`f"{a}|{b}"` vs
  `f"{min...}|{max...}"`) — extracted `pair_hint_key()` in grouping.py,
  used by both writer (graph_heuristics) and reader (group_contract).
- cli.py __main__-guard bug class: recurrence guard added —
  `test_main_guard_is_last_statement_in_cli_module` (AST check that the
  guard is the final top-level statement; an appended command now fails
  the suite instead of shipping silently).
- FakeGraphHeuristics: `verdicts` comment said "(a_id, b_id) sorted
  tuple" but the code keys by statements — comment corrected.

Product-surface findings/fixes (Tier 1, applied):
- `enrich` output claimed "adjudicated pairs: N" where N was the TOTAL
  cached hints — a fully-cached rerun claimed work it didn't do.
  enrich_workspace now also returns `new_pair_hints`; CLI prints
  "adjudicated N new borderline pairs (M on file)".
- `named: anchor → "None"` was possible when the LLM skipped a group —
  None entries filtered out of `named`; a no-op naming pass now says
  "every area already has a name" instead of printing nothing.
- "(1 promises)" pluralization in the areas listing — reuses mirror's
  `_plural` (precedent from the 07-18 tick).

Backlog (too big for this tick):
- api.py constructs `GraphHeuristics()` (a ChatAnthropic client) per /ask
  request — cache on app.state or a module singleton.
- adjudicate_borderline_pairs is silent when the per-run budget exhausts
  with borderline pairs left; surface "K pairs remain, re-run enrich".
- enrich_workspace regroups (load_group_state) twice and writes
  groups.yaml twice per pass — harmless at current scale, could be one.
- `_plural` is imported cross-module from mirror.py as a private helper —
  promote to a small shared text/display module when a third caller
  appears.

99 tests green (97 + 2 new).

## 2026-07-19 — tick over 3ff6a97..e515b99 (deferred to dedicated review)

Three commits since last tick: cd29325 and 6608e92 are docs-only
(experience spec, PRD v1.0) — skipped per precedent. e515b99 (entity
graph MVP step 1) is code, but at tick time it is already under a
DEEPER dedicated review, explicitly requested by the owner: a staff-eng
counterexample hunt (in flight → docs/reviews/2026-07-19-entity-graph-
eng-review.md) plus a completed CPO live-use session
(docs/reviews/2026-07-19-cpo-inbox-session.md, 9 defects, D1–D9). No
loop agent dispatched — a second reviewer over the same files would
duplicate and collide with the fix pass about to land. Findings from
both reviews will be applied as their own commit, which the next tick
will register and may then sweep for anything the dedicated pass left.

Backlog carried forward: unchanged from previous tick (GraphHeuristics
per-request construction; adjudication budget-exhaustion silence; double
regroup/write in enrich_workspace; `_plural` promotion).
