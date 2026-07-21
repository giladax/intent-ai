import pytest

from refund_agent.guard import GuardRejection, RefundToolGuard
from refund_agent.policy import RefundDecision, RefundRequest


def approved_decision():
    return RefundDecision(approved=True, requires_human_approval=False, reason="ok")


def test_guard_blocks_above_ceiling():
    guard = RefundToolGuard()
    request = RefundRequest(customer_id="c1", tier="premium", risk="low", amount=51.0)
    with pytest.raises(GuardRejection):
        guard.check(request, approved_decision())


def test_guard_blocks_unapproved_decisions():
    guard = RefundToolGuard()
    request = RefundRequest(customer_id="c1", tier="premium", risk="high", amount=10.0)
    decision = RefundDecision(approved=False, requires_human_approval=True, reason="high risk")
    with pytest.raises(GuardRejection):
        guard.check(request, decision)


def test_guard_allows_within_ceiling():
    guard = RefundToolGuard()
    request = RefundRequest(customer_id="c1", tier="premium", risk="low", amount=50.0)
    guard.check(request, approved_decision())
