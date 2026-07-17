import pathlib

import pytest

from quire_align.adapters.fixture import FixtureWorkspace

FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"


@pytest.fixture
def refund_workspace() -> FixtureWorkspace:
    return FixtureWorkspace(FIXTURES / "refund-agent")
