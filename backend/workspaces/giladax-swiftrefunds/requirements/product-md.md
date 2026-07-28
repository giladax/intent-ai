---
reference: PRODUCT.md
version: onboard-1
status: approved
---

# SwiftRefunds: Product Promises

These are the behavioral guarantees SwiftRefunds makes to customers and operators. Every feature must honor all of them.

---

**P1. Standard customers receive automatic refunds up to $50.**
A standard-tier account whose refund request is $50 or under is approved automatically without any human review, provided the account is not flagged high-risk.

**P2. Premium customers with a low risk score receive automatic refunds up to $100 without human review.**
A premium-tier account whose risk score is below the high-risk threshold and whose request is $100 or under is approved automatically and immediately.

**P3. Every refund above the automatic approval limit requires a named human approver.**
Requests that exceed the tier limit — $50 for standard, $100 for premium — are never auto-approved. They are placed in a pending queue and require an explicit approval from an identified staff member before any funds move.

**P4. High-risk accounts always require human review, regardless of amount.**
An account carrying a high-risk flag is never auto-approved, even if the requested amount would otherwise qualify. All high-risk requests go to the pending queue.

**P5. Every refund decision is logged with its reason.**
Each outcome — approved, denied, or pending — is recorded with a timestamp, the account id, the amount, and the specific reason the decision was reached. This record is permanent and not modified after the fact.

**P6. A denied customer is always told which rule denied them.**
When a refund is denied, the response includes a plain-language explanation identifying the specific policy rule that caused the denial (for example: "amount exceeds the $50 automatic limit for standard accounts" or "account is flagged high-risk").

**P7. Policy limits and risk thresholds are declared in one place.**
The numeric thresholds — tier limits, risk cutoffs — live in a single policy module. No other module hard-codes dollar amounts or risk values; all enforcement reads from the policy module.

**P8. The system never silently swallows an unknown account tier.**
If a refund request arrives with an unrecognized tier, the request is rejected with a clear error rather than defaulting to any approval limit.
