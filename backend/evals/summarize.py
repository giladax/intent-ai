"""Summarize a LangSmith experiment as a case × evaluator matrix.

    python3 evals/summarize.py <experiment-name-or-prefix>

Picks the most recent experiment matching the prefix and prints one row per
case with each evaluator's score, plus comments for every failure.
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from dotenv import load_dotenv

load_dotenv(pathlib.Path(__file__).parent.parent.parent / ".env")

from langsmith import Client

from evals.dataset import DATASET_NAME


def main(prefix: str) -> None:
    client = Client()
    projects = [
        p
        for p in client.list_projects(reference_dataset_name=DATASET_NAME)
        if p.name.startswith(prefix)
    ]
    if not projects:
        print(f"no experiment matching '{prefix}'")
        return
    project = max(projects, key=lambda p: p.start_time or 0)
    print(f"experiment: {project.name}\n")

    runs = list(client.list_runs(project_name=project.name, is_root=True))
    failures: list[str] = []
    scores_total: dict[str, list[int]] = {}
    for run in sorted(runs, key=lambda r: (r.inputs or {}).get("pr_number", 0)):
        case = (run.inputs or {}).get("case", "?")
        feedback = list(client.list_feedback(run_ids=[run.id]))
        row = {}
        for fb in feedback:
            row[fb.key] = int(fb.score or 0)
            scores_total.setdefault(fb.key, []).append(int(fb.score or 0))
            if not fb.score:
                failures.append(f"{case} · {fb.key}: {fb.comment}")
        failed = [k for k, v in row.items() if v == 0]
        status = "PASS" if not failed else f"FAIL({len(failed)}): {', '.join(sorted(failed))}"
        print(f"{case:32} {sum(row.values())}/{len(row)}  {status}")

    print("\nper-evaluator pass rate:")
    for key, values in sorted(scores_total.items()):
        print(f"  {key:28} {sum(values)}/{len(values)}")
    if failures:
        print("\nfailure details:")
        for f in failures:
            print(f"- {f}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "alignment-")
