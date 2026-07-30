"""LLM layer for the understanding stage — structured-output inference steps.

Every model step from the TS pipeline (topic-shifts, classify, classify-exchanges,
extract, weave, verify, transitions, narrative) is a REAL structured-output LLM
call here — none is approximated by regex/keyword/length heuristics (founder
directive, Slice 5b). Deterministic post-processing (anchor validation, dedup,
weave-decision application, verdict application, confidence derivation) lives in
the sibling modules; this file is only the inference boundary.

Models per CLAUDE.md: Sonnet=claude-sonnet-4-6 (extract/weave/verify/transitions/
narrative), Haiku=claude-haiku-4-5 (classify/topic-shifts/classify-exchanges).

`FakeUnderstandLLM` injects canned outputs for offline tests and offline runs,
mirroring analysis/llm.py::FakeAlignmentLLM.
"""

from __future__ import annotations

from typing import Optional, Protocol

from quire.understand import prompts
from quire.understand.schemas import (
    BatchClassificationOutput,
    ExtractOutput,
    SessionNarrativeOutput,
    SessionShapeOutput,
    TopicShiftOutput,
    TransitionsOutput,
    VerifyOutput,
    WeaveOutput,
)

SONNET_MODEL = "claude-sonnet-4-6"
HAIKU_MODEL = "claude-haiku-4-5"


class UnderstandLLM(Protocol):
    def classify_session(self, system: str, user: str) -> SessionShapeOutput: ...

    def detect_topic_shifts(self, system: str, user: str) -> TopicShiftOutput: ...

    def classify_exchanges(self, system: str, user: str) -> BatchClassificationOutput: ...

    def extract(self, system: str, user: str) -> ExtractOutput: ...

    def weave(self, system: str, user: str) -> WeaveOutput: ...

    def verify(self, system: str, user: str) -> VerifyOutput: ...

    def transitions(self, system: str, user: str) -> TransitionsOutput: ...

    def narrative(self, system: str, user: str) -> SessionNarrativeOutput: ...


def _messages(system: str, user: str) -> list:
    """TS sends the system prompt as the API `system` param; mirror that with a
    proper system/user message pair (never fold both into one user string —
    system-level instruction adherence, e.g. verbatim quoting, depends on it)."""
    return [("system", system), ("user", user)]


def _invoke_validated(model, system: str, user: str, attempts: int = 3):
    """Structured-output call with validation retry: on schema/parse failure,
    re-ask with corrective feedback appended to the USER message, mirroring the
    TS client's retryWithStricterPrompt. Non-validation errors propagate."""
    from quire.llm_retry import _RETRYABLE

    last_error: Exception | None = None
    for _ in range(attempts):
        try:
            return model.invoke(_messages(system, user))
        except _RETRYABLE as error:
            last_error = error
            user = (
                user
                + "\n\nIMPORTANT: your previous response failed schema "
                f"validation ({str(error)[:200]}). Return output matching "
                "the requested schema exactly — list fields must be proper "
                "JSON ARRAYS of objects, never a JSON-encoded string, and "
                "any double quotes inside string values must be escaped."
            )
    raise last_error


# ── Raw-JSON text mode (TS client modality) ──────────────────────────
#
# The TS pipeline never used tool-use structured output: callSonnet asked for
# JSON in plain text and parsed/validated it (client.ts::validateJson). For the
# extract step, tool-use mode measurably degrades verbatim quoting of long
# strings (the anchored fidelity dimension), so extract runs in the TS
# modality: plain completion → fence-strip → json.loads → Pydantic validation,
# with the same {...}-extraction fallback and stricter-prompt retry as TS.


class _JsonValidationError(ValueError):
    """Model output was not valid JSON or failed schema validation."""


def _validate_json(text: str, schema):
    """Port of client.ts::validateJson — fence strip, parse, {...} fallback,
    Pydantic validation."""
    import json
    import re

    from pydantic import ValidationError

    cleaned = re.sub(r"^```(?:json)?\s*\n?", "", text, flags=re.IGNORECASE)
    cleaned = re.sub(r"\n?```\s*$", "", cleaned, flags=re.IGNORECASE).strip()

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", cleaned)
        if match:
            try:
                parsed = json.loads(match.group(0))
                return schema.model_validate(parsed)
            except (json.JSONDecodeError, ValidationError):
                pass
        raise _JsonValidationError(
            f"LLM returned invalid JSON: {cleaned[:200]}"
        ) from None

    try:
        return schema.model_validate(parsed)
    except ValidationError as err:
        raise _JsonValidationError(
            f"Schema validation failed: {str(err)[:500]}"
        ) from None


def _invoke_raw_json(chat_model, system: str, user: str, schema):
    """TS-modality call: plain text completion parsed as JSON, one stricter
    retry on validation failure (client.ts::retryWithStricterPrompt)."""

    def _text_of(response) -> str:
        content = response.content
        if isinstance(content, str):
            return content
        # LangChain content blocks: concatenate text parts
        return "".join(
            b.get("text", "") if isinstance(b, dict) else str(b) for b in content
        )

    response = chat_model.invoke(_messages(system, user))
    try:
        return _validate_json(_text_of(response), schema)
    except _JsonValidationError as original:
        stricter_user = "\n".join(
            [
                user,
                "",
                "IMPORTANT: Your previous response was not valid JSON or did not match the required schema.",
                f"Error: {original}",
                "",
                "Please respond with ONLY valid JSON (no markdown fences, no explanation). Ensure every required field is present and has the correct type.",
            ]
        )
        retry_response = chat_model.invoke(_messages(system, stricter_user))
        return _validate_json(_text_of(retry_response), schema)


_RETRYABLE_STATUS = {429, 500, 502, 503, 529}


def _is_transient(err: Exception) -> bool:
    """True for provider-side transient errors worth retrying with backoff:
    429 rate-limit, 5xx, 529 overloaded (APIStatusError), plus connection/timeout.
    529 OverloadedError is an APIStatusError, NOT an InternalServerError, so we
    match on status_code rather than exception class."""
    try:
        from anthropic import APIConnectionError, APIStatusError, APITimeoutError
    except Exception:  # pragma: no cover
        return False
    if isinstance(err, (APIConnectionError, APITimeoutError)):
        return True
    if isinstance(err, APIStatusError):
        return getattr(err, "status_code", None) in _RETRYABLE_STATUS
    return False


def _with_backoff(fn):
    """Run fn() with exponential backoff on transient provider errors,
    mirroring the TS client's network/rate-limit retry loop."""
    import time

    base_delay = 2.0
    max_attempts = 6
    last_error: Exception | None = None
    for attempt in range(max_attempts):
        try:
            return fn()
        except Exception as err:  # noqa: BLE001 — classify then re-raise
            if not _is_transient(err):
                raise
            last_error = err
            if attempt < max_attempts - 1:
                time.sleep(base_delay * (2**attempt))
    raise last_error  # type: ignore[misc]


def _invoke(model, system: str, user: str):
    """Structured-output call: validation retries inside transient backoff."""
    return _with_backoff(lambda: _invoke_validated(model, system, user))


class AnthropicUnderstandLLM:
    """Production implementation on langchain-anthropic.

    Most steps use `with_structured_output` (tool-use). The EXTRACT step runs
    in the TS raw-JSON-text modality instead — tool-use structured output
    measurably degrades verbatim quoting of long strings, and extract's quotes
    feed the anchored fidelity dimension (see _invoke_raw_json)."""

    def __init__(self) -> None:
        from langchain_anthropic import ChatAnthropic

        haiku = ChatAnthropic(model=HAIKU_MODEL, temperature=0, max_tokens=16384)
        haiku_8k = ChatAnthropic(model=HAIKU_MODEL, temperature=0, max_tokens=8192)
        sonnet = ChatAnthropic(model=SONNET_MODEL, temperature=0, max_tokens=16384)

        self._classify_model = haiku.with_structured_output(SessionShapeOutput)
        self._topic_shift_model = haiku.with_structured_output(TopicShiftOutput)
        # classify-exchanges uses maxTokens 8192 in TS
        self._exchange_model = haiku_8k.with_structured_output(BatchClassificationOutput)
        self._extract_chat = sonnet  # raw-JSON modality (TS parity)
        self._weave_model = sonnet.with_structured_output(WeaveOutput)
        self._verify_model = sonnet.with_structured_output(VerifyOutput)
        self._transitions_model = sonnet.with_structured_output(TransitionsOutput)
        self._narrative_model = sonnet.with_structured_output(SessionNarrativeOutput)

    def classify_session(self, system: str, user: str) -> SessionShapeOutput:
        return _invoke(self._classify_model, system, user)

    def detect_topic_shifts(self, system: str, user: str) -> TopicShiftOutput:
        return _invoke(self._topic_shift_model, system, user)

    def classify_exchanges(self, system: str, user: str) -> BatchClassificationOutput:
        return _invoke(self._exchange_model, system, user)

    def extract(self, system: str, user: str) -> ExtractOutput:
        return _with_backoff(
            lambda: _invoke_raw_json(self._extract_chat, system, user, ExtractOutput)
        )

    def weave(self, system: str, user: str) -> WeaveOutput:
        return _invoke(self._weave_model, system, user)

    def verify(self, system: str, user: str) -> VerifyOutput:
        return _invoke(self._verify_model, system, user)

    def transitions(self, system: str, user: str) -> TransitionsOutput:
        return _invoke(self._transitions_model, system, user)

    def narrative(self, system: str, user: str) -> SessionNarrativeOutput:
        return _invoke(self._narrative_model, system, user)


class FakeUnderstandLLM:
    """Canned-output stand-in for tests and offline runs.

    Each step can be given a callable (system, user) -> output OR a fixed value.
    Missing steps return a benign empty output so partial-fixture tests still run.
    """

    def __init__(
        self,
        *,
        classify_session=None,
        detect_topic_shifts=None,
        classify_exchanges=None,
        extract=None,
        weave=None,
        verify=None,
        transitions=None,
        narrative=None,
    ) -> None:
        self._classify_session = classify_session
        self._detect_topic_shifts = detect_topic_shifts
        self._classify_exchanges = classify_exchanges
        self._extract = extract
        self._weave = weave
        self._verify = verify
        self._transitions = transitions
        self._narrative = narrative
        self.calls: list[str] = []

    @staticmethod
    def _resolve(canned, system, user, default):
        if canned is None:
            return default
        if callable(canned):
            return canned(system, user)
        return canned

    def classify_session(self, system: str, user: str) -> SessionShapeOutput:
        self.calls.append("classify_session")
        return self._resolve(
            self._classify_session, system, user, SessionShapeOutput(shape="narrative")
        )

    def detect_topic_shifts(self, system: str, user: str) -> TopicShiftOutput:
        self.calls.append("detect_topic_shifts")
        return self._resolve(
            self._detect_topic_shifts, system, user, TopicShiftOutput(shifts=[])
        )

    def classify_exchanges(self, system: str, user: str) -> BatchClassificationOutput:
        self.calls.append("classify_exchanges")
        return self._resolve(
            self._classify_exchanges,
            system,
            user,
            BatchClassificationOutput(classifications=[]),
        )

    def extract(self, system: str, user: str) -> ExtractOutput:
        self.calls.append("extract")
        return self._resolve(self._extract, system, user, ExtractOutput(moments=[]))

    def weave(self, system: str, user: str) -> WeaveOutput:
        self.calls.append("weave")
        return self._resolve(self._weave, system, user, WeaveOutput(decisions=[]))

    def verify(self, system: str, user: str) -> VerifyOutput:
        self.calls.append("verify")
        return self._resolve(self._verify, system, user, VerifyOutput(verdicts=[]))

    def transitions(self, system: str, user: str) -> TransitionsOutput:
        self.calls.append("transitions")
        return self._resolve(
            self._transitions, system, user, TransitionsOutput(transitions=[], outcomes=[])
        )

    def narrative(self, system: str, user: str) -> SessionNarrativeOutput:
        self.calls.append("narrative")
        return self._resolve(
            self._narrative, system, user, SessionNarrativeOutput()
        )
