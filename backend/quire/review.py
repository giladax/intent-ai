"""quire.review — the review room's assembled contract (A2).

A stored PRAnalysis is not enough to render a review the way a human reads a
real PR: the diff and the PR title live in git / the workspace registry, the
verbatim receipts live inside the analysis, and "why the author did it" is a
mix of the declared intent (always present when the PR carried one) and the
coupled coding session (present only when a Claude-Session trailer bound one).

This module composes those sources into ONE public JSON contract — the same
shape the app renders and any agent can call — with plain-language verdicts
(quire.vocab, never the shouty legacy labels) and ids kept as footnotes.

Everything here is failure-safe: a missing mirror, an unreadable prs.yaml, or
an absent session degrades to an honest empty/absent state, never a 500.

Public entry points:
  review_detail(store, adapter, workspace, pr_number, link_store=None) -> dict
  repo_reviews(store, adapter, workspace) -> list[dict]
  feature_promises(adapter, feature_files) -> dict   # obligations ∩ files join
"""
from __future__ import annotations

import logging
from typing import Any

from quire import vocab
from quire.models import ImpactRelation, PRAnalysis

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Repo reviews list — newest first, plain verdict + human title + when
# ---------------------------------------------------------------------------

def repo_reviews(store, adapter, workspace: str) -> list[dict[str, Any]]:
    """The repo's reviews as a list (newest first).

    Each row reads like the mock's review rows: a one-line human PR title,
    the plain-language verdict, and when it was observed. The PR title comes
    from the workspace registry (prs.yaml, surfaced via the adapter) — the
    analysis alone carries no human title, so we resolve it here and fall
    back to "PR #N" when the registry can't answer.
    """
    repository = adapter.repository()
    try:
        analyses = store.list_analyses(repository=repository)
    except Exception as error:  # pragma: no cover - defensive
        logger.warning("repo_reviews: list_analyses failed for %s: %s", workspace, error)
        return []

    rows: list[dict[str, Any]] = []
    for a in analyses:  # already newest-first (ORDER BY created_at DESC)
        v = vocab.verdict(a.classification.value)
        rows.append({
            "pr_number": a.pr_number,
            "analysis_id": a.analysis_id,
            "title": _pr_title(adapter, a.pr_number),
            "verdict": a.classification.value,      # raw enum (agents re-translate)
            "label": v["label"],                    # plain language (app renders directly)
            "ink": v["ink"],
            "review_state": a.review_state.value,
            "head_sha": a.head_sha,
            "ts": a.created_at.isoformat() if a.created_at else "",
            "link": f"/repo/{workspace}/review/{a.pr_number}",
        })
    return rows


# ---------------------------------------------------------------------------
# Review detail — the review-room contract (mock 09's three zones)
# ---------------------------------------------------------------------------

def review_detail(
    store,
    adapter,
    workspace: str,
    pr_number: int,
    link_store=None,
    narrative_lookup=None,
) -> dict[str, Any] | None:
    """Assemble the review room for one PR.

    Returns None when no analysis exists for the PR (caller raises 404).

    narrative_lookup: optional callable session_id -> {summary, momentCount}|None
        so a coupled session's reasoning can join. When omitted (or it
        returns None), the "why" card falls back to the declared intent and
        the session walk is honestly absent.
    """
    analyses = store.list_analyses(repository=adapter.repository(), pr_number=pr_number)
    if not analyses:
        return None
    a: PRAnalysis = max(analyses, key=lambda x: x.created_at)

    v = vocab.verdict(a.classification.value)
    statements = _statement_index(adapter)

    # ── the diff / changed files (re-derived live; the analysis stores none) ──
    files, file_notes = _files_and_notes(adapter, a, statements)

    # ── promise cards: impacts that carry the story, statement + receipts ──
    promises = _promise_cards(a, statements)

    # ── the gap: coverage findings + missing evidence, plain-worded ──
    gap = _gap(a)

    # ── why the author did it: declared intent + (honest) coupled session ──
    why = _why(a, workspace, pr_number, link_store, narrative_lookup)

    # ── headline counts (green/amber/red chips) ──
    counts = _counts(a)

    return {
        "workspace": workspace,
        "pr_number": pr_number,
        "analysis_id": a.analysis_id,
        "title": _pr_title(adapter, pr_number),
        "verdict": a.classification.value,          # raw enum
        "label": v["label"],                        # plain language
        "ink": v["ink"],
        "verdict_sentence": _verdict_sentence(a, v),
        "head_sha": a.head_sha,
        "base_sha": a.base_sha,
        "analyzer_version": a.analyzer_version,
        "observed_at": a.created_at.isoformat() if a.created_at else "",
        "review_state": a.review_state.value,
        "reviewer": a.reviewer,
        "review_note": a.review_note,
        "counts": counts,
        "files": files,            # [{path, additions, deletions, patch, notes:[note_id…]}]
        "file_notes": file_notes,  # [{id, path, label, ink, statement, reasoning, source_ref}]
        "promises": promises,      # [{obligation_id, statement, label, ink, relation, reasoning, citations[]}]
        "gap": gap,                # {has_gap, summary, items[]}
        "why": why,                # {summary, claims[], session:{id,link,steps}|None} | None
        "intent_ledger_url": f"/intent/{workspace}",
    }


# ---------------------------------------------------------------------------
# Feature ↔ promises join — the deterministic edge (bindings ∩ feature_files)
# ---------------------------------------------------------------------------

def feature_promises(adapter, feature_files: list[dict]) -> dict[str, Any]:
    """The obligations a feature holds, via the deterministic edge:
    a binding's control-point PATH ∩ the feature's files.

    This is an edge derivation (per the edges rule) — no node is mutated;
    the intersection of two path sets IS the join. Returns the promises plus
    a count so a feature page can stop showing promiseCount 0.

    feature_files: rows from the journal feature_files table
        [{glob, file_path}…]. Both a concrete file_path and a glob may
        anchor the feature to code; we match either against binding paths.
    """
    feat_paths = {
        (row.get("file_path") or row.get("glob") or "").strip()
        for row in feature_files
    }
    feat_paths.discard("")
    if not feat_paths:
        return {"promises": [], "promiseCount": 0}

    statements = _statement_index(adapter)
    ob_paths = _obligation_paths(adapter)  # obligation_id -> {path…}

    promises: list[dict[str, Any]] = []
    for ob_id, paths in ob_paths.items():
        overlap = sorted(_path_overlap(paths, feat_paths))
        if not overlap:
            continue
        promises.append({
            "obligation_id": ob_id,
            "statement": statements.get(ob_id, ""),
            "files": overlap,
        })
    promises.sort(key=lambda p: p["obligation_id"])
    return {"promises": promises, "promiseCount": len(promises)}


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _pr_title(adapter, pr_number: int) -> str:
    """The human PR title from the workspace registry (prs.yaml), via the
    adapter. Falls back to a plain 'PR #N' when the registry can't answer."""
    try:
        return adapter.get_pr(pr_number).title or f"PR #{pr_number}"
    except Exception:
        return f"PR #{pr_number}"


def _statement_index(adapter) -> dict[str, str]:
    try:
        return {o.obligation_id: o.statement for o in adapter.obligations()}
    except Exception:  # pragma: no cover - defensive
        return {}


def _obligation_paths(adapter) -> dict[str, set[str]]:
    """obligation_id -> set of control-point paths bound to it."""
    try:
        cp_path = {cp.control_point_id: cp.path for cp in adapter.control_points()}
        out: dict[str, set[str]] = {}
        for b in adapter.bindings():
            path = cp_path.get(b.control_point_id)
            if path:
                out.setdefault(b.obligation_id, set()).add(path)
        return out
    except Exception:  # pragma: no cover - defensive
        return {}


def _path_overlap(a: set[str], b: set[str]) -> set[str]:
    """Paths in `a` that a path in `b` names — exact match, or one being a
    directory prefix / glob stem of the other (a feature file 'src/mcp/' or
    'src/mcp/*' covers 'src/mcp/server.ts')."""
    hit: set[str] = set()
    for pa in a:
        for pb in b:
            if _path_matches(pa, pb):
                hit.add(pa)
                break
    return hit


def _path_matches(path: str, feature_ref: str) -> bool:
    if path == feature_ref:
        return True
    stem = feature_ref.rstrip("*").rstrip("/")
    if not stem:
        return False
    return path == stem or path.startswith(stem + "/")


_RELATION_VERDICT = {
    ImpactRelation.SATISFIES: ("Keeps this promise", "green"),
    ImpactRelation.PARTIALLY_SATISFIES: ("Partly keeps this promise", "amber"),
    ImpactRelation.CONTRADICTS: ("Breaks this promise", "red"),
    ImpactRelation.UNRELATED: ("Doesn't touch this promise", "gray"),
}


def _promise_cards(a: PRAnalysis, statements: dict[str, str]) -> list[dict[str, Any]]:
    """The promises this change touched, most-load-bearing first. Unrelated
    impacts are dropped — the rail shows the promises that carry the story,
    with the model's plain reasoning and its verbatim citations as receipts."""
    ranked = sorted(
        (i for i in a.obligation_impacts if i.relation != ImpactRelation.UNRELATED),
        key=lambda i: (_relation_rank(i.relation), -(i.confidence or 0.0)),
    )
    cards: list[dict[str, Any]] = []
    for imp in ranked:
        label, ink = _RELATION_VERDICT.get(imp.relation, ("Needs your review", "gray"))
        cards.append({
            "obligation_id": imp.obligation_id,
            "statement": statements.get(imp.obligation_id, ""),
            "relation": imp.relation.value,
            "label": label,
            "ink": ink,
            "confidence": imp.confidence,
            "reasoning": imp.reasoning,
            "citations": [
                {
                    "reference": e.reference,
                    "lines": [e.start_line, e.end_line],
                    "excerpt": e.excerpt,
                    "valid": e.valid,
                }
                for e in imp.evidence
                if e.excerpt  # a receipt without its quote refuses to render
            ],
        })
    return cards


_RELATION_ORDER = {
    ImpactRelation.CONTRADICTS: 0,
    ImpactRelation.PARTIALLY_SATISFIES: 1,
    ImpactRelation.SATISFIES: 2,
    ImpactRelation.UNRELATED: 3,
}


def _relation_rank(relation: ImpactRelation) -> int:
    return _RELATION_ORDER.get(relation, 4)


def _gap(a: PRAnalysis) -> dict[str, Any]:
    """The coverage gap: what nothing verifies. Coverage findings without any
    verification, plus the analysis-level missing evidence, in plain words."""
    items: list[str] = []
    for cov in a.coverage:
        if not cov.has_any_verification:
            for g in cov.gaps:
                items.append(g)
            if not cov.gaps:
                items.append(f"{cov.obligation_id} has no test or eval bound to verify it.")
    for m in a.missing_evidence:
        if m not in items:
            items.append(m)
    return {
        "has_gap": bool(items),
        "summary": "Nothing verifies it." if items else "",
        "items": items,
    }


def _why(
    a: PRAnalysis,
    workspace: str,
    pr_number: int,
    link_store,
    narrative_lookup,
) -> dict[str, Any] | None:
    """Why the author did it: the declared intent (the author's own reasoning,
    always present when the PR carried a body) plus the coupled session when a
    Claude-Session trailer bound one. The session is honestly absent when no
    link exists — the mock's 'attached by trailer' only shows when true."""
    di = a.declared_intent
    summary = getattr(di, "summary", "") if di else ""
    claims = list(getattr(di, "claims", []) or []) if di else []

    session = None
    if link_store is not None:
        try:
            links = link_store.links_for_check(workspace, pr_number)
        except Exception as error:  # pragma: no cover - defensive
            logger.warning("_why: links_for_check failed for %s#%s: %s", workspace, pr_number, error)
            links = []
        for link in links:
            sid = link.session_id
            info = narrative_lookup(sid) if narrative_lookup else None
            if info is not None:
                session = {
                    "id": sid,
                    "link": f"/session/{sid}",
                    "summary": info.get("summary"),
                    "steps": info.get("momentCount"),
                    "kind": link.kind,
                }
                break
            # A link with no readable narrative still proves the coupling.
            if session is None:
                session = {"id": sid, "link": f"/session/{sid}", "kind": link.kind}

    if not summary and not claims and session is None:
        return None
    return {"summary": summary, "claims": claims, "session": session}


def _counts(a: PRAnalysis) -> dict[str, int]:
    broken = sum(1 for i in a.obligation_impacts if i.relation == ImpactRelation.CONTRADICTS)
    partial = sum(
        1 for i in a.obligation_impacts if i.relation == ImpactRelation.PARTIALLY_SATISFIES
    )
    kept = sum(1 for i in a.obligation_impacts if i.relation == ImpactRelation.SATISFIES)
    not_covered = sum(
        1 for cov in a.coverage if not cov.has_any_verification
    )
    return {
        "broken": broken,
        "partial": partial,
        "kept": kept,
        "not_verified": not_covered,
    }


def _verdict_sentence(a: PRAnalysis, v: dict[str, str]) -> str:
    """One plain sentence for the verdict head. Prefer the behavioral-delta
    summary (what changed) framed by the plain verdict; fall back to the
    verdict label alone. Never the raw enum."""
    bd = a.behavioral_delta
    change = (getattr(bd, "summary", "") or "").strip() if bd else ""
    label = v["label"]
    if change:
        return f"{label}. {change}"
    return f"{label}."


def _files_and_notes(
    adapter, a: PRAnalysis, statements: dict[str, str]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Changed files with their diff hunks and per-file promise notes.

    File-level notes anchor a promise to a changed file wherever a binding's
    control-point path names that file — the same deterministic edge the
    feature join uses. Each note carries the promise's plain verdict on this
    change (from the obligation impact) so the manuscript reads with its
    margin content inline.

    Invariant: prs.yaml refs must be SHA literals, not branch names — a
    branch ref re-resolved at render time can diverge from the SHA that was
    analyzed, silently showing a different diff. When get_pr()'s head_sha
    does not match the stored analysis head_sha the diff is marked unavailable
    (honest-state: never show a diff that wasn't analyzed).
    """
    try:
        pr = adapter.get_pr(a.pr_number)
        changed = adapter.changed_files(pr)
    except Exception as error:
        logger.warning("_files_and_notes: diff unavailable for PR %s: %s", a.pr_number, error)
        return [], []

    # Invariant: prs.yaml refs must be SHA literals, not branch names — a
    # branch name re-resolved here can diverge from the SHA that was analyzed,
    # silently showing a diff for a different commit.
    if pr.head_sha != a.head_sha:
        logger.warning(
            "_files_and_notes: head_sha mismatch for PR %s "
            "(analyzed %s, workspace now %s) — diff unavailable",
            a.pr_number, a.head_sha, pr.head_sha,
        )
        return [
            {
                "path": "(diff unavailable -- source moved since analysis)",
                "additions": 0,
                "deletions": 0,
                "patch": "",
                "notes": [],
            }
        ], []

    # obligation_id -> impact (for the note verdict)
    impact_by_ob = {i.obligation_id: i for i in a.obligation_impacts}
    ob_paths = _obligation_paths(adapter)  # obligation_id -> {path…}

    notes: list[dict[str, Any]] = []
    note_ids_by_path: dict[str, list[str]] = {}
    note_seq = 0
    for ob_id, paths in ob_paths.items():
        imp = impact_by_ob.get(ob_id)
        if imp is None or imp.relation == ImpactRelation.UNRELATED:
            continue
        for path in sorted(paths):
            if path not in changed:
                continue
            note_seq += 1
            note_id = f"note-{note_seq}"
            label, ink = _RELATION_VERDICT.get(imp.relation, ("Needs your review", "gray"))
            notes.append({
                "id": note_id,
                "path": path,
                "obligation_id": ob_id,
                "label": label,
                "ink": ink,
                "statement": statements.get(ob_id, ""),
                "reasoning": imp.reasoning,
                "source_ref": ob_id,
            })
            note_ids_by_path.setdefault(path, []).append(note_id)

    files: list[dict[str, Any]] = []
    for path in changed:
        patch = _file_patch(adapter, pr, path)
        adds, dels = _count_hunks(patch)
        files.append({
            "path": path,
            "additions": adds,
            "deletions": dels,
            "patch": patch,
            "notes": note_ids_by_path.get(path, []),
        })
    return files, notes


def _file_patch(adapter, pr, path: str) -> str:
    """A unified diff for one changed file, built from base/head content —
    adapter-agnostic (works whether the adapter emits `git diff` or difflib
    output), so the manuscript expands to the same shape everywhere."""
    import difflib

    try:
        base = adapter.file_content(pr, path, "base")
        head = adapter.file_content(pr, path, "head")
    except Exception:  # pragma: no cover - defensive
        return ""
    base_lines = base.splitlines(keepends=True) if base else []
    head_lines = head.splitlines(keepends=True) if head else []
    return "".join(
        difflib.unified_diff(
            base_lines,
            head_lines,
            fromfile=f"a/{path}" if base is not None else "/dev/null",
            tofile=f"b/{path}" if head is not None else "/dev/null",
        )
    )


def _count_hunks(patch: str) -> tuple[int, int]:
    adds = dels = 0
    for line in patch.splitlines():
        if line.startswith("+") and not line.startswith("+++"):
            adds += 1
        elif line.startswith("-") and not line.startswith("---"):
            dels += 1
    return adds, dels
