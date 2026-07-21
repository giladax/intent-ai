"""Run the alignment eval against the LangSmith dataset.

    python3 evals/run_eval.py                     # offline (canned LLM) — pipeline harness check
    python3 evals/run_eval.py --live              # real LLM inference (EDD baseline)
    python3 evals/run_eval.py --variant exhaustive-v1
    python3 evals/run_eval.py --judge             # add the (secondary) explanation-quality judge

Offline runs exercise everything around the model deterministically; live
runs measure actual inference quality against the same expectations.
Compare variants (topology/config) by experiment prefix — EDD: baseline
first, inspect failures, then change code.
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from dotenv import load_dotenv

from evals.dataset import DATASET_NAME
from evals.evaluators import DETERMINISTIC_EVALUATORS, explanation_quality_judge
from evals.target import run_target


def main() -> None:
    load_dotenv(pathlib.Path(__file__).parent.parent.parent / ".env")
    from langsmith import evaluate

    live = "--live" in sys.argv
    variant = "linear-v1"
    if "--variant" in sys.argv:
        variant = sys.argv[sys.argv.index("--variant") + 1]
    evaluators = list(DETERMINISTIC_EVALUATORS)
    if "--judge" in sys.argv:
        evaluators.append(explanation_quality_judge)

    def target(inputs: dict) -> dict:
        return run_target({**inputs, "offline": not live, "variant": variant})

    mode = "live" if live else "offline"
    results = evaluate(
        target,
        data=DATASET_NAME,
        evaluators=evaluators,
        experiment_prefix=f"alignment-{variant}-{mode}",
        metadata={"variant": variant, "mode": mode},
    )
    print(results)


if __name__ == "__main__":
    main()
