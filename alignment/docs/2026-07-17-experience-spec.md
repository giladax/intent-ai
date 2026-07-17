# The Experience — org-situation mirror (spec + experience-EDD)

> Founder framing, verbatim: "all our graphs and work is so that we could
> reflect the work and organization situation." CPO-session output below,
> adopted as the experience spec. The organizing rule of every screen:
> **"what changed against what we promised?" — never "what happened?"**

## Part 1 — the experience, by persona × moment

- **CPO, Monday morning → the situation diff.** "Did anything we promised
  degrade, and is anything waiting on me?" Deltas since last visit, not
  totals: "1 promise degraded (refund cap, Fri 6pm) · 2 findings await a
  human · coverage unchanged." Click-through: evidence excerpt against the
  promise's own provenance quote; assign or scrub back to last-healthy.
- **Eng lead, review week → the verdict queue.** This week's PRs sorted
  contradicted → flipped → drift → aligned (aligned collapsed). Honest
  admission: this persona's real home is the GitHub comment; the queue is
  where curiosity lands afterward.
- **PM asked "where are we on payments?" → the area page.** A sentence
  she can say out loud: "Payments: 7 promises — 5 satisfied, 1 partial
  since PR #212, 1 no evidence yet; 2 open findings." Provenance quotes
  make it defensible from the org's own documents. **The area page IS the
  status report; if she composes one, we failed.**
- **New engineer, week one → the area page as a map.** Promise → the
  approved sentence explaining why the guard exists → jump to code. The
  one persona for whom quotes matter more than lamps.
- **Incident → pin the blast radius.** Promises carried by the affected
  locations + judged-change history filtered to them; scrub backward to
  the flip — that's the suspect. The scrubbable ledger becomes
  load-bearing exactly here.

**THE home surface (the mirror), above the fold, in order:**
1. Health diff since last visit (every flipped promise: PR + one-line why)
2. Findings inbox, top finding inline with its two verbs
   (*adopt into contract* / *not intent — bug*)
3. One coverage sentence naming the largest uncovered surface

Nothing else above the fold. Areas/search/scrubber are navigation.

**Do NOT build:** promise↔code graph viz (links are for jumping, not
staring); a single org "alignment score" (gamed in a week; flattens
contradicted-a-hard-rule into a decimal); health trend charts (the
scrubber is the history); chat before the mirror answers the five
questions without one.

## Part 2 — experience-EDD acceptance cases

Mutation → what a person must see (checkable by eye or script). Cases
1–5, 8, 14–18 mutate the **contract**, not the code — the mirror's real
acceptance criterion is that the org can change its mind and the screen
tells the truth about when and how.

1. **Promise approved** → mirror diff "new, no evidence yet"; area count
   increments; ⟡ revision marker on timeline. Within one refresh.
2. **Promise retired** → leaves lamps/coverage now; scrubbing pre-retirement
   shows it alive; diff cites who retired it.
3. **Promise reworded (v2)** → visible v1→v2 diff + new quote; historical
   verdicts stay labeled "judged against v1" — no retroactive rewriting.
4. **Area renamed** → new name everywhere in one refresh; old name becomes
   an alias that still lands; old URLs redirect.
5. **Areas merged** → union of promises (counts sum, zero lost); both prior
   names alias; health unchanged by the merge.
6. **PR flips satisfied→partial** → top of mirror diff: promise, PR,
   one-line reason, evidence resolving verbatim against the diff; queue
   sorts it above aligned.
7. **Contradicted hard rule** → unmistakably distinct from drift: blocking
   styling, the violated promise line quoted, owner named.
8. **Finding adopted** → leaves inbox; new promise with provenance =
   source + approval act; originating PR re-judged aligned.
9. **Finding rejected as bug** → closes with disposition, never resurfaces;
   the fixing PR judges aligned without spawning a new finding.
10. **Uncovered surface touched** → a *coverage* finding ("no contract —
    register intent?"), visually distinct from drift; coverage sentence
    updates to name the surface.
11. **Incident declared** → area banners; its promises pin above the mirror
    diff for everyone; history auto-filters to affected locations.
12. **Day-one empty workspace** → home is the wizard's Scan act with a
    mirror preview; zero-state NEVER renders "0 promises, 0 findings."
13. **100-promise contract** → five-second answers survive: per-area
    roll-ups, bounded above-the-fold items, search first-class.
14. **Orphaned pointer (bound code deleted)** → promise flips to
    "orphaned — evidence location gone," cites the deleting commit,
    auto-opens a rebinding finding. Silent rot is the failure tested.
15. **Refactor renames a bound symbol** → no-material-impact verdict +
    binding-follow proposal in inbox; health does not flip.
16. **Human edits bindings in UI** → ⟡ on timeline; next PR judged against
    new bindings; prior analyses untouched.
17. **Scrub to past event** → every lamp/count/inbox reflects exactly that
    moment; contract-v2 promises invisible before their ⟡.
18. **Analyzer version bump** → re-judged events labeled as such — never
    fake churn presented as real flips.
19. **Two PRs between refreshes** → correct net state with the two-step
    history one click away.
20. **Search in org slang** → "checkout" asks once "did you mean
    Payments?"; acceptance teaches the alias workspace-wide.

## Delta vs. what exists today (build order)

| Spec surface | Today | Gap |
|---|---|---|
| Situation mirror (home) | — | New. Diff-since-last-visit needs a "last seen" cursor; data (flips, inbox, coverage) all exists in store/timeline. **Build first.** |
| Area page | `ask` card (inline panel) | Promote to a real page/URL; add provenance quotes + jump-to-code links. |
| Promise page | — | Statement + quote + locations + health history; mostly timeline data re-sliced. |
| Verdict queue | `list` CLI + ledger | Sort by severity; collapse aligned. Small. |
| Findings inbox with verbs | review CLI/API exists | Wire *adopt into contract* (creates promise + re-judges) and *bug* dispositions — the flywheel's UI half. |
| Orphaned-pointer detection (case 14) | — | New deterministic check in analysis (bound path/symbol gone at head → orphan finding). Aligns with CTO-review binding-rot risk. |
| Incident pinning (case 11) | — | Community card + elevated scrutiny — designed earlier, unbuilt. |
| Scrub correctness (cases 2,3,17) | Ledger has it | Promote from demo surface to shared component; case-17 script check. |

Experience-EDD harness: encode cases as scripted checks against the API
(mirror/area/ask endpoints return JSON — assert the expected content per
mutation), mirroring `evals/cases.py`. UI eyeballing stays human; content
correctness becomes CI.
