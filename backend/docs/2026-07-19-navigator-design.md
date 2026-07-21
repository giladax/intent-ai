# The Navigator — searching the mental model (2026-07-19)

**Session:** CPO + UX. **Founder's brief:** "When I search payments I want
to see the tree, the connections and the reasoning… is it like Notion?
Obsidian?" — refined: "This, in a way, would be wrapped as the product.
The shared brain serves both. Same for MCP to communicate."

## 1. Paradigm verdict

**First, what the IP is — because the paradigm must serve it.** The IP
is not graph browsing (Obsidian has graphs, Notion has pages). It is
**understanding you can cross-examine**: free LLM thinking mechanically
bound to evidence. The navigator's hero interaction — the moment that
is ours alone — is a person clicking from a bold claim down through the
reasoning that produced it, to the check receipt, to the exact
file:line a check observed, seeing who signed what along the way. Every
layout choice below is judged against that walk. If this screen ever
reads as "a nicer Obsidian," it has failed.

With that as the bar — a synthesis, taken precisely:

**From Notion:** *everything is a page.* Every ref in the brain — an
entity, a promise, a signed diff, a check, an unsigned thought — gets a
uniform, addressable focus card at a stable URL. No second-class nodes.

**From Obsidian:** *backlinks are half the truth.* A focus shows both
directions — what this node holds/cites AND what holds/cites it — and
the local-neighborhood instinct replaces any global view. (The global
sky already exists as the constellation; the navigator is the local
walk.) We deliberately do NOT take Obsidian's untyped links or its
graph-as-decoration.

**From neither — ours alone:**
1. **Edges carry reasoning.** Obsidian links and Notion links have no
   *why*. Here every connection renders the reasoning that made it —
   the attach note, the diff's thinking, the check's finding, the mind
   node's why. The founder's test is exactly this: tree + connections +
   REASONING, together.
2. **The three moods partition the neighborhood.** Signed (ink),
   observed (mono receipts), thought (amber dashed) — a reader always
   knows whether a connection is law, evidence, or thinking.
3. **The trail is the URL.** Hops accumulate:
   `#/explore/ent-feature/QUIREB-006/7` is a walk — promise to verdict
   to receipt — pasteable into any argument (rule 2's walkable-chain
   amendment, delivered). Matuschak's stacked panes are the v2 richness;
   the v1 trail bar is the same chain flattened, and the receipt slip
   already gives one stacked pane.

## 2. Navigation grammar

- **Entry:** search-first — the existing ask ladder resolves a word to a
  node; the rail gains a `navigator` door; records link "structure →";
  the navigator links back "read the record →". Deep links everywhere.
- **Focus card:** the node's identity in its own terms (name/statement/
  question/gloss), its mood badge, its verdict or salience where it has
  one, and its REASONING in full — the thinking kept on the node is the
  card's body, not a footnote.
- **Neighborhood:** grouped Signed / Observed / Thought; each row =
  type tag + label + inline why (truncated at a line; the full why lives
  on the neighbor's own focus) + a hop arrow when the ref is focusable.
  Code/doc paths render as leaves (v1).
- **Hop mechanics:** click → neighbor becomes focus, trail grows; trail
  chips truncate back to any earlier hop. Browser back works (hash).
- **The chain of custody is completable:** promise → its verdict ("since
  check #7") → the check's focus → the finding's citation with
  file:line and excerpt — the walk bottoms out at code the check
  actually observed, and every signed hop names its signer and date.
- **Authority lives in the walk:** a thought's focus carries dismiss; an
  entity's focus carries teach; an open diff's focus points at the one
  place signing happens (the inbox). The single mutation path is
  visible in the design itself.
- **History is reachable:** a mind node's focus shows retired/dismissed
  status; an entity's Thought group includes what was dismissed about
  it (marked), because knowing what we decided was trash is part of the
  mental model.

## 3. The shared-brain contract

One brain, two clients: every human view IS an agent query. The MCP
surface (parent-repo intent-brain precedent) wraps the same composition
endpoints — no privileged human data, no privileged agent data.

| Navigator view | HTTP (human shell) | MCP tool (agent) |
|---|---|---|
| resolve a word | `GET /api/ask/{ws}?q=` | `quire_resolve(q)` |
| focus + neighborhood | `GET /api/model/{ws}/around/{ref}` | `quire_around(ref)` |
| record (reading view) | `GET /api/graph/{ws}/entity/{id}` | `quire_record(id)` |
| the story | `GET /api/story/{ws}/…` | `quire_story(scope)` |
| check receipt | `GET /api/checks/{ws}/{n}` | `quire_receipt(n)` |
| working mind | `GET /api/mind/{ws}` | `quire_mind()` |
| teach / correct (write) | `POST /api/graph/{ws}/teach·correct` | `quire_propose(…)` — attributed |
| sign / decline | `POST …/decision` | **no tool.** Signing is human-only. |

Write law over MCP: agents may propose and teach, always attributed
(`proposed_by: agent:<session>`); nothing an agent sends can reach the
signed layer without a human signature — the map's own promise, kept
for its makers.

## 4. Build notes (v1, shipped with this doc)

`/api/model/{ws}/around/{ref}` composes read-only from what exists —
fold, contract, analyses, atoms, mind cache; zero LLM calls at view
time; ref kinds resolved by shape (entity id, promise id, GD-N, check
number, mind-node name case-insensitive). The screen is a route in
app.html (`#/explore/<trail…>`) — the navigator is product shell, not a
side tool, so it shares the rail, the ask pill, the mood language, and
the escaping discipline. V2: stacked panes; agent-session nodes arrive
as just another reasoning-bearing neighbor.
