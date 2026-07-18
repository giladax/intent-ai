"""The entity graph — PRD v1.0 rules enforced as code, tested as code.

Each test names the rule it holds. The graph state is always a fold over
approved diffs; these tests never touch state directly.
"""

import pathlib

import pytest

from quire_align.entity_graph import (
    AddAlias,
    Attach,
    CreateEntity,
    EvidenceQuote,
    GraphDiff,
    GraphIntegrityError,
    PromiseFate,
    Relate,
    Supersede,
    append_proposals,
    compute_shape_key,
    decide,
    graph_state,
    load_diffs,
    open_proposals,
    resolve_entity,
    slug_entity_id,
    stakes_label,
)

T0 = "2026-07-18T10:00:00+00:00"
T1 = "2026-07-18T11:00:00+00:00"
T2 = "2026-07-18T12:00:00+00:00"


def proposal(question="Create Payments?", operations=None, evidence=None) -> GraphDiff:
    return GraphDiff(
        diff_id="",
        question=question,
        evidence=evidence
        or [EvidenceQuote(quote="refunds require approval", source="OB-1")],
        operations=operations
        or [
            CreateEntity(entity_id="ent-payments", name="Payments"),
            Attach(entity_id="ent-payments", kind="promise", ref="OB-1"),
        ],
    )


@pytest.fixture
def ws(tmp_path) -> pathlib.Path:
    (tmp_path / "workflow.yaml").write_text(
        "repositories:\n  - provider: fixture\n"
    )
    return tmp_path


def approve(ws, diff_id, at=T1, by="gilad", operations=None):
    return decide(ws, diff_id, "approved", by=by, now=at, operations=operations)


# -- rule 5: one mutation path --------------------------------------------


def test_open_proposals_never_touch_the_map(ws):
    append_proposals(ws, [proposal()], T0)
    assert graph_state(load_diffs(ws))["entities"] == {}


def test_only_approval_mutates(ws):
    report = append_proposals(ws, [proposal()], T0)
    approve(ws, report["added"][0])
    state = graph_state(load_diffs(ws))
    entity = state["entities"]["ent-payments"]
    assert entity["name"] == "Payments"
    assert entity["holdings"] == [
        {"kind": "promise", "ref": "OB-1", "note": "", "via": "GD-1"}
    ]
    assert entity["created_via"] == "GD-1"


def test_rejected_proposal_mutates_nothing(ws):
    report = append_proposals(ws, [proposal()], T0)
    decide(ws, report["added"][0], "rejected", by="gilad", now=T1,
           reason_code="not_one_thing")
    assert graph_state(load_diffs(ws))["entities"] == {}


def test_decisions_are_final(ws):
    report = append_proposals(ws, [proposal()], T0)
    approve(ws, report["added"][0])
    with pytest.raises(GraphIntegrityError, match="already approved"):
        approve(ws, report["added"][0], at=T2)


# -- rule 6: structured rejection + shape suppression ---------------------


def test_rejection_requires_structured_reason(ws):
    report = append_proposals(ws, [proposal()], T0)
    with pytest.raises(GraphIntegrityError, match="structured reason"):
        decide(ws, report["added"][0], "rejected", by="gilad", now=T1)


def test_other_rejection_requires_a_sentence(ws):
    report = append_proposals(ws, [proposal()], T0)
    with pytest.raises(GraphIntegrityError, match="teaches the system"):
        decide(ws, report["added"][0], "rejected", by="gilad", now=T1,
               reason_code="other")


def test_rejected_shape_never_returns(ws):
    report = append_proposals(ws, [proposal()], T0)
    decide(ws, report["added"][0], "rejected", by="gilad", now=T1,
           reason_code="not_one_thing")
    again = append_proposals(ws, [proposal()], T2)
    assert again["added"] == []
    assert again["skipped_rejected_shape"] == ["Create Payments?"]
    # a different shape (new name) is a new question — allowed
    renamed = proposal(operations=[
        CreateEntity(entity_id="ent-payments-core", name="Payments Core"),
        Attach(entity_id="ent-payments-core", kind="promise", ref="OB-1"),
    ])
    assert append_proposals(ws, [renamed], T2)["added"] == ["GD-2"]


def test_duplicate_shape_not_reproposed_while_open(ws):
    append_proposals(ws, [proposal()], T0)
    again = append_proposals(ws, [proposal()], T1)
    assert again["added"] == []
    assert again["skipped_duplicate"] == ["Create Payments?"]


# -- rule 7: edited approvals are human-amended ---------------------------


def test_edited_approval_records_amended_and_keeps_original(ws):
    report = append_proposals(ws, [proposal()], T0)
    edited = [
        {"op": "create_entity", "entity_id": "ent-payments", "name": "Payments Risk"},
        {"op": "attach", "entity_id": "ent-payments", "kind": "promise", "ref": "OB-1"},
    ]
    decided = approve(ws, report["added"][0], operations=edited)
    assert decided.decision.amended is True
    assert decided.operations[0].name == "Payments"  # original untouched
    state = graph_state(load_diffs(ws))
    assert state["entities"]["ent-payments"]["name"] == "Payments Risk"


def test_unedited_operations_are_not_amended(ws):
    report = append_proposals(ws, [proposal()], T0)
    same = [op.model_dump() for op in proposal().operations]
    decided = approve(ws, report["added"][0], operations=same)
    assert decided.decision.amended is False


# -- rule 8: blast radius orders the inbox, label = position --------------


def test_stakes_order_and_label_agree(ws):
    low = proposal("Attach a doc?", [
        CreateEntity(entity_id="ent-a", name="A"),
    ])
    high = proposal("Retire Checkout?", [
        CreateEntity(entity_id="ent-b", name="B"),
        Supersede(entity_id="ent-x", successor_id="ent-b"),
    ])
    append_proposals(ws, [low, high], T0)
    ordered = open_proposals(load_diffs(ws))
    assert [d.question for d in ordered] == ["Retire Checkout?", "Attach a doc?"]
    labels = [stakes_label(d.stakes) for d in ordered]
    assert labels == ["high", "low"]
    assert [d.stakes for d in ordered] == sorted(
        (d.stakes for d in ordered), reverse=True
    )


def test_open_cap_is_five(ws):
    proposals = [
        proposal(f"Create {name}?", [CreateEntity(entity_id=f"ent-{name.lower()}", name=name)])
        for name in ["A", "B", "C", "D", "E", "F", "G"]
    ]
    report = append_proposals(ws, proposals, T0)
    assert len(report["added"]) == 5
    assert len(report["skipped_cap"]) == 2
    assert report["open"] == 5


# -- rule 10: supersession freezes, fully legibly -------------------------


@pytest.fixture
def two_entities(ws):
    report = append_proposals(ws, [
        proposal("Create Checkout?", [
            CreateEntity(entity_id="ent-checkout", name="Checkout"),
            Attach(entity_id="ent-checkout", kind="promise", ref="OB-1"),
            Attach(entity_id="ent-checkout", kind="promise", ref="OB-2"),
            Attach(entity_id="ent-checkout", kind="check", ref="check-148"),
        ]),
        proposal("Create Payments?", [
            CreateEntity(entity_id="ent-payments", name="Payments"),
        ]),
    ], T0)
    for diff_id in report["added"]:
        approve(ws, diff_id)
    return ws


def test_supersede_without_full_promise_fates_fails_loudly(two_entities):
    ws = two_entities
    report = append_proposals(ws, [
        proposal("Retire Checkout?", [
            Supersede(entity_id="ent-checkout", successor_id="ent-payments",
                      promise_fates=[PromiseFate(ref="OB-1", fate="carried")]),
        ]),
    ], T1)
    with pytest.raises(GraphIntegrityError, match="rule 10.*OB-2"):
        approve(ws, report["added"][0], at=T2)
    # the failed approval mutated nothing — the proposal is still open
    assert load_diffs(ws)[-1].status == "open"
    assert graph_state(load_diffs(ws))["entities"]["ent-checkout"]["status"] == "active"


def test_supersede_enumerating_every_fate_freezes_and_forwards(two_entities):
    ws = two_entities
    report = append_proposals(ws, [
        proposal("Retire Checkout?", [
            Supersede(entity_id="ent-checkout", successor_id="ent-payments",
                      promise_fates=[
                          PromiseFate(ref="OB-1", fate="carried"),
                          PromiseFate(ref="OB-2", fate="retired",
                                      note="policy withdrawn in Q2"),
                      ]),
        ]),
    ], T1)
    approve(ws, report["added"][0], at=T2, by="dana")
    state = graph_state(load_diffs(ws))
    checkout = state["entities"]["ent-checkout"]
    payments = state["entities"]["ent-payments"]
    assert checkout["status"] == "superseded"
    assert checkout["superseded_by"] == "ent-payments"
    assert checkout["superseded_by_user"] == "dana"
    assert {f["ref"]: f["fate"] for f in checkout["promise_fates"]} == {
        "OB-1": "carried", "OB-2": "retired",
    }
    # carried promise lands on the successor with lineage; retired does not
    successor_promises = [h for h in payments["holdings"] if h["kind"] == "promise"]
    assert [h["ref"] for h in successor_promises] == ["OB-1"]
    assert "carried from Checkout" in successor_promises[0]["note"]
    # the frozen record keeps everything it ever held
    assert {h["ref"] for h in checkout["holdings"]} == {"OB-1", "OB-2", "check-148"}


def test_frozen_entity_refuses_new_holdings(two_entities):
    ws = two_entities
    report = append_proposals(ws, [
        proposal("Retire Checkout?", [
            Supersede(entity_id="ent-checkout", successor_id="ent-payments",
                      promise_fates=[
                          PromiseFate(ref="OB-1", fate="carried"),
                          PromiseFate(ref="OB-2", fate="retired"),
                      ]),
        ]),
        proposal("Attach to Checkout?", [
            Attach(entity_id="ent-checkout", kind="doc", ref="spec-v3"),
        ]),
    ], T1)
    approve(ws, report["added"][0], at=T1)
    with pytest.raises(GraphIntegrityError, match="frozen"):
        approve(ws, report["added"][1], at=T2)


# -- rule 9: retired names forward ----------------------------------------


def test_retired_name_forwards_with_receipt(two_entities):
    ws = two_entities
    report = append_proposals(ws, [
        proposal("Retire Checkout?", [
            AddAlias(entity_id="ent-checkout", terms=["cart"]),
            Supersede(entity_id="ent-checkout", successor_id="ent-payments",
                      promise_fates=[
                          PromiseFate(ref="OB-1", fate="carried"),
                          PromiseFate(ref="OB-2", fate="retired"),
                      ]),
        ]),
    ], T1)
    approve(ws, report["added"][0], at=T2, by="dana")
    state = graph_state(load_diffs(ws))
    for term in ("checkout", "CART"):
        hit = resolve_entity(state, term)
        assert hit["entity"]["entity_id"] == "ent-payments"
        assert hit["forwarded_from"]["name"] == "Checkout"
        assert hit["forwarded_from"]["superseded_by_user"] == "dana"
        assert hit["forwarded_from"]["via"] == "GD-3"
    direct = resolve_entity(state, "payments")
    assert direct["forwarded_from"] is None
    assert resolve_entity(state, "nonsense") is None


# -- integrity of the fold ------------------------------------------------


def test_relate_and_alias_fold(ws):
    report = append_proposals(ws, [
        proposal("Create both?", [
            CreateEntity(entity_id="ent-payments", name="Payments"),
            CreateEntity(entity_id="ent-risk", name="Payments Risk"),
            AddAlias(entity_id="ent-risk", terms=["fraud", "risk pod"]),
            Relate(entity_id="ent-risk", relation="part_of", other_id="ent-payments"),
        ]),
    ], T0)
    approve(ws, report["added"][0])
    state = graph_state(load_diffs(ws))
    risk = state["entities"]["ent-risk"]
    assert risk["aliases"] == ["fraud", "risk pod"]
    assert risk["relations"] == [{"relation": "part_of", "other_id": "ent-payments"}]


def test_approving_against_unknown_entity_fails(ws):
    report = append_proposals(ws, [
        proposal("Attach somewhere?", [
            Attach(entity_id="ent-ghost", kind="doc", ref="x"),
        ]),
    ], T0)
    with pytest.raises(GraphIntegrityError, match="unknown entity"):
        approve(ws, report["added"][0])


def test_slug_minting_uniquifies():
    assert slug_entity_id("Payments Risk", set()) == "ent-payments-risk"
    assert slug_entity_id("Payments Risk", {"ent-payments-risk"}) == "ent-payments-risk-2"


# -- regressions from the 2026-07-19 engineering review -------------------


def test_amended_detected_for_identity_sentence_edit(ws):
    """Rule 7 by VALUE: the shape key ignores meaning-bearing fields, so
    amendment detection must not use it."""
    report = append_proposals(ws, [proposal()], T0)
    edited = [op.model_dump() for op in proposal().operations]
    edited[0]["identity_sentence"] = "A completely different meaning."
    decided = approve(ws, report["added"][0], operations=edited)
    assert decided.decision.amended is True


def test_amended_detected_for_promise_fate_flip(two_entities):
    """Flipping carried→retired at approval drops a promise from the
    successor — that MUST be recorded human-amended."""
    ws = two_entities
    report = append_proposals(ws, [
        proposal("Retire Checkout?", [
            Supersede(entity_id="ent-checkout", successor_id="ent-payments",
                      promise_fates=[
                          PromiseFate(ref="OB-1", fate="carried"),
                          PromiseFate(ref="OB-2", fate="retired"),
                      ]),
        ]),
    ], T1)
    edited = [op.model_dump() for op in load_diffs(ws)[-1].operations]
    edited[0]["promise_fates"][0]["fate"] = "retired"
    decided = approve(ws, report["added"][0], at=T2, operations=edited)
    assert decided.decision.amended is True
    payments = graph_state(load_diffs(ws))["entities"]["ent-payments"]
    assert [h for h in payments["holdings"] if h["kind"] == "promise"] == []


def test_unknown_action_fails_loudly(ws):
    report = append_proposals(ws, [proposal()], T0)
    with pytest.raises(GraphIntegrityError, match="unknown action"):
        decide(ws, report["added"][0], "approv", by="gilad", now=T1)
    assert graph_state(load_diffs(ws))["entities"] == {}


def test_fold_orders_by_instant_not_string(ws):
    """A non-UTC offset that lexically sorts after a later UTC instant
    must still fold first — else the log becomes unreadable."""
    report = append_proposals(ws, [
        proposal("Create?", [CreateEntity(entity_id="ent-e1", name="E1")]),
        proposal("Attach?", [Attach(entity_id="ent-e1", kind="doc", ref="spec")]),
    ], T0)
    # create decided at 12:00+03:00 == 09:00Z; attach at 10:00Z (later)
    approve(ws, report["added"][0], at="2026-07-18T12:00:00+03:00")
    approve(ws, report["added"][1], at="2026-07-18T10:00:00+00:00")
    state = graph_state(load_diffs(ws))
    assert [h["ref"] for h in state["entities"]["ent-e1"]["holdings"]] == ["spec"]


def test_multi_hop_forwarding_lands_on_live_entity(ws):
    report = append_proposals(ws, [
        proposal("Create all?", [
            CreateEntity(entity_id="ent-a", name="A"),
            CreateEntity(entity_id="ent-b", name="B"),
            CreateEntity(entity_id="ent-c", name="C"),
        ]),
        proposal("A→B?", [Supersede(entity_id="ent-a", successor_id="ent-b")]),
        proposal("B→C?", [Supersede(entity_id="ent-b", successor_id="ent-c")]),
    ], T0)
    approve(ws, report["added"][0], at=T0)
    approve(ws, report["added"][1], at=T1)
    approve(ws, report["added"][2], at=T2)
    hit = resolve_entity(graph_state(load_diffs(ws)), "a")
    assert hit["entity"]["entity_id"] == "ent-c"
    assert hit["forwarded_from"]["name"] == "A"


def test_rejected_shape_survives_whitespace_and_punctuation(ws):
    report = append_proposals(ws, [proposal()], T0)
    decide(ws, report["added"][0], "rejected", by="gilad", now=T1,
           reason_code="not_one_thing")
    for variant in ("Payments ", "Payments.", "PAYMENTS", "payments-"):
        again = append_proposals(ws, [proposal(operations=[
            CreateEntity(entity_id="ent-p2", name=variant),
            Attach(entity_id="ent-p2", kind="promise", ref="OB-1"),
        ])], T2)
        assert again["added"] == [], f"'{variant}' evaded shape suppression"


def test_supersede_naming_unheld_promises_fails(two_entities):
    ws = two_entities
    report = append_proposals(ws, [
        proposal("Retire Checkout?", [
            Supersede(entity_id="ent-checkout", successor_id="ent-payments",
                      promise_fates=[
                          PromiseFate(ref="OB-1", fate="carried"),
                          PromiseFate(ref="OB-2", fate="retired"),
                          PromiseFate(ref="OB-999", fate="retired"),
                      ]),
        ]),
    ], T1)
    with pytest.raises(GraphIntegrityError, match="does not hold.*OB-999"):
        approve(ws, report["added"][0], at=T2)


def test_medium_stakes_band():
    ops = [CreateEntity(entity_id="ent-a", name="A"),
           Relate(entity_id="ent-a", relation="part_of", other_id="ent-b")]
    from quire_align.entity_graph import compute_stakes

    assert stakes_label(compute_stakes(ops)) == "medium"


def test_failed_approval_leaves_no_decision_on_disk(two_entities):
    ws = two_entities
    report = append_proposals(ws, [
        proposal("Retire Checkout?", [
            Supersede(entity_id="ent-checkout", successor_id="ent-payments",
                      promise_fates=[PromiseFate(ref="OB-1", fate="carried")]),
        ]),
    ], T1)
    with pytest.raises(GraphIntegrityError):
        approve(ws, report["added"][0], at=T2)
    on_disk = load_diffs(ws)[-1]
    assert on_disk.status == "open" and on_disk.decision is None


def test_shape_key_ignores_operation_order():
    ops1 = [CreateEntity(entity_id="e", name="N"),
            Attach(entity_id="e", kind="promise", ref="OB-1")]
    ops2 = list(reversed(ops1))
    assert compute_shape_key(ops1) == compute_shape_key(ops2)
