# CPO inbox session — first real use of the proposal inbox (quire-brain seed)

**Date:** 2026-07-19 (decisions stamped 2026-07-18 UTC by the server clock — verified honest against the machine clock)
**Who:** CPO, signing every decision `by: "cpo"`
**What:** Decided all 5 seed graph diffs for the `quire-brain` workspace through the live inbox (`/inbox/quire-brain`, port 8331), using only the actions the page offers. Decisions are real and persisted to `workspaces/quire-brain/graph/diffs.yaml`.
**Grounding read first:** `docs/PRD.md` (the twelve rules), `design/round2/inbox.html` (signed-off mock), `workspaces/quire-brain/obligations.yaml` (the 12 promises themselves).

---

## 1. Session log

The inbox opened with 5 cards, all labeled "medium stakes", ordered by stakes descending (2.8 → 2.2). Order held; blast-radius ordering (Rule 8) is real. I decided top-down.

### GD-3 — "These 2 promises and 7 code locations describe one thing — call it MCP Surface?"
**Decision: Edit first → approved (recorded human-amended).**

This is the easiest "yes" in the batch on the naming question — "MCP Surface" is verbatim our vocabulary; it is literally the `source_section` of QUIREB-004 and QUIREB-006 in obligations.yaml. The two quotes on the card justify the entity on their own. But the card's "7 code locations" included `docs/plans/2026-07-03-observability-design.md` — a plan document, not a code location, attached under `kind: code`. I opened Edit first, which turned out to be a raw JSON textarea of the operations array. I deleted that one attach op and approved. The system correctly recorded `amended: true` and applied my final operations, not the AI's.

What I could not judge from the card: whether the six remaining code files actually belong. There is no quote, no line, no note per file — `note: ""` on every attach. I judged them from my own knowledge of the codebase (`src/mcp/*` and `emit-events.ts` are right; `src/adapters/types.ts` is the shared types file and a weak but defensible bind). A reviewer without my codebase memory is approving code bindings on faith. I also independently verified every cited path exists in the repo — all 14 refs across all five cards do — but I had to do that outside the product.

### GD-5 — "These 3 promises and 5 code locations describe one thing — call it Current Understanding?"
**Decision: Edit first → approved (recorded human-amended).**

The three quotes (QUIREB-008, 011, 010) genuinely cohere into one thing: the human-gated, artifact-grounded body of approved knowledge. "Current Understanding" is verbatim from QUIREB-008 — the name is what the org says. The identity sentence is accurate and readable aloud.

But one attachment was wrong in an almost comic way: `docs/future-knowledge.md` — our register of *consciously deferred* hypotheses — attached to an entity whose identity sentence is about what is *currently approved*. Future-knowledge is the explicit complement of Current Understanding. That the mechanical clustering co-mentions them is believable; that no one caught the inversion is exactly why a human is in this loop. I edited it out and approved. I kept `src/eval/fidelity.ts` after hesitation — it is the nearest thing we have to enforcement of the groundedness invariant (QUIREB-010).

### GD-2 — "These 3 promises and 4 code locations describe one thing — call it Feature?"
**Decision: Approved as proposed.**

Clean approve, and a deserved one. Feature is the org's most load-bearing noun — the primary lens of the whole product — and QUIREB-007's entire point is that there is exactly one vocabulary and its name is Feature. The three quotes justify it; the four code refs are the right four files. I noted that QUIREB-006 is attached both here and on MCP Surface and decided that is correct, not a duplicate — the promise about structured candidate lists genuinely binds both the surface and the vocabulary. But I only knew about the dual attachment because I read both cards side by side; neither card told me.

### GD-1 — "These 2 promises and 4 code locations describe one thing — call it Brain?"
**Decision: Rejected — `wrong_name`.**

The best question in the inbox, and my only rejection. The grouping is genuinely coherent: QUIREB-001 ("never edit the source documents in external systems") and QUIREB-012 ("must not store source artifacts; external systems of record stay external") together describe one real thing — the source-artifact custody boundary. So `not_one_thing` would have been dishonest. But **"Brain" is the whole product** — it is the name of this very workspace. Every one of the 12 promises is about Brain. An entity called "Brain" holding 2 of 12 promises means Ask("brain") lands a PM on a dossier that misrepresents the org by omission — the mirror would lie by framing. The name is wrong at the level of scale, not spelling.

Here I hit the sharpest friction of the session: `wrong_name` is precisely the code whose meaning is "keep the grouping, fix the name" — and the page gave me nowhere to say what the name should point at. Only "other…" prompts for a sentence ("it teaches the system"). I wanted to teach it: *the entity here is the artifact-custody boundary, not the product*. I could not, without miscoding my rejection as "other". I sent `wrong_name` with empty text, as the page's own JavaScript does, and swallowed the loss.

I also chose rejection over Edit-first deliberately: I could have renamed it inline, but the org does not yet have a settled name for this boundary, and I don't want the map to crystallize a name I improvised at 5pm. The rejection loop — repropose in a different shape — is the right mechanism for this. The `shape_key` is persisted with the rejection, so Rule 6 is enforceable.

### GD-4 — "These 2 promises and 4 code locations describe one thing — call it Write Provenance?"
**Decision: Approved as proposed.**

Two promises, one concept: every write carries session id and actor, whether the writer is a human or an agent acting on the human's behalf (QUIREB-003 the rule, QUIREB-009 the permission — different kinds, same identity). The name is a fair synthesis of the org's own words ("as provenance", "actor attribution"), and both org phrases are captured as aliases, which is exactly what aliases are for. `src/mcp/context.ts` and `src/mcp/instrument.ts` are precisely where this lives. Approved untouched.

---

## 2. The map I made

Four active entities, verified via `GET /api/graph/quire-brain` after deciding:

| Entity | Promises | Code holdings | Via |
|---|---|---|---|
| MCP Surface | QUIREB-004, 006 | 6 (amended from 7) | GD-3, amended |
| Current Understanding | QUIREB-008, 010, 011 | 4 (amended from 5) | GD-5, amended |
| Feature | QUIREB-002, 006, 007 | 4 | GD-2 |
| Write Provenance | QUIREB-003, 009 | 4 | GD-4 |

**Is this the org I know?** Largely yes — and that is not faint praise. MCP Surface, Feature, Current Understanding, Write Provenance are four of the five nouns I would have written on a whiteboard unprompted. My amendments were honored exactly (the graph holds my final operations, `via` the amended diffs). The one mutation path held: nothing touched the map except my approvals.

Three things about the map surprised me, and per my own rule for this session, a surprise is a defect:

1. **QUIREB-005 is nowhere.** The promise that digested logs are copied to `.intent/raw-sessions/` was never in any proposal. The seed pass silently consolidated 12 promises into proposals covering 11. Nothing in the product told me; I caught it only because I had read obligations.yaml before the session — i.e., outside the product. (QUIREB-001 and 012 are also unhoused, but that is the *intended* consequence of my GD-1 rejection — the loop should bring them back in a new shape.)
2. **Zero relations.** The signed-off mock's exemplar card includes `+ relation part of Payments`; the PRD promises role-labeled links (Rule 11). Not one of the five proposals contained a `relate` op. The map is four islands — no "MCP Surface *speaks* Feature", no "Write Provenance *constrains* MCP Surface". Dossiers will render empty relations lists on day one.
3. **The fifth whiteboard noun is the one I rejected.** The custody boundary (001+012) is real and currently homeless. That's the system working as designed — but the inbox went straight to "Nothing awaits you" with no acknowledgment that three approved promises now have no home.

---

## 3. Defects

Numbered, with severity, each tied to a PRD rule or the signed-off mock (`design/round2/inbox.html`).

**D1 — Coverage silence: a promise can vanish from the seed with no signal. Severity: HIGH.**
QUIREB-005 appears in no proposal; after my five decisions the inbox reads "Nothing awaits you. The map asks rarely…" while 3 of 12 approved promises (005 by omission, 001/012 by my rejection) have no entity. PRD §4 promises "one coverage sentence" (Home) and the proof sentence demands the org be readable "without composing anything" — I had to compose the gap myself from obligations.yaml. The inbox (or at minimum the post-decision empty state) must say: *9 of 12 promises housed; 3 awaiting a home.*

**D2 — Structured rejection teaches nothing except for "other". Severity: HIGH.**
Rule 6's premise is that rejection is structured *so the system learns* ("a rejected proposal never returns in the same shape"); the page's own prompt for "other" says "it teaches the system." But `wrong_name` — the code that most needs a payload (what should the name gesture at?) — sends `reason_text: ""`. Same for `not_one_thing` (which split?) and `bad_evidence` (which quote?). This incentivizes miscoding rejections as "other" just to smuggle the sentence in. The mock (line 72) has the same four bare links, so this passed sign-off — the defect is in the design, and it is mine to own. One optional sentence on every reason code fixes it.

**D3 — "Edit first" is a raw JSON textarea, not the promised edit surface. Severity: HIGH.**
The signed-off mock (line 68) promises: "Edit opens inline: **rename the entity · uncheck any attachment · adjust aliases**." PRD §4: "Edit-first (visible preview)". What ships is a `JSON.stringify(operations)` blob. I am the CPO of this product and I hand-edited operation arrays; a PM would not survive first contact, and a typo'd edit fails with a JSON parse error. There is also no preview: the rendered change block does not re-render from the edited JSON before approving. The two edits I made (delete one attach op each) are exactly the "uncheck any attachment" gesture the mock promised as a checkbox.

**D4 — Code attachments carry no evidence chain. Severity: HIGH.**
Rule 2: every rendered claim completes its chain (statement → quoted source → enforcing file:line → verdict). Rule 3: no quote, no render. The promise attachments honor this in spirit — verbatim quotes lead the card. The code attachments honor none of it: no line, no per-file reason, `note: ""` on all 25 attach ops across the batch. GD-3's meta line says "reasoned from 2 quoted sources" while asking me to bind 7 files. I decided those bindings from personal codebase knowledge and out-of-band file checks — the card alone was insufficient evidence for roughly half of what it asked me to approve. Acceptable for a seed *only* if the card says so ("bindings are mechanical, tier-2, individually revocable"); it doesn't.

**D5 — Documents attached under `kind: code` and counted as "code locations". Severity: MEDIUM.**
GD-3 counted a plan doc among "7 code locations"; GD-5 counted `docs/future-knowledge.md`; GD-1/GD-2 count spec docs and `.repo/brain.md` the same way. PRD §1–2 enumerate docs as a distinct holding kind from code locations. The model apparently has only `promise|code`. This directly caused my GD-3 amendment and inflated every card's question sentence.

**D6 — Evidence sources are stripped of section and date. Severity: MEDIUM.**
Mock quotes carry provenance a human can weigh: "risk-model spec §2 · Notion, Apr 2026". Live quotes carry "QUIREB-004 · approved promise" — no `source_reference` (prd), no `source_section` ("MCP Surface"), no revision/date, all of which sit unused in obligations.yaml. Rule 2 again. For GD-3 the section name alone ("MCP Surface") would have closed the naming question instantly.

**D7 — Stakes labels are uniform, and all five cards render fully expanded. Severity: LOW-MEDIUM.**
Ordering by stakes held (Rule 8 ✓) and labels technically "agree with position" — but only because every card says "medium stakes", which conveys nothing. The mock (lines 76–77) collapses below-the-fold proposals into one-line rows with differentiated stakes ("high stakes · 2 entities freeze" / "low stakes · 3 sources"); the live page is five full cards, a wall. Either the stakes function needs dynamic range or the label should be hidden when uniform.

**D8 — Decided history is not in decision order. Severity: LOW.**
The page reverses the id-ordered API list, showing GD-5,4,3,2,1; my actual decision sequence was GD-3, GD-5, GD-2, GD-1, GD-4. §1 calls the diff log "the map's immutable history" — history reads chronologically or it isn't history. (The underlying records are correct; timestamps are honest — I verified the server clock. Rendering only.)

**D9 — Cross-attachment invisibility. Severity: LOW.**
QUIREB-006 attaches to both MCP Surface (GD-3) and Feature (GD-2). I judged the dual attachment correct — but neither card disclosed the other. Approving GD-3 first, I "gave" 006 a home; GD-2 then asked again without saying "already held by MCP Surface". For promises that anchor entity identity, that's decision-relevant context.

**What passed — recorded so the team knows the spine held:** one mutation path (Rule 5 ✓ — only my decisions changed the graph, verbs live only in the inbox); amended approvals recorded `amended: true` with final operations (Rule 7 ✓); shape_key persisted with the rejection (Rule 6 enforceable ✓); no approve-all anywhere, cap noted "(never more than 5)" (Rule 8 ✓); mechanics score is a genuine footnote with the self-aware "(footnote, not the argument)" (Rule 8 ✓); org quotes lead every card (Rule 8 ✓); rejected shows in Decided with its reason code, reads "rejected · wrong name" (✓); doctrine appears exactly once, in the footer (Rule 12 ✓); one question per card in form (Rule 8 ✓ — though see the note below on what a card really asks).

---

## 4. What this taught me about the product

**Deciding the entity questions felt like judgment. Deciding the attachments felt like chores I wasn't equipped to do.** The five headline questions — is this one thing, is this its name — were genuinely good questions, and GD-1 was the best moment in the product so far: the AI made a defensible proposal, I disagreed for a reason that only someone who knows the org could articulate, and the structured rejection captured *that a human said no about naming* even if it couldn't capture why (D2). That loop — machine proposes, human sharpens — is the product. It exists. It works.

But each card is secretly N questions wearing one question's clothes: one identity, one name, one identity sentence, one alias set, and 4–7 bindings. The headline question I could answer from the quotes. The bindings I could not (D4), and Edit-first — the designed escape valve for "right thing, imperfect details" — is currently hostile enough (D3) that most reviewers would face a false binary: approve imperfection or reject truth. I used Edit-first twice and it did exactly the right thing *to the data* (amendments honored, flagged, persisted). The engine of Rule 7 is built; only its handle is missing.

**The reading experience honors the design language.** Quotes lead. Mechanics whisper. The empty state ("The map asks rarely — that is how it earns the right to ask") is the product's voice exactly. The page did not shout at me once.

**The mirror's edge is coverage, and today it has a blind spot.** The one thing I could not learn from inside the product was the most important thing a mirror must never hide: what it isn't showing me (D1). A situation mirror that silently drops one promise in twelve is not yet a mirror; it's a well-lit partial view.

**On my own conduct as a user:** I read obligations.yaml before the session, and I needed it — for QUIREB-005's absence and for weighing GD-1's scale problem. For the five headline questions, the cards' quotes were sufficient. That's the right bar: the card must carry enough to answer *its own question*; the workspace's promise ledger must be one link away for everything else. Today it's zero links because I cheated, and infinity links because the page has none.

---

## 5. Verdict: ready for a founder demo?

**Not yet — but it is close, and the gap is skin, not spine.**

The irreversible things are right: one mutation path, human-amended records, structured rejection with shape memory, honest persistence, blast-radius ordering, quotes-first cards, no approve-all. Those are the things you cannot retrofit credibly, and they held under real use by a hostile-friendly user.

What would break a founder demo, in order: (1) the founder asks "so all twelve promises are housed now?" and the product cannot answer — D1; (2) the founder clicks Edit first and sees a JSON blob where the mock promised checkboxes — D3; (3) the founder rejects something and realizes the system learned nothing but a two-word code — D2. Each of these punctures the exact story we'd be telling ("humans decide, and the system learns").

Fix D1 (one coverage sentence on the inbox), D2 (one optional reason sentence on every code), and D6 (pass through section+date we already store) and I will demo it myself in that state, with Edit-first driven carefully. D3 is the largest lift and the true bar for putting it in front of a founder's own hands rather than mine.

The map that exists tonight — MCP Surface, Feature, Current Understanding, Write Provenance, and one honest rejection holding space for the custody boundary — is the org I know. The product asked me five questions and four of them deserved to be asked exactly as they were. For step 1 of the MVP, that is the substance of a pass.

— cpo
