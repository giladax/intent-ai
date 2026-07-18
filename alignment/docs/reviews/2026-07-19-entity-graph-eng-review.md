# Entity Graph MVP (step 1) — engineering review

Commit `e515b99` ("entity graph MVP step 1 — diff engine, apply-on-approve, Meridian inbox").
Reviewer: staff eng, adversarial pass. Baseline: `python3 -m pytest -q` → **123 passed** (clean).
All counterexamples below were reproduced with throwaway probes against the real code.

## Verdict

**Fix-first.** The architecture is sound — the fold is genuinely pure, the two-writer
discipline holds, reject/validate/rollback are correct, and the front-end is honestly
`textContent`-built. But **rule 7 ("edited approvals are recorded human-amended") is
mechanically defeated**: an approval that edits an entity's meaning, or flips a
supersede promise-fate from `carried` to `retired`, is recorded `amended: false`. That
is a load-bearing rule silently not enforced, and it interacts with rule 10 (a promise
can be dropped from the successor with no human-amended trace). One blocker, several
majors (reflected XSS on the inbox surface, an unvalidated CLI decide verb, a latent
fold-ordering hazard, broken multi-hop name forwarding, whitespace shape-evasion,
non-atomic writes). None require rearchitecting; all are local fixes.

## Defects

### D1 — Edited approvals escape the `amended` flag (rule 7 defeated) — BLOCKER
`quire_align/entity_graph.py:505-506`

`decide()` sets `amended` by comparing **shape keys**:
```python
amended=final_ops is not None and compute_shape_key(final_ops) != target.shape_key,
```
But `compute_shape_key` (`_op_signature`, lines 176-192) is a *lossy* fingerprint that
covers only a subset of fields. It ignores `CreateEntity.identity_sentence`,
`Attach.note`, and — critically — `PromiseFate.fate` and `PromiseFate.note`. So a human
who edits the meaning of an entity, or changes a promise's destiny during a supersession
approval, is recorded as having approved it verbatim.

Reproduction (identity edited, folds into state, `amended` stays False):
```
A: amended = False | folded identity = COMPLETELY DIFFERENT MEANING
```
Worse — a supersede fate edited `carried` → `retired` at approval time (the successor
loses the promise) is also invisible:
```
H: fate carried->retired edit | amended = False | successor promises = []
```
This defeats rule 7 outright and undermines rule 10's "fully legible" guarantee: the
promise-fate list the human actually approved differs from the record, unmarked.

**Fix:** detect edits by value, not by lossy fingerprint —
`amended = final_ops is not None and final_ops != target.operations` (compare the
validated Pydantic models, or their `model_dump()`). The shape key is the right tool for
rejection suppression, the wrong tool for amendment detection.

### D2 — Reflected XSS on `/inbox/{workspace:path}` — MAJOR
`quire_align/api.py:484-489`

`inbox_page` injects the raw path param into the page via string substitution and does
**not** resolve/validate the workspace first:
```python
html = (STATIC / "inbox.html").read_text()
return HTMLResponse(html.replace("__WORKSPACE__", workspace))
```
`__WORKSPACE__` lands inside a JS string literal (`const WS = "__WORKSPACE__"`) and an
`href`. A `"` breaks out. Reproduced:
```
GET /inbox/x";document.title="PWNED";//   → 200
const WS = "x";document.title="PWNED";//";   ← arbitrary JS executes
```
The endpoint even serves for non-existent workspaces (no `_workspace_dir` call), so it is
an unauthenticated reflected-XSS gadget. Same inherited pattern exists in `mirror_page`
and `intent_page`, but this commit adds a new instance. The onboard trust note
("bound to 127.0.0.1") mitigates but does not excuse it — the inbox is the surface the
whole feature ships on.

**Fix:** JSON-encode the workspace into the JS context (e.g. inject
`<script>const WS = {json.dumps(workspace)}</script>` or a `data-` attribute read via
`textContent`), and resolve the workspace first so junk 404s instead of reflecting.

### D3 — CLI `graph-decide` does not validate the action verb — MAJOR
`quire_align/cli.py:457-475`

The API guards `action` (`api.py:449` → 400 on anything but approved/rejected), but the
CLI passes the positional `action` straight into `decide()`, and `decide()` treats **any
non-`"rejected"` string as an approval** (`entity_graph.py:478` / the `else` at 500).
Reproduced at the engine level:
```
C: action='banana' → approved approved
```
So `align graph-decide ws GD-1 approv` (typo), or `... rejcted`, silently **approves and
mutates the map** — the exact opposite of a reject. Rule 5 says the decision path is the
one gate; that gate mis-parses.

**Fix:** validate `action in ("approved","rejected")` in the CLI (mirror the API), and/or
make `decide()` reject unknown actions instead of defaulting to approve.

### D4 — Fold order uses a string sort on `decision.at` — MAJOR (latent)
`quire_align/entity_graph.py:316-319`

```python
approved = sorted(..., key=lambda d: d.decision.at)
```
`at` is a caller-supplied ISO string, sorted lexically. Both current writers mint UTC
`...+00:00`, so it *happens* to be safe today — but nothing enforces that, and `decide()`
is public API accepting any `now`. A single approval recorded with a non-UTC offset
misorders the fold; because operations depend on prior state (`attach` needs its
`create`), a misorder doesn't just reorder — it can make the whole approved log
**unreadable**:
```
F2: create decided at 12:00+03:00 (=09:00Z), attach at 10:00Z
    → graph_state raises GraphIntegrityError: unknown entity 'e1'
```
An immutable, human-approved history that a legitimately-signed timestamp can render
un-foldable is a correctness landmine.

**Fix:** sort by parsed instant — `key=lambda d: datetime.fromisoformat(d.decision.at)`
— and consider a stable secondary key (diff seq) for equal-second ties.

### D5 — Multi-hop supersession forwards to a frozen entity (rule 9) — MAJOR
`quire_align/entity_graph.py:356`

`resolve_entity` forwards exactly one hop: `successor = state["entities"].get(match["superseded_by"])`.
If A→B and later B→C, resolving "A" returns **B, which is itself superseded/frozen**:
```
multi-hop resolve('A') -> ent-b   (expected ent-c)
```
Rule 9 promises retired names resolve to *the successor* (a live entity); a chain lands
the user on a dead, frozen node.

**Fix:** follow the `superseded_by` chain until an active entity (guard against cycles),
and compose the receipt across hops.

### D6 — Rejected-shape suppression evaded by whitespace/punctuation (rule 6) — MAJOR
`quire_align/entity_graph.py:176-197`

`_op_signature` lowercases names/aliases/terms but does not otherwise normalize them,
while quote validation elsewhere uses `_normalize_quote` (strips punctuation, collapses
whitespace). So a rejected "Payments" create returns in a trivially different "shape":
```
B: reject "Payments"; re-propose "Payments " (trailing space) → added GD-2
   re-propose "Payments." (period)               → added GD-3
```
Rule 6 says "a rejected proposal never returns in the same shape"; a space or a period
defeats it. The proposer is an LLM, so this is a realistic re-emission, not just theory.

**Fix:** run entity/alias/name tokens through the same normalization used for quotes
(`_normalize_quote` or an equivalent) before hashing the shape key.

### D7 — Non-atomic, unlocked diff-log writes — MAJOR
`quire_align/entity_graph.py:384-393`

`_write_diffs` does `path.write_text(yaml.safe_dump(...))` after a full `load_diffs`
read-modify. There is no file lock and no temp-file+rename. Two concurrent `decide`/
`append_proposals` calls (two inbox tabs, or CLI + web) race: last writer wins, the other
decision is lost. A crash mid-`write_text` truncates the file that the module's docstring
calls "the graph's immutable history." For a log whose whole value proposition is
durability and legibility, silent loss/corruption is a real defect.

**Fix:** write to a temp file in the same dir and `os.replace` (atomic); take an advisory
lock (or a per-workspace lock) around read-modify-write, or serialize decisions.

### D8 — `attach` note-only differences collide on shape key — MINOR
`quire_align/entity_graph.py:187-188`

`_op_signature` for `attach` omits `note`, so rejecting an attach with `note="A"`
suppresses re-proposal of the same attach with `note="B different"` (probe J: keys
equal). Likely intended (note is a footnote), but worth a deliberate decision + comment,
since it means a rejection can suppress a materially different justification.

### D9 — `existing_shapes` duplicate-guard also blocks re-proposal of approved shapes — MINOR
`quire_align/entity_graph.py:417`

`existing_shapes` includes `status == "approved"` diffs, so an identical shape can never
be re-proposed after approval. Harmless in practice (a duplicate create would fail
validation anyway), but the naming/intent ("duplicate while open") and the behavior
diverge — worth a comment or a status filter.

### D10 — `/api/graph/{workspace:path}/propose` has no offline path — MINOR
`quire_align/api.py:468-482`

Unlike `/analyses` (which honors `offline=true` → canned model), `graph_propose` always
constructs `EntityProposerLLM()` and hits the network; there is no `FakeEntityProposer`
route for demos/tests-over-HTTP. Given API credits have been empty in this project
before, an offline seed path would be prudent. Not a correctness bug.

## Test gaps

The 24 tests are well-named and each pins a rule, but the following failure paths have
**no** coverage (several correspond to the defects above):

1. **Amended detection beyond the shape key** (D1). No test edits `identity_sentence`,
   `Attach.note`, or a `PromiseFate.fate` and asserts `amended is True`. Add:
   approve-with-edited-identity → `amended True`; approve-with-fate-flipped
   (`carried`→`retired`) → `amended True` **and** successor holdings reflect the edit.
2. **CLI action validation** (D3). No test that `graph-decide ... <garbage-action>` is
   rejected rather than silently approving. (`test_cli_api.py` covers other commands.)
3. **Fold ordering under mixed/parsed timestamps** (D4). No test that two approvals whose
   wall-clock order disagrees with lexical order fold in instant order. Add one with a
   non-UTC offset and assert the fold succeeds and orders correctly.
4. **Multi-hop supersession forwarding** (D5). `test_retired_name_forwards_with_receipt`
   covers one hop only; add A→B→C and assert `resolve("A")` lands on the active C.
5. **Rejected-shape normalization** (D6). `test_rejected_shape_never_returns` proves a
   *different name* re-proposes (correct) but never proves that whitespace/punctuation/
   case variants of a *rejected* name stay suppressed. Add the trailing-space case.
6. **`supersede` unknown-promise branch** (`entity_graph.py:287-292`). The `fated -
   live_promises` "names promises it does not hold" error has no test; only the missing
   branch is exercised.
7. **`stakes_label` medium boundary.** `test_stakes_order_and_label_agree` hits only
   low/high; nothing asserts `1.5 ≤ stakes < 3.0 → "medium"` (e.g. a create+relate, or
   three creates). The medium band is untested.
8. **XSS/reflection of the workspace param** (D2). No test asserts the inbox HTML safely
   encodes a hostile workspace value.
9. **Concurrent decide** (D7). No test for two decisions racing / lost update (hard, but
   at least a lost-update regression test after the lock fix).
10. **Reject → validate rollback is *correct*** and worth a positive test: approving an
    invalid supersede leaves `target.decision is None` on disk (partially covered by
    `test_supersede_without_full_promise_fates_fails_loudly`, which checks status stays
    `open` — good — but not that `decision` is `None`).

## Nits

- **Docstring honesty (D1):** the module docstring (`entity_graph.py:12-14`) states rule
  7 "records `amended: true`" — the code records it only for shape-key-visible edits.
  The claim over-promises versus the implementation. Fix the code (preferred) or the
  docstring.
- `graph_state` (line 313) and `validate_operations` (line 330) deep-copy state via
  `json.loads(json.dumps(...))`; fine for small maps but O(n) per validation and lossy if
  a non-JSON type ever enters state. `copy.deepcopy` is clearer and safer.
- `entity_propose.py:171-174` builds `files_by_obligation` then immediately overwrites via
  `setdefault` from bindings; the first loop's `setdefault(..., [])` seeds empty lists that
  the group `members` never populate (only bindings add paths). The first loop is
  effectively dead — code paths only ever come from bindings. Either wire group member
  files in or drop the first loop.
- `DecisionRequest.action: str` (`api.py:67`) with a `# approved | rejected` comment is
  weaker than a `Literal["approved","rejected"]` — Pydantic could reject bad verbs at the
  edge instead of the handler (and would fix half of D3 for the API path for free).
- Duplication with `propose.py`: the verbatim-quote-validation + drop-with-notes pattern
  in `entity_propose._validated` mirrors `propose.validate_candidates`. Reuse is partial
  (`_normalize_quote` is shared — good); the notes-accumulation shape could be factored.
- Inbox "Edit-first (visible preview)" (rule 8 / PRD §4) is realized as a raw JSON
  textarea, not a rendered preview of the resulting diff. Honest and functional, but not
  quite the "visible preview" the spec describes — worth a follow-up.
- `open_proposals` sorts by `-d.stakes` only; ties fall to Python's stable sort
  (insertion order). Fine, but a documented secondary key (proposed_at / seq) would make
  inbox order deterministic across reloads.
</content>
</invoke>
