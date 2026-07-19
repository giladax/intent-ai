# Quire — The Story Layer (2026-07-19)

**Session:** Storyteller (leads) · UX designer · CPO · CTO.
**Founder's brief:** "We are not telling a coherent story… we need a storyteller, a UX,
and the CTO/CPO to work together and create the e2e experience."
**The question:** what is THE STORY, and how does the LLM synthesize it so every
surface tells one narrative — where a founder reads what is happening, touches any
sentence, and lands on its evidence.

The premise all four agree on: the data already IS a story. Entities are born by
signature, promises break at named checks, rejections teach, groupings return under
better names. Today the product shows the *state* and hides the *plot*. The story
layer is the LLM narrating the plot — under the same evidence discipline as
everything else. **Interpretation is versioned and appends; facts are immutable;
stories are derived, disposable, and never authoritative.**

---

## 1. The narrative grammar (Storyteller)

Four story types. Each is a STORY because it has an arc (something changed), tension
(something is unresolved), and stakes (what the promise protects) — never a list
with prose punctuation.

| Story | Lives | Length | Tense / POV |
|---|---|---|---|
| **The org lede** | home, under the headline | 3–5 sentences | present for standing, past for events; third person |
| **Story so far** | each record, after the identity line | 2–6 sentences (scales with the entity's event count) | past → present |
| **The collation** | the Collation Log door | 8–12 sentences per week | past; signed events name their signer |
| **The answer-story** | atop a gathering | 2–4 sentences | present |

Rules of craft: open on the tension if one exists, else on the newest change, else on
continuity ("still holding" is a story after enough time). One sentence of stakes
maximum. No sentence without a plot function. The narrator is the clerk, invisible —
"I" appears only in margin rationale cards, never in stories.

### The examples ARE the spec (written against live quire-brain data)

**A. Story so far — the Feature record** (type b):

> Feature was put on the map by the CPO on July 18 [GD-2], holding three promises
> about the org's one vocabulary [QUIREB-002] [QUIREB-006] [QUIREB-007]. One of them
> is broken: candidate lists from the MCP surface must be structured content, and
> check #7 found `brain_attention` returning prose an agent would have to parse
> [check #7] [QUIREB-006]. The promise is shared with MCP Surface — both records
> carry the break [GD-3]. The other two promises have not yet been exercised by any
> check [QUIREB-002] [QUIREB-007].

**B. The custody-boundary saga — collation fragment** (type c; the product's best
plot so far):

> The clerk proposed an entity called "Brain" for two promises that keep source
> artifacts out of the store [GD-1] [QUIREB-001] [QUIREB-012]. The CPO declined it —
> wrong name: the grouping was sound, but Brain is the whole product [GD-1]. The
> rejection taught the map: the name is dead, the grouping is free. On July 19 the
> same two promises returned under a new name, External System Boundaries [GD-7].
> It is in quires — unsigned until someone decides the name is finally right [GD-7].

**C. The org lede — home, today** (type a):

> This map was born on July 18, when the CPO signed four names into existence and
> declined a fifth [GD-2] [GD-3] [GD-4] [GD-5] [GD-1]. Ten promises are housed; two
> are broken, both traced to check #7's finding that the MCP surface returned prose
> where it promised structure [check #7] [QUIREB-006]. Five proposals from the
> July 19 collation wait unsigned [GD-6] [GD-7] [GD-8] [GD-9] [GD-10] — among them
> the custody boundary, back under its third name. Everything else is holding.

What makes these stories and not reports: A has a wound and a witness; B has a
character arc (rejection → learning → return); C has a birth, a tension, and an
open question. None contains a sentence that merely inventories.

---

## 2. The truth rules (CPO)

**Citation grammar.** Every sentence carries ≥1 citation binding it to the record:
`[check #N]` (a receipt), `[GD-N]` (a diff and, if decided, its signature),
`[QUIREB-NNN]` (a promise), `[taught: "word"]` (a teach event). Citations are data,
not text (see §4); the UI renders them as the same walkable links the product
already has. **A sentence whose citations do not all resolve is dropped before
render** — the same law as evidence validation. A story that loses sentences shows
how many, like `dropped_citations` does.

**The never-list.** A story may never: assert motive ("the CPO wanted…" — only the
recorded reason may be quoted); predict ("will likely break"); flatter or console;
aggregate into scores; use "because / so that / in order to" unless a cited artifact
states the mechanism (a decision's reason_text, a rejection's teaching sentence, a
proposal's question, a review note). Temporal sequence ("then", "three days later",
"after check #7") is observable and always allowed. Correlation may be narrated as
sequence, never upgraded to cause.

**Moods bound the voice.** Observed events narrate in plain past/present with their
receipt. Proposed things are always marked unbound ("in quires", "unsigned") — the
story may never narrate a proposal as if it happened. Signed events name the signer
and date. The machine never asserts; it cites.

**Graceful degradation.** Story length is earned by events. A young map's lede is
two true sentences ("This map is three days old. Four names, ten promises, nothing
yet broken [GD-2]…"), not padding. An entity with one event gets one sentence. If
every sentence of a story is dropped by citation validation, the surface shows no
story — a missing story is honest; a hollow one is not.

---

## 3. Placement & behavior (UX)

- **Org lede:** replaces the static subtitle under "The map of {ws}" — the banner
  (needs-attention) stays separate above it; the lede is narrative, the banner is
  triage. Entity grid follows.
- **Story so far:** on the record, directly after the identity sentence, before
  "still in quires". Identity says what the thing IS; the story says what has
  HAPPENED to it. Visually: body type, not italic — stories are content, not chrome.
- **The collation:** its own door (rail foot: "collation log"), one page, newest
  week first, each week an authored paragraph followed by its signature list.
- **Answer-story:** the first block of a gathering (rides on Working Edition
  slice 5).
- **Citations render** as small mono superscript chips — `#7`, `GD-1`, `QUIREB-006`
  — each a real link: promise chips deep-link (`#/entity/…/QUIREB-006`), check chips
  open the receipt, GD chips open the decided card (trail panes when slice 3 lands).
  Chips are the ONLY mono inside story text.
- **Retelling mark:** every story ends with a quiet byline: "retold after check #8 ·
  2026-07-19". While a story regenerates, the previous one stays visible with
  "retelling…" appended — never a spinner where prose was.
- **Rhythm:** story → banner → structure on home; identity → story → quires →
  promises on the record. Stories never exceed their budget; the reading order is
  always narrative first, evidence one touch away.

---

## 4. The synthesis engine (CTO)

**Inputs per story** (all already stored): the fold (`graph_state`), decided diffs
with decisions/reasons/amendments (`graph/diffs.yaml`), analyses → receipts
(per-promise findings, verdicts, check numbers), teach events (human-proposed
diffs), the contract (statements). Scoped: lede = whole workspace; story-so-far =
one entity's holdings/diffs/checks; collation = events in a date window; answer =
the gathering's refs.

**Prompt architecture.** Sonnet, structured output:
`Story = {sentences: [{text: str, cites: [{kind: check|diff|promise|teach, ref}]}]}`.
The prompt receives ONLY resolvable material (each candidate fact pre-labeled with
its ref) plus the grammar and never-list from §§1–2. **Mechanical validation after
generation:** every cite must resolve against the store/diff log/contract; every
`because` sentence must cite a reason-bearing artifact; violating sentences are
dropped and counted. Same philosophy as quote validation: the model narrates, the
validator decides what renders.

**Storage & invalidation.** `workspaces/<ws>/stories.yaml` — a derived cache, never
read by the fold, safe to delete: `{scope, input_hash, as_of, sentences, dropped,
generated_at, model}`. `input_hash` = sha256 of the scoped inputs (diff ids +
decision timestamps + analysis ids + contract pin). `GET /api/story/{ws}/{scope}`
returns the cache when the hash matches, else regenerates (synchronous; UI keeps
the old story visible meanwhile). Regeneration triggers are data changes only —
a new check, a decision, a teach — a handful of Sonnet calls per active day, zero
per page view. Offline: `FakeStoryteller` returns canned sentences with real refs;
tests pin the validator (unresolvable cite → dropped; motive-free never-list is
prompt + judge territory, not regex).

**Eval hook — per the standing bar, none ships in slice A.** The citation gate is
engine behavior; tests pin it; an eval asserting "sentences cite" would pass by
construction (the conservation-metric precedent). A story eval lands when the first
real defect is observed (bar rule 2) — the likely candidate is an LLM judge for
motive/prediction leakage with a calibration set (must-flag: an invented "because";
must-clear: a temporal sequence), owned by the CPO like the complement judge.

### Build order (each lands alone)

- **Slice A — the lede and the story so far.** One endpoint
  (`/api/story/{ws}/org`, `/api/story/{ws}/entity/{id}`), the validator, the cache,
  FakeStoryteller + tests, both placements on home and record. The founder reads
  the org as narrative on day one.
- **Slice B — the collation log.** Date-windowed input scoping, the door, weekly
  paragraphs. (Also absorbs the direction doc's Rule-1 amendment: deltas live here.)
- **Slice C — answer-stories.** Depends on Working Edition slice 5 (gatherings);
  same endpoint pattern, scope = the gathering's refs.

---

## The pitch (founder-facing)

Open Quire and it reads you the situation in five true sentences: what was born,
what broke, who signed, what waits. Touch any sentence and the evidence opens —
the check's receipt, the signed decision, the promise's own words. Click a name
and its record begins with its life story, not a form. Nothing in the prose is
ornament: every clause is cited, every "because" is somebody's recorded reason,
and when the map changes, the story is retold — with a byline saying when and why.
The org stops looking like a database wearing nice type. It reads like what it is:
a book being written by everyone who signs it.

*Machines observe and propose; humans sign; the clerk narrates — and cites.*
