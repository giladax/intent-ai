"""The LLM as a bounded heuristic inside the semantic graph.

Three jobs, each schema-constrained so the model contributes judgment but
can never invent structure (house rule: schema constraints over prompt
instructions; closed enums over free text):

1. **Area naming** — turn a community's promises into a 2–4 word product
   name. Precedence stays human rename > LLM name > TF-IDF fallback, and
   names persist in groups.yaml so this runs once per group, not per view.
2. **Borderline-pair adjudication** — for obligation pairs whose text
   similarity sits in the ambiguous window, ask "same product area?" and
   cache the verdict as a soft hint (weaker than any human must/cannot
   link). Bounded per run; cached forever.
3. **Question routing** — classify a free-text question into a CLOSED enum
   of routes (status answers vs term lookup). Replaces the regex table
   that violated the repo's own no-regex-for-semantics rule; the regex
   survives only as the offline fallback.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from quire.grouping import pair_hint_key
from quire.llm_retry import invoke_with_retry
from quire.text import cosine_similarity, tf_idf_vectors, tokenize

# Cosine window where lexical evidence is genuinely ambiguous: below it the
# pair is clearly unrelated, above it clearly related — only in between is
# a judgment call worth a model consultation.
BORDERLINE_WINDOW = (0.15, 0.45)
MAX_PAIR_JUDGEMENTS_PER_RUN = 10


class AreaName(BaseModel):
    anchor: str
    name: str = Field(description="2-4 word product-area name in the org's own vocabulary")


class AreaNames(BaseModel):
    names: list[AreaName] = Field(default_factory=list)


class PairVerdict(BaseModel):
    same_area: bool = Field(description="Do these two promises govern the same product area?")
    confidence: float = Field(ge=0.0, le=1.0, default=0.5)


class RouteDecision(BaseModel):
    """Closed enum: the model picks a route, it cannot invent one."""

    route: Literal[
        "whats_broken", "whats_uncovered", "whats_changed", "overview", "term_lookup"
    ] = Field(
        description=(
            "whats_broken: asking whether promises are violated/red/failing. "
            "whats_uncovered: asking what work no promise covers. "
            "whats_changed: asking what happened recently. "
            "overview: asking for the map of areas/topics. "
            "term_lookup: naming a specific area, feature, or domain term."
        )
    )


class GraphHeuristics:
    """Haiku-backed implementation; swap FakeGraphHeuristics offline."""

    def __init__(self, model: str = "claude-haiku-4-5") -> None:
        from langchain_anthropic import ChatAnthropic

        base = ChatAnthropic(model=model, temperature=0, max_tokens=1024)
        self._namer = base.with_structured_output(AreaNames)
        self._judge = base.with_structured_output(PairVerdict)
        self._router = base.with_structured_output(RouteDecision)

    def name_areas(self, groups: list[dict], statements: dict[str, str]) -> dict[str, str]:
        menu = "\n\n".join(
            f"anchor={g['anchor']}\n"
            + "\n".join(f"- {statements.get(i, '')}" for i in g["obligation_ids"][:6])
            for g in groups
        )
        result = invoke_with_retry(
            self._namer,
            "Name each product area below from the promises it contains: a "
            "2-4 word noun phrase a product team would actually say, built "
            "from the promises' own vocabulary. Never generic filler "
            "(no 'Management', 'Handling', 'Misc'). One name per anchor.\n\n"
            + menu,
        )
        return {n.anchor: n.name.strip() for n in result.names if n.name.strip()}

    def judge_pair(self, statement_a: str, statement_b: str) -> PairVerdict:
        return invoke_with_retry(
            self._judge,
            "Two approved product promises. Do they govern the SAME product "
            "area (same feature/surface/concern), or different ones?\n\n"
            f"A: {statement_a}\nB: {statement_b}",
        )

    def route_question(self, q: str) -> str:
        return invoke_with_retry(
            self._router,
            f'An engineer asked their product-intent tool: "{q}"\n'
            "Classify the question into exactly one route.",
        ).route


class FakeGraphHeuristics:
    def __init__(self, names=None, verdicts=None, routes=None):
        self.names = names or {}
        self.verdicts = verdicts or {}  # (statement_a, statement_b) -> bool
        self.routes = routes or {}

    def name_areas(self, groups, statements):
        return dict(self.names)

    def judge_pair(self, statement_a, statement_b):
        return PairVerdict(same_area=self.verdicts.get((statement_a, statement_b), False))

    def route_question(self, q):
        return self.routes.get(q, "term_lookup")


def adjudicate_borderline_pairs(
    obligations: list[dict],
    existing_hints: dict[str, str],
    heuristics,
) -> dict[str, str]:
    """Judge obligation pairs in the ambiguous cosine window (new pairs
    only, bounded per run). Returns the updated hint cache — hints are
    soft: human must/cannot links always outrank them."""
    vectors = tf_idf_vectors(
        {o["obligation_id"]: tokenize(o["statement"], min_len=4, keep_digits=True)
         for o in obligations}
    )
    statements = {o["obligation_id"]: o["statement"] for o in obligations}
    hints = dict(existing_hints)
    budget = MAX_PAIR_JUDGEMENTS_PER_RUN
    ids = sorted(vectors)
    for i, a in enumerate(ids):
        for b in ids[i + 1 :]:
            key = pair_hint_key(a, b)
            if key in hints or budget <= 0:
                continue
            low, high = BORDERLINE_WINDOW
            if low <= cosine_similarity(vectors[a], vectors[b]) <= high:
                verdict = heuristics.judge_pair(statements[a], statements[b])
                hints[key] = "same" if verdict.same_area else "different"
                budget -= 1
    return hints


def enrich_workspace(workspace_dir, adapter, heuristics) -> dict:
    """One enrichment pass over a workspace: adjudicate new borderline
    pairs, then name any group that has neither a human nor an LLM name.
    Results persist in groups.yaml; human labels always win. Safe to
    re-run — cached hints/names make it incremental."""
    import yaml

    from quire.ask import load_group_state

    groups_file = workspace_dir / "groups.yaml"
    data = (yaml.safe_load(groups_file.read_text()) or {}) if groups_file.exists() else {}
    obligations = [
        {"obligation_id": o.obligation_id, "statement": o.statement}
        for o in adapter.obligations()
    ]

    existing_hints = data.get("pair_hints") or {}
    hints = adjudicate_borderline_pairs(obligations, existing_hints, heuristics)
    data["pair_hints"] = hints
    groups_file.write_text(yaml.safe_dump(data, sort_keys=False))

    state = load_group_state(workspace_dir, adapter)  # regroup with new hints
    human = (data.get("constraints") or {}).get("labels") or {}
    llm_labels = data.get("llm_labels") or {}
    unnamed = [g for g in state["groups"] if g["anchor"] not in human and g["anchor"] not in llm_labels]
    if unnamed:
        statements = {o["obligation_id"]: o["statement"] for o in obligations}
        llm_labels.update(heuristics.name_areas(unnamed, statements))
        data["llm_labels"] = llm_labels
        groups_file.write_text(yaml.safe_dump(data, sort_keys=False))

    return {
        "pair_hints": hints,
        "new_pair_hints": len(hints) - len(existing_hints),
        "named": {
            g["anchor"]: llm_labels[g["anchor"]]
            for g in unnamed
            if llm_labels.get(g["anchor"])  # a group the LLM skipped stays unnamed
        },
        "groups": load_group_state(workspace_dir, adapter)["groups"],
    }
