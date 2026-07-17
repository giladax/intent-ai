# CPO review — Quire Align prototype (2026-07-17)

Independent product review (fresh-context agent, adoption-first lens, primed
with the founder's open questions; engine claims verified before review).

**Bottom line:** The analysis engine has real trust architecture — deterministic classification, validated citations, abstention over confidence — and it caught genuine drift on your own repo. That's rare for an MVP. But the product as it stands is a consulting engagement wearing a CLI: onboarding requires a person who understands the PRD *and* the codebase down to the symbol level. That person is a staff engineer, and they're exactly who won't do it.

## 1. Intent sources and the minimum onboarding motion

Look at what onboarding actually required here: six obligations hand-extracted from `docs/prd.md` into `obligations.yaml`, and a `bindings.yaml` that maps them to five control points *by file path and function symbol* (`formatFeatureOrientation`, `resolveFeature`). The README admits it: "Bindings are hand-curated; no assisted onboarding yet." That's the fatal hole. Nobody outside this building will write that YAML, and if they do, it rots on the first refactor — a rename breaks a symbol-level binding silently.

What counts as an intent source: anything a human has *approved* — PRD docs, Jira epics with acceptance criteria, ADRs, Slack decision threads, even a PR description once a PM signs off. The architecture already has the right primitive (provider-asserted authority: approved/draft/stale). The credible motion is: point the tool at 1–3 approved docs and the repo → the system *drafts* obligations and bindings → a PM plus a tech lead spend one 60-minute session approving/editing → first PR analyzed the same day. If first value requires more than one meeting and one week, design partners churn before verdict #1.

## 2. Their taxonomy vs. ours

Their vocabulary, our semantics. "Obligation," "control point," "binding" are fine internal compiler targets — never customer-facing maintenance surfaces. Customers should see *their* epics, components, and doc sections; we infer the contract from those artifacts and re-propose deltas when the artifacts change. The line: **we infer the draft; they approve the contract; they never hand-maintain our model.** Asking a customer to keep `bindings.yaml` current is asking them to maintain a shadow taxonomy — that's a dead end. The moment their Jira and our YAML disagree, they'll trust Jira and delete us.

## 3. Inference vs. imposition

This tension is already resolved in your own parent PRD — "human-gated mutations, never silently" — you just haven't applied it to onboarding. Inference proposes; humans gate; and critically, **drift verdicts double as onboarding prompts.** The README's dogfood sweep shows the pattern: PRs 4–5 flagged POSSIBLE_DRIFT purely because feed/infra surfaces "are ungoverned by construction." Productize that reading: every coverage-gap finding becomes a one-click "register this spec / extend the contract" proposal. The system never tells a team what their product is; it shows them where their approved intent has holes and lets them fill them. That converts the noise problem into the growth loop.

But be honest about the current signal: **3 of 5 real verdicts were POSSIBLE_DRIFT, and only one was a true catch.** In a customer demo on *their* repo, "your tool cried wolf on my dashboard fix" is the demo-killer. Either separate the verdict vocabulary — DRIFT vs. UNGOVERNED SURFACE are different messages with different emotional loads — or gate coverage findings behind a different channel entirely.

## 4. The wedge, and what not to build

**Wedge:** a GitHub PR check enforcing 3–5 *hard rules* on one team's one repo — money, compliance, security invariants, exactly the refund-guard shape of your demo. Hard rules are where "the LLM never decides the final label" is a sales line, not a caveat, and where a single true catch pays for the tool. Founder does the YAML curation forward-deployed for the first two partners; that's acceptable — *asking the customer to do it* is not.

**Do not build yet:** multi-source intent inference, Jira/Slack ingestion, embeddings retrieval, multi-repo, any dashboard UI. All of it is Phase-3 gravity pulling you off the wedge.

**Two table-stakes gaps that would embarrass us in a demo:** (a) the PR comment is "rendered but not posted" — the product literally cannot appear where developers live; that's days of work, do it first; (b) 90/90 passed once, n=1, with a known-flaky boundary case — run the live suite ten times before any live demo.

## The ONE thing

**Assisted contract drafting.** Given an approved doc plus the repo, generate draft `obligations` + `bindings` for human review — the compiler from *their* artifacts to *our* model. Everything else about adoption (onboarding cost, taxonomy fit, the inference-vs-imposition tension, binding rot after refactors) collapses into this one capability. The engine is good enough to sell; the on-ramp is what's unsellable.
