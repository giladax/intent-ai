"""Assisted contract drafting: intent doc + repo → DRAFT obligations + bindings.

The on-ramp compiler. Machines propose, humans approve:

- every candidate obligation carries a VERBATIM quote from the source doc,
  validated deterministically — a candidate whose quote doesn't resolve is
  dropped (same rule as analysis evidence);
- every proposed control point must be an existing repo path;
- output is written as ``obligations.draft.yaml`` / ``bindings.draft.yaml``
  with ``status: draft`` — nothing enters the approved contract until a
  human renames/edits them. The analyzer never reads draft files.

Bounded by design: the model sees the doc, the repo's file listing
(code/config/test files only, capped), and the contents of the few files
that lexically match the obligation vocabulary. No repo-wide indexing.
"""

from __future__ import annotations

import json
import logging
import pathlib
import re
import subprocess

import yaml
from pydantic import BaseModel, Field, field_validator

from quire_align.llm_retry import invoke_with_retry
from quire_align.text import tokenize

logger = logging.getLogger(__name__)


def _coerce_json_list(value):
    # Long inputs occasionally make the model emit the list as a JSON-encoded
    # string; accept it rather than failing the whole proposal.
    if isinstance(value, str):
        return json.loads(value)
    return value

_MAX_TREE_PATHS = 400
_MAX_CONTEXT_FILES = 10
_MAX_FILE_CHARS = 6_000
_CODE_SUFFIXES = (".py", ".ts", ".js", ".go", ".java", ".rb", ".yaml", ".yml", ".json", ".toml", ".md")
_SKIP_PARTS = {"node_modules", ".git", "__pycache__", "dist", "build", ".venv", "venv"}


# --------------------------------------------------------------------------
# Structured outputs
# --------------------------------------------------------------------------


class CandidateObligation(BaseModel):
    obligation_id: str = Field(description="Short id like OB-DRAFT-1")
    kind: str = Field(description="permission | hard_rule | invariant")
    statement: str = Field(description="One atomic, testable behavioral promise")
    source_quote: str = Field(
        description="VERBATIM quote from the source document this promise comes from"
    )
    source_section: str = Field(default="", description="Heading/section it appears under")


class ObligationCandidates(BaseModel):
    candidates: list[CandidateObligation] = Field(default_factory=list)

    _coerce = field_validator("candidates", mode="before")(_coerce_json_list)


class CandidateBinding(BaseModel):
    obligation_id: str
    path: str = Field(description="Existing repo file path")
    symbol: str = Field(default="", description="Function/class name when identifiable")
    role: str = Field(
        description="decision | enforcement | executor | configuration | audit | test_or_eval"
    )
    relation: str = Field(
        description="decides | enforces | executes | configures | observes | verifies"
    )
    why: str = Field(description="One sentence: why this location implements/verifies the promise")


class BindingCandidates(BaseModel):
    candidates: list[CandidateBinding] = Field(default_factory=list)

    _coerce = field_validator("candidates", mode="before")(_coerce_json_list)


class ProposerLLM:
    """Sonnet-backed proposer; swap with FakeProposer offline."""

    def __init__(self, model: str = "claude-sonnet-4-6") -> None:
        from langchain_anthropic import ChatAnthropic

        base = ChatAnthropic(model=model, temperature=0, max_tokens=8192)
        self._obligations = base.with_structured_output(ObligationCandidates)
        self._bindings = base.with_structured_output(BindingCandidates)

    def extract_obligations(self, doc: str) -> ObligationCandidates:
        return invoke_with_retry(
            self._obligations,
            "Extract candidate PRODUCT OBLIGATIONS from this document: atomic, "
            "testable behavioral promises about what the system may, must, or "
            "must never do. 5-15 candidates, most load-bearing first.\n\n"
            "Rules:\n"
            "- One behavior per candidate; split compound promises.\n"
            "- kind: hard_rule for must/never promises; permission for "
            "may-do-under-conditions; invariant for properties that must hold.\n"
            "- source_quote must be copied VERBATIM from the document — it is "
            "validated mechanically and the candidate is discarded if it "
            "does not match.\n"
            "- Skip aspirations, metrics, and roadmap items — only promises "
            "about system behavior.\n\n"
            f"## Document\n{doc}",
        )

    def propose_bindings(
        self,
        obligations: list[CandidateObligation],
        tree: list[str],
        file_contents: dict[str, str],
        doc_paths: list[str] | None = None,
    ) -> BindingCandidates:
        listing = "\n".join(tree)
        files = "\n\n".join(
            f"### {path}\n```\n{content[:_MAX_FILE_CHARS]}\n```"
            for path, content in file_contents.items()
        )
        promises = "\n".join(
            f"- {o.obligation_id} ({o.kind}): {o.statement}" for o in obligations
        )
        mentioned = (
            "## Locations the source document itself references\n"
            + "\n".join(f"- {p}" for p in doc_paths)
            + "\nThe document's own citations are the strongest signal of "
            "where its promises live — prefer these locations and their "
            "neighbors.\n\n"
            if doc_paths
            else ""
        )
        return invoke_with_retry(
            self._bindings,
            "For each product obligation below, propose the CONTROL POINTS in "
            "this repository that decide, enforce, execute, configure, "
            "observe, or verify it. Propose only paths that appear in the "
            "file listing (invalid paths are discarded mechanically). Prefer "
            "precision over coverage — omit an obligation rather than guess. "
            "Include test/eval files as `verifies` bindings when they cover "
            "the promise.\n\n"
            f"{mentioned}"
            f"## Obligations\n{promises}\n\n"
            f"## Repository files\n{listing}\n\n"
            f"## Selected file contents\n{files}",
        )


class FakeProposer:
    def __init__(self, obligations: ObligationCandidates, bindings: BindingCandidates):
        self._o, self._b = obligations, bindings

    def extract_obligations(self, doc: str) -> ObligationCandidates:
        return self._o

    def propose_bindings(self, obligations, tree, file_contents, doc_paths=None) -> BindingCandidates:
        return self._b


# --------------------------------------------------------------------------
# Semantic grouping — delegates to the link-community engine in grouping.py
# (overlapping weighted membership, constrained clustering; see that module
# for the algorithmic design and citations).
# --------------------------------------------------------------------------


def group_candidates(
    obligations: list[CandidateObligation],
    bindings: list[CandidateBinding],
    constraints=None,
    llm_labels=None,
    pair_hints=None,
) -> dict:
    from quire_align.grouping import group_contract

    return group_contract(
        [
            {
                "obligation_id": o.obligation_id,
                "statement": o.statement,
                "source_section": o.source_section,
            }
            for o in obligations
        ],
        [
            {"obligation_id": b.obligation_id, "path": b.path, "relation": b.relation}
            for b in bindings
        ],
        constraints=constraints,
        llm_labels=llm_labels,
        pair_hints=pair_hints,
    )


# --------------------------------------------------------------------------
# Deterministic plumbing
# --------------------------------------------------------------------------


def _normalize(text: str) -> str:
    return " ".join(text.split())


def _normalize_quote(text: str) -> str:
    """Format-tolerant normalization for provenance matching: markdown
    styling, punctuation variants, and case don't count as differences —
    the words do. The original quote is preserved for human review."""
    text = text.lower()
    text = re.sub(r"[*_`#>\[\]()\"'“”‘’]", "", text)
    text = text.replace("—", "-").replace("–", "-")
    return " ".join(text.split())


def extract_doc_paths(doc: str, tree: list[str]) -> list[str]:
    """Repo paths the intent document itself cites, validated against the
    tree — mechanical, like quote validation. A document that references
    its own code defines its own scope."""
    # The char class already excludes quoting/bracket characters, so
    # matches need no trimming; tree membership is the only gate.
    candidates = re.findall(r"[\w.\-]+(?:/[\w.\-]+)+\.\w{1,6}", doc)
    return sorted(set(candidates) & set(tree))


def scope_from_doc_paths(doc_paths: list[str], tree: list[str]) -> list[str]:
    """Scope the binding search space to the regions the document cites:
    the top-level directories of its referenced paths (plus their test
    dirs, which share the top level). Empty when the doc cites nothing —
    full-tree behavior is the fallback, so uncited docs lose nothing."""
    if not doc_paths:
        return tree
    prefixes = {p.split("/")[0] for p in doc_paths}
    # tests conventionally live beside or above the cited code
    prefixes |= {"tests", "test"} & {p.split("/")[0] for p in tree}
    scoped = [p for p in tree if p.split("/")[0] in prefixes]
    return scoped or tree


def repo_tree(repo: pathlib.Path) -> list[str]:
    """Tracked/visible code files, bounded. Uses git when available."""
    try:
        out = subprocess.run(
            ["git", "-C", str(repo), "ls-files"], capture_output=True, text=True
        )
        paths = out.stdout.splitlines() if out.returncode == 0 else []
    except OSError:
        paths = []
    if not paths:
        paths = [
            str(p.relative_to(repo))
            for p in repo.rglob("*")
            if p.is_file() and not any(part in _SKIP_PARTS for part in p.parts)
        ]
    paths = sorted(p for p in paths if p.endswith(_CODE_SUFFIXES))
    if len(paths) > _MAX_TREE_PATHS:
        # Bounded by design, but never silently: the model only sees the
        # first _MAX_TREE_PATHS paths (sorted), so bindings into the tail
        # of a large repo cannot be proposed.
        logger.warning(
            "repo tree truncated: %d code files, only the first %d shown to the proposer",
            len(paths),
            _MAX_TREE_PATHS,
        )
    return paths[:_MAX_TREE_PATHS]


def select_context_files(
    repo: pathlib.Path, tree: list[str], candidates: list[CandidateObligation]
) -> dict[str, str]:
    """Lexical overlap between obligation vocabulary and path/content."""
    vocabulary = {
        term
        for candidate in candidates
        # keep_digits: limits like "$50" are exactly the values worth
        # locating in code and config.
        for term in tokenize(candidate.statement, min_len=4, keep_digits=True)
    }

    def score(path: str) -> int:
        return sum(1 for term in vocabulary if term in path.lower())

    ranked = sorted(tree, key=score, reverse=True)
    contents: dict[str, str] = {}
    for path in ranked:
        if len(contents) >= _MAX_CONTEXT_FILES:
            break
        try:
            text = (repo / path).read_text()
        except (UnicodeDecodeError, OSError):
            continue
        if score(path) > 0 or sum(1 for t in vocabulary if t in text.lower()) >= 3:
            contents[path] = text
    return contents


def validate_candidates(
    obligations: ObligationCandidates,
    bindings: BindingCandidates,
    doc: str,
    tree: list[str],
) -> tuple[list[CandidateObligation], list[CandidateBinding], list[str]]:
    """Drop candidates whose provenance doesn't resolve. Returns
    (kept_obligations, kept_bindings, rejection_notes)."""
    notes: list[str] = []
    doc_normalized = _normalize_quote(doc)
    kept_obligations = []
    seen_ids: set[str] = set()
    for candidate in obligations.candidates:
        # Model-emitted ids are untrusted: a reused id corrupts grouping
        # (self-loop edges) and bindings — same mechanical gate as quotes.
        if candidate.obligation_id in seen_ids:
            notes.append(
                f"{candidate.obligation_id}: duplicate id emitted by the model — dropped"
            )
            continue
        if _normalize_quote(candidate.source_quote) in doc_normalized:
            seen_ids.add(candidate.obligation_id)
            kept_obligations.append(candidate)
        else:
            notes.append(
                f"{candidate.obligation_id}: source quote not found verbatim in document — dropped"
            )
    kept_ids = {o.obligation_id for o in kept_obligations}
    tree_set = set(tree)
    kept_bindings = []
    for binding in bindings.candidates:
        if binding.obligation_id not in kept_ids:
            notes.append(f"binding to {binding.obligation_id}: obligation was dropped")
        elif binding.path not in tree_set:
            notes.append(f"{binding.obligation_id} → {binding.path}: path not in repo — dropped")
        else:
            kept_bindings.append(binding)
    return kept_obligations, kept_bindings, notes


def mint_control_point_id(path: str) -> str:
    """Stable control-point id derived from the FULL repo path — the stem
    alone collides (``a/config.py`` vs ``b/config.py``) and diverged from
    the client-side derivation. Ids are minted server-side only; clients
    consume, never derive."""
    slug = re.sub(r"[^A-Za-z0-9]+", "-", path).strip("-")
    return f"CP-{slug}"


def write_draft(
    out_dir: pathlib.Path,
    source_reference: str,
    obligations: list[CandidateObligation],
    bindings: list[CandidateBinding],
    notes: list[str],
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "obligations.draft.yaml").write_text(
        yaml.safe_dump(
            {
                "status": "draft — human approval required; rename to obligations.yaml after review",
                "obligations": [
                    {
                        "obligation_id": o.obligation_id,
                        "kind": o.kind,
                        "statement": o.statement,
                        "source_reference": source_reference,
                        "source_section": o.source_section,
                        "provenance_quote": o.source_quote,
                        "revision": "draft-1",
                    }
                    for o in obligations
                ],
            },
            sort_keys=False,
            width=88,
        )
    )
    control_points: dict[str, dict] = {}
    binding_rows = []
    for binding in bindings:
        cp_id = mint_control_point_id(binding.path)
        control_points.setdefault(
            cp_id,
            {
                "control_point_id": cp_id,
                "role": binding.role,
                "path": binding.path,
                **({"symbol": binding.symbol} if binding.symbol else {}),
                "description": binding.why,
            },
        )
        binding_rows.append(
            {
                "obligation_id": binding.obligation_id,
                "control_point_id": cp_id,
                "relation": binding.relation,
            }
        )
    (out_dir / "bindings.draft.yaml").write_text(
        yaml.safe_dump(
            {
                "status": "draft — human approval required; rename to bindings.yaml after review",
                "control_points": list(control_points.values()),
                "bindings": binding_rows,
            },
            sort_keys=False,
            width=88,
        )
    )
    if notes:
        (out_dir / "proposal-notes.txt").write_text("\n".join(notes) + "\n")


def propose_contract(
    doc_path: pathlib.Path,
    repo: pathlib.Path,
    out_dir: pathlib.Path,
    source_reference: str,
    llm=None,
) -> tuple[list[CandidateObligation], list[CandidateBinding], list[str]]:
    llm = llm or ProposerLLM()
    doc = doc_path.read_text()
    obligation_candidates = llm.extract_obligations(doc)
    tree = repo_tree(repo)
    doc_paths = extract_doc_paths(doc, tree)
    scoped_tree = scope_from_doc_paths(doc_paths, tree)
    contents = select_context_files(repo, scoped_tree, obligation_candidates.candidates)
    binding_candidates = llm.propose_bindings(
        obligation_candidates.candidates, scoped_tree, contents, doc_paths=doc_paths
    )
    obligations, bindings, notes = validate_candidates(
        obligation_candidates, binding_candidates, doc, scoped_tree
    )
    write_draft(out_dir, source_reference, obligations, bindings, notes)
    return obligations, bindings, notes
