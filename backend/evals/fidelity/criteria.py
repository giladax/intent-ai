"""Fidelity eval criteria — port of journal/tests/eval/fidelity-criteria.ts.

Each SessionFidelityCriteria defines the expected and forbidden moments
for one digested session. The harness scores the stored digest against
these criteria.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from evals.fidelity.scorers import ExpectedMoment, ForbiddenClaim


@dataclass
class SessionFidelityCriteria:
    cc_session_id: str
    label: str
    raw_log_path: str  # .intent/raw-sessions preferred; fall back to ~/.claude/projects
    expected_moments: list[ExpectedMoment] = field(default_factory=list)
    forbidden_claims: list[ForbiddenClaim] = field(default_factory=list)


FIDELITY_CRITERIA: list[SessionFidelityCriteria] = [
    SessionFidelityCriteria(
        cc_session_id="20f5efec-83cc-4a16-ac34-86728b07ccbf",
        label="large + self-digested mid-life (tail = 65% of session)",
        raw_log_path=".intent/raw-sessions/20f5efec-83cc-4a16-ac34-86728b07ccbf.jsonl",
        expected_moments=[
            # In-window (should already pass at baseline):
            ExpectedMoment(desc="docker disk-full root cause", keywords=["disk", "100%"]),
            ExpectedMoment(desc="port 5433 already-in-use discovery", keywords=["5433"]),
            ExpectedMoment(desc="clean-slate migration decision", keywords=["clean", "migration"]),
            # Additional in-window items from catalog §8:
            ExpectedMoment(
                desc="BrainCardView reversal (sibling-relative-import cause + git restore)",
                keywords=["braincard"],
            ),
            ExpectedMoment(
                desc="parent_topic_id null-mask to full-removal pivot",
                keywords=["parent_topic_id"],
            ),
            # Tail (must pass only after F1 fix + re-digest — pre-registered improvement):
            ExpectedMoment(
                desc="journal-as-product pivot (trees rejected)",
                keywords=["journal", "river"],
            ),
            ExpectedMoment(desc="correspondence chat built", keywords=["correspondence"]),
            ExpectedMoment(desc="topic subsystem excision", keywords=["topic", "excis"]),
            ExpectedMoment(
                desc="scheduled/cron digestion built and running",
                keywords=["digest", "schedule"],
            ),
        ],
        forbidden_claims=[
            ForbiddenClaim(
                desc="fabricated wrong-location edit mechanism (audit F4)",
                keywords=["wrong location"],
            ),
            ForbiddenClaim(
                desc="cron digestion claimed unbuilt (falsified by tail)",
                keywords=["cron", "unbuilt"],
            ),
        ],
    ),
    SessionFidelityCriteria(
        cc_session_id="b9ab1a0c-1315-463d-85e7-3143c9e7fb59",
        label="resumed, 3 sittings over 4 days",
        raw_log_path=".intent/raw-sessions/b9ab1a0c-1315-463d-85e7-3143c9e7fb59.jsonl",
        expected_moments=[
            ExpectedMoment(desc="brain helps the next agent insight", keywords=["next agent"]),
            ExpectedMoment(desc="API-key blocker + resume refocus", keywords=["api key"]),
            ExpectedMoment(
                desc="brain_cards unique-constraint bug (4th bug, dropped)",
                keywords=["brain_cards"],
            ),
            # Additional from catalog §1:
            ExpectedMoment(
                desc="rag-readiness requirement (embedding column, pgvector)",
                keywords=["rag"],
            ),
            ExpectedMoment(
                desc="index-layer architecture decision (layer on top of events)",
                keywords=["layer on top"],
            ),
        ],
        forbidden_claims=[
            ForbiddenClaim(
                desc="all 5 tools confirmed (only 3 invoked — audit F4)",
                keywords=["all 5", "confirm"],
            ),
        ],
    ),
    SessionFidelityCriteria(
        cc_session_id="5b31a1bb-3f6b-4d03-b418-a6c0f0ab704c",
        label="17/17-high-confidence symptom case",
        raw_log_path=".intent/raw-sessions/5b31a1bb-3f6b-4d03-b418-a6c0f0ab704c.jsonl",
        expected_moments=[
            ExpectedMoment(
                desc="30-day log purge discovery (rewrote PRD scope)",
                keywords=["30", "purge"],
            ),
            ExpectedMoment(
                desc="developer prompted the UI redesign",
                keywords=["redesign"],
                agency="developer",
            ),
            # Additional from catalog §1:
            ExpectedMoment(
                desc="emit-events chronology bug (all events stamped at digest time)",
                keywords=["emit", "chronology"],
            ),
        ],
        forbidden_claims=[
            ForbiddenClaim(
                desc="vi.hoisted claimed to unblock tests (a later fix did — audit F4)",
                keywords=["hoisted", "unblock"],
            ),
            ForbiddenClaim(
                desc="ai identified redesign without being prompted (inverts developer initiative)",
                keywords=["without being prompted"],
            ),
        ],
    ),
    SessionFidelityCriteria(
        cc_session_id="d73d5190-3683-4204-9e04-d325a7bb6527",
        label="short (15 min) — intent dropped, agency inverted",
        raw_log_path=".intent/raw-sessions/d73d5190-3683-4204-9e04-d325a7bb6527.jsonl",
        expected_moments=[
            ExpectedMoment(
                desc="founding requirement: activity event table + derived memory",
                keywords=["activity", "event"],
                agency="developer",
            ),
            ExpectedMoment(
                desc="file-sink vs DB gap discovery",
                keywords=["file", "sink"],
                agency="ai",
            ),
            # Additional from catalog §1:
            ExpectedMoment(
                desc="open A/B/C architectural fork at session end",
                keywords=["persist daemon events", "activity log"],
            ),
        ],
        forbidden_claims=[],
    ),
]
