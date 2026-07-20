# Quality loop — review log for alignment/

Recurring agent review (engineering quality + product-surface language).
Each entry: date, reviewed SHA, findings, fixes applied. The loop skips
ticks with no new commits past `last-reviewed`.

last-reviewed: 0aab0cf

## 2026-07-21 — SHA advance over 7680a08..0aab0cf (no fresh agent)

The sole new commit is 0aab0cf — the previous tick itself, which applied
that tick's agent-recommended Tier-1 fixes (structured `broken` flag,
unified session ref, plain-language push labels, the blind-spot warning).
Those changes were already agent-derived, hand-verified, and test-gated
(229 passed). Re-dispatching an agent to review the fixes an agent just
recommended is circular, so this tick only advances last-reviewed — same
precedent as the 2026-07-17 bootstrap ("the tip commit is the reviewed
state"). Next substantive commit past 0aab0cf gets a full dual-lens review.

## 2026-07-20 — tick over 1531e1a..7680a08 (session + comms + alarms; agent review)

Ten commits since the last tick landed three new subsystems: session
ingestion (`session.py`), comms + org event stream (`comms.py`,
`events.py`), and the proactive alarm layer (`alarms.py`), plus the
evidence-gate / injection hardening from the blind review. One
general-purpose agent reviewed the changed source under both lenses.
Overall read: high-quality, disciplined code — quote-or-drop enforced
throughout, prose in the alarm narration is genuinely CPO-ready.

**Tier-1 applied (this commit):**
- `events.py` — **live-store break detection was dead in production**
  (highest-impact find). Break was sniffed as `"contradict" in text`, but a
  live check's verdict is the Classification enum `"OFF_INTENT"`, which
  contains no such substring — so every drift/silent-drift alarm was green
  on fixtures and would never fire against a real analysis store. Fixed by
  carrying a structured `broken` flag on the check event, computed from the
  classification (live) or the verdict phrase (fixture), and mapping the
  live enum to the same human verdict vocabulary the fixtures use
  (`_VERDICT_TEXT`) — which also kills an "OFF_INTENT" product-surface leak.
  Regression test added (`test_break_is_read_from_the_structured_flag…`).
- `events.py`/`alarms.py` — `collisions()` and the alarm break-check now
  read the structured flag, not the substring.
- `model.py:466` — session node ref used `session_id[:8]` while every other
  surface uses the canonical `session_ref()` (`_REF_LEN=12`, bumped from 8
  for collision-safety in blind review B4); same session showed two ref
  strings. Now calls `session_ref(record)`.
- `alarms.py` — `render_telegram` used unguarded `_ICON[...]`/`_RANK[...]`;
  now `.get()` with fallbacks (defensive against a future signal→severity).
- `alarms.py` — push receipts/roles rendered raw taxonomy (`gap: 14d`,
  `to: stakeholder, pm, dev`). Added plain-language maps: `gap`→"coverage",
  roles→"exec/product/engineering".
- `cli.py watch` — "N loud" → "N urgent"; and a swallowed `Store()` error no
  longer yields a false "all quiet" — a live workspace with no fixture
  checks and an unreachable store now warns "this is a blind spot, not an
  all-clear" (the one thing an intent-assurance product must never claim).
- `evidence.py` — clarified the 1-based/0-based context-window comment.

**Tier-2 deferred (logged, not applied):**
- `prompts.py` — declared intent (PR title/body, attacker-controlled) sits
  in the trusted region above the injection fence. Moving it inside is a
  prompt change → needs a fidelity/EDD run before applying (memory:
  EDD-for-LLM-tasks). Deterministic verdict mitigates severity today.
- `alarms.py` receipt/audience taxonomy — a fuller user-facing label map
  (incl. `mandate`) is design-level; revisit when wiring real delivery.
- `evidence.py` empty-excerpt tightening is an intentional behavior change
  already shipped; confirm no eval regression when live credits return.

Gate: `python3 -m pytest` → 229 passed. Both evals all-clear
(event_stream, alarms). Imports smoke-checked.

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

## 2026-07-20 — tick over 659094d..55596cf (navigator + ring)

Four code commits: dc053ba (the navigator — model.py, /api/model,
#/explore; previously excluded, now board-certified and reviewed
end-to-end for the first time), 76d5b12 (board round-1 fixes +
hierarchy.py/derive_tree + tests), 95b7cb1 (derive_ring, /api/tree, the
ring rail, clerk-lingo purge), 55596cf (trail-chip resolution,
constellation density control). Docs/workspace commits skipped per
precedent. Not relitigated (settled): the board-certified navigator
design (moods, custody fallback, disclosure lines), the CPO-signed
seven-shelf ring grammar, sign-is-human-only, prompt() dialogs, T4
ref-shadowing deferral.

Engineering findings/fixes (Tier 1, applied):
- THREE mind.yaml readers had accreted (model._mind_cache, hierarchy's
  two inline yaml reads, relevance._mind_parts) plus the api.py mind
  fallback reaching into `_mind_file` and mind.py's own two — the
  mandated extraction: `mind.read_mind_cache()` (read-only, {} when
  never swept, "a view must never trigger a sweep" stated once). All
  seven sites converted; relevance and hierarchy shed their yaml
  imports; the api.py private-import backlog item is half-cleared
  (story._load_cache remains).
- The last-event `state_after` fold existed in SEVEN files — extracted
  `timeline.current_state()`; model.py and hierarchy.py (the in-range
  files) use it; mirror/story/ask/api call sites carried as backlog
  (they also use `events` and deserve their own touch).
- model.py re-declared the promise-health vocabulary as a private
  `_VERDICT_BUCKET` — the exact "private twin" class last tick's Hush
  unification killed in cli.py. Replaced with a `_health()` helper over
  mirror.HEALTH_LABELS + timeline.UNOBSERVED; one vocabulary, one home.
- T5 thresholds PEGGED (the round-2 CTO's honesty note: "thresholds
  pegged" was asserted but pegged nowhere): comment on model.around and
  derive_ring — memo layer owed at ~100–150 checks or a read over
  ~2.5s, whichever first; round 1's ~300–500 figure marked stale.
  hierarchy's docstring no longer calls the ring "cheap".
- Magic numbers named: model `[-6:]` → _RECENT_EVENTS_SHOWN;
  hierarchy `[-20:]` → _CHANGING_SHOWN; app.html rail slice(0,5) →
  RAIL_PULSE, name clips 46/44 + 34/32 → one `clip()` helper with
  RAIL_CLIP/CHIP_CLIP (also fixes the round-1 residual: pasted-ancestor
  chips stored an un-ellipsized 32-slice and re-rendered inconsistently
  on later walks — both paths now store and show the same word-boundary
  clip), density 14 → CROWDED_SKY, why-fold 220/200 → WHY_FOLD/WHY_LEDE.
- model.py duplication: the getattr entity-id triple appeared in both
  _diffs_touching and _around_diff — extracted _op_entity_ids().
- model.py docstring honesty: "every neighbor row carries its why"
  overclaimed after the board's own C3 fix (a shared control point's
  rationale is deliberately withheld; relations and events carry none)
  — now says "when the store holds one".
- _around_thought rendered "first seen  · unsigned" when first_seen was
  absent — guarded.
- hierarchy comment said "gaps by age" but the code renders ledger
  order — comment now tells the truth; derive_tree's unused `store`
  param documented as deliberate (uniform reader signature).
- Checked, accepted as-is: /api/model and /api/tree route order (unique
  literal prefixes; the greedy :path anchors on "/around/"); the
  trail-chip fetch `.catch((){})` (cosmetic name resolution — failure
  degrades to the id-with-tooltip the paste recipient already had;
  comment now says so); `max(mine, key=created_at)` latest-analysis
  resolution (T4, settled).

Product-surface findings/fixes (Tier 1, applied):
- The navigator's not-found copy said a missing ref "may have been
  retold or dismissed" — "retold" is the STORY's word (retold_after)
  and has never applied to a node; dismissed thoughts actually still
  resolve by name. Now: "It may have faded from the mind's trail, or
  the name may be mistyped" — faded is the mind's own vocabulary.
- Checked and deliberately kept: the seven shelf names and their lines
  (CPO-signed grammar); the dormant who-and-where empty state; the
  density-note sentence (honest, counts the hidden, names the shelf);
  MOOD_HEADERS and the navigator legend ("in quires" glossed both
  places); rail marks speaking Hush words ("broken", "high stakes");
  "proposed by the machine" (the clerk purge, complete — no clerk
  remains in any rendered string); the 404 detail "nothing in the
  brain answers to '{ref}'".

Backlog (Tier 2, not applied):
- RESOLVED this tick: three-reader mind-cache duplication; T5
  thresholds unpegged; the round-1 pasted-chip residual.
- New: adopt timeline.current_state in mirror.py/story.py/ask.py/api.py
  at their next touch (four remaining inline folds).
- New: explore() in app.html is ~230 lines doing trail, focus card,
  authority chips, and mood sections — split candidates exist
  (trailBar(), focusCard()) when it next grows.
- New: derive_ring's branch builders and loadRail's renderKid both
  re-encode "which kinds hop where" (entity → record, proposal → inbox,
  else navigator) — a third surface wanting this mapping should force a
  shared table.
- Carried: shared static/app.js (esc ×2, reviewer identity ×3, plural
  ×2, REASONS ×2, JSON-POST boilerplate); conftest workspace fixture
  (now SIX files with test_model/test_hierarchy's copytree+seed
  skeleton — promote to conftest.py); GraphHeuristics per-request
  construction; adjudication budget-exhaustion silence; double
  regroup/write in enrich_workspace; seed_quality source-string
  parsing; mirror.html orphaned; story._load_cache private import from
  api.py; judge-scaffold mechanics extraction; _resolve_port swallowed
  probe errors; story._org_facts citation wall + stray space.

196 tests green before and after (no count change — pure refactor +
strings). app.html JS syntax-checked (node --check, workspace token
substituted); inbox/mirror pages untouched this tick. workspaces/, the
scale dossier, docs/reviews/, the PRD, and the runbook untouched per
brief. No commits — the parent lands it.

## 2026-07-20 — tick over 55596cf..9738240 (scale-groan fixes)

Cache-focused review of the three same-day fixes. The two questions the
brief posed directly, answered first: **the story staleness key does NOT
miss the mind** — `_org_facts`/`_entity_facts` compose from diffs, atoms,
health facts, and obligations; nothing in the story path reads
mind.yaml (verified by import/call audit; the key's comment now says so).
**No adopter violates read_state's read-only contract** — atoms,
derive_tree/derive_ring, model.around, relevance.node_documents, and
both api call sites all compose into fresh local structures; mutation
grep over the returned diffs/state/events found nothing.

Tier-1 applied:
- **The guard was never recalibrated** (the commit's headline claim):
  `_CORPUS_NAME_SHARE = 0.6` landed as dead code while `_wrong_scale`
  still ran the old 2x-membership rule — the seeding deadlock (groan 1)
  was fixed in the EVAL only, and 'Strict Mode' would still die at the
  guard. `_wrong_scale` now enforces the 0.6 corpus rule (unused
  `members` param dropped, discard note reworded to "names most of the
  corpus", LLM prompt's "while its members are few" clause trimmed,
  stale eval docstring updated). Pinned by
  test_wrong_scale_is_the_corpus_share_rule.
- **`_analyses_sig` collision was real**, not hypothetical: (count, max
  created_at) misses `store.update_review`, the one in-place mutation
  the store allows — it flips review_state keeping both count and every
  created_at, so reviewing any non-newest check kept serving the
  pre-review timeline (stale review_state and open_findings). Sig is
  now sorted (analysis_id, review_state) per row. Pinned by
  test_cached_timeline_reflects_review_of_an_older_check.
- **Story key missed the promises**: statements are quoted in health
  facts and the approved count opens the org lede, but a re-onboard
  (same minted ids, new words) changes neither the diff log nor the
  analyses. An obligations fingerprint (id, revision, statement) joined
  the hash. Pinned by test_story_stales_when_a_promise_statement_changes.
- **Duplicate-id refusal surfaced as a 500**: onboard_create didn't
  catch write_workspace's new ValueError, so the operator got an opaque
  500 instead of the refusal text; now a 400 with the message. The
  check also ran after `out.mkdir`, leaving a half-created workspace
  dir on refusal — moved before any write. Pinned by the two new
  onboard tests.

Checked and clean:
- Draft-id namespacing: `_ns` closes over the loop variable but is
  consumed eagerly within the same iteration (extend drains the
  generator) — no late-binding hazard; `D{digits}-` with the dash
  separator is injective across docs and every pooled id is namespaced,
  so no collision with a doc's own draft ids is constructible.
- Refusal message language: "duplicate draft obligation ids would
  collapse in the id map and mis-house bindings … namespace draft ids
  per source document" — names the failure and the remedy in the
  ledger's own vocabulary; kept as-is.
- Cache growth: `_READ_CACHE`/`_TIMELINE_CACHE` are one entry per
  workspace/repo with no eviction — noted in both comments with a
  threshold (LRU cap if a server ever holds ~100+ workspaces); nothing
  built now at 3 workspaces.

Backlog delta:
- RESOLVED: none of the carried Tier-2 items were in this tick's scope.
- New: api.py still has fresh `load_diffs`+`graph_state` call sites
  (graph_entity and friends) that could adopt read_state at next touch
  — perf only, not correctness.
- New: story.py `_universe`/`_org_facts`/`_entity_facts` and
  `_health_facts` still load diffs / build the timeline fresh on a
  cache MISS (generation path) — fine while generation is rare; adopt
  read_state/cached_timeline if telling ever gets hot.
- Carried: everything from the 2026-07-19 list, unchanged.

196 → 201 tests green (5 added, none changed). workspaces/ and other
docs untouched per brief. No commits — the parent lands it.

## 2026-07-20 — tick over 9738240..1531e1a (docs + reconciliation; no agent)

Two commits since last review, neither adding product logic: 664fc08
is docs-only (the five layered specs — skip per docs precedent);
1531e1a is the spec/code reconciliation pass, itself a review — it
only SUBTRACTED (deleted the orphaned static/mirror.html, removed a
dead DEFAULT name binding in analysis/config.py) and fixed a spec
legend + a trailing docstring. No new logic surface to review;
reviewing a reconciliation commit is reviewing the reviewer. No agent
dispatched; last-reviewed → 1531e1a. (An in-flight session-ingestion
build died to an upstream rate limit mid-work; its uncommitted
session.py/model.py remnants are NOT part of this range and will be
rewritten clean before landing — the next tick reviews the committed
result.) Backlog unchanged: story._load_cache cross-module private
import; enrich_workspace redundant regroup; _resolve_port swallow;
plus the standing carried items. 201 tests green (unchanged).
