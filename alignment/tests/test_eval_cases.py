"""All 10 eval cases, run end-to-end offline through the same target and
deterministic evaluators the LangSmith experiment uses.

This is the regression harness: a reviewed production mistake becomes a new
fixture PR + case entry, and lands here automatically.
"""

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from evals.cases import CASES
from evals.evaluators import DETERMINISTIC_EVALUATORS
from evals.target import run_target


class _Run:
    def __init__(self, outputs):
        self.outputs = outputs


class _Example:
    def __init__(self, outputs):
        self.outputs = outputs


@pytest.mark.parametrize("case", CASES, ids=[c.name for c in CASES])
def test_case_passes_all_deterministic_evaluators(case):
    outputs = run_target(
        {"workspace": case.workspace, "pr_number": case.pr_number, "offline": True}
    )
    run, example = _Run(outputs), _Example(case.model_dump())
    failures = []
    for evaluator in DETERMINISTIC_EVALUATORS:
        result = evaluator(run, example)
        if result["score"] != 1:
            failures.append(f"{evaluator.__name__}: {result['comment']}")
    assert not failures, f"{case.name} → {outputs['classification']}\n" + "\n".join(failures)
