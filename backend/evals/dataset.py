"""Create/update the LangSmith dataset `alignment-mvp-e2e` from evals/cases.py.

    python3 evals/dataset.py            # upload to LangSmith (needs LANGSMITH_API_KEY)
    python3 evals/dataset.py --print    # just print the examples JSON
"""

from __future__ import annotations

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from dotenv import load_dotenv

from evals.cases import CASES

DATASET_NAME = "alignment-mvp-e2e"


def examples() -> list[dict]:
    rows = []
    for case in CASES:
        rows.append(
            {
                "inputs": {
                    "workspace": case.workspace,
                    "pr_number": case.pr_number,
                    "case": case.name,
                },
                "outputs": case.model_dump(
                    exclude={"name", "workspace", "pr_number", "description"}
                ),
                "metadata": {"description": case.description},
            }
        )
    return rows


def upload() -> None:
    from langsmith import Client

    client = Client()
    if not client.has_dataset(dataset_name=DATASET_NAME):
        client.create_dataset(
            DATASET_NAME,
            description=(
                "End-to-end product-to-code alignment cases over the "
                "refund-agent fixture workspace. Inputs point at fixture PRs; "
                "outputs pin expected intermediate + final results."
            ),
        )
    existing = {
        e.inputs.get("case"): e for e in client.list_examples(dataset_name=DATASET_NAME)
    }
    created = updated = 0
    for row in examples():
        case_name = row["inputs"]["case"]
        if case_name in existing:
            client.update_example(
                example_id=existing[case_name].id,
                inputs=row["inputs"],
                outputs=row["outputs"],
                metadata=row["metadata"],
            )
            updated += 1
        else:
            client.create_example(
                dataset_name=DATASET_NAME,
                inputs=row["inputs"],
                outputs=row["outputs"],
                metadata=row["metadata"],
            )
            created += 1
    print(f"dataset '{DATASET_NAME}': {created} created, {updated} updated")


if __name__ == "__main__":
    load_dotenv(pathlib.Path(__file__).parent.parent.parent / ".env")
    if "--print" in sys.argv:
        print(json.dumps(examples(), indent=2))
    else:
        upload()
