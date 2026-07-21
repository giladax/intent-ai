from refund_agent.policy import RefundPolicy, RefundRequest


def make_request(tier="premium", risk="low", amount=40.0):
    return RefundRequest(customer_id="c1", tier=tier, risk=risk, amount=amount)


def test_premium_low_risk_within_limit_auto_approved():
    decision = RefundPolicy().evaluate(make_request(amount=50.0))
    assert decision.approved


def test_premium_above_limit_escalates():
    decision = RefundPolicy().evaluate(make_request(amount=51.0))
    assert not decision.approved
    assert decision.requires_human_approval


def test_high_risk_always_requires_human_approval():
    decision = RefundPolicy().evaluate(make_request(risk="high", amount=5.0))
    assert not decision.approved
    assert decision.requires_human_approval


def test_standard_limit_is_25():
    assert RefundPolicy().evaluate(make_request(tier="standard", amount=25.0)).approved
    assert not RefundPolicy().evaluate(make_request(tier="standard", amount=26.0)).approved
