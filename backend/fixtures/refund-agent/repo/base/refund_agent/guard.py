"""Tool-side guard: last line of defense before the refund executes.

Enforces the refund ceiling independently of the decision policy, per the
enforcement section of the refund policy PRD.
"""

import pathlib

import yaml

from refund_agent.policy import RefundDecision, RefundRequest

CONFIG_PATH = pathlib.Path(__file__).parent / "config" / "policy.yaml"


class GuardRejection(Exception):
    pass


class RefundToolGuard:
    """Independently blocks over-limit or unapproved refunds at the tool boundary."""

    def __init__(self) -> None:
        config = yaml.safe_load(CONFIG_PATH.read_text())
        self.ceiling = float(config["guard_ceiling"])

    def check(self, request: RefundRequest, decision: RefundDecision) -> None:
        if not decision.approved or decision.requires_human_approval:
            raise GuardRejection("refund not approved for automatic execution")
        if request.amount > self.ceiling:
            raise GuardRejection(
                f"amount ${request.amount:.2f} exceeds guard ceiling ${self.ceiling:.2f}"
            )
