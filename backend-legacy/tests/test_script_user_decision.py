from types import SimpleNamespace

from app.api.endpoints import user_approved_script


def test_user_approval_requires_explicit_risk_acknowledgement():
    approved = SimpleNamespace(
        review_status="USER_APPROVED",
        review_json={"user_decision": {"decision": "approve_current", "risk_acknowledged": True}},
    )
    not_acknowledged = SimpleNamespace(
        review_status="USER_APPROVED",
        review_json={"user_decision": {"decision": "approve_current", "risk_acknowledged": False}},
    )

    assert user_approved_script(approved) is True
    assert user_approved_script(not_acknowledged) is False
