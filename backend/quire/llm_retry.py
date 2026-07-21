"""Shared retry for structured-output LLM calls.

Retries ONLY output-shape failures (schema validation / parse errors),
appending corrective feedback to the prompt. Auth, rate-limit, and network
errors propagate immediately — retrying those with a "your output failed
validation" suffix wastes spend and lies to the model about what went wrong.
"""

from __future__ import annotations

import json

from langchain_core.exceptions import OutputParserException
from pydantic import ValidationError

_RETRYABLE = (ValidationError, OutputParserException, json.JSONDecodeError)


def invoke_with_retry(model, prompt: str, attempts: int = 3):
    """Invoke a structured-output model, retrying malformed output with
    feedback. Raises the last validation error after ``attempts`` tries."""
    last_error: Exception | None = None
    for _ in range(attempts):
        try:
            return model.invoke(prompt)
        except _RETRYABLE as error:
            last_error = error
            prompt = (
                prompt
                + "\n\nIMPORTANT: your previous response failed schema "
                f"validation ({str(error)[:200]}). Return output matching "
                "the requested schema exactly — list fields must be proper "
                "JSON ARRAYS of objects, never a JSON-encoded string, and "
                "any double quotes inside string values must be escaped."
            )
    raise last_error
