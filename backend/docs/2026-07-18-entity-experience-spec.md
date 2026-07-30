# Entities: the MVP experience (CPO cut, 2026-07-18)

Settled pivot context: the org map becomes first-class **Entities**
("Payments") accumulating heterogeneous attachments (promises, code, docs,
tickets, Slack decisions, incidents, checks, sessions later). The LLM
reasons over evidence and proposes **graph diffs** (create/merge/attach/
supersede), human-reviewed like PRs; approved diffs are the graph's
immutable history. Mechanics are evidence, never deciders.

## 1. THE view — the entity page is a dossier, not a diagram

Above the fold, exactly three things: the **identity line** (name + one
approved sentence, provenance one hover away), the **health sentence**
("7 promises: 5 satisfied, 1 partial since PR #212, 1 unverified; 2 open
findings"), and the **latest change**. Acceptance: a PM reads the fold
aloud in a meeting; if she composes a status report, we failed.

Below: left column = **the ledger** (this entity's slice of the river —
checks, attachments, approved diffs, incidents, newest first; time stays
the axis). Right column = **holdings** grouped by evidence kind (promises
with lamps + quotes; code locations with jump links; docs/tickets;
decisions; incidents), then **related entities as a flat labeled list** —
"part of: Commerce · depends on: Ledger · supersedes: Checkout, Billing".
Every relation exists because a diff was approved.

Neighbor click = full page navigation with a hop trail ("Payments ▸
Refunds"). You traverse the graph; you never stare at it. The all-entities
map is an **index, not a canvas**: ranked table (entity · identity
sentence · health · last event), sorted by recent activity, search on top.

## 2. Search — one box, three answer shapes, zero modes

- **Lookup** ("payments") → straight to the dossier; ambiguous → "did you
  mean"; acceptance teaches the alias.
- **Status** ("anything broken?") → situation answer across ALL entities —
  never a single node card (the PM interrogation's worst failure, now a
  standing invariant).
- **Semantic** ("that thing where refunds got stuck") → embedding hits
  over node+connections, returned as entities **with the matching
  attachment quoted**: "Payments — matched via INC-112: 'refunds stuck in
  pending > 24h'."

Invariant: every result states what kind of thing it is and why it
surfaced. A result that can't quote its reason doesn't render.

## 3. Lifecycle — supersede is a tombstone with a forwarding address

Supersede is a diff like any other. The old page never disappears and
never changes: banner ("Superseded by Payments v2, 2026-06-30, approved by
Dana — view diff"), holdings freeze, new evidence routes to the successor,
old names alias forward. **Attachments do not migrate** — a check that ran
against Checkout in May belongs to Checkout forever; rewriting attachment
history is how mirrors start lying. Scrubbed to a pre-supersede date, the
old entity is simply alive. Merge/rename = same machinery, friendlier
banners; counts sum, zero attachments lost.

## 4. The diff-review inbox — cards answerable in ten seconds

Lives in the mirror's inbox slot (same act as findings: system noticed;
confirm or correct). One card = proposal sentence ("These 14 docs and 3
code clusters describe one thing — call it Payments?") + three evidence
QUOTES with sources (+N more) + the mutation as a readable diff — never
JSON. Mechanical signals are a footnote; the headline is always a quote
from the org's own material. Verbs: Approve / Edit (inline rename, uncheck
attachments; recorded human-amended) / Reject with a required one-sentence
reason that suppresses same-shape re-proposals. Hard cap ~5 open
proposals; one question per card; no "approve all", ever.

## 5. MVP cut (build order)

1. **Diff-review inbox** (create/attach/supersede + reject-with-reason) —
   the graph is BORN through review; it is also the demo.
2. **Entity page** — the payoff.
3. **One search box**, three answer shapes (status route mandatory in v1).
4. **Index** — an afternoon once 1–3 exist.

NOT building: any canvas (banned forever); split (a bad split UI poisons
trust in all diffs); entity mutation outside the diff path (one mutation
path or history lies); >2 ingestion sources in v1 (docs + code; Slack is
the first fast-follow and the extensibility proof); notifications;
permissions; composite scores; trend charts.

Proof sentence: *a PM types "payments", lands on a page assembled entirely
from human-approved diffs, and reads the org's situation aloud without
composing anything.*

## Acceptance cases (mutation → visible truth)

1. Diff approved (create Payments from 14 docs + 3 clusters) → stable URL
   within one refresh; identity sentence links its diff; index +1 row;
   card leaves inbox, lands in ledger as an event.
2. Diff edited-then-approved (renamed; 2 attachments unchecked) → born
   with 12 attachments under the edited name; event marked human-amended;
   dropped docs never silently re-attach.
3. Diff rejected with reason → closes as an event; same-shape proposal not
   re-raised; evidence stays available to different future proposals.
4. Merge approved → union; counts sum; zero attachments lost; both names
   alias; health unchanged by the merge itself.
5. Supersede → old pages banner + freeze; new evidence routes to
   successor; "carries forward from" both; no attachment migrates.
6. Landing on superseded → banner names successor/date/approver + diff
   link; frozen holdings; one click to successor, one to "as it was".
7. Scrub pre-supersede → simply alive: no banner, own health, successor
   absent everywhere.
8. Rename → new name in one refresh; old name resolves via alias; old
   URLs redirect.
9. Slack decision attached (new source type) → holdings "decisions" with
   quote + permalink; ledger event; zero new UI (attachments are
   source-agnostic).
10. Embedding search hits neighbor content ("refunds stuck" text lives in
    an incident on Refunds ⊂ Payments) → Refunds returned with the
    incident quoted as the why; Payments appears as a labeled relation,
    not a mystery second hit.
11. Status query → situation answer across all entities, never one card;
    all-healthy says so and names when last verified.
12. Check flips a promise → health sentence updates; flip in entity
    ledger + home mirror with the entity named.
13. Mechanical signal alone (new co-mention cluster) → graph unchanged; at
    most a new inbox proposal; no entity page mutates.
14. Neighbor hop → page swap + trail growth; back works; no node-link
    picture ever renders.

## Technical addendum (implementation mapping)

- **Entity storage**: entities + attachment edges + the diff log in the
  workspace store (diff log is the source of truth; entity state is a fold
  of approved diffs — same event-sourcing shape as the intent ledger).
- **Node embeddings from connections**: an entity's embedding = aggregate
  over its attachments' text (promise statements, doc excerpts, incident
  text, commit subjects), refreshed on attachment change. Serves as a NEW
  RUNG in the ask ladder between lexical and LLM-translation: alias/label
  (exact) → lexical → **embedding** → LLM translation → unresolved. Every
  embedding hit must carry its best-matching attachment excerpt (the
  "quote its reason" invariant). Requires an embedding provider — the one
  new dependency this pivot introduces; choose at build time.
- **What survives unchanged**: fact layer, analyzer + harness, contract
  versioning, alias learning, mirror/ledger (they re-anchor onto
  entities), the three-tier edge authority model — diffs formalize tier-1
  mutations.
- **Migration**: current derived areas + their names/aliases seed the
  first LLM proposals ("these six areas across two workspaces are five
  entities — confirm?"), so day one of the inbox starts with real,
  relevant questions about our own repo.
