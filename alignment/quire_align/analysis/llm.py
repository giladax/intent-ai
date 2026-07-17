"""LLM layer: the three structured-output inference steps.

Everything the model returns is validated Pydantic (`DeclaredIntent`,
`BehavioralDelta`, `ObligationImpact`); classification stays rule-based
downstream. Prompt text lives in `prompts.py` so it is shared verbatim with
experiment harnesses.

`FakeAlignmentLLM` lets tests and offline runs inject canned outputs.
"""

from __future__ import annotations

from typing import Protocol

from quire_align.analysis.prompts import (
    build_delta_prompt,
    build_impact_prompt,
    build_intent_prompt,
)
from quire_align.models import (
    BehavioralDelta,
    DeclaredIntent,
    Issue,
    Obligation,
    ObligationImpact,
    PullRequest,
)

REASONING_MODEL = "claude-sonnet-4-6"
CLASSIFIER_MODEL = "claude-haiku-4-5"


class AlignmentLLM(Protocol):
    def parse_intent(self, pr: PullRequest, issue: Issue | None) -> DeclaredIntent: ...

    def infer_delta(
        self,
        pr: PullRequest,
        diff: str,
        declared: DeclaredIntent,
        code_context: dict[str, str],
    ) -> BehavioralDelta: ...

    def assess_obligation(
        self,
        obligation: Obligation,
        delta: BehavioralDelta,
        diff: str,
        code_context: dict[str, str],
        coverage_note: str,
        source_excerpt: str = "",
    ) -> ObligationImpact: ...


class AnthropicAlignmentLLM:
    """Production implementation on langchain-anthropic structured output."""

    def __init__(self) -> None:
        from langchain_anthropic import ChatAnthropic

        self._intent_model = ChatAnthropic(
            model=CLASSIFIER_MODEL, temperature=0, max_tokens=1024
        ).with_structured_output(DeclaredIntent)
        reasoning = ChatAnthropic(
            model=REASONING_MODEL, temperature=0, max_tokens=4096
        )
        self._delta_model = reasoning.with_structured_output(BehavioralDelta)
        self._impact_model = reasoning.with_structured_output(ObligationImpact)

    def parse_intent(self, pr: PullRequest, issue: Issue | None) -> DeclaredIntent:
        return self._intent_model.invoke(build_intent_prompt(pr, issue))

    def infer_delta(
        self,
        pr: PullRequest,
        diff: str,
        declared: DeclaredIntent,
        code_context: dict[str, str],
    ) -> BehavioralDelta:
        return self._delta_model.invoke(
            build_delta_prompt(pr, diff, declared, code_context)
        )

    def assess_obligation(
        self,
        obligation: Obligation,
        delta: BehavioralDelta,
        diff: str,
        code_context: dict[str, str],
        coverage_note: str,
        source_excerpt: str = "",
    ) -> ObligationImpact:
        result = self._impact_model.invoke(
            build_impact_prompt(
                obligation, delta, diff, code_context, coverage_note, source_excerpt
            )
        )
        # The id comes from us, not the model — never trust echo-back.
        result.obligation_id = obligation.obligation_id
        return result


class FakeAlignmentLLM:
    """Canned-output stand-in for tests and offline runs."""

    def __init__(
        self,
        intent: DeclaredIntent | None = None,
        delta: BehavioralDelta | None = None,
        impacts: dict[str, ObligationImpact] | None = None,
    ) -> None:
        self.intent = intent or DeclaredIntent(summary="(fake) no declared intent")
        self.delta = delta or BehavioralDelta(material=False, summary="(fake) no delta")
        self.impacts = impacts or {}
        self.calls: list[str] = []

    def parse_intent(self, pr, issue):
        self.calls.append("parse_intent")
        return self.intent

    def infer_delta(self, pr, diff, declared, code_context):
        self.calls.append("infer_delta")
        return self.delta

    def assess_obligation(self, obligation, delta, diff, code_context, coverage_note, source_excerpt=""):
        self.calls.append(f"assess:{obligation.obligation_id}")
        if obligation.obligation_id in self.impacts:
            return self.impacts[obligation.obligation_id]
        from quire_align.models import ImpactRelation

        return ObligationImpact(
            obligation_id=obligation.obligation_id,
            relation=ImpactRelation.UNRELATED,
            confidence=0.9,
            reasoning="(fake) not covered by canned impacts",
        )
