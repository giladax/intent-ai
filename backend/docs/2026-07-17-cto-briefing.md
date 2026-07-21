# CTO briefing — Quire Align (prep for partner meeting)

Every claim here is implemented and verifiable in `alignment/` as of
2026-07-17. Where something is a gap or roadmap, it says so explicitly —
use the honesty; CTOs buy from people who know their own edges.

---

## 1. The 90-second story

Production agents and services drift from approved behavior — not because
code review fails, but because a product promise lives in *several places
at once*: the decision logic, an enforcement guard, a config value, a
prompt, the tests. A PR that moves one and not the others passes review
(each file looks right) while the promise silently breaks. Our demo case:
policy raised to $100, guard still blocking at $50 — every test green,
product promise not delivered.

Quire Align sits on the PR. It compares the behavioral change a PR
introduces against the org's **approved obligations** (5–15 atomic product
promises), and answers: which promises does this touch, does it deliver
them fully, what verification is missing, does a human need to look. One
comment, evidence-cited, quiet unless it matters.

## 2. "What are these control points?" — the exact answer

**A control point is a pointer, not code.** It's an entry in our workspace
metadata that names a place in *their existing repo* and its role in a
promise:

```yaml
- control_point_id: CP-guard
  role: enforcement            # decision | enforcement | executor |
  path: refund_agent/guard.py  #   configuration | audit | test_or_eval
  symbol: RefundToolGuard.check
```

It's their code's existing anatomy, labeled: where a promise is *decided*
(policy logic), *enforced* (guards/validators), *executed* (the
side-effect boundary), *configured* (yaml/env/prompts), *observed*
(audit/logging), and *verified* (tests/evals). A **binding** is the typed
edge obligation↔control-point. The analyzer uses bindings to know which
files to read, which obligations a diff can affect (deterministic gate —
untouched bindings mean zero model calls for that obligation), and whether
a change moved the decision without moving the enforcement (the PARTIAL
verdict — our sharpest signal).

**How they're created:** proposed automatically (`propose-obligations`
reads their docs + repo and drafts both obligations and bindings, each with
a verbatim provenance quote that's validated mechanically); a human
approves in the onboarding wizard. Nobody hand-writes YAML.

## 3. "Is there code friction?" — the answer is no, and here's the proof shape

- **Zero changes to their code.** No SDK, no decorators, no annotations, no
  imports, no build step, nothing in their runtime path. Their code never
  runs under us; we never execute their code (analysis is static reading +
  LLM inference).
- **Read-only integration.** A GitHub token with repo-read + one
  comment-write scope — or *no integration at all* for the pilot: the git
  adapter analyzes local commit ranges, so a retroactive audit of their
  last 50 merged PRs needs only a checkout.
- **Non-blocking by default.** The verdict is an advisory PR comment
  (upserted in place, marker-tagged). Making a specific hard rule a
  required check is their choice, per rule, later.
- **Quiet by default.** ALIGNED / NO_MATERIAL_IMPACT → no comment.
  Changes on surfaces the contract doesn't cover → UNGOVERNED, routed to a
  weekly intent-inbox, never an alarm on the developer's PR.
- **Deployment posture.** Small Python service (FastAPI + SQLite); can run
  in their VPC. The only egress is model calls (diff + selected files +
  the approved doc to the Anthropic API). If they have a Claude enterprise
  agreement, it rides their existing DPA.
- **Cost/latency per PR:** 2–8 Sonnet calls (the binding gate and
  refactor short-circuit keep it low), ~1–2.5 minutes, roughly $0.10–0.50.

## 4. The object model in 30 seconds

- **Obligation** — one approved, testable promise, pinned to a section of
  an approved source doc (verbatim quote, mechanically validated).
- **Control point / binding** — where that promise lives in code (above).
- **ContractSnapshot** — hash of the exact obligation revisions used; every
  analysis pins one. Intent evolves; history is never re-interpreted.
- **PRAnalysis** — idempotent on (repo, PR#, head SHA, contract, analyzer
  version); every finding cites evidence that was verified verbatim against
  the diff/files/docs, or was dropped.

## 5. The trust architecture (the part a CTO will probe hardest)

1. **The LLM never picks the verdict.** Structured Sonnet/Haiku calls
   produce findings (declared intent, behavioral delta, per-obligation
   impact) validated by Pydantic; ordered deterministic rules compute the
   label. The classifier is auditable code, not a prompt.
2. **Similarity never grants authority.** Product context resolves through
   a ladder: explicit ticket links → registered sources → bindings →
   lexical retrieval — and authority comes only from human-approved status.
   Two conflicting approved sources → the system **abstains** (UNKNOWN)
   rather than pick a side. Stale/draft docs are rejected by status.
3. **Evidence or silence.** Every citation is checked verbatim against
   real content; unverifiable citations are dropped; a finding left
   without evidence degrades the verdict toward UNKNOWN.
4. **Code never creates intent.** A behavior change with no matching
   obligation is drift/ungoverned — a question for a human, never an
   auto-added "requirement".

## 6. Numbers we own (and their honest scope)

- 72 unit/e2e tests, all offline-runnable.
- 11-case end-to-end eval, 9 deterministic evaluators per case (checks
  every stage: artifact selection, stale rejection, obligations, control
  points, evidence validity, abstention, review flag, classification).
- **8 consecutive live-inference runs at 99/99** after an eval-driven
  hardening loop (69→99 over 5 iterations; each fix was a general
  semantics fix, verified on an unseen case via blind probes).
- Dogfood on our own repo: onboarding e2e drafted 15 obligations / 61
  bindings from our real PRD with zero provenance drops; retro sweep found
  one true drift (a shipped MCP tool no approved intent covered).
- **Honest scope:** the eval suite is self-authored — it proves engine
  stability and regression safety, not field accuracy. Field accuracy
  (catch rate, false-alarm rate) is exactly what the pilot measures on
  *their* history.

## 7. Sharp questions → answers

**"So it's an LLM code reviewer?"** No — it doesn't judge code quality at
all. It compares behavioral change against approved product intent. Its
sharpest verdicts (PARTIAL, POSSIBLE_DRIFT) are invisible to code review
by construction: each file individually looks correct.

**"Why not just write more tests?"** Tests verify code against
code-authored expectations. We verify against *product-approved* intent —
and inspect the tests themselves: the coverage inspector flags when a
promise's bound verification wasn't updated with the behavior (and we
found live that models want to call a broken test "contradicts"; the
architecture forces test-state into missing-evidence, keeping the
behavior verdict clean).

**"Why not RAG over our docs?"** Retrieval finds *relevant* text; it can't
tell you what's *authoritative*. Our ladder treats similarity as
candidates only; approval status is the authority; conflicts abstain.
That's the difference between an intent system and a search box.

**"Bindings will rot on refactors."** Pointers, not hashes — file renames
break them visibly, not silently: paths are validated against the tree at
draft time, and a re-proposal run regenerates the contract for
re-approval. Symbol checks are structural (declaration presence), not
AST-parsing, so we're language-agnostic today (proven on TypeScript and
Python repos). Roadmap: a `doctor` check in CI that flags stale bindings,
and co-change edges from git history. *This is a real maintenance
surface; the mitigation is that regeneration is cheap and human-approved.*

**"What about our monorepo / 500 PRs a day?"** Per-analysis context is
bounded by design: the diff, bound control-point files, and the approved
doc — never repo-wide indexing (explicit non-goal). The binding gate means
most obligations cost zero model calls on most PRs; refactor-shaped diffs
short-circuit after 2 calls; identical re-runs hit the idempotency cache.
Honest edge: today's manifest is one repo per workflow; multi-repo
workflows are roadmap.

**"Who maintains the intent when the PRD changes?"** The contract is
versioned; changing it is a re-proposal + approval session (minutes, not a
project). Drift/ungoverned findings continuously propose additions from
the other direction. Everything human-gated; the system never edits
intent.

**"Model lock-in? Model updates?"** LangChain abstraction (Sonnet for
reasoning, Haiku for parsing today). Any model change re-qualifies against
the eval harness — that's what 8×99/99 is *for*: a regression gate, so
model swaps are a measured decision, not a leap.

**"What data leaves us?"** PR diff, contents of bound files, the approved
doc excerpts — to the model API only. Analyses live in SQLite wherever the
service runs (their VPC if they want). No telemetry.

**"What do you need from us for a pilot?"** One repo checkout, 1–3 docs
someone will stand behind (or none — we mine tests/config), one hour with
a PM + tech lead in the onboarding wizard, and a list of the last ~50
merged PRs. We run read-only, retroactively. Success criteria agreed
upfront: N confirmed catches, false-alarm rate under X, per-PR cost/latency
in budget. No CI gating, no code changes, cancel by deleting a token.

## 8. Demo flow for the meeting (15 min)

1. **The hook (fixture):** `cli demo` — PARTIAL: policy $100 / guard $50 /
   no test. "Every file passed review."
2. **The scary one:** analyze PR 106 — guard deletion → OFF_INTENT,
   enforcement-removed, human required.
3. **Abstention:** PR 110 — two conflicting approved docs → UNKNOWN.
   "It refuses to bluff."
4. **Onboarding, live:** `/onboard` on a real repo — scan finds their
   docs, drafts the contract with provenance quotes, approve, first-light
   sweep verdicts appear per commit.
5. **The ledger:** `/intent/<workspace>` — scrub time, show a digestion
   changing intent state, the ⟡ contract-revision marker, the inbox.
6. **The receipts:** LangSmith experiments (8×99/99), the dogfood catch on
   our own repo.

## 9. What we deliberately do NOT do (say these unprompted — it builds trust)

No repo-wide understanding or vector indexing. No auto-generated intent
from code. No merge blocking. No replacement for code review. No
chain-of-thought/session ingestion (yet — it's the roadmap bridge to the
parent understanding engine). No graph database. The narrowness is the
design: bounded context, auditable verdicts, human-owned intent.
