"""Prompt builders for the understanding LLM steps.

Ported VERBATIM from journal/src/llm/prompts/** (and the inline prompt in
chunk.ts::detectTopicShifts). Prompt wording is load-bearing — the fidelity
gate is calibrated against the TS output these exact strings produce. Do not
paraphrase; changes here are prompt-engineering changes that must go through
the EDD fidelity loop.

Each builder returns (system, user). The structural formatting of events,
moments, evidence, etc. mirrors the TS template literals character-for-char.
"""

from __future__ import annotations

from typing import Optional

from quire.ingest.models import NormalizedDevEvent, SessionChunk
from quire.understand.models import ExtractedMoment
from quire.understand.render import render_chunk_events


# ── shared-rubrics.ts ─────────────────────────────────────────────────

MOMENT_TYPES_TAXONOMY = """## Moment Types

- **proposal** — Someone (developer or AI) suggests an approach, architecture, or solution. Use the proposer's actual words.
- **discovery** — New information surfaces that changes understanding. "Oh, this API doesn't support streaming" or "The tests are actually passing, it was a caching issue."
- **pivot** — Direction changes. The developer was doing X, now they're doing Y. Must cite what triggered the pivot.
- **confirmation** — A tentative approach becomes accepted. "Yeah, that looks right" or running tests that pass.
- **rejection** — An approach is explicitly rejected. "Actually let's not mock the database" or reverting a change.
- **commitment** — A firm decision that shapes subsequent work. Different from confirmation — this is choosing a path, not validating one.
- **struggle** — Repeated failed attempts, confusion, or difficulty. Cycles of edit-fail-edit on the same problem.
- **breakthrough** — A struggle resolves. The thing that wasn't working now works, or the confusion clears.
- **execution** — Sustained implementation of an already-decided approach. Only flag this for significant scope, not every edit."""

AGENCY_RUBRIC = """## Agency Rubric

Agency is about who SET THE DIRECTION, not who typed. Executing tools is NOT agency.
- **developer** — the developer initiated or drove this moment
- **ai** — the AI proposed it and the developer passively accepted (went along without meaningful engagement)
- **collaborative** — genuine back-and-forth shaped the outcome"""


def _truncate(text: str, max_len: int) -> str:
    if len(text) <= max_len:
        return text
    return text[:max_len] + "..."


# ── classify.ts ───────────────────────────────────────────────────────


def build_classify_prompt(
    event_counts: dict[str, int],
    files: list[str],
    sample_user_messages: list[str],
    total_events: int,
) -> tuple[str, str]:
    system = """You are a development session classifier. You analyze a summary of a developer's coding session and classify it into one of five shapes.

Session shapes:

1. **narrative** — The session tells a story of building something. There is a clear arc: the developer starts with an intent, works through implementation, and arrives at a result. Characterized by a mix of intent, action, and reflection events. The developer is driving toward a goal.

2. **exploratory** — The session is about understanding, investigating, or experimenting. The developer is reading code, searching, asking questions, trying things out. Lots of reflection events, Read/Grep/Glob tool calls. No clear build arc — more like research.

3. **janitorial** — The session is maintenance work: renaming, reformatting, dependency updates, config changes, CI fixes. Lots of small edits across many files. Low cognitive load, high file count. The changes are mechanical rather than creative.

4. **debugging** — The session is dominated by a bug hunt. Characterized by cycles of: hypothesis → test → observe → adjust. Lots of Bash runs, error output in tool results, repeated edits to the same files. The developer is reacting to failures.

5. **review** — The session is primarily about reviewing code, reading diffs, or evaluating existing work. Mostly reading and reflection, with few or no edits. The developer is assessing rather than building.

Respond with ONLY a JSON object: { "shape": "<one of the five shapes>" }"""

    counts_block = "\n".join(f"- {t}: {c}" for t, c in event_counts.items())
    files_block = "\n".join(files[:30])
    if len(files) > 30:
        files_block += f"\n... and {len(files) - 30} more"
    msgs_block = "\n".join(
        f"{i + 1}. {msg}" for i, msg in enumerate(sample_user_messages[:8])
    )

    user = f"""Here is a summary of the development session:

**Event counts:**
{counts_block}

**Total events:** {total_events}

**Files touched ({len(files)} total):**
{files_block}

**Sample user messages:**
{msgs_block}

Classify this session. Return JSON only."""

    return system, user


# ── chunk.ts::detectTopicShifts inline prompt ─────────────────────────


def build_topic_shift_prompt(candidates: list[NormalizedDevEvent]) -> tuple[str, str]:
    system = """You analyze the developer's messages within a single AI-assisted coding session and identify which messages mark an EXPLICIT shift to a NEW topic or task.

A topic shift is when the developer deliberately pivots away from what was just being worked on to start a different piece of work — for example: "now let's work on X", "moving on to Y", "switch to Z", "ok, next: ...", "different thing now".

The following are NOT topic shifts: continuations of the current task, clarifications, answers to a question the assistant asked, bug reports about the in-progress work, approvals/rejections ("yes", "no", "looks good"), and refinements of the same goal.

Be conservative — only flag a message when the developer is clearly starting new work.

Respond with ONLY a JSON object of the form:
{ "shifts": [ { "eventId": "<id>", "isTopicShift": true|false }, ... ] }
Include an entry for every message id you were given."""

    text_cap = 280
    lines = [
        f"- id: {e.id}\n  message: {(e.content.detail or e.content.summary or '')[:text_cap]}"
        for e in candidates
    ]
    user = f"""Developer messages, in order:

{chr(10).join(lines)}

For each message id, decide whether it marks an explicit shift to a new topic/task. Return JSON only."""

    return system, user


# ── classify-exchanges.ts (system prompt VERBATIM) ────────────────────


def build_classifier_system_prompt() -> str:
    return """You classify developer-AI exchanges from a coding session. For each exchange, determine 4 properties.

## Properties

1. **engagement**: How substantively did the developer respond?
   - "passive": Short response, no reasoning (e.g., "ok", "yes", "sure", "a")
   - "active": Substantive response with reasoning or detail
   - "challenging": Pushback, questions proposing alternatives, new direction, or disagreement

2. **intent**: What is the developer doing in this exchange?
   - "acceptance": Agreeing with AI's proposal or output
   - "rejection": Explicitly rejecting, correcting, or overriding AI's approach
   - "question": Asking for information or clarification
   - "delegation": Handing off a task to the AI with minimal guidance
   - "refinement": Adjusting or improving an existing approach
   - "challenge": Pushing back on assumptions or proposing alternatives

3. **agency**: Who drove this exchange?
   - "developer": Developer initiated the topic, idea, or direction
   - "ai": AI proposed and developer passively accepted
   - "collaborative": Back-and-forth where both contributed substantively
   - "ambiguous": Can't clearly determine who drove it

4. **candidateType**: If this exchange represents a meaningful moment, what type? Use null if it's routine conversation.
   - "proposal": Someone suggests an approach or architecture
   - "discovery": New information surfaces that changes understanding
   - "pivot": Direction changes from what was previously planned
   - "confirmation": A tentative approach becomes accepted
   - "rejection": An approach is explicitly rejected
   - "commitment": A firm decision that shapes subsequent work
   - "struggle": Repeated failed attempts or confusion
   - "breakthrough": A struggle resolves or confusion clears
   - "execution": Sustained implementation of a decided approach
   - null: Routine exchange, not a meaningful moment

## Rules
- Consider the CONTEXT (what the AI said/did before the developer's response) when classifying.
- A developer saying "ok" after a major architectural proposal is passive acceptance (agency: "ai"), not a commitment.
- A developer saying "actually, let's use TypeScript instead" is a rejection with developer agency.
- Short responses like "yes" or "ok" are passive engagement UNLESS they follow a significant question/decision.
- Don't over-classify: most exchanges are routine. Only mark candidateType when something meaningful happened.

Return ONLY a JSON object: { "classifications": [ { "engagement": "...", "intent": "...", "agency": "...", "candidateType": "..." | null }, ... ] }

The array MUST have exactly one entry per exchange, in order."""


def build_classifier_user_prompt(exchanges: list) -> str:
    blocks: list[str] = []
    for i, ex in enumerate(exchanges):
        dev_text = _truncate(ex.dev_event.content.detail, 300)
        context = ""
        ai_texts = [
            _truncate(e.content.detail, 200)
            for e in ex.ai_turn_events
            if e.category in ("proposal", "reflection")
        ][:2]
        if ai_texts:
            context += "\n   AI said: " + " | ".join(ai_texts)
        ai_actions = [
            e.content.summary
            for e in ex.ai_turn_events
            if e.category == "action"
        ][:3]
        if ai_actions:
            context += "\n   AI did: " + ", ".join(ai_actions)
        blocks.append(
            f'{i + 1}. DEV: "{dev_text}" ({ex.dev_response_chars} chars){context}'
        )
    exchange_list = "\n\n".join(blocks)
    return (
        f"Classify each of the following {len(exchanges)} developer-AI "
        f"exchanges:\n\n{exchange_list}"
    )


# ── understand/extract.ts ─────────────────────────────────────────────


def _get_shape_guidance(shape: str) -> str:
    if shape == "janitorial":
        return """## Shape-specific guidance (janitorial session)
Focus on SCOPE moments — what got included, what got excluded, any scope creep. In janitorial sessions, the interesting moments are:
- When the developer decided what to clean up (commitment)
- When they discovered unexpected issues during cleanup (discovery)
- When cleanup scope expanded or contracted (pivot)
- When mechanical work revealed a deeper problem (breakthrough/discovery)
Don't flag every rename or format change as a moment. Look for the decisions, not the keystrokes."""
    if shape == "exploratory":
        return """## Shape-specific guidance (exploratory session)
Focus on INSIGHT moments — what the developer learned, what changed their understanding. In exploratory sessions:
- Key discoveries about how code works or doesn't work
- Moments where investigation direction changed (pivot)
- "Aha" moments where confusion cleared (breakthrough)
- Decisions about what to investigate next (commitment)
Don't flag every file read as a moment. Look for what the developer understood differently after reading."""
    if shape == "debugging":
        return """## Shape-specific guidance (debugging session)
Focus on the HYPOTHESIS-TEST cycle. In debugging sessions:
- Initial hypothesis about the bug (proposal)
- Evidence that confirmed or rejected the hypothesis (confirmation/rejection)
- The actual root cause discovery (breakthrough)
- Failed attempts that narrowed the search (struggle → discovery)
Track the chain of reasoning, not every individual Bash run."""
    if shape == "narrative":
        return """## Shape-specific guidance (narrative session)
This session has a build arc. Focus on:
- The initial intent and how it evolved
- Key architectural decisions (commitment)
- Moments where the plan changed (pivot)
- AI proposals that were accepted vs rejected
- The progression from intent to working code"""
    if shape == "review":
        return """## Shape-specific guidance (review session)
Focus on ASSESSMENT moments:
- Observations about code quality or correctness (discovery)
- Decisions about what to flag or change (commitment)
- Surprising findings (discovery/breakthrough)
Don't flag every file read. Look for judgments and insights."""
    return ""


def _build_directive_guidance(directives) -> str:
    if directives is None:
        return ""
    ps = getattr(directives, "prompt_sections", None)
    if ps is None:
        return ""
    notes: list[str] = []
    if getattr(ps, "detect_passive_acceptance", False):
        notes.append(
            "Note: This session contains many short developer responses. When you see 'yes', 'ok', 'sure' — distinguish active agreement from passive acceptance. This matters for agency classification."
        )
    if getattr(ps, "track_delegation", False):
        notes.append(
            "Note: The developer frequently defers decisions. Look for moments where the AI made choices the developer didn't engage with."
        )
    if getattr(ps, "detect_ignored_proposals", False):
        notes.append(
            "Note: The AI made proposals that the developer didn't fully address. Flag proposals that received no direct response as potential ignored proposals."
        )
    if getattr(ps, "is_learning_exchange", False):
        notes.append(
            "Note: The developer is asking questions to understand. Focus on what insights or understanding emerged, not just what actions were taken."
        )
    if not notes:
        return ""
    return "\n\n## Interaction Signals\n\n" + "\n\n".join(notes)


def build_extract_prompt(
    chunk: SessionChunk,
    session_shape: str,
    directives=None,
    digest_header: Optional[str] = None,
) -> tuple[str, str]:
    directive_guidance = _build_directive_guidance(directives)
    system = f"""You are an expert at identifying meaningful moments in developer coding sessions. You read a sequence of events from one chunk of a session and extract the moments that matter.

A "moment" is a point where something meaningful happened — a decision was made, an insight occurred, direction changed, or a commitment was established. NOT every event is a moment. You are looking for the inflection points.

{MOMENT_TYPES_TAXONOMY}

## Rules

1. **Be specific, not generic.** "Developer rejected AI's suggestion to use a mock database, saying 'actually let's not mock the database, let's use testcontainers'" — not "a decision was made about testing."
2. **Use the developer's own language.** Quote them. If the AI proposed something and the developer accepted, say what the AI proposed AND how the developer responded.
3. **Every moment MUST have evidence.** At least one direct quote from the events.
4. **Distinguish agency clearly.** Who drove this moment? "developer" if they initiated it. "ai" if the AI proposed it and the developer just went along. "collaborative" if there was back-and-forth.
5. **topicFingerprint** should be a short, stable identifier for the topic area (e.g., "auth-middleware", "test-setup", "api-schema"). Use kebab-case. Two moments about the same topic should share a fingerprint.
6. **Fewer is better.** A chunk of 20 events might have 2-5 moments. Don't pad. If nothing meaningful happened, return an empty array.
7. **Opening intent is a moment.** If this is chunk 0, the developer's first substantive message states what they came to do — extract it (usually "commitment" or "proposal", agency "developer").
8. **Cite the event index.** Every evidence item includes "eventIndex": the [N] number shown on the event you are quoting. Quotes must come from the events shown — never from memory.

{AGENCY_RUBRIC}

{_get_shape_guidance(session_shape)}{directive_guidance}

## Output Format

Return ONLY a JSON object:
{{
  "moments": [
    {{
      "type": "proposal|discovery|pivot|confirmation|rejection|commitment|struggle|breakthrough|execution",
      "statement": "What happened, in the developer's own language",
      "significance": "Why this moment matters in the context of the session",
      "agency": "developer|ai|collaborative",
      "topicFingerprint": "kebab-case-topic-id",
      "evidence": [
        {{
          "quote": "Exact or near-exact quote from the events",
          "eventIndex": 12,
          "sourceType": "user|ai|tool_output"
        }}
      ]
    }}
  ]
}}"""

    # User section mirrors TS extract.ts userParts.join("\n") exactly:
    # single-newline joins, digestHeader appended as its own part (it begins
    # with "\n"), and "## Events (...)" as a separate part with blank lines
    # around the rendered events.
    user_parts: list[str] = [
        f"## Session Shape: {session_shape}",
        f"## Chunk {chunk.chunk_index} — Topic: {chunk.topic_hint}",
        f"## Files in scope: {', '.join(chunk.files_in_scope[:15])}",
    ]
    if digest_header:
        user_parts.append(digest_header)
    user_parts.extend(
        [
            f"## Events ({len(chunk.events)} total):",
            "",
            render_chunk_events(chunk.events),
            "",
            "Extract the meaningful moments from this chunk. Return JSON only.",
        ]
    )
    user = "\n".join(user_parts)

    return system, user


# ── understand/weave.ts ───────────────────────────────────────────────


def build_weave_prompt(
    moments: list[ExtractedMoment],
    session_shape: str,
    sittings: list,
) -> tuple[str, str]:
    system = """You are the weave stage of a developer-session understanding pipeline. You receive a flat list of extracted moments (from multiple chunks of the same session) and produce ONLY a decisions object.

Your job is:
1. **Dedup / merge** moments that describe the same event from overlapping chunks (chunk boundaries cause duplicates). When merging, list all source moment ids — primary first.
2. **Drop** moments that are low quality: vague statement AND zero anchored evidence. Give a short reason.
3. **Assign arcs** — group moments into named story arcs (arcId). Use kebab-case names like "auth-refactor", "test-setup". If a moment doesn't fit a named arc, use "general".
4. **Assign arc roles** — within each arc, classify the role: origin / development / turning_point / resolution.
5. **Link related moments** — if moments are causally or thematically related across arcs, list their ids in relatedTo.

## Absolute constraints

- You output DECISIONS about the listed moment ids. You never rewrite statements except when merging (then "statement" combines the merged moments in the developer's language).
- Every input id appears in exactly one decision.
- Never invent ids. Never re-emit evidence — it is carried automatically.
- For drop decisions, include a brief "reason" field.
- For merge decisions with 2+ ids, the "statement" field should combine the merged moments into one crisp statement in the developer's language.

## Output format

Return ONLY a JSON object:
{
  "decisions": [
    {
      "action": "keep" | "merge" | "drop",
      "momentIds": ["c0-m0"],          // all source ids for this decision
      "arcId": "kebab-case-arc-name",  // optional, default "general"
      "arcRole": "origin" | "development" | "turning_point" | "resolution",
      "relatedTo": ["c0-m2"],          // extract ids of related moments
      "statement": "...",              // merge only: new combined statement
      "reason": "..."                  // drop only: why dropped
    }
  ]
}"""

    if sittings:
        sitting_lines = "\n".join(
            f"  sitting {s.sitting_index}: events {s.event_range[0]}–{s.event_range[1]} ({s.started_at} → {s.ended_at})"
            for s in sittings
        )
    else:
        sitting_lines = "(no sitting boundaries)"

    moment_blocks: list[str] = []
    for m in moments:
        anchored_count = sum(1 for e in m.evidence if e.anchored)
        first_ev = m.evidence[0] if m.evidence else None
        quote = first_ev.quote[:120] if first_ev else "(no evidence)"
        moment_blocks.append(
            f"""id: {m.id}
  type: {m.type}
  statement: {m.statement}
  agency: {m.agency}
  confidence: {m.confidence if m.confidence is not None else "null"}
  topic: {m.topic_fingerprint}
  chunk: {m.chunk_index}
  occurredAt: {m.occurred_at if m.occurred_at is not None else "null"}
  anchored_evidence: {anchored_count}/{len(m.evidence)}
  first_quote: "{quote}\""""
        )
    moment_lines = "\n\n".join(moment_blocks)

    user = f"""## Session shape: {session_shape}

## Sitting boundaries
{sitting_lines}

## Extracted moments ({len(moments)} total)

{moment_lines}

Produce the decisions object. Every input id must appear in exactly one decision. Return JSON only."""

    return system, user


# ── understand/verify.ts ──────────────────────────────────────────────


def build_verify_prompt(
    claims: list[dict],
    windows: dict[str, str],
) -> tuple[str, str]:
    system = """You are auditing claims from a coding-session digest against what the tools actually did.
For each claim you get the tool activity (commands, edits, results) from the same part of the session.
- "supported": tool events directly show the claimed thing happened (the test run passed, the commit exists, the command succeeded)
- "contradicted": tool events show the opposite (the test still failed after the claimed fix, the command errored)
- "unverified": the window contains no tool evidence either way
Judge ONLY from the provided events. An assistant SAYING it did something is not tool evidence.

## Output format

Return ONLY a JSON object:
{
  "verdicts": [
    {
      "momentId": "moment-0",
      "verdict": "supported" | "contradicted" | "unverified",
      "note": "brief rationale (optional)"
    }
  ]
}"""

    claim_blocks: list[str] = []
    for claim in claims:
        window = windows.get(claim["momentId"], "(no tool events found)")
        claim_blocks.append(
            f"""### Claim: {claim["momentId"]}
Type: {claim["type"]}
Statement: {claim["statement"]}

Tool events:
{window}"""
        )
    blocks = "\n\n---\n\n".join(claim_blocks)

    user = f"""## Claims to verify ({len(claims)} total)

{blocks}

Return verdicts for all {len(claims)} claims. Return JSON only."""

    return system, user


# ── transitions.ts ────────────────────────────────────────────────────


def build_transitions_prompt(
    moments: list,
    session_shape: str,
    files_in_session: list[str],
) -> tuple[str, str]:
    system = """You are an expert at identifying intent transitions and accepted outcomes in developer coding sessions.

You receive the final set of moments from a session and must extract two things:

## 1. Intent Transitions

An intent transition is when the developer's working intent shifted. NOT every moment is a transition — only the points where what-the-developer-is-trying-to-do actually changed.

Examples:
- "Implement auth middleware" → "Debug auth middleware CORS issue" (triggered by a discovery that CORS headers were missing)
- "Add unit tests for parser" → "Refactor parser to be testable" (triggered by realizing the parser was too coupled)
- "Explore caching options" → "Implement Redis caching layer" (triggered by a commitment to use Redis)

Each transition must cite which moments triggered it (by index into the moments array).

Only flag genuine shifts. If the developer stayed focused on one thing the whole time, return an empty transitions array.

## 2. Accepted Outcomes

An accepted outcome is something the developer produced and accepted during the session. This is NOT just "files were edited" — it's "the developer reached a state they considered done (or at least good enough) for this piece."

Indicators of acceptance:
- Tests passing after implementation
- Developer explicitly saying "that looks good" or moving on to the next thing
- A commit being made
- No further edits to a file/feature after implementation

Each outcome should:
- State what was accomplished in the developer's terms
- List the specific files affected
- Reference supporting moments

If the session was purely exploratory with no concrete outputs, return an empty outcomes array.

## Confidence

"confidence" reflects evidential support, not enthusiasm:
- "high": a direct quote or tool result in the provided events explicitly supports the statement (a test passed, a commit was made, the developer said it).
- "medium": inferred from multiple events but never explicitly stated.
- "low": plausible reading with weak or indirect support.
If you cannot decide, omit the field entirely (it will be recorded as null).

## Output Shape

Respond with ONLY a JSON object of this exact shape:
{
  "transitions": [
    {
      "fromStatement": "...",
      "toStatement": "...",
      "reason": "...",
      "triggeringMomentIndices": [0, 1],
      "arcId": "...",
      "confidence": "high" | "medium" | "low"
    }
  ],
  "outcomes": [
    {
      "statement": "...",
      "supportingMomentIndices": [0, 2],
      "filesAffected": ["src/foo.ts"],
      "confidence": "high" | "medium" | "low"
    }
  ]
}"""

    moment_blocks: list[str] = []
    for i, m in enumerate(moments):
        verif = f" verification={m['verification']}" if m.get("verification") else ""
        evidence = "; ".join(f'"{e["quote"][:100]}"' for e in m["evidence"])
        moment_blocks.append(
            f"""{i}. [{m['type']}] (arc: {m['arcId']}, role: {m['arcRole']}) {m['statement']}
   agency={m['agency']} confidence={m['confidence']}{verif}
   topic={m['topicFingerprint']}
   evidence: {evidence}"""
        )
    moments_str = "\n\n".join(moment_blocks)

    files_str = "\n".join(files_in_session[:40])
    if len(files_in_session) > 40:
        files_str += f"\n... and {len(files_in_session) - 40} more"

    user = f"""## Session Shape: {session_shape}

## Moments ({len(moments)} total):

{moments_str}

## Files touched in session ({len(files_in_session)} total):
{files_str}

Identify intent transitions and accepted outcomes. Return JSON only."""

    return system, user


# ── narrative.ts ──────────────────────────────────────────────────────


def _render_gap(prev_ended_at: str, next_started_at: str) -> str:
    from datetime import datetime

    def _ms(iso: str) -> float:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000

    gap_ms = _ms(next_started_at) - _ms(prev_ended_at)
    gap_hours = gap_ms / (1000 * 60 * 60)
    if gap_hours >= 24:
        days = gap_hours / 24
        return f"after a {days:.1f}-day gap"
    return f"after a {gap_hours:.1f}-hour gap"


def build_narrative_prompt(
    moments: list,
    transitions: list,
    outcomes: list,
    session_shape: str,
    sittings: list,
) -> tuple[str, str]:
    sitting_instruction = ""
    if sittings and len(sittings) > 1:
        sitting_instruction = '\nThis session happened in the sittings listed above. Progression entries must respect sitting boundaries — never narrate work from different sittings as one continuous flow; name the break ("after a two-day gap, ...").\n'

    system = f"""You are a technical narrator for developer coding sessions. You synthesize moments, transitions, and outcomes into a concise narrative that captures what actually happened.
{sitting_instruction}
## Tone

- **Observational** — You report what happened, not what should have happened. You're a historian, not a coach.
- **Evidence-backed** — Every claim maps to specific moments. Don't editorialize.
- **Developer's language** — Use the same terms the developer used. If they called it "the auth thing," don't upgrade it to "authentication module."
- **Never recommend** — Don't say "consider using X" or "it might be better to Y." You are recording, not advising.

## What to produce

### summary
A 2-4 sentence narrative of the session. What did the developer set out to do? What actually happened? How did it end? Use past tense.

### arcs
Each narrative arc represents a coherent thread of activity. Give each arc:
- **title** — Short, descriptive, in the developer's language
- **summary** — 1-2 sentences about what happened in this arc
- **resolution** — "completed" (the arc reached its goal), "abandoned" (developer gave up or moved on), "ongoing" (still in progress when session ended), "merged" (got absorbed into another arc)
- **momentIds** — Indices into the moments array that belong to this arc

### progression
An ordered list of 3-8 statements describing how the session unfolded chronologically. Each statement should be a single sentence. Think of this as a timeline.

### discoveries
Key things the developer learned or uncovered during the session. Only include genuine insights, not trivial observations. Can be empty.

### stabilizedDirections
Decisions or approaches that became established during this session — things that started uncertain but are now settled. Can be empty.

### abandonedDirections
Approaches that were tried and rejected, or directions that were considered but not pursued. Can be empty.

Respond with ONLY a JSON object matching the schema above."""

    # sittings section
    sittings_section = ""
    if sittings:
        s_lines: list[str] = []
        for idx, s in enumerate(sittings):
            gap_note = (
                f", {_render_gap(sittings[idx - 1].ended_at, s.started_at)}"
                if idx > 0
                else ""
            )
            start = s.started_at[:16].replace("T", " ")
            end = s.ended_at[:16].replace("T", " ")
            s_lines.append(
                f"Sitting {idx + 1}: {start} → {end} (events {s.event_range[0]}–{s.event_range[1]}){gap_note}"
            )
        sittings_section = f"## Sittings ({len(sittings)}):\n" + "\n".join(s_lines) + "\n\n"

    moment_blocks: list[str] = []
    for i, m in enumerate(moments):
        top_evidence = "; ".join(f'"{e["quote"][:100]}"' for e in m["evidence"][:2])
        time_note = (
            f" at {m['occurredAt'][:16].replace('T', ' ')}" if m.get("occurredAt") else ""
        )
        ev_block = f"\n   evidence: {top_evidence}" if top_evidence else ""
        moment_blocks.append(
            f"""{i}. [{m['type']}] (arc: {m['arcId']}, {m['arcRole']}) agency={m['agency']}{time_note}
   {m['statement']}
   significance: {m['significance']}{ev_block}"""
        )
    moments_str = "\n".join(moment_blocks)

    if not transitions:
        transitions_str = "(none — developer maintained consistent intent)"
    else:
        transitions_str = "\n".join(
            f"""{i}. "{t['fromStatement']}" → "{t['toStatement']}"
   reason: {t['reason']} (arc: {t['arcId']})"""
            for i, t in enumerate(transitions)
        )

    if not outcomes:
        outcomes_str = "(none — session was exploratory or incomplete)"
    else:
        outcomes_str = "\n".join(
            f"""{i}. {o['statement']}
   files: {", ".join(o['filesAffected'][:10])}"""
            for i, o in enumerate(outcomes)
        )

    user = f"""## Session Shape: {session_shape}

{sittings_section}## Moments ({len(moments)}):
{moments_str}

## Intent Transitions ({len(transitions)}):
{transitions_str}

## Accepted Outcomes ({len(outcomes)}):
{outcomes_str}

Generate the session narrative. Return JSON only."""

    return system, user
