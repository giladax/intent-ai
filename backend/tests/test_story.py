"""The story layer: the clerk narrates, the validator decides what
renders — prose under the same law as evidence."""

import pathlib
import shutil

import pytest
from fastapi.testclient import TestClient

from quire.api import create_app
from quire.entity_graph import (
    Attach,
    CreateEntity,
    GraphDiff,
    append_proposals,
    decide,
)
from quire.story import (
    Citation,
    FakeStoryteller,
    Sentence,
    Story,
    get_story,
    validate_story,
)
from quire.store import Store

FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"
T0 = "2026-07-01T10:00:00+00:00"


@pytest.fixture
def ws(tmp_path) -> pathlib.Path:
    dest = tmp_path / "refund-agent"
    shutil.copytree(FIXTURES / "refund-agent", dest)
    report = append_proposals(dest, [GraphDiff(
        diff_id="", question="Create Refunds?",
        operations=[
            CreateEntity(entity_id="ent-refunds", name="Refunds",
                         identity_sentence="How money goes back."),
            Attach(entity_id="ent-refunds", kind="promise", ref="OB-101"),
        ],
    )], T0)
    decide(dest, report["added"][0], "approved", by="gilad", now=T0)
    return dest


@pytest.fixture
def adapter(ws):
    from quire.adapters.fixture import FixtureWorkspace

    return FixtureWorkspace(ws)


@pytest.fixture
def store(tmp_path):
    return Store(url=f"sqlite:///{tmp_path}/t.db")


UNIVERSE = {
    "check": {"7"},
    "diff": {"GD-1"},
    "promise": {"OB-101"},
    "teach": {"cashback"},
}


def s(text, *cites):
    return Sentence(text=text, cites=list(cites))


def test_validator_is_the_law():
    story = Story(sentences=[
        s("Refunds was signed on July 1.", Citation(kind="diff", ref="GD-1")),
        s("An uncited assertion."),
        s("A ghost citation.", Citation(kind="check", ref="99")),
        s("Broken since check #7.", Citation(kind="check", ref="#7"),
          Citation(kind="promise", ref="OB-101")),
    ])
    kept, dropped = validate_story(story, UNIVERSE)
    assert [x.text for x in kept] == [
        "Refunds was signed on July 1.", "Broken since check #7.",
    ]
    assert dropped == 2


def test_causality_requires_a_recorded_reason():
    invented = s("It broke because the team rushed.",
                 Citation(kind="check", ref="7"))
    licensed = s("Declined because the name was wrong.",
                 Citation(kind="diff", ref="GD-1"))
    sequence = s("Then, after check #7, it held.",
                 Citation(kind="check", ref="7"))
    kept, dropped = validate_story(Story(sentences=[invented, licensed, sequence]), UNIVERSE)
    assert [x.text for x in kept] == [licensed.text, sequence.text]
    assert dropped == 1


def test_story_caches_and_retells_only_on_data_change(ws, adapter, store):
    teller = FakeStoryteller(Story(sentences=[
        s("Refunds was put on the map by gilad.",
          Citation(kind="diff", ref="GD-1"),
          Citation(kind="promise", ref="OB-101")),
    ]))
    first = get_story(ws, adapter, store, "org", teller=teller, now=T0)
    assert first["sentences"][0]["text"].startswith("Refunds was put")
    # cache hit: no teller needed while inputs are unchanged
    cached = get_story(ws, adapter, store, "org", teller=None, now=T0)
    assert cached["input_hash"] == first["input_hash"]
    # a data change staling the cache: without a teller, stale beats hollow
    report = append_proposals(ws, [GraphDiff(
        diff_id="", question="Create Risk?",
        operations=[CreateEntity(entity_id="ent-risk", name="Risk")],
    )], T0)
    decide(ws, report["added"][0], "approved", by="gilad", now=T0)
    stale = get_story(ws, adapter, store, "org", teller=None, now=T0)
    assert stale["input_hash"] == first["input_hash"]  # the old telling
    retold = get_story(ws, adapter, store, "org", teller=teller, now=T0)
    assert retold["input_hash"] != first["input_hash"]


def test_hollow_story_renders_as_none(ws, adapter, store):
    teller = FakeStoryteller(Story(sentences=[
        s("Everything is fine, probably.")  # uncited → dropped
    ]))
    entry = get_story(ws, adapter, store, "org", teller=teller, now=T0)
    assert entry["sentences"] == [] and entry["dropped"] == 1


def test_story_endpoints(ws, store):
    app = create_app(store=store)
    client = TestClient(app)
    # llm=false → cache only; nothing told yet → story null
    r = client.get(f"/api/story/{ws}/org", params={"llm": False})
    assert r.status_code == 200 and r.json()["story"] is None
    assert client.get(
        f"/api/story/{ws}/entity/ent-ghost", params={"llm": False}
    ).status_code == 404
    # seed the cache directly, then the endpoint serves it offline
    from quire.adapters.fixture import FixtureWorkspace
    from quire.story import Story as S

    get_story(ws, FixtureWorkspace(ws), store, "entity",
              teller=FakeStoryteller(S(sentences=[
                  s("Refunds holds one promise.",
                    Citation(kind="promise", ref="OB-101"))])),
              entity_id="ent-refunds", now=T0)
    r = client.get(f"/api/story/{ws}/entity/ent-refunds", params={"llm": False})
    assert r.json()["story"]["sentences"][0]["cites"][0]["ref"] == "OB-101"


def test_citation_normalization_by_shape():
    story = Story(sentences=[
        s("Broken since check #7.", Citation(kind="check", ref="check #7"),
          Citation(kind="promise", ref="OB-101")),
        s("Five wait unsigned.", Citation(kind="promise", ref="GD-1")),
    ])
    kept, dropped = validate_story(story, UNIVERSE)
    assert dropped == 0
    assert kept[0].cites[0].kind == "check" and kept[0].cites[0].ref == "7"
    assert kept[1].cites[0].kind == "diff" and kept[1].cites[0].ref == "GD-1"


def test_faithfulness_judge_gates_content(ws, adapter, store):
    teller = FakeStoryteller(Story(sentences=[
        s("Refunds was signed by gilad.", Citation(kind="diff", ref="GD-1")),
        s("Refunds was signed by a committee of twelve.",
          Citation(kind="diff", ref="GD-1")),
    ]))
    fake_judge = lambda text, facts: "committee" not in text  # noqa: E731
    entry = get_story(ws, adapter, store, "org", teller=teller, now=T0,
                      judge=fake_judge)
    assert [x["text"] for x in entry["sentences"]] == ["Refunds was signed by gilad."]
    assert entry["unfaithful"] == 1
    assert entry["retold_after"]  # the byline knows what changed


def test_story_stales_when_a_promise_statement_changes(ws, adapter, store):
    """The promises are a story input (statements are quoted in health
    facts; the approved count opens the org lede) — the signature key
    must catch a statement change even though neither the diff log nor
    the analyses moved."""
    import yaml

    teller = FakeStoryteller(Story(sentences=[
        s("Refunds was put on the map by gilad.",
          Citation(kind="diff", ref="GD-1"),
          Citation(kind="promise", ref="OB-101")),
    ]))
    first = get_story(ws, adapter, store, "org", teller=teller, now=T0)

    path = ws / "obligations.yaml"
    data = yaml.safe_load(path.read_text())
    data["obligations"][0]["statement"] += " Revised at re-onboard."
    path.write_text(yaml.safe_dump(data, sort_keys=False))

    stale = get_story(ws, adapter, store, "org", teller=None, now=T0)
    assert stale["input_hash"] == first["input_hash"]  # stale beats hollow
    retold = get_story(ws, adapter, store, "org", teller=teller, now=T0)
    assert retold["input_hash"] != first["input_hash"]
