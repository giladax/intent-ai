"""Pure, DB-free helpers for Feature resolution and formatting.

Port of journal/src/mcp/feature.ts — no imports from quire.db or quire.mcp.queries.
All functions are deterministic; the DB calls live in queries.py.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


# ── Data classes (mirrors of TS interfaces) ─────────────────────────────

@dataclass
class FeatureRecord:
    id: str
    name: str
    description: str
    current_understanding: Optional[str]
    constraints: list[str]
    known_unknowns: list[str]


@dataclass
class FeatureFileRow:
    feature_id: str
    glob: Optional[str]
    file_path: Optional[str]


@dataclass
class RelatedSession:
    id: str
    shape: Optional[str]
    summary: str
    role: str
    started_at: Optional[datetime]


@dataclass
class FeatureObservation:
    id: str
    category: str
    summary: str
    review_status: str
    timestamp: Optional[datetime]


@dataclass
class FeatureMomentRow:
    id: str
    session_id: str
    statement: str
    type: str
    confidence: Optional[str]
    verification: Optional[str]
    occurred_at: Optional[datetime]
    quote: Optional[str]
    files: list[str] = field(default_factory=list)


@dataclass
class FeatureContextData:
    feature: FeatureRecord
    relevant_files: list[str]
    related_sessions: list[RelatedSession]
    approved_observations: list[FeatureObservation]
    reported_unknowns: list[FeatureObservation]
    moment_candidates: list[FeatureMomentRow]


@dataclass
class MomentEvidenceItem:
    quote: str
    source_type: str
    quote_type: Optional[str]
    source_event_id: Optional[str]


@dataclass
class SessionNarrativeSummary:
    session_id: str
    session_shape: str
    summary: str
    progression: list[str]
    discoveries: list[str]


# ── Text scoring ────────────────────────────────────────────────────────

def tokenize(text: str) -> list[str]:
    return [t for t in re.split(r'[^a-z0-9]+', text.lower()) if t]


def fuzzy_score(query: str, text: str) -> float:
    q_tokens = tokenize(query)
    t_tokens = set(tokenize(text))
    if not q_tokens:
        return 0.0

    if query.lower() in text.lower():
        return 1.0

    hits = 0.0
    for q in q_tokens:
        if q in t_tokens:
            hits += 1
            continue
        for t in t_tokens:
            if t in q or q in t:
                hits += 0.5
                break
    return hits / len(q_tokens)


# ── Glob matching (structural only) ────────────────────────────────────

def normalize_path(p: str) -> str:
    """Remove leading ./ and / from a path."""
    p = p.strip()
    if p.startswith("./"):
        p = p[2:]
    p = p.lstrip("/")
    return p


def glob_to_regexp(glob: str) -> re.Pattern:
    """Convert a glob pattern to a compiled regex.

    **  → .*  (any chars including /)
    *   → [^/]*  (any chars except /)
    ?   → [^/]   (single non-/ char)
    other regex metacharacters are escaped.
    """
    i = 0
    re_str = ""
    while i < len(glob):
        c = glob[i]
        if c == "*":
            if i + 1 < len(glob) and glob[i + 1] == "*":
                re_str += ".*"
                i += 1
                # consume optional trailing /
                if i + 1 < len(glob) and glob[i + 1] == "/":
                    i += 1
            else:
                re_str += "[^/]*"
        elif c == "?":
            re_str += "[^/]"
        elif c in r"\^$+.()|[]{}":
            re_str += "\\" + c
        else:
            re_str += c
        i += 1
    return re.compile("^" + re_str + "$")


def file_matches_patterns(file: str, patterns: list[str]) -> bool:
    """Check if a file path matches any of the Feature's glob/exact patterns.

    Handles absolute vs relative by testing every path-segment suffix.
    """
    target = normalize_path(file)
    segments = target.split("/")
    for p in patterns:
        pat = normalize_path(p)
        if pat == target or target.endswith("/" + pat):
            return True
        regex = glob_to_regexp(pat)
        for i in range(len(segments)):
            if regex.match("/".join(segments[i:])):
                return True
    return False


@dataclass
class PatternMatch:
    feature_id: str
    specificity: int


def matching_rows(file_path: str, rows: list[FeatureFileRow]) -> list[PatternMatch]:
    target = normalize_path(file_path)
    out: list[PatternMatch] = []
    for row in rows:
        if row.glob:
            pat = normalize_path(row.glob)
            if glob_to_regexp(pat).match(target):
                out.append(PatternMatch(feature_id=row.feature_id, specificity=len(pat)))
        elif row.file_path:
            pat = normalize_path(row.file_path)
            if pat == target or target.endswith(pat) or pat.endswith(target):
                out.append(PatternMatch(feature_id=row.feature_id, specificity=len(pat)))
    return out


@dataclass
class FeatureResolution:
    feature_id: Optional[str] = None
    candidate_ids: list[str] = field(default_factory=list)


def resolve_feature(file_path: str, rows: list[FeatureFileRow]) -> FeatureResolution:
    """Resolve a file path to a Feature via longest-glob-wins."""
    matches = matching_rows(file_path, rows)
    if not matches:
        return FeatureResolution(candidate_ids=[])

    # Best (longest) matching pattern per Feature.
    best_by_feature: dict[str, int] = {}
    for m in matches:
        if m.specificity > best_by_feature.get(m.feature_id, -1):
            best_by_feature[m.feature_id] = m.specificity

    max_len = max(best_by_feature.values())
    winners = [fid for fid, length in best_by_feature.items() if length == max_len]

    if len(winners) == 1:
        return FeatureResolution(feature_id=winners[0], candidate_ids=winners)
    return FeatureResolution(candidate_ids=list(best_by_feature.keys()))


# ── Task → Feature matching ─────────────────────────────────────────────

@dataclass
class TaskScore:
    feature: FeatureRecord
    score: float


@dataclass
class TaskResolution:
    feature: Optional[FeatureRecord] = None
    candidates: list[FeatureRecord] = field(default_factory=list)


def score_features_for_task(task: str, features: list[FeatureRecord]) -> list[TaskScore]:
    scored = []
    for f in features:
        name_score = fuzzy_score(task, f.name) * 2.0
        desc_score = fuzzy_score(task, f.description or "") * 1.0
        scored.append(TaskScore(feature=f, score=max(name_score, desc_score)))
    scored.sort(key=lambda s: s.score, reverse=True)
    return scored


def resolve_task(
    task: str,
    features: list[FeatureRecord],
    threshold: float = 0.3,
) -> TaskResolution:
    scored = score_features_for_task(task, features)
    above = [s for s in scored if s.score >= threshold]
    if len(above) == 1:
        return TaskResolution(feature=above[0].feature, candidates=[above[0].feature])
    if len(above) > 1:
        return TaskResolution(candidates=[s.feature for s in above])
    # 0 above threshold → offer top-5 non-zero candidates
    non_zero = [s for s in scored if s.score > 0][:5]
    return TaskResolution(candidates=[s.feature for s in non_zero])


# ── Key-moment selection ────────────────────────────────────────────────

KEY_MOMENT_LIMIT = 8


def _key_moment_score(m: FeatureMomentRow, patterns: list[str]) -> float:
    score = 2.0 if m.confidence == "high" else 1.0
    if patterns and any(file_matches_patterns(f, patterns) for f in m.files):
        score += 1.5
    if m.verification == "supported":
        score += 0.5
    if m.verification == "contradicted":
        score -= 2.0
    return score


def select_key_moments(
    candidates: list[FeatureMomentRow],
    patterns: list[str],
    limit: int = KEY_MOMENT_LIMIT,
) -> list[FeatureMomentRow]:
    eligible = [
        m for m in candidates
        if m.confidence in ("high", "medium")
        and isinstance(m.quote, str)
        and m.quote.strip()
    ]

    def sort_key(m: FeatureMomentRow):
        score = _key_moment_score(m, patterns)
        occurred_ts = m.occurred_at.timestamp() if m.occurred_at else 0.0
        return (-score, -occurred_ts)

    eligible.sort(key=sort_key)
    return eligible[:limit]


# ── Formatting ──────────────────────────────────────────────────────────

def build_agent_instructions(ctx: FeatureContextData) -> str:
    lines: list[str] = []
    f = ctx.feature
    if f.constraints:
        lines.append(f"Respect these constraints before editing: {'; '.join(f.constraints)}.")
    if f.known_unknowns:
        lines.append(f"Open questions to watch for: {'; '.join(f.known_unknowns)}.")
    if ctx.relevant_files:
        lines.append(f"Touch points: {', '.join(ctx.relevant_files[:8])}.")
    lines.append("Report observations, unknowns, and a context-quality rating back to Brain when done.")
    return " ".join(lines)


def format_candidates(features: list[FeatureRecord], reason: str) -> str:
    if not features:
        return (
            f"No Feature matched ({reason}). Use brain_enter again with a different "
            "file/task, or create the file↔Feature mapping first."
        )
    lines = [
        f"Multiple/ambiguous Feature candidates ({reason}). "
        "Pick one and call brain_feature_context(featureId):\n"
    ]
    for f in features:
        summary = (f.description or f.current_understanding or "")[:140]
        suffix = f" — {summary}" if summary else ""
        lines.append(f"- {f.name}  [id: {f.id}]{suffix}")

    top = features[0]
    if top.constraints:
        lines.append(f'\nTop candidate "{top.name}" constraints (verify the Feature match before relying on these):')
        for c in top.constraints:
            lines.append(f"  · {c}")
    return "\n".join(lines)


def format_feature_orientation(ctx: FeatureContextData) -> str:
    f = ctx.feature
    lines: list[str] = []

    lines.append(f"Feature: {f.name}  [id: {f.id}]")

    # Verdict-grade understanding: first 2-3 sentences of assembled understanding.
    understanding_parts: list[str] = []
    if f.current_understanding:
        understanding_parts.append(f.current_understanding)
    for o in ctx.approved_observations:
        understanding_parts.append(o.summary)
    if understanding_parts:
        full = " ".join(understanding_parts)
        # Split on sentence-ending [.!?] followed by whitespace+uppercase.
        # Avoids splitting decimal numbers like "7.7" or abbreviations mid-sentence.
        sentences = [s for s in re.split(r'(?<=[.!?])\s+(?=[A-Z])', full) if s]
        verdict = " ".join(sentences[:3]).strip()
        lines.append(f"\nUnderstanding: {verdict}")

    if f.constraints:
        lines.append("\nConstraints:")
        for c in f.constraints:
            lines.append(f"  · {c}")

    # Drill handles
    key_moments = select_key_moments(ctx.moment_candidates, ctx.relevant_files)
    session_ids = [s.id[:8] + "…" for s in ctx.related_sessions[:3]]
    drill_parts: list[str] = []
    if key_moments:
        moment_ids = ", ".join(m.id[:8] + "…" for m in key_moments[:3])
        count = len(key_moments)
        s = "" if count == 1 else "s"
        drill_parts.append(f'{count} moment{s} (ids: {moment_ids}) → brain_moments("{f.id}")')
    if ctx.related_sessions:
        count = len(ctx.related_sessions)
        s = "" if count == 1 else "s"
        drill_parts.append(
            f'{count} session{s} (s: {", ".join(session_ids)}) → brain_narrative(sessionId)'
        )
    if key_moments:
        drill_parts.append("evidence per moment → brain_evidence(momentId)")
    if drill_parts:
        lines.append("\nDrill:")
        for d in drill_parts:
            lines.append(f"  · {d}")

    lines.append(f'\nFor full context (moments+evidence+sessions+files): brain_feature_context("{f.id}", depth: "full")')
    return "\n".join(lines)


def format_feature_context_full(ctx: FeatureContextData) -> str:
    f = ctx.feature
    parts: list[str] = []
    parts.append(f"# Feature: {f.name}  [id: {f.id}]")

    if f.description:
        parts.append(f"\n{f.description}")

    # Current understanding = stored text + approved observations (assembled).
    understanding: list[str] = []
    if f.current_understanding:
        understanding.append(f.current_understanding)
    for o in ctx.approved_observations:
        understanding.append(f"- {o.summary}")
    if understanding:
        parts.append(f"\n## Current Understanding\n\n{chr(10).join(understanding)}")

    if f.constraints:
        parts.append(
            "\n## Constraints\n\n" + "\n".join(f"- {c}" for c in f.constraints)
        )

    # Key moments
    key_moments = select_key_moments(ctx.moment_candidates, ctx.relevant_files)
    if key_moments:
        moment_lines: list[str] = []
        for m in key_moments:
            day = m.occurred_at.isoformat()[:10] if m.occurred_at else "undated"
            verif = (m.verification or "").strip() or "unverified"
            quote = re.sub(r'\s+', ' ', m.quote or "").strip()[:200]
            moment_lines.append(
                f'- [{m.confidence}, {verif}] {m.statement} ({day})\n  > "{quote}"'
            )
        parts.append(f"\n## Key Moments (evidence-anchored)\n\n{chr(10).join(moment_lines)}")

    if ctx.relevant_files:
        parts.append(
            "\n## Relevant Files\n\n" + "\n".join(f"- `{fp}`" for fp in ctx.relevant_files)
        )

    if ctx.related_sessions:
        session_lines: list[str] = []
        for s in ctx.related_sessions[:8]:
            day = s.started_at.isoformat()[:10] + " — " if s.started_at else ""
            shape = s.shape or "session"
            role_part = f", {s.role}" if s.role else ""
            session_lines.append(f"- {day}{s.summary} ({shape}{role_part})")
        parts.append(f"\n## Related Sessions\n\n{chr(10).join(session_lines)}")

    unknowns = list(f.known_unknowns) + [o.summary for o in ctx.reported_unknowns]
    if unknowns:
        parts.append("\n## Known Unknowns\n\n" + "\n".join(f"- {u}" for u in unknowns))

    parts.append(f"\n## Agent Instructions\n\n{build_agent_instructions(ctx)}")

    return "\n".join(parts)


def format_feature_context(
    ctx: FeatureContextData,
    depth: str = "orientation",
) -> str:
    if depth == "full":
        return format_feature_context_full(ctx)
    return format_feature_orientation(ctx)


# ── Drill tool formatters ───────────────────────────────────────────────

def format_moment_list(moments: list[FeatureMomentRow]) -> str:
    if not moments:
        return "No moments available for this Feature."
    lines: list[str] = []
    for m in moments:
        conf = m.confidence or "?"
        verif = m.verification or "unverified"
        day = m.occurred_at.isoformat()[:10] if m.occurred_at else "undated"
        has_evidence = isinstance(m.quote, str) and m.quote.strip()
        evidence_hint = f' · evidence: brain_evidence("{m.id}")' if has_evidence else ""
        lines.append(f"[{m.id[:8]}…] [{conf}, {verif}] {m.statement} ({day}){evidence_hint}")
    lines.append("\nUse brain_evidence(momentId) for anchored quotes.")
    return "\n".join(lines)


def format_moment_evidence(
    moment_id: str,
    statement: str,
    evidence: list[MomentEvidenceItem],
) -> str:
    if not evidence:
        return f"Moment {moment_id[:8]}… has no stored evidence quotes."
    count = len(evidence)
    s = "" if count == 1 else "s"
    lines: list[str] = [
        f"Moment [{moment_id[:8]}…]: {statement}",
        "",
        f"Evidence ({count} quote{s}):",
    ]
    for e in evidence:
        ref = f" [event: {e.source_event_id[:8]}…]" if e.source_event_id else ""
        qt = f" ({e.quote_type})" if e.quote_type else ""
        cleaned = re.sub(r'\s+', ' ', e.quote).strip()[:300]
        lines.append(f'  > "{cleaned}"{qt} · {e.source_type}{ref}')
    return "\n".join(lines)


def format_session_narrative(n: SessionNarrativeSummary) -> str:
    lines: list[str] = [
        f"Session {n.session_id[:8]}… ({n.session_shape})",
        "",
        f"Summary: {n.summary}",
    ]
    if n.progression:
        lines.append("\nProgression:")
        for p in n.progression:
            lines.append(f"  · {p}")
    if n.discoveries:
        lines.append("\nDiscoveries:")
        for d in n.discoveries:
            lines.append(f"  · {d}")
    return "\n".join(lines)


def format_attention_mcp_text(
    state: Optional[dict],
    updated_at,
    stale: bool = False,
) -> str:
    if not state or "surface" not in state:
        return "No attention reported — the Brain dashboard does not appear to be open."

    stale_mark = " (stale — older than 10 min)" if stale else ""
    lines: list[str] = [
        f"## User Attention{stale_mark}",
        f"Surface: {state['surface']}",
    ]

    lens = state.get("lens") or {}
    if lens.get("featureName"):
        feature_id = lens.get("featureId", "unknown")
        lines.append(f'Lens: Feature — "{lens["featureName"]}" (id: {feature_id})')
    elif lens.get("type"):
        lines.append(f"Lens: {lens['type']}")
    else:
        lines.append("Lens: feed (no specific lens focused)")

    if state.get("openSessionId"):
        lines.append(f"Open session: {state['openSessionId']}")

    expanded = state.get("expandedStoryIds") or []
    if expanded:
        lines.append(f"Expanded stories: {', '.join(expanded[:5])}")

    if updated_at:
        if hasattr(updated_at, "isoformat"):
            lines.append(f"\n_Updated at: {updated_at.isoformat()}_")
        else:
            lines.append(f"\n_Updated at: {updated_at}_")

    return "\n".join(lines)
