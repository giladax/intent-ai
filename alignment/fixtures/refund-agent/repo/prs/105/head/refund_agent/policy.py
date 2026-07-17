"""Refund decision policy for the refund agent.

Pure decision logic: no side effects, no I/O. The tool-side guard enforces
the ceiling independently.
"""

from dataclasses import dataclass


@dataclass
class RefundRequest:
    customer_id: str
    tier: str  # "premium" | "standard"
    risk: str  # "low" | "high"
    amount: float
    region: str = "us"


@dataclass
class RefundDecision:
    approved: bool
    requires_human_approval: bool
    reason: str


class RefundPolicy:
    """Decides whether a refund request is auto-approved, denied, or escalated."""

    PREMIUM_MAX_AUTO_REFUND = 50.0
    STANDARD_MAX_AUTO_REFUND = 25.0

    def _tier_limit(self, tier: str) -> float:
        """Auto-refund ceiling for a customer tier."""
        if tier == "premium":
            return self.PREMIUM_MAX_AUTO_REFUND
        return self.STANDARD_MAX_AUTO_REFUND

    def evaluate(self, request: RefundRequest) -> RefundDecision:
        if request.risk == "high":
            return RefundDecision(
                approved=False,
                requires_human_approval=True,
                reason="high-risk requests always require human approval",
            )
        tier_limit = self._tier_limit(request.tier)
        if request.amount <= tier_limit:
            return RefundDecision(
                approved=True,
                requires_human_approval=False,
                reason=f"auto-approved: within {request.tier} limit of ${tier_limit:.0f}",
            )
        return RefundDecision(
            approved=False,
            requires_human_approval=True,
            reason=f"amount exceeds {request.tier} auto-refund limit of ${tier_limit:.0f}",
        )
