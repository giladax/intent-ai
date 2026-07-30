from quire import ANALYZER_VERSION
from quire.models import (
    ArtifactSnapshot,
    ArtifactKind,
    Authority,
    ContractSnapshot,
    Obligation,
    ObligationKind,
    analysis_key,
    sha256_hex,
)


def test_artifact_snapshot_hashes_content():
    snap = ArtifactSnapshot(
        provider="fixture",
        reference="refund-policy-prd",
        kind=ArtifactKind.REQUIREMENT,
        content="Premium refunds up to $100",
        authority=Authority.APPROVED,
    )
    assert snap.content_hash == sha256_hex("Premium refunds up to $100")
    assert len(snap.snapshot_id) == 16


def test_artifact_snapshot_id_stable_for_same_content():
    kwargs = dict(
        provider="fixture",
        reference="r",
        kind=ArtifactKind.REQUIREMENT,
        content="x",
        revision="3",
    )
    assert ArtifactSnapshot(**kwargs).snapshot_id == ArtifactSnapshot(**kwargs).snapshot_id


def test_contract_snapshot_id_order_independent():
    a = ContractSnapshot(workflow_id="w", obligation_pins=["p1", "p2"])
    b = ContractSnapshot(workflow_id="w", obligation_pins=["p2", "p1"])
    assert a.contract_snapshot_id == b.contract_snapshot_id


def test_contract_snapshot_id_changes_with_revision():
    ob1 = Obligation(
        obligation_id="OB-1",
        workflow_id="w",
        statement="max $100",
        kind=ObligationKind.PERMISSION,
        source_reference="prd",
        revision="1",
    )
    ob2 = ob1.model_copy(update={"statement": "max $200", "revision": "2"})
    a = ContractSnapshot(workflow_id="w", obligation_pins=[ob1.pin])
    b = ContractSnapshot(workflow_id="w", obligation_pins=[ob2.pin])
    assert a.contract_snapshot_id != b.contract_snapshot_id


def test_analysis_key_idempotent_and_sensitive():
    k = analysis_key("acme/refund-agent", 101, "headsha", "contract1", ANALYZER_VERSION)
    assert k == analysis_key("acme/refund-agent", 101, "headsha", "contract1", ANALYZER_VERSION)
    assert k != analysis_key("acme/refund-agent", 101, "other", "contract1", ANALYZER_VERSION)
    assert k != analysis_key("acme/refund-agent", 101, "headsha", "contract2", ANALYZER_VERSION)
    assert k != analysis_key("acme/refund-agent", 101, "headsha", "contract1", "9.9.9")
