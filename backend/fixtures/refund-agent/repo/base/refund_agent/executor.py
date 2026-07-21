"""Refund executor: performs the side effect after policy and guard clear it."""

import pathlib
import time

import yaml

from refund_agent.audit import emit_refund_decision
from refund_agent.guard import RefundToolGuard
from refund_agent.policy import RefundPolicy, RefundRequest

CONFIG_PATH = pathlib.Path(__file__).parent / "config" / "policy.yaml"


class PaymentAPI:
    def refund(self, customer_id: str, amount: float) -> str:
        # Placeholder for the real payment integration.
        return f"refund-txn-{customer_id}-{amount:.2f}"


class RefundExecutor:
    def __init__(self) -> None:
        self.policy = RefundPolicy()
        self.guard = RefundToolGuard()
        self.payments = PaymentAPI()
        config = yaml.safe_load(CONFIG_PATH.read_text())
        self.cooldown_hours = float(config.get("auto_refund_cooldown_hours", 24))
        self._last_refund_at: dict[str, float] = {}

    def execute(self, request: RefundRequest) -> str | None:
        decision = self.policy.evaluate(request)
        emit_refund_decision(request, decision)
        if decision.requires_human_approval:
            return None  # escalate to human queue
        last = self._last_refund_at.get(request.customer_id)
        if last is not None and time.time() - last < self.cooldown_hours * 3600:
            return None  # cooldown active: escalate instead of auto-refund
        self.guard.check(request, decision)
        self._last_refund_at[request.customer_id] = time.time()
        return self.payments.refund(request.customer_id, request.amount)
