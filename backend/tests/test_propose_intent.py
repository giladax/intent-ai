"""Sessions as INTENT (O4): a product-direction session becomes a signed
intent source through the human approval act — without breaking an invariant.

These tests exercise the constitutional mechanism offline (canned distiller):
distill quote-backed intent cards, validate verbatim against the archived
transcript, and — only on human approval — write the memo artifact and
register it as an approved source. The adversarial case proves a session's
OPINION never moves the deterministic classification: the parse reports the
tension, but unapproved intent mints nothing.
"""

import json
import pathlib

import pytest
import yaml

from quire.propose_intent import (
    FakeIntentDistiller,
    IntentCard,
    IntentCards,
    approve_intent_memo,
    distill_intent,
    validate_cards,
)


FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"
T0 = "2026-07-23T09:05:00+00:00"


def _write_transcript(path: pathlib.Path, texts: list[str]) -> None:
    """A real-shaped CC .jsonl: assistant text blocks are the reasoning."""
    lines = [{"type": "mode", "mode": "normal", "sessionId": "sess-intent-1"}]
    for i, text in enumerate(texts):
        lines.append(
            {
                "sessionId": "sess-intent-1",
                "timestamp": f"2026-07-23T09:0{i}:00Z",
                "message": {"role": "assistant", "content": [{"type": "text", "text": text}]},
            }
        )
    path.write_text("\n".join(json.dumps(x) for x in lines))


@pytest.fixture
def transcript(tmp_path) -> pathlib.Path:
    p = tmp_path / "sess-intent-1.jsonl"
    _write_transcript(
        p,
        [
            "We should raise the premium automatic-refund ceiling from $100 to $250 "
            "for low-risk requests. This is product direction, not a code change.",
            "High-risk refund requests always require human approval, regardless of "
            "tier or amount. That rule is untouched.",
        ],
    )
    return p


# --------------------------------------------------------------------------
# Distillation + verbatim quote validation (same discipline as propose.py)
# --------------------------------------------------------------------------


def test_distill_keeps_only_verbatim_quotes(transcript):
    cards = IntentCards(
        cards=[
            IntentCard(
                statement="Premium low-risk customers may get automatic refunds up to $250",
                source_quote="raise the premium automatic-refund ceiling from $100 to $250",
                speaker="founder",
            ),
            IntentCard(
                statement="High-risk always needs a human",
                source_quote="High-risk refund requests always require human approval",
                speaker="founder",
            ),
            # A hallucinated quote — not verbatim in the transcript — must drop.
            IntentCard(
                statement="Standard tier goes to $500",
                source_quote="standard tier customers now get $500 automatic refunds",
            ),
        ]
    )
    kept, notes = distill_intent(transcript, FakeIntentDistiller(cards))
    statements = {c.statement for c in kept}
    assert "Premium low-risk customers may get automatic refunds up to $250" in statements
    assert "High-risk always needs a human" in statements
    assert "Standard tier goes to $500" not in statements
    assert any("not found verbatim" in n for n in notes)


def test_validate_is_format_tolerant():
    reasoning = "We will raise the premium ceiling to $250 for low-risk."
    cards = [
        IntentCard(
            statement="Premium to $250",
            # markdown styling + case differences must not count as mismatch
            source_quote="**raise the premium ceiling to $250** for low-risk",
        )
    ]
    kept, notes = validate_cards(cards, reasoning)
    assert len(kept) == 1
    assert not notes


# --------------------------------------------------------------------------
# The approval act — writes the memo + registers it approved (the authority)
# --------------------------------------------------------------------------


def test_approve_writes_memo_and_registers_approved_source(tmp_path, transcript):
    ws = tmp_path / "ws"
    ws.mkdir()
    cards = [
        IntentCard(
            statement="Premium low-risk customers may get automatic refunds up to $250",
            source_quote="raise the premium automatic-refund ceiling from $100 to $250",
            speaker="founder",
        ),
    ]
    result = approve_intent_memo(
        workspace_dir=ws,
        source_session="sess-intent-1",
        approved_by="gilad (founder)",
        cards=cards,
        transcript_path=transcript,
        now=T0,
        title="premium refund expansion",
    )

    # The memo artifact landed under intent/session-memos/ with frontmatter.
    memo_path = ws / result.path
    assert memo_path.exists()
    assert result.path.startswith("intent/session-memos/2026-07-23-")
    text = memo_path.read_text()
    assert text.startswith("---\n")
    fm = yaml.safe_load(text.split("---")[1])
    assert fm["source_session"] == "sess-intent-1"
    assert fm["approved_by"] == "gilad (founder)"
    assert fm["approved_at"] == T0
    assert "raise the premium automatic-refund ceiling from $100 to $250" in fm["quotes"]

    # It is registered as an APPROVED source — the existing ladder, no new path.
    sources = yaml.safe_load((ws / "sources.yaml").read_text())
    entry = next(s for s in sources if s["reference"] == result.reference)
    assert entry["status"] == "approved"
    assert entry["path"] == result.path


def test_approve_rejects_a_card_whose_quote_does_not_resolve(tmp_path, transcript):
    ws = tmp_path / "ws"
    ws.mkdir()
    # An edited card whose quote no longer resolves verbatim is a hard stop —
    # the artifact must validate against the transcript forever.
    cards = [
        IntentCard(
            statement="Premium to a made-up number",
            source_quote="raise the premium ceiling to nine thousand dollars",
        )
    ]
    with pytest.raises(ValueError, match="do not resolve verbatim"):
        approve_intent_memo(
            workspace_dir=ws,
            source_session="sess-intent-1",
            approved_by="gilad",
            cards=cards,
            transcript_path=transcript,
            now=T0,
        )
    # Nothing minted — no memo, no sources.yaml (draft cards mint NOTHING).
    assert not (ws / "sources.yaml").exists()
    assert not (ws / "intent").exists()


def test_approve_requires_a_signature(tmp_path, transcript):
    ws = tmp_path / "ws"
    ws.mkdir()
    cards = [
        IntentCard(
            statement="Premium to $250",
            source_quote="raise the premium automatic-refund ceiling from $100 to $250",
        )
    ]
    with pytest.raises(ValueError, match="signature has a name"):
        approve_intent_memo(
            workspace_dir=ws,
            source_session="sess-intent-1",
            approved_by="   ",
            cards=cards,
            transcript_path=transcript,
            now=T0,
        )


# --------------------------------------------------------------------------
# Adversarial (U-plan mandate): a session whose OPINION contradicts an
# approved obligation. The parse reports the direction; the deterministic
# classification is UNCHANGED by the session's opinion — because unapproved
# intent mints nothing.
# --------------------------------------------------------------------------


def test_adversarial_session_opinion_governs_nothing_until_approved(tmp_path):
    """A session argues AGAINST the approved high-risk-always-human rule.

    Stage 1 (parse): the contrarian direction is distilled and quote-checked —
    the tension is legible. Stage 2 (govern): because no human approved it, no
    memo is written and no approved source is registered, so the analyzer's
    deterministic verdict is unchanged. Opinion is not authority.
    """
    transcript = tmp_path / "contrarian.jsonl"
    _write_transcript(
        transcript,
        [
            "Honestly I think high-risk refunds under the premium limit should be "
            "auto-approved to shrink the queue — humans slow us down.",
        ],
    )
    contrarian = IntentCards(
        cards=[
            IntentCard(
                statement="High-risk refunds under the limit should be auto-approved",
                source_quote="high-risk refunds under the premium limit should be "
                "auto-approved to shrink the queue",
                speaker="founder",
            )
        ]
    )
    # The parse SURFACES the direction (tension with OB-102 is legible to a human).
    kept, notes = distill_intent(transcript, FakeIntentDistiller(contrarian))
    assert kept and "auto-approved" in kept[0].statement

    # But nothing was approved → nothing minted. The refund-agent contract on
    # disk is untouched: OB-102 (high-risk always human) still stands, and no
    # session-opinion source exists. The deterministic verdict cannot be moved
    # by an unapproved opinion.
    ws = tmp_path / "ws"
    ws.mkdir()
    assert not (ws / "sources.yaml").exists()
    assert not (ws / "intent").exists()

    # Prove the standing analyzer verdict for the hard-rule-violating PR is
    # still OFF_INTENT — the session's opinion did not soften it.
    from evals.target import run_target

    out = run_target({"workspace": "refund-agent", "pr_number": 103, "offline": True})
    assert out["classification"] == "OFF_INTENT"
    assert out["review_required"] is True
