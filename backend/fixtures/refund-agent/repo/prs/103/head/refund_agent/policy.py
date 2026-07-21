"""Refund decision policy for the refund agent."""

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

    def evaluate(self, request: RefundRequest) -> RefundDecision:
        if request.risk == "high":
            if request.amount <= self.PREMIUM_MAX_AUTO_REFUND:
                return RefundDecision(
                    approved=True,
                    requires_human_approval=False,
                    reason="auto-approved: low-value high-risk fast path",
                )
            return RefundDecision(
                approved=False,
                requires_human_approval=True,
                reason="high-risk request above limit requires human approval",
            )
        limit = (
            self.PREMIUM_MAX_AUTO_REFUND
            if request.tier == "premium"
            else self.STANDARD_MAX_AUTO_REFUND
        )
        if request.amount <= limit:
            return RefundDecision(
                approved=True,
                requires_human_approval=False,
                reason=f"auto-approved: within {request.tier} limit of ${limit:.0f}",
            )
        return RefundDecision(
            approved=False,
            requires_human_approval=True,
            reason=f"amount exceeds {request.tier} auto-refund limit of ${limit:.0f}",
        )
