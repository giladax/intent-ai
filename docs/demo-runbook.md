# SwiftRefunds Demo Runbook

**Product:** Quire
**Demo repo:** giladax/swiftrefunds (publish commands below)
**Duration:** ~12 minutes, six beats

---

## Pre-flight checklist (before you sit down)

- [ ] Quire backend running: `cd ~/dev/intent-ai/backend && python3 -m quire.cli` (confirm no startup errors)
- [ ] Telegram bot registered and connected (quire channels configured)
- [ ] Feed pre-warmed: `PRODUCT.md` already scanned against the onboarded swiftrefunds workspace (saves ~30 seconds on-stage)
- [ ] Both PR branches pushed and PRs open on GitHub (run publish commands below)
- [ ] The break-session JSONL uploaded via `quire sessions upload` (see Beat 4)
- [ ] Screen at 1440p or higher; font size readable from the back row

---

## Publish commands (founder runs these before the demo)

```bash
# Create the repo and push main
cd ~/dev/swiftrefunds
gh repo create giladax/swiftrefunds --public --source=. --push

# Push both PR branches
git push origin feature/denial-reasons-detail
git push origin feature/premium-limit-increase

# Open the keep-PR
gh pr create \
  --title "feat: enrich denial messages with rule label and code" \
  --body "Adds a human-readable rule label and machine code to every denial response. Serves the product promise that a denied customer is always told which specific rule denied them (P6 in PRODUCT.md).

Changes:
- \`swiftrefunds/decisions.py\`: denial_message() now includes the rule label (e.g. 'Unrecognized account tier') and the rule code (e.g. UNKNOWN_TIER)
- \`tests/test_decisions.py\`: tests updated to assert on the new label and code format

All 36 tests green." \
  --base main \
  --head feature/denial-reasons-detail

# Open the break-PR
gh pr create \
  --title "feat: raise premium auto-approval limit to \$250" \
  --body "Premium customers were churning at the \$100 cap. CS reported 23 escalations last week from customers surprised their refund went to manual review.

Changes:
- \`swiftrefunds/policy.py\`: TIER_PREMIUM limit raised from \$100 to \$250
- \`tests/test_policy.py\`: assertion updated to match new limit
- \`tests/test_guard.py\`: over-limit boundary test updated to \$250.01

All 34 tests green." \
  --base main \
  --head feature/premium-limit-increase
```

---

## Beat 1 — Open the repo (1 min)

**Click:** Navigate to `github.com/giladax/swiftrefunds`

**Say:**
"This is SwiftRefunds — a small refund-decision service. Nothing exotic: standard and premium tiers, risk scoring, auto-approval below limits, human review above. The interesting part is PRODUCT.md."

**Click:** Open `PRODUCT.md`

**Say:**
"Eight behavioral promises. Written as product truth, not code comments. P2 says premium customers get automatic refunds up to a hundred dollars. P3 says anything above the limit needs a named human approver. P4 says high-risk accounts always require review regardless of amount. These are the contract."

---

## Beat 2 — Onboard the repo (2 min)

**Command:**
```bash
python3 -m quire.cli onboard giladax/swiftrefunds
```

**Say:**
"Quire scans the repo, finds PRODUCT.md as the top intent source — it outscored the README by 57% on promise-word density — and drafts it into obligation cards with verbatim provenance quotes. Nine cards from eight promises; one promise split into two atomics. No human had to classify anything."

**Show:** The drafted obligation cards on-screen (the Quire UI or CLI output)

**Point to OB-DRAFT-2 / OB-DRAFT-4:**
"Notice OB-4: 'premium accounts may be auto-approved up to a hundred dollars.' That's the promise the code is judged against. That number came directly from the doc — verbatim."

---

## Beat 3 — Review the keep-PR (2 min)

**Click:** Open the PR `feature/denial-reasons-detail`

**Say:**
"First PR. Someone enriched the denial messages — when a customer is rejected, they now see which rule name and code triggered it. That serves P6 directly."

**Click:** Run the Quire review (or show the output)

**Say:**
"Quire finds the binding to decisions.py, traces it to P6, confirms the quote is grounded. Green. The PR keeps every promise."

---

## Beat 4 — Upload the break session and review the break-PR (4 min)

**Command:**
```bash
python3 -m quire.cli sessions upload \
  backend/.demo-assets/swiftrefunds-break-session.jsonl \
  --workspace swiftrefunds
```

**Say:**
"Before we look at the second PR, I'm going to feed in the agent session where the author implemented it. This is the AI coding session transcript — what the model thought, what it read, what it decided to defer."

**Click:** Open the PR `feature/premium-limit-increase`

**Say:**
"On the surface this looks fine: policy.py raises the premium limit to two-fifty, tests are updated, CI is green."

**Click:** Run the Quire review

**Say:**
"Quire disagrees. It sees that policy.py says two-fifty but guard.py still enforces a hard block above one hundred. The session transcript is even more interesting — the author *noticed* the guard, wrote in the thinking block 'guard update tracked separately,' and then didn't do it. Quire surfaces both: the code gap and the author's own deferred note."

**Point to OB-DRAFT-2 on screen:**
"OB-2: 'requests exceeding the tier limit must never be auto-approved.' The guard still says one hundred. The policy says two-fifty. Those two things are not the same. This PR breaks a promise."

---

## Beat 5 — Show the alarm (1 min)

**Show:** Telegram message (or CLI alarm output)

**Say:**
"You didn't have to watch for this. Quire sent it before the PR was merged. The alarm names the obligation, quotes the conflicting code paths, and links to the session note where the author flagged it themselves."

---

## Beat 6 — Close (2 min)

**Say:**
"Two PRs. One keeps promises, one breaks one. Standard tooling — CI, linters, code review — passed the second PR. Quire caught it because it knows what the product is supposed to do, not just whether the tests pass.

The session transcript is the extra layer. It's not just 'the code doesn't match the spec.' It's 'the author saw this and called it a follow-up.' That context changes what the reviewer needs to do.

This is Quire: intent-aware review, not diff-aware review."

---

## Recovery notes

- If the draft step is slow: pre-run `python3 -m quire.cli onboard giladax/swiftrefunds` before the audience sits down and cache the output
- If Telegram doesn't fire during the demo: have the CLI alarm output in a terminal tab ready to show
- If the guard discrepancy needs explaining more slowly: open `swiftrefunds/guard.py` and `swiftrefunds/policy.py` side by side — the guard calls `auto_approval_limit()` from policy but the old $100 check is gone, so requests for $101-$250 will now auto-approve through the policy path while the guard's own logic would have blocked them had there been an explicit check there. The bug is that the guard was *already* reading from policy — so raising policy was correct, but there was never an independent guard check at $100 to update. The integration test gap is the real tell.

---

## Spend estimate

- Onboard draft (live LLM): ~$0.10 (9 obligations, Sonnet)
- PR review (two PRs): ~$0.05 each
- Session upload: $0 (deterministic parsing)
- Total demo spend: ~$0.20
