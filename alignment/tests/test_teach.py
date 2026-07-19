"""The teaching loop: misses teach instantly (aliases), corrections take
the inbox path — every gesture lands in the diff log, signed."""

import pathlib

import pytest
from fastapi.testclient import TestClient

from quire_align.api import create_app
from quire_align.entity_graph import (
    Attach,
    CreateEntity,
    Detach,
    GraphDiff,
    GraphIntegrityError,
    append_proposals,
    decide,
    graph_state,
    load_diffs,
    open_proposals,
    resolve_entity,
)
from quire_align.store import Store
from quire_align.teach import correct, teach_alias, teach_create

# well in the past: API endpoints stamp real wall-clock time, and the
# fold orders by instant — fixture decisions must precede live ones
T0 = "2026-07-01T10:00:00+00:00"
T1 = "2026-07-01T11:00:00+00:00"


@pytest.fixture
def ws(tmp_path) -> pathlib.Path:
    # a full fixture copy: the ask endpoint builds the workspace adapter,
    # which needs a real manifest
    import shutil

    fixtures = pathlib.Path(__file__).parent.parent / "fixtures"
    dest = tmp_path / "refund-agent"
    shutil.copytree(fixtures / "refund-agent", dest)
    tmp_path = dest
    report = append_proposals(tmp_path, [GraphDiff(
        diff_id="", question="Create Payments?",
        operations=[
            CreateEntity(entity_id="ent-payments", name="Payments",
                         identity_sentence="How money moves."),
            Attach(entity_id="ent-payments", kind="promise", ref="OB-101"),
        ],
    )], T0)
    decide(tmp_path, report["added"][0], "approved", by="gilad", now=T0)
    return tmp_path


# -- teaching a word: one gesture, full receipt ---------------------------


def test_teach_alias_lands_instantly_signed(ws):
    diff = teach_alias(ws, "  the money  flow ", "ent-payments", "dana", T1)
    assert diff.status == "approved"
    assert diff.proposed_by == "human:dana"
    assert diff.decision.by == "dana"
    state = graph_state(load_diffs(ws))
    hit = resolve_entity(state, "the money flow")
    assert hit["entity"]["entity_id"] == "ent-payments"
    # nothing left waiting — teaching a word is not a chore for later
    assert open_proposals(load_diffs(ws)) == []


def test_teach_alias_unknown_entity(ws):
    with pytest.raises(KeyError):
        teach_alias(ws, "x", "ent-ghost", "dana", T1)


def test_teaching_the_same_word_twice_says_already_learned(ws):
    teach_alias(ws, "checkout", "ent-payments", "dana", T1)
    with pytest.raises(GraphIntegrityError, match="already learned"):
        teach_alias(ws, "checkout", "ent-payments", "sam", T1)


def test_teach_create_opens_a_card_not_an_entity(ws):
    diff = teach_create(ws, "Risk Scoring", "dana", T1, note="How we score risk.")
    assert diff.status == "open"
    assert diff.proposed_by == "human:dana"
    assert diff.evidence[0].source == "taught by dana"
    assert "ent-risk-scoring" in [
        op.entity_id for op in diff.operations if op.op == "create_entity"
    ]
    # the map itself is untouched until the inbox decides
    assert "ent-risk-scoring" not in graph_state(load_diffs(ws))["entities"]


def test_teach_create_refuses_names_already_on_the_map(ws):
    with pytest.raises(GraphIntegrityError, match="already answers"):
        teach_create(ws, "payments", "dana", T1)


def test_same_open_question_not_asked_twice(ws):
    teach_create(ws, "Risk Scoring", "dana", T1)
    with pytest.raises(GraphIntegrityError, match="already open"):
        teach_create(ws, "Risk Scoring", "sam", T1)


# -- corrections: shared meaning changes by review ------------------------


def test_corrections_open_cards(ws):
    rename = correct(ws, "ent-payments", "rename", "dana", T1, name="Money Movement")
    assert rename.status == "open" and rename.operations[0].op == "rename"
    detach = correct(ws, "ent-payments", "detach", "dana", T1,
                     kind="promise", ref="OB-101")
    assert detach.operations[0].op == "detach"
    assert len(open_proposals(load_diffs(ws))) == 2
    # approving the detach actually removes the holding
    decide(ws, detach.diff_id, "approved", by="gilad", now=T1)
    payments = graph_state(load_diffs(ws))["entities"]["ent-payments"]
    assert payments["holdings"] == []
    assert payments["name"] == "Payments"  # rename still awaits its decision


def test_detach_of_nothing_fails_loudly(ws):
    ghost = correct(ws, "ent-payments", "detach", "dana", T1, kind="doc", ref="nope.md")
    with pytest.raises(GraphIntegrityError, match="nothing to detach"):
        decide(ws, ghost.diff_id, "approved", by="gilad", now=T1)


def test_unknown_correction_verb(ws):
    with pytest.raises(GraphIntegrityError, match="unknown correction"):
        correct(ws, "ent-payments", "merge", "dana", T1)


# -- human proposals bypass the machine's leash ---------------------------


def test_human_proposals_bypass_cap_and_suppression(ws):
    fillers = [GraphDiff(diff_id="", question=f"Create {n}?",
                         operations=[CreateEntity(entity_id=f"ent-{n.lower()}", name=n)])
               for n in ["A", "B", "C", "D", "E"]]
    append_proposals(ws, fillers, T0)  # inbox now full
    diff = teach_create(ws, "Risk Scoring", "dana", T1)
    assert diff.status == "open"  # not capped
    rejected = correct(ws, "ent-payments", "rename", "dana", T1, name="Cashflow")
    decide(ws, rejected.diff_id, "rejected", by="gilad", now=T1,
           reason_code="wrong_name")
    again = correct(ws, "ent-payments", "rename", "sam", T1, name="Cashflow")
    assert again.status == "open"  # a human revisiting a rejection is a new decision


# -- the loop over HTTP ---------------------------------------------------


def test_teach_and_ask_over_http(ws, tmp_path):
    app = create_app(store=Store(url=f"sqlite:///{tmp_path}/t.db"))
    client = TestClient(app)

    taught = client.post(f"/api/graph/{ws}/teach", json={
        "term": "checkout", "action": "alias",
        "entity_id": "ent-payments", "by": "dana",
    })
    assert taught.status_code == 200
    assert taught.json()["status"] == "approved"

    answer = client.get(f"/api/ask/{ws}", params={"q": "checkout", "llm": False}).json()
    assert answer["resolution"]["method"] == "entity"
    assert answer["entity"]["name"] == "Payments"

    opened = client.post(f"/api/graph/{ws}/correct", json={
        "entity_id": "ent-payments", "verb": "rename",
        "name": "Money Movement", "by": "dana",
    })
    assert opened.status_code == 200
    listing = client.get(f"/api/graph/{ws}/proposals").json()
    human_cards = [p for p in listing["open"] if p["proposed_by"] == "human:dana"]
    assert len(human_cards) == 1

    missing = client.post(f"/api/graph/{ws}/teach", json={
        "term": "x", "action": "alias", "entity_id": "ent-ghost", "by": "dana",
    })
    assert missing.status_code == 404
    # the detail reads as a sentence, not a repr-quoted KeyError
    assert missing.json()["detail"] == "no entity 'ent-ghost'"


def test_forwarded_name_resolves_in_ask(ws, tmp_path):
    from quire_align.entity_graph import PromiseFate, Supersede

    report = append_proposals(ws, [GraphDiff(
        diff_id="", question="Create Commerce?",
        operations=[CreateEntity(entity_id="ent-commerce", name="Commerce")],
    ), GraphDiff(
        diff_id="", question="Retire Payments?",
        operations=[Supersede(entity_id="ent-payments", successor_id="ent-commerce",
                              promise_fates=[PromiseFate(ref="OB-101", fate="carried")])],
    )], T0)
    for diff_id in report["added"]:
        decide(ws, diff_id, "approved", by="gilad", now=T1)
    app = create_app(store=Store(url=f"sqlite:///{tmp_path}/t.db"))
    client = TestClient(app)
    answer = client.get(f"/api/ask/{ws}", params={"q": "payments", "llm": False}).json()
    assert answer["resolution"]["method"] == "entity-forwarded"
    assert answer["entity"]["name"] == "Commerce"
    assert answer["forwarded_from"]["name"] == "Payments"


# -- the map app: rail rollups, entity focus, the front door --------------


def test_graph_lists_rollups_and_awaiting(ws, tmp_path):
    app = create_app(store=Store(url=f"sqlite:///{tmp_path}/t.db"))
    client = TestClient(app)
    d = client.get(f"/api/graph/{ws}").json()
    payments = next(e for e in d["entities"] if e["name"] == "Payments")
    # OB-1 has no check yet: unexercised, never counted as kept (rule 4)
    assert payments["rollup"]["unexercised"] == 1
    assert payments["rollup"]["kept"] == 0
    assert d["awaiting"] == 0


def test_entity_focus_carries_statements_health_and_pending(ws, tmp_path):
    app = create_app(store=Store(url=f"sqlite:///{tmp_path}/t.db"))
    client = TestClient(app)
    correct(ws, "ent-payments", "rename", "dana", T1, name="Money Movement")
    e = client.get(f"/api/graph/{ws}/entity/ent-payments").json()
    assert e["name"] == "Payments"
    assert e["promises"][0]["statement"].startswith("Premium-tier customers")
    assert e["promises"][0]["state"] == "unexercised"
    assert [p["diff_id"] for p in e["pending"]] == ["GD-2"]
    assert client.get(f"/api/graph/{ws}/entity/ent-ghost").status_code == 404


def test_app_page_serves_with_encoded_workspace(ws, tmp_path):
    app = create_app(store=Store(url=f"sqlite:///{tmp_path}/t.db"))
    client = TestClient(app)
    page = client.get(f"/app/{ws}")
    assert page.status_code == 200
    assert "__WORKSPACE_JSON__" not in page.text
    assert "The map" in page.text
    assert client.get("/app/nope-no-such-ws").status_code == 400
