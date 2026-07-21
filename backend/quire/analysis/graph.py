"""Analysis graph wiring — topology lives here, and only here.

Topologies are registered by name so variants can be experimented with and
A/B'd through the eval harness without touching node logic. The default
`linear-v1` follows the spec's node order with two cost short-circuits
(cached result, abstained context / empty diff).
"""

from __future__ import annotations

from typing import Callable

from langgraph.graph import END, START, StateGraph

from quire.analysis.config import AnalyzerConfig, get_variant
from quire.analysis.nodes import build_nodes
from quire.analysis.state import AnalysisState

TopologyBuilder = Callable[[dict, AnalyzerConfig], "StateGraph"]

_TOPOLOGIES: dict[str, TopologyBuilder] = {}


def register_topology(name: str):
    def wrap(builder: TopologyBuilder) -> TopologyBuilder:
        _TOPOLOGIES[name] = builder
        return builder

    return wrap


@register_topology("linear-v1")
def _linear_v1(nodes: dict, config: AnalyzerConfig) -> StateGraph:
    graph = StateGraph(AnalysisState)
    for name, fn in nodes.items():
        graph.add_node(name, fn)

    graph.add_edge(START, "load_inputs")
    graph.add_edge("load_inputs", "snapshot_artifacts")
    graph.add_edge("snapshot_artifacts", "resolve_product_context")
    graph.add_edge("resolve_product_context", "load_obligations")

    def after_obligations(state: AnalysisState) -> str:
        if state.cached:
            return "publish"
        if (
            config.short_circuit_on_abstain
            and state.context is not None
            and state.context.abstained
        ):
            return "classify_alignment"
        return "parse_intent"

    graph.add_conditional_edges(
        "load_obligations",
        after_obligations,
        ["publish", "classify_alignment", "parse_intent"],
    )

    graph.add_edge("parse_intent", "collect_diff")

    def after_diff(state: AnalysisState) -> str:
        if config.short_circuit_on_empty_diff and not state.diff.strip():
            return "classify_alignment"
        return "match_points"

    graph.add_conditional_edges(
        "collect_diff", after_diff, ["classify_alignment", "match_points"]
    )

    graph.add_edge("match_points", "gather_code_context")
    graph.add_edge("gather_code_context", "infer_delta")

    def after_delta(state: AnalysisState) -> str:
        # Immaterial delta with intact enforcement → nothing to compare
        # obligations against; skip straight to classification (which will
        # land NO_MATERIAL_IMPACT) instead of paying N obligation calls.
        if (
            config.short_circuit_on_empty_diff
            and state.delta is not None
            and not state.delta.material
            and not state.removed_enforcement
        ):
            return "classify_alignment"
        return "compare_obligations"

    graph.add_conditional_edges(
        "infer_delta", after_delta, ["classify_alignment", "compare_obligations"]
    )

    graph.add_edge("compare_obligations", "inspect_tests")
    graph.add_edge("inspect_tests", "validate")
    graph.add_edge("validate", "classify_alignment")
    graph.add_edge("classify_alignment", "persist")
    graph.add_edge("persist", "publish")
    graph.add_edge("publish", END)
    return graph


def build_analysis_graph(
    adapter,
    llm,
    store=None,
    config: AnalyzerConfig | None = None,
):
    config = config or AnalyzerConfig()
    nodes = build_nodes(adapter, llm, store, config)
    topology = _TOPOLOGIES.get(config.variant) or _TOPOLOGIES["linear-v1"]
    return topology(nodes, config).compile()


def run_analysis(
    adapter,
    pr_number: int,
    *,
    llm=None,
    store=None,
    config: AnalyzerConfig | None = None,
    variant: str | None = None,
    force: bool = False,
):
    """Convenience entry point: build the graph, run one PR, return PRAnalysis."""
    if config is None and variant is not None:
        config = get_variant(variant)
    if llm is None:
        from quire.analysis.llm import AnthropicAlignmentLLM

        llm = AnthropicAlignmentLLM()
    graph = build_analysis_graph(adapter, llm, store=store, config=config)
    result = graph.invoke({"pr_number": pr_number, "force": force})
    return result["analysis"]
