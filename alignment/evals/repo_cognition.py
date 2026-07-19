"""Repo-cognition evals: does the understanding machinery NOTICE what we
know actually happened in this repo — without being told to look?

Anti-overfit discipline (the standing eval bar, plus blind-probe
precedent): the agent under eval receives the raw document corpus and
the SAME generic mind-sweep prompt it always gets — zero task hints.
The ground truths live only in the judges below. Controls (things that
never happened) catch judges that reward mentioning anything.

    python3 -m evals.repo_cognition            # live sweep + judged

Each case must be able to fail (bar rule 3): the baseline run IS the
point — misses are findings about the machinery, not embarrassments.
"""

from __future__ import annotations

import pathlib
import subprocess
import sys

from quire_align.mind import Mind, MindLLM, validate_mind

REPO = pathlib.Path(__file__).resolve().parents[2]

# What a good understanding system should notice, described ONLY for the
# judge. must_flag=False rows are controls: flagging them is a failure.
GROUND_TRUTHS = [
    {
        "id": "name-drift",
        "must_flag": True,
        "judge": "The project/product has carried multiple different names "
        "over its life (at least three or four distinct product names, one "
        "of them explicitly killed). A node counts only if it identifies "
        "naming multiplicity or product-identity drift as a phenomenon.",
    },
    {
        "id": "overlapping-truth",
        "must_flag": True,
        "judge": "More than one top-level document simultaneously claims to "
        "be the product's source of truth / PRD, with overlapping scope. A "
        "node counts if it identifies competing or overlapping "
        "authoritative product documents.",
    },
    {
        "id": "reversed-doctrine",
        "must_flag": True,
        "judge": "A design doctrine was declared absolutely (no trees / no "
        "graph visualization ever) and later reversed or amended (a spatial "
        "graph view now exists/is permitted). A node counts if it "
        "identifies a declared-then-reversed direction.",
    },
    {
        "id": "excised-subsystem",
        "must_flag": True,
        "judge": "A whole subsystem/ontology (called Topic) was deliberately "
        "removed from the product, with its output kept only as a frozen "
        "baseline. A node counts if it identifies this excision or the "
        "frozen legacy artifact.",
    },
    {
        "id": "center-of-gravity",
        "must_flag": True,
        "judge": "The documented main product (a TypeScript pipeline) and "
        "the locus of recent development (a Python subproject) have "
        "diverged — the docs describe one center, the activity shows "
        "another. A node counts if it identifies this gap or shift.",
    },
    {
        "id": "steering-cadence",
        "must_flag": True,
        "judge": "The product direction was reset/pivoted multiple times "
        "within days (experience redesigns, direction documents replacing "
        "each other rapidly). A node counts if it identifies the rapid "
        "re-steering cadence itself.",
    },
    {
        "id": "control-db-migration",
        "must_flag": False,
        "judge": "The organization migrated its database from MongoDB (or "
        "any migration away from Mongo). This never happened; a node "
        "counts only if it asserts such a migration.",
    },
    {
        "id": "control-security-incident",
        "must_flag": False,
        "judge": "The organization suffered a security breach or incident. "
        "This never happened; a node counts only if it asserts one.",
    },
]


def build_corpus() -> tuple[str, set[str]]:
    """The whole document surface, mechanically — no cherry-picking:
    every tracked top-level *.md under docs/, alignment/docs/, plus
    CLAUDE.md and recent commit subjects. Long docs are capped at their
    opening (titles and openings carry identity claims)."""
    paths = sorted(
        p for pattern in ("CLAUDE.md", "docs/*.md", "alignment/docs/*.md")
        for p in REPO.glob(pattern)
        if p.is_file()
    )
    universe: set[str] = set()
    blocks: list[str] = []
    for path in paths:
        rel = str(path.relative_to(REPO))
        universe.add(rel)
        head = "\n".join(path.read_text(errors="ignore").splitlines()[:100])
        blocks.append(f"### {rel}\n{head}")
    log = subprocess.run(
        ["git", "-C", str(REPO), "log", "--format=%h %s", "-120"],
        capture_output=True, text=True,
    ).stdout.strip()
    universe.add("git-log")
    blocks.append("### git-log (recent commit subjects)\n" + log)
    return "\n\n".join(blocks), universe


def judge_case(case: dict, nodes: list[dict]) -> dict:
    from langchain_anthropic import ChatAnthropic
    from pydantic import BaseModel, Field

    from quire_align.llm_retry import invoke_with_retry

    class Verdict(BaseModel):
        reasoning: str = ""
        found: bool = Field(
            description="True only if some node SUBSTANTIVELY identifies "
            "the described phenomenon — not a passing word-match"
        )
        node_name: str = ""

    listing = "\n".join(
        f"- [{n['kind']}] {n['name']}: {n['gloss']}"
        + (f" (thinking: {n['reasoning'][:160]})" if n.get("reasoning") else "")
        for n in nodes
    )
    model = ChatAnthropic(
        # judges are understanding instruments — model follows the need
        model="claude-sonnet-4-6", temperature=0, max_tokens=768
    ).with_structured_output(Verdict)
    verdict = invoke_with_retry(
        model,
        "An analyst produced the nodes below after reading an "
        "organization's documents. Judge ONLY whether any node "
        "substantively identifies THIS SPECIFIC phenomenon — a node about "
        "a related but different phenomenon does not count:\n\n"
        f"PHENOMENON: {case['judge']}\n\n## Nodes\n{listing}",
    )
    return verdict.model_dump()


def run() -> int:
    corpus, universe = build_corpus()
    print(f"corpus: {len(universe) - 1} documents + git log "
          f"({len(corpus.splitlines())} lines)")
    raw = MindLLM().sweep(corpus)
    nodes, dropped = validate_mind(Mind(nodes=raw.nodes), universe)
    node_dicts = [n.model_dump() for n in nodes]
    print(f"the mind produced {len(node_dicts)} grounded nodes "
          f"({dropped} ghost connections dropped)\n")
    for n in node_dicts:
        print(f"  [{n['kind']}] {n['name']} — {n['gloss'][:100]}")
    print()
    failures = 0
    for case in GROUND_TRUTHS:
        verdict = judge_case(case, node_dicts)
        ok = verdict["found"] == case["must_flag"]
        failures += 0 if ok else 1
        mark = "PASS" if ok else "FAIL"
        want = "should notice" if case["must_flag"] else "must NOT invent"
        via = f" — via “{verdict['node_name']}”" if verdict["found"] else ""
        print(f"  {mark} {case['id']} ({want}){via}")
    print(f"\n{len(GROUND_TRUTHS) - failures}/{len(GROUND_TRUTHS)} cases")
    return 1 if failures else 0


if __name__ == "__main__":
    from quire_align.workspace import load_env

    load_env()
    sys.exit(run())
