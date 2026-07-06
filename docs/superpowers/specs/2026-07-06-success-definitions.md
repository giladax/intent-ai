# What Success Looks Like — the next steps

**Date:** 2026-07-06 · **Owners:** Gilad + Quire's builders (this session's successors)
**Rule of this doc:** every step gets three lines — *done means*, *measured by*, *falsified by*. If a step can't fill the third line, it isn't defined yet. Pre-register before building; the fidelity audit taught us why.

---

## 0. The MVP claim (running now — success already pre-registered)

- **Done means:** the 42-session campaign completes and the pre-registered analysis is applied untouched.
- **Measured by:** `docs/audits/2026-07-06-mvp-campaign.md` — stratified ETC/tokens/CVR deltas against the locked pass bar.
- **Falsified by:** the pass bar itself. A FAIL honestly reported is a success of the *method*; the claim then gets revised, not the scoring. INCONCLUSIVE → the follow-up is more N on the strong stratum, not a redesign.

## 1. Knowledge graph — intent artifacts ↔ implementation features (#22)

- **Done means:** `intent_artifacts` (PRDs/specs as first-class nodes) + many-to-many links to features, seeded from this repo's own docs/prd.md and specs; at least one intent-shaped lens works end to end ("the feed for PRD X"); an alignment question is answerable *as a query* ("which specs does the digest pipeline serve, and which of their requirements have no supporting evidence?").
- **Measured by:** a new fidelity-style eval slice: N known intent↔implementation pairs from this repo (hand-labeled from the audit-era docs) — link recall/precision against them; plus one demo alignment query with a cited answer.
- **Falsified by:** links that exist but don't discriminate (every feature linked to every spec = graph theater). Precision floor pre-registered before seeding.

## 2. The feed as a daily surface

- **Done means:** the feed is the default view *someone actually returns to*. Dogfood definition: Gilad opens Quire on ≥3 distinct days in a week without being prompted, and at least once learns something from the feed he didn't already know (self-reported, logged as a journal event).
- **Measured by:** attention/visit events already in the river (`digest:run` freshness vs. visit times); the "learned something" moments recorded via the composer's own feedback affordance (add one: 👍/"knew it" on stories — cheap, ships with #21).
- **Falsified by:** the feed composing correctly but nobody returning — that's a content-value failure, and the fix conversation is editorial (what gets written), not visual.

## 3. Shared attention (shipped v1 — success is usage, not existence)

- **Done means:** one real mid-session save: an agent (Claude Code via MCP) uses `brain_attention` during actual work and the fetched context changes what it does (cited in its transcript).
- **Measured by:** the MCP read instrumentation already on the tool (emitRead events) + one documented transcript excerpt in the journal.
- **Falsified by:** zero organic calls in two weeks of dogfooding → the tool is a demo, not a feature; demote from the killer-feature narrative until the trigger surface (when do agents *think* to ask?) is redesigned.

## 4. Digestion-v2 (design capital, parked)

- **Done means (unfreeze condition):** unfrozen only when one of: (a) the campaign verdict implicates digest quality in a measured failure; (b) a second source adapter is scheduled (the receiver design exists for exactly this); (c) fidelity eval on new sessions regresses below the post-rewrite baseline.
- **Measured by:** run-fidelity — v2 must beat the shipped pipeline on the same pre-registered criteria (proposal §experiments V2-E1..E4) at ≤3× cost.
- **Falsified by:** v2 winning on vibes but not on the eval — then v1 stays, and that is fine.

## 5. Second source adapter (Jira or Slack — the boundary proof)

- **Done means:** one thin adapter ingests a real second source through the *unchanged* receiver core; its events land in the river with occurred-time; at least one cross-source moment links intent (a ticket/thread) to implementation (a session).
- **Measured by:** zero modifications to the understanding core to admit the source (the import-boundary check from the v2 proposal); one demo alignment trace across sources.
- **Falsified by:** the adapter needing core surgery — that falsifies the receiver abstraction itself, and the v2 design gets revised before more sources.

## 6. Near-term product polish (#20, #21)

- **Done means:** chat answers carry citation tokens that open the evidence walk inline (#20); the feature page has its editorial layer — state band, story-so-far, approval anatomy (#21); both pass the existing gates (voice scan, design fidelity vs mockups, 5-second tests).
- **Measured by:** the existing test suites + one Playwright walkthrough per surface; no new eval needed.
- **Falsified by:** any regression on the trust chain (citation → evidence → transcript must stay walkable end to end).

## 7. The standing invariants (every step above inherits these)

1. **Nothing asserted without evidence** — generated prose is presentation cache, never stored as fact; citations DB-derived; the walk to the transcript never breaks.
2. **Pre-register before building** — criteria first, baseline, then change (this doc is itself that discipline applied to the roadmap).
3. **The voice rule** — plain, value-first, doors slightly open, never pretentious; guarded by tests, not intentions.
4. **Essence** — terse by default, everything on demand, one mental model for humans and agents.
5. **One writer per file set; reviews gate; honest reports** — the process that built these two days is itself a success criterion: if a step ships without its review gate, it isn't done.

---

*Sequencing after the campaign lands: read its verdict first — it may reorder 1–6. Default order absent new information: #21+#20 (small, closes the surface), then #1 (the moat), then #5 (the boundary proof), with #2/#3 measured passively throughout.*
