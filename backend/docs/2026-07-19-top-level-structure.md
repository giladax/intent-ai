# Quire — The Top Level: the constant entry node and its ring (CPO, 2026-07-19)

**The founder's tension, resolved first:** "dynamically decide top level" and
"constant traversal entry node" are both right, at different layers. The
GRAMMAR is constant — the root and its first ring of branches never change,
never reorder, and each is a genre an organization recognizes cold. The
MEMBERSHIP is dynamic — what sits inside each branch, and in what order, is
derived from the graph (subsumption, coverage, time, salience). Constant
shelves; dynamic books. Nobody relearns the room; the room restocks itself.

This kills the failure the founder named: "Feature" floating as top-level.
Under this anatomy, Feature is a *capability of brain*, shelved under "What
we build", wearing its path. No bare words, ever.

---

## 1. The entry node — the project

The constant root a user always lands on. It is a card, not a menu:

> **brain** — the org-level learning layer for AI-assisted development.
> *The situation:* the org lede, told by the clerk (cited, walkable).
> *Vital signs:* 4 capabilities · 12 promises (2 broken) · 5 wait for a signature.

- **Identity:** the project's name and one identity sentence. Today derived
  from the workspace; it should become a SIGNED fact (the org edits it via a
  proposal like any other meaning — the root obeys the same law as its
  children).
- **Situation:** the existing org story lede — the entry node is where the
  story layer and the structure layer meet.
- **Vital signs:** counts with moods, never scores. Broken is vermilion;
  waiting is amber; the rest is silence.
- **Reconciliation with the map home:** they are the same thing. The home
  page IS the entry node rendered large (card + banner + ring); the
  navigator's `#/explore/project` is the same node rendered compact with its
  neighbors. One front door, two zoom levels — not two products.

## 2. The constant ring — six branches, one dormant

Always present, always this order, each a genre with a defining line. The
order is a narrative: what we build → what we promised → what's changing →
what needs you → what the mind wonders → what has no home. Identity before
obligation, obligation before events, events before attention, attention
before speculation, speculation before gaps.

| # | Branch (product voice) | Genre an org knows | Populated by | Child order (the dynamic part) | Honest empty state |
|---|---|---|---|---|---|
| 1 | **What we build** | capabilities / product areas | the signed entity tree | hierarchy.py: part_of first, then shared-world subsumption; connectors float up; promises leaf under their capability | "Nothing is named yet. The first proposals are being prepared." |
| 2 | **What we promised** | specifications / requirements | the same promises, grouped by SOURCE — spec doc → section (source_reference/source_section) | by artifact, then section order; each promise shows its verbatim quote and current verdict | "No approved specification feeds this map yet." |
| 3 | **What's changing** | updates | atoms: checks, signings, refusals, teachings, returns | time, newest first — NEVER containment; this branch is the Collation Log's home | "Quiet. Nothing has changed since [date]." |
| 4 | **What needs a human** | approvals / open questions | open diffs (in quires) + broken/partly-kept promises awaiting review | blast radius (stakes), worst first — the banner deep-links here | "Nothing needs you." |
| 5 | **What the mind wonders** | open questions / working notes | mind nodes: tensions, bets, gaps, questions — unsigned | salience (important → ambiguous), then recency; probably-noise collapsed; dismissals reachable as history | "The mind has nothing it would show you yet." |
| 6 | **What has no home** | gaps | unplaced promises; uncovered surfaces (coverage) | by age — the oldest gap is the most embarrassing | absent entirely when there are no gaps (silence is the good news) |
| 7 | **Who and where** *(dormant slot)* | people / channels / sources | future: authors from commits, session actors, message channels — the observable-relations fallback | by activity | "The map hasn't met the people yet. It learns them from sessions and channels when they connect." |

**Weighed and decided:** "what we're building" — adopted as *What we build*
(the derived tree lives here and ONLY here). "Contract view" — adopted as
*What we promised*, because a PM thinks in specs while an engineer thinks in
capabilities; same promises, two shelves, one addressable node (the IP keeps
this honest — both shelves walk to the same record, so dual-shelving is
navigation, not duplication). "Updates/collation" — adopted as *What's
changing*; time is its only order. "Quires/attention" — adopted as *What
needs a human*, and it absorbs broken promises awaiting review (a gap in
attention is attention). "Mind threads" — adopted, clearly unsigned.
"Gaps" — adopted SEPARATE from attention: a gap is an absence, not a pending
decision; merging them would let the inbox count hide the coverage hole.
"Who and where" — designed now, shipped dormant: the slot exists so people
and channels arrive without a redesign. REJECTED: any branch named with our
internal nouns (Entities, Diffs, Atoms, Mind) — shelf names are for the org,
not for us.

## 3. Traversal grammar — what is always true

- **Depth:** root → branch → node → record/focus. Any node's full record is
  ≤2 hops from the front door; the trail is always the URL.
- **Where derivation applies:** the subsumption tree operates ONLY inside
  *What we build*. *What we promised* nests by document structure. *What's
  changing* orders by time. *Attention* by stakes. *Mind* by salience.
  Applying containment logic to a time feed (or vice versa) is a defect.
- **Moods map onto the ring:** branches 1–2 are signed ink (the law), 3 is
  observed mono (receipts), 4 is proposed amber, 5 is thought amber-dashed,
  6 is the faint gap register. The first ring teaches the three moods by
  walking it once.
- **Context is mandatory:** every child everywhere wears its path
  ("brain › What we build › MCP Surface"). A bare word is a rendering bug.
- **One more connection:** when the org adds a new relation kind (author,
  channel, incident), it enters as a facet on existing nodes and, when a
  genre accumulates, fills the dormant branch. New top-level branches are a
  signed product decision — the anatomy changes the way the map changes:
  rarely, and on the record.

## 4. Implementation notes (for the wiring pass)

- hierarchy.py already gives: subsumption tree, unplaced branch, thought
  anchoring, context paths. Keep it as the engine of branch 1.
- Add a branch layer above it: branches as first-class nodes (kind
  "branch", fixed ids/order/genre lines) with the root card on top;
  `derive_tree` returns root → ring → members.
- New derivations needed: spec-axis grouping (promises by
  source_reference/section) for branch 2; atoms time-feed for branch 3;
  open-diffs + broken-promises merge for branch 4; mind salience order for
  branch 5 (canonical shelf for thoughts — entity records keep their
  "working threads" section, the ring does not double-shelve).
- Root vital signs and identity from existing rollup/coverage/story data;
  project identity becomes signable later (new op or convention entity).
- Rail = root + ring with counts/marks (branch rows expand lazily).
  Home = entry card + banner + ring summary. Navigator = same tree,
  compact, every branch addressable (`#/explore/branch:what-we-build`).
- Empty states verbatim from the table; branch 6 renders only when gaps
  exist; branch 7 renders dormant with its honest line.
