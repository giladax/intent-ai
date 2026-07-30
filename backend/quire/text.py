"""Shared lexical toolkit: one tokenizer, one TF-IDF, one cosine, one Jaccard.

Previously each of grouping.py, analysis/context.py, propose.py, and ask.py
hand-rolled its own tokenizer with silently different rules (and none kept
digit-bearing tokens like "$50" or "24h"). Every call site now states its
rules explicitly through this module's parameters.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict

_ALPHA = re.compile(r"[a-z]+")
_ALNUM = re.compile(r"[a-z0-9]+")


def tokenize(
    text: str,
    *,
    min_len: int = 4,
    keep_digits: bool = False,
    stopwords: frozenset[str] | set[str] = frozenset(),
) -> list[str]:
    """Lowercase word tokens, order-preserving (with repeats — callers that
    want a vocabulary wrap in ``set``).

    - ``min_len`` drops short noise tokens ("a", "the", "is").
    - ``keep_digits=True`` also emits digit-bearing tokens ("100", "24h")
      regardless of length — "$50" and "24h" are load-bearing vocabulary in
      product promises, not noise.
    - ``stopwords`` are removed after pattern matching.
    """
    pattern = _ALNUM if keep_digits else _ALPHA
    tokens: list[str] = []
    for token in pattern.findall(text.lower()):
        if token in stopwords:
            continue
        if len(token) >= min_len or (keep_digits and any(c.isdigit() for c in token)):
            tokens.append(token)
    return tokens


def tf_idf_vectors(docs: dict[str, list[str]]) -> dict[str, dict[str, float]]:
    """L2-normalized TF-IDF vector per document (docs: key → token list)."""
    df: dict[str, int] = defaultdict(int)
    for terms in docs.values():
        for term in set(terms):
            df[term] += 1
    n = max(len(docs), 1)
    out: dict[str, dict[str, float]] = {}
    for key, terms in docs.items():
        tf: dict[str, int] = defaultdict(int)
        for term in terms:
            tf[term] += 1
        vec = {t: c * math.log(1 + n / df[t]) for t, c in tf.items()}
        norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
        out[key] = {t: v / norm for t, v in vec.items()}
    return out


def cosine_similarity(a: dict[str, float], b: dict[str, float]) -> float:
    """Dot product — assumes inputs are already L2-normalized
    (``tf_idf_vectors`` output)."""
    if len(b) < len(a):
        a, b = b, a
    return sum(v * b.get(t, 0.0) for t, v in a.items())


def jaccard_similarity(a: set, b: set) -> float:
    return len(a & b) / max(len(a | b), 1)


def plural(n: int, noun: str, nouns: str = "") -> str:
    """'1 promise' / '3 promises' — '(s)' reads as template residue.
    Pass ``nouns`` for irregular plurals ('entity' → 'entities').
    Promoted from mirror.py once a third caller appeared (mirror, the
    enrich CLI, entity-proposal card questions)."""
    return f"{n} {noun}" if n == 1 else f"{n} {nouns or noun + 's'}"
