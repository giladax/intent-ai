# Quality loop — review log for alignment/

Recurring agent review (engineering quality + product-surface language).
Each entry: date, reviewed SHA, findings, fixes applied. The loop skips
ticks with no new commits past `last-reviewed`.

last-reviewed: 659094d

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

## 2026-07-19 — tick DEFERRED over 21c2104..a0521af (UX pass in flight)

Eleven code commits await review (up/port/tracing fixes, lens-chat UI,
meaning-first card, map IA, Quire rename, Working Edition direction +
receipts, The Hush). Not dispatched this tick: a design fork is
actively rewriting quire_align/static/* and an api.py route (founder-
directed UX pass — readability, signature scope, affirmative home) —
a parallel reviewer would collide with in-flight edits and review
surfaces already being replaced. last-reviewed stays at 21c2104; the
next tick sweeps the full range including the UX pass in one pass.
Known item already queued for it: mirror.py hero strings still speak
the pre-Hush vocabulary (backend-composed; display-label freeze rules
apply).

## 2026-07-19 — tick over e515b99..21c2104 (teaching loop + eval overhaul)

Reviewed the three code commits (f04ab74 dual-review application, e150ea0
eval overhaul, 21c2104 teaching loop; bf187bb is workspace data, skipped).
Respected as deliberate, not relitigated: the two independently-phrased
Haiku complement judges; human=True bypassing cap/suppression;
reason-aware suppression semantics; the eval-vs-test boundary
(docs/evals-sweep-2026-07-19.md); prompt()-based dialogs.

Engineering findings/fixes (Tier 1, applied):
- api.py 404 details were repr-quoted: `HTTPException(404, str(error))`
  on a KeyError renders `"no entity 'x'"` (str(KeyError) wraps the
  message in repr quotes). Extracted `_detail()` to unwrap args[0]; used
  by the teach and correct endpoints; test now asserts the detail reads
  as a sentence. Verified the KeyError→404 / GraphIntegrityError→409
  mapping is consistent across teach/correct/decide.
- api.py graph_decide carried an unreachable action check —
  DecisionRequest.action is a Literal (422 at the edge, pinned by
  test_decision_api_rejects_unknown_action) and decide() re-checks for
  non-HTTP callers. Dead branch removed, comment explains the layering.
- api.py decided history sorted lexically by `decision.at` while the
  fold deliberately parses instants (entity_graph._instant exists
  BECAUSE lexical sort misorders non-UTC offsets). Added
  `decided_proposals()` to entity_graph — history now uses the same
  clock as the fold.
- entity_graph.py append_proposals minted next_seq with a raw
  `int(d.diff_id.split("-")[1])` (crashes on a malformed id) one screen
  below the guarded `_diff_seq` helper — now reuses the helper.
- `_now()` (api.py) and `_graph_now()` (cli.py) were identical
  wall-clock 3-liners — single definition `entity_graph.now_iso()`
  (docstring: the graph never reads the clock; edges stamp time).
- teach.py: whitespace-collapse inlined three times — extracted
  `_clean()`. `_append_human` claimed "this exact question is already
  open in the inbox" even when the identical change had been APPROVED
  (teaching the same word twice) — now distinguishes; new test
  `test_teaching_the_same_word_twice_says_already_learned`.
- entity_propose.py: module `logger` was defined and never used — dead
  code, removed. `_wrong_scale` triple-inlined
  `set(tokenize(..., min_len=3, keep_digits=True))` — extracted
  `_token_set()` with a docstring noting the seed_quality eval's
  `_norm_tokens` twin is DELIBERATE mirroring (mechanism and eval stay
  independent; only the tokenizer rules are shared via quire_align.text).
- `_plural` promoted (prior-backlog item, trigger met): the third caller
  appeared — entity_propose._question hand-rolled its pluralization.
  Now `text.plural()`, shared by mirror, the enrich CLI, and card
  questions.
- intent.html teachAlias fetched the graph with no error handling (an
  unreachable server threw an uncaught rejection mid-gesture) — wrapped,
  with a user-readable message. Script re-checked with node --check.

Product-surface findings/fixes (Tier 1, applied):
- suppression_reason leaked internals onto an operator surface:
  "identical shape was rejected", "rejected as wrong_name", "rejected as
  not_one_thing" → "an identical proposal was already rejected",
  "rejected as the wrong name", "rejected as not one thing" ("shape" is
  mechanism vocabulary; reason codes stay snake_case in the record, not
  in prose). Tests updated to pin the display strings.
- CLI propose-entities: "suppressed (rejected shape):" → "withheld:"
  (each entry already carries its bracketed reason); the
  `skipped_duplicate` report field was silently dropped from output —
  now printed ("already asked (open or approved)"); "capped at 5"
  hardcoded next to MAX_OPEN_PROPOSALS = 5 → interpolated; truncation
  widened 70→100 so the reason clause survives.
- Seed-card mechanics_note said "bindings are mechanical (tier 2)" —
  "tier 2" is internal architecture; now "the file attachments come from
  approved code links, not from reasoning — each is individually
  removable in Edit".
- Checked and deliberately kept: "shape and approve it in the inbox"
  (plain-English verb, consistent across CLI and intent.html); inbox
  opText verbs ("+ attach", "∅ supersede") — terse but legible in the
  change-block context; reason-code CLI flag help showing raw codes
  (they ARE the flag values).

Backlog (Tier 2, not applied):
- Carried from previous ticks: GraphHeuristics per-request construction
  in /ask; adjudication budget-exhaustion silence; double regroup/write
  in enrich_workspace. RESOLVED this tick: `_plural` promotion (now
  text.plural).
- Shared static/app.js (carried from 07-18, now three pages strong):
  esc() duplicated in mirror/intent; the reviewer-identity prompt exists
  twice with drifting wording (inbox `reviewer()` vs intent `whoami()`,
  same localStorage key); JSON-POST-with-error-detail boilerplate
  duplicated (inbox `post()` vs intent `teachPost()`). Also fold in:
  inbox masthead hardcodes "(never more than 5)", and inbox load() has
  no fetch error handling.
- tests: test_teach.py and test_entity_propose.py each copytree the
  refund-agent fixture into tmp_path with slight variations — promote a
  writable-workspace fixture to conftest.py (which today only has the
  read-only adapter).
- teach.correct with verb part_of loads and folds the diff log once per
  `_require_entity` call — harmless single-operator, wasteful pattern.
- evals/seed_quality.eval_decision_sufficiency parses quote.source by
  splitting on the "·" separator — couples the metric to
  entity_propose's string formatting; a formatting change would silently
  weaken the eval. Consider a structured source field on EvidenceQuote.

152 tests green (151 + 1 new). intent.html JS syntax-checked
(node --check, workspace token substituted).

## 2026-07-19 — tick over 21c2104..659094d (the Working Edition sprint; navigator excluded, under board review)

Nineteen code commits: The Hush + UX pass, meaning-first card, story
layer, relevance/atoms, working mind + evolution/triage,
reasoning-on-nodes, receipts, repo-cognition evals, teach fixes, Quire
rename, up/port/tracing fixes. dc053ba (the navigator — model.py and the
#/explore surface) deliberately NOT reviewed: separate board review in
flight; model.py and the explore route untouched. Respected as
deliberate, not relitigated: the two-phase free-thinking mind design;
salience/dismissal semantics; sign-is-human-only; Sonnet judges
(understanding over tier dogma); the independently-phrased complement
judges; prompt()-based dialogs; single-operator concurrency posture.

Engineering findings/fixes (Tier 1, applied):
- Atomic-write duplication (the mandated extraction): the
  mkstemp/os.replace dance existed 4× — entity_graph._write_diffs (the
  only copy with tmp cleanup on failure), story._write_cache, and BOTH
  mind writers (get_mind, dismiss_thought — which also duplicated the
  yaml header string and mid-function `import os/tempfile`). Extracted
  `fs.atomic_write_text()` (mkdir + write + replace + cleanup, the
  strongest variant's semantics); all four sites now use it; mind's two
  writers share a `_write_mind()` that owns the header. entity_graph
  sheds three stdlib imports.
- mind.py docstring honesty: the module claimed nodes that don't earn
  belief "just evaporate on the next sweep" and the whole file was
  "disposable" — but sweeps now EVOLVE (prior nodes fed back, birthdays
  kept, faded thoughts recorded retired) and the dismissed list is a
  signed human record that deleting the file would destroy. Docstring
  and the mind.yaml header now say so. The magic `[-40:]` retired-trail
  cap is named `_RETIRED_KEPT` with rationale.
- api.py story/mind fallbacks (the sprint's broad excepts): they DID
  log, but only str(error) — a refused API key and an AttributeError
  read identically. All four warnings now carry the exception type
  (`%s: %s`), matching the /ask router-fallback precedent.
- cli.py graph-decide and teach printed `str(error)` on KeyError —
  repr-quoted output (`"no entity 'x'"`), the exact bug class api.py's
  `_detail()` fixed last tick. Extracted `_error_text()`; both commands
  use it.
- cli.py `up` disagreed with itself about the front door: `--open` help
  said "open the inbox", a fresh start opened /app (the map — the
  declared front door since 330db3a), and the reuse-a-running-server
  branch opened /inbox. Unified: the map, everywhere; help text fixed.
- relevance.py `_mind_parts` imported `yaml as _yaml` mid-function —
  moved to module top, alias dropped.
- Route-order check (fragility pass): story/mind/checks routes were
  audited against the greedy `:path` converter — safe by method and
  pattern; the existing NOTE comments in api.py remain accurate.
- evals/repo_cognition.py reviewed: anti-overfit design is sound (task
  hints live only in judges; controls present; every case can fail).
  No changes.

Product-surface findings/fixes (Tier 1, applied):
- The queued Hush item (deferred-tick note): promise-health vocabulary
  still spoke pre-Hush dialect in THREE places — mirror.HEALTH_LABELS
  ("satisfied / partially delivered / CONTRADICTED / no evidence yet"),
  cli.py's private `_HEALTH_DISPLAY` twin, and mirror.html's rollup
  template. These leak into the map's ask-box answers ("what's
  broken?"). All unified to the map's words: kept / partly kept /
  broken / not yet exercised; the whats_broken all-clear answer now
  reads "Nothing is broken or partly kept — every exercised promise is
  holding." Check VERDICTS (DISPLAY_LABELS) stay frozen — a check's
  judgment and a promise's standing deliberately read differently.
  `_HEALTH_DISPLAY` deleted; the ask CLI imports HEALTH_LABELS.
- `up` listed "situation mirror" as a fourth door, but /mirror/<ws> has
  307-forwarded to the map since the UX pass — two doors, one page.
  Door removed (with a comment); test updated to pin its absence.
- Checked and deliberately kept: story byline "N sentences withheld"
  (the refusal voice, honest); "in quires" copy and the needdot; the
  colophon ("Assembled from N signed decisions… Machines propose;
  humans sign."); receipt-slip keys (observed/commit/analyzer/verdict);
  the dismiss prompt ("Why is this noise? — it teaches the mind");
  thoughtSlip showing raw salience token "probably-noise" (legible,
  matches the schema's own vocabulary); reason-code flags in CLI help
  (they ARE the values).

Backlog (Tier 2, not applied):
- RESOLVED this tick: atomic-write duplication (fs.atomic_write_text);
  the queued mirror.py pre-Hush hero strings.
- Carried: GraphHeuristics per-request construction in /ask;
  adjudication budget-exhaustion silence; double regroup/write in
  enrich_workspace; teach.correct part_of double fold; seed_quality
  source-string parsing coupling.
- Carried, grown — shared static/app.js: esc() ×2 (mirror/intent),
  reviewer identity prompt now ×3 (inbox reviewer(), intent whoami(),
  app reviewer()), plural() now in JS ×2 (app, inbox) plus text.plural
  in Python, REASONS table ×2 (app, inbox), JSON-POST boilerplate ×2;
  inbox masthead still hardcodes "(never more than 5)"; inbox load()
  still has no fetch error handling.
- Carried, grown — conftest workspace fixture: the
  copytree-refund-agent + seed-graph skeleton now repeats in FIVE files
  (test_teach, test_entity_propose, test_mind, test_story,
  test_relevance), with identical `adapter`/`store` fixtures pasted 3×;
  promote a writable-workspace fixture + shared store to conftest.py.
- New: mirror.html is orphaned — no route serves it since /mirror began
  redirecting to /app (updated this tick for vocabulary coherence
  anyway); delete it or revive the route, a design-owner call.
- New: api.py fallback paths import `story._load_cache` and
  `mind._mind_file` privates — give story/mind small public cached
  accessors so the API stops reaching into underscores.
- New: judge scaffold (local Verdict model + ChatAnthropic +
  invoke_with_retry) recurs across story.faithfulness_judge,
  evals/repo_cognition.judge_case, and the complement judges — extract
  the MECHANICS only; the judges' independent phrasing is deliberate
  and must survive any helper.
- New: cli._resolve_port swallows probe errors wholesale (`except
  Exception: pass`) — right for the walk, but a debug-level log would
  distinguish a hung occupant from a foreign server; the 10-port walk
  width could be a named constant.
- New: story._org_facts puts every approved diff's citation on the one
  summary line (the prompt itself calls citation walls "inventory
  wearing a costume") and appends a stray space when none exist.

194 tests green (the 189 at the reviewed tip 659094d + 5 from the
excluded navigator commit present in the working tree; no regressions,
1 test updated for the door change). mirror.html JS syntax-checked
(node --check, workspace token substituted); no other page scripts
touched.
