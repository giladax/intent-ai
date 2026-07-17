import re

import pytest
from fastapi.testclient import TestClient
from typer.testing import CliRunner

from quire_align.api import create_app
from quire_align.cli import app as cli_app
from quire_align.store import Store

runner = CliRunner()


@pytest.fixture
def db_url(tmp_path):
    return f"sqlite:///{tmp_path}/cli.db"


def test_cli_analyze_offline_and_show_and_review(db_url):
    result = runner.invoke(
        cli_app, ["analyze", "refund-agent", "101", "--offline", "--db", db_url]
    )
    assert result.exit_code == 0, result.output
    assert "🟡 Partial" in result.output
    match = re.search(r"Analysis id: (\w+)", result.output)
    analysis_id = match.group(1)

    result = runner.invoke(cli_app, ["show", analysis_id, "--db", db_url])
    assert result.exit_code == 0
    assert "Human review required" in result.output

    result = runner.invoke(
        cli_app,
        ["review", analysis_id, "approved", "--reviewer", "gilad", "--db", db_url],
    )
    assert result.exit_code == 0
    assert "review=approved" in result.output

    result = runner.invoke(cli_app, ["list", "--db", db_url])
    assert "company/refund-agent#101" in result.output


def test_cli_unknown_workspace_fails():
    result = runner.invoke(cli_app, ["analyze", "no-such-workspace", "1", "--offline"])
    assert result.exit_code != 0


def test_api_analyze_get_review(db_url):
    client = TestClient(create_app(store=Store(url=db_url)))

    response = client.post(
        "/analyses",
        json={"workspace": "refund-agent", "pr_number": 101, "offline": True},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["classification"] == "PARTIAL"
    assert body["human_review_required"] is True
    analysis_id = body["analysis_id"]

    assert client.get(f"/analyses/{analysis_id}").status_code == 200
    assert "Partial" in client.get(f"/analyses/{analysis_id}/comment").json()["comment_markdown"]

    response = client.post(
        f"/analyses/{analysis_id}/review",
        json={"state": "approved", "reviewer": "gilad", "note": "follow-up guard PR"},
    )
    assert response.status_code == 200
    assert response.json()["review_state"] == "approved"

    listed = client.get("/analyses", params={"pr_number": 101}).json()
    assert len(listed) == 1

    assert client.get("/analyses/doesnotexist").status_code == 404
