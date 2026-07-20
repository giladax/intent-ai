"""Analyzer configuration — every decision worth experimenting with lives
here, not hard-coded in nodes.

Topology, candidate scoping, thresholds, and model choices are all
config-driven so the eval harness can A/B variants (see `evals/run_eval.py`
and `.claude/skills/agents/{topologies,experiments}` for the house
methodology). Register a named variant instead of editing the default.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class AnalyzerConfig(BaseModel):
    variant: str = "linear-v1"

    # --- topology switches ---------------------------------------------------
    short_circuit_on_abstain: bool = Field(
        default=True,
        description="Skip LLM nodes and classify UNKNOWN when context resolution abstains",
    )
    short_circuit_on_empty_diff: bool = Field(
        default=True,
        description="Skip LLM nodes and classify NO_MATERIAL_IMPACT on an empty diff",
    )

    # --- candidate scoping ------------------------------------------------------
    obligation_scope: Literal["bound_and_resolved", "all"] = Field(
        default="bound_and_resolved",
        description=(
            "Which obligations to assess: only those bound to touched control "
            "points or sourced from resolved artifacts, or the whole contract"
        ),
    )
    strict_binding_gate: bool = Field(
        default=True,
        description=(
            "Deterministically mark obligations whose bound control points "
            "were all untouched as unrelated, without an LLM call. Registry-"
            "first: impacts are judged against registered control points; "
            "changes outside the registry surface as POSSIBLE_DRIFT instead."
        ),
    )
    max_context_files: int = Field(
        default=12, description="Bound on files handed to the LLM as code context"
    )

    # --- thresholds -------------------------------------------------------------
    retrieval_min_overlap: int = Field(
        default=3, description="Lexical-overlap floor for the retrieval rung"
    )
    low_confidence: float = Field(
        default=0.4, description="Impact confidence below this is treated as conflicting"
    )

    # --- models -------------------------------------------------------------------
    reasoning_model: str = "claude-sonnet-4-6"
    classifier_model: str = "claude-haiku-4-5"


_VARIANTS: dict[str, AnalyzerConfig] = {}


def register_variant(config: AnalyzerConfig) -> AnalyzerConfig:
    _VARIANTS[config.variant] = config
    return config


def get_variant(name: str) -> AnalyzerConfig:
    if name not in _VARIANTS:
        raise KeyError(f"unknown analyzer variant '{name}'; known: {sorted(_VARIANTS)}")
    return _VARIANTS[name].model_copy(deep=True)


register_variant(AnalyzerConfig())  # the default "linear-v1" variant

# A wider net: assess every obligation in the contract, no short-circuits,
# and let the LLM judge even obligations with untouched bindings.
register_variant(
    AnalyzerConfig(
        variant="exhaustive-v1",
        short_circuit_on_empty_diff=False,
        obligation_scope="all",
        strict_binding_gate=False,
    )
)
