"""Tests for feed.py — deterministic core + cache staleness + canned-LLM paths.

All tests here are offline (no DB, no real LLM calls).
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

import pytest

from quire.journal.feed import (
    build_fallback_deep,
    build_fallback_lede_fallback_text,
    build_fallback_lede_headline,
    build_fallback_story_headline,
    build_feed_cache_key,
    build_skeleton_feed,
    compute_heat_score,
    contains_banned_words,
    deduplicate_trending,
    filter_citations,
    heat_label,
    is_cache_stale,
    rank_trending,
)


# ── compute_heat_score ───────────────────────────────────────────────────────


def test_heat_score_empty_events():
    assert compute_heat_score([], datetime.now(timezone.utc)) == 0.0


def test_heat_score_single_fresh_event():
    now = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    events = [{"timestamp": now.isoformat(), "featureId": "f1"}]
    score = compute_heat_score(events, now)
    assert abs(score - 1.0) < 1e-9


def test_heat_score_event_12h_old_contributes_half():
    now = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    twelve_hours_ago = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    events = [{"timestamp": twelve_hours_ago.isoformat(), "featureId": "f1"}]
    score = compute_heat_score(events, now)
    # exp(-12 * ln2 / 12) = exp(-ln2) = 0.5
    assert abs(score - 0.5) < 1e-6


def test_heat_score_multiple_events_sum():
    now = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    events = [
        {"timestamp": now.isoformat(), "featureId": "f1"},
        {"timestamp": now.isoformat(), "featureId": "f1"},
    ]
    score = compute_heat_score(events, now)
    assert abs(score - 2.0) < 1e-9


def test_recent_events_score_higher_than_old():
    now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
    recent = [{"timestamp": "2026-07-22T11:00:00+00:00", "featureId": "f1"}]
    old = [{"timestamp": "2026-07-21T00:00:00+00:00", "featureId": "f2"}]
    assert compute_heat_score(recent, now) > compute_heat_score(old, now)


def test_heat_score_ignores_malformed_timestamps():
    now = datetime.now(timezone.utc)
    events = [{"timestamp": "not-a-date", "featureId": "f1"}]
    assert compute_heat_score(events, now) == 0.0


# ── heat_label ───────────────────────────────────────────────────────────────


def test_heat_label_hot():
    assert heat_label(8.0) == "hot"
    assert heat_label(100.0) == "hot"


def test_heat_label_hot_boundary():
    assert heat_label(8.0) == "hot"


def test_heat_label_still_warm():
    assert heat_label(2.0) == "still warm"
    assert heat_label(7.9) == "still warm"


def test_heat_label_still_warm_boundary():
    assert heat_label(2.0) == "still warm"


def test_heat_label_cooling():
    assert heat_label(0.0) == "cooling"
    assert heat_label(1.9) == "cooling"


# ── rank_trending ────────────────────────────────────────────────────────────


def test_rank_trending_empty():
    assert rank_trending([], datetime.now(timezone.utc)) == []


def test_rank_trending_sorted_descending():
    now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
    items = [
        {
            "featureId": "f1",
            "featureName": "Alpha",
            "events": [{"timestamp": "2026-07-22T06:00:00+00:00", "featureId": "f1"}],
        },
        {
            "featureId": "f2",
            "featureName": "Beta",
            "events": [
                {"timestamp": "2026-07-22T11:00:00+00:00", "featureId": "f2"},
                {"timestamp": "2026-07-22T11:30:00+00:00", "featureId": "f2"},
                {"timestamp": "2026-07-22T11:45:00+00:00", "featureId": "f2"},
            ],
        },
    ]
    ranked = rank_trending(items, now)
    assert ranked[0]["featureId"] == "f2"


def test_rank_trending_max_items():
    now = datetime.now(timezone.utc)
    items = [
        {
            "featureId": f"f{i}",
            "featureName": f"F{i}",
            "events": [{"timestamp": now.isoformat(), "featureId": f"f{i}"}],
        }
        for i in range(10)
    ]
    assert len(rank_trending(items, now, max_items=3)) == 3


def test_rank_trending_adds_heat_fields():
    now = datetime.now(timezone.utc)
    items = [
        {"featureId": "f1", "featureName": "X", "events": [{"timestamp": now.isoformat(), "featureId": "f1"}]}
    ]
    ranked = rank_trending(items, now)
    assert "heatScore" in ranked[0]
    assert "heatLabel" in ranked[0]
    assert "eventCount" in ranked[0]
    assert ranked[0]["eventCount"] == 1


# ── is_cache_stale ───────────────────────────────────────────────────────────


def test_cache_fresh_within_min_age():
    entry = {"composedAt": datetime.now(timezone.utc), "eventCountAtCompose": 100}
    assert is_cache_stale(entry, 101) is False


def test_cache_stale_new_events_after_min_age():
    six_min_ago = datetime.now(timezone.utc) - timedelta(minutes=6)
    entry = {"composedAt": six_min_ago, "eventCountAtCompose": 100}
    assert is_cache_stale(entry, 101) is True


def test_cache_stale_older_than_1_hour():
    old = datetime.now(timezone.utc) - timedelta(hours=2)
    entry = {"composedAt": old, "eventCountAtCompose": 100}
    assert is_cache_stale(entry, 100) is True


def test_cache_not_stale_same_count_recent():
    entry = {"composedAt": datetime.now(timezone.utc), "eventCountAtCompose": 100}
    assert is_cache_stale(entry, 100) is False


def test_cache_degraded_stale_after_5_min():
    six_min_ago = datetime.now(timezone.utc) - timedelta(minutes=6)
    entry = {"composedAt": six_min_ago, "eventCountAtCompose": 100}
    # degraded=True uses 5-min TTL; 6 minutes old → stale
    assert is_cache_stale(entry, 100, degraded=True) is True


# ── build_feed_cache_key ─────────────────────────────────────────────────────


def test_build_feed_cache_key():
    assert build_feed_cache_key() == "org"


# ── build_fallback_story_headline ────────────────────────────────────────────


def test_story_headline_uses_first_summary():
    summaries = ["[outcome.verified] Digest quality was audited yesterday. More detail follows."]
    h = build_fallback_story_headline(summaries, "Activity Event Backbone")
    assert h == "Digest quality was audited yesterday."
    assert "Activity Event Backbone" not in h


def test_story_headline_strips_category_prefix():
    h = build_fallback_story_headline(["[struggle.blocked] The build broke on ESM imports."], "F")
    assert h.startswith("The build broke")
    assert "[" not in h


def test_story_headline_caps_at_12_words():
    long_summary = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen more"
    h = build_fallback_story_headline([long_summary], "F")
    words = h.replace(".", "").split()
    assert len(words) <= 12


def test_story_headline_fallback_to_feature_name_empty():
    assert build_fallback_story_headline([], "My Feature") == "My Feature"


def test_story_headline_fallback_to_feature_name_blank():
    assert build_fallback_story_headline([""], "My Feature") == "My Feature"


def test_story_headline_no_undefined_leak():
    h = build_fallback_story_headline([], "My Feature")
    assert "undefined" not in h.lower()


# ── build_fallback_lede_headline ─────────────────────────────────────────────


def test_lede_headline_org_level():
    h = build_fallback_lede_headline(None, 3)
    assert h == "3 active features."


def test_lede_headline_singular():
    assert build_fallback_lede_headline(None, 1) == "1 active feature."


def test_lede_headline_plural():
    assert build_fallback_lede_headline([], 4) == "4 active features."
    assert build_fallback_lede_headline([], 2) == "2 active features."


def test_lede_headline_ignores_summaries():
    # summaries arg is unused — always org-level count
    h = build_fallback_lede_headline(
        ["[outcome] The daemon was sinking events to a file and not the DB. Fixed."], 3
    )
    assert h == "3 active features."


# ── build_fallback_lede_fallback_text ───────────────────────────────────────


def test_lede_fallback_text_singular():
    assert build_fallback_lede_fallback_text(1) == "Quire has active work across 1 feature."


def test_lede_fallback_text_plural():
    assert build_fallback_lede_fallback_text(3) == "Quire has active work across 3 features."


def test_lede_fallback_text_custom_org():
    t = build_fallback_lede_fallback_text(2, org_name="Acme")
    assert t == "Acme has active work across 2 features."


# ── build_fallback_deep ──────────────────────────────────────────────────────


def test_fallback_deep_empty_list():
    assert build_fallback_deep([]) == {}


def test_fallback_deep_only_one_summary():
    assert build_fallback_deep(["[a] Only one event."]) == {}


def test_fallback_deep_uses_remaining_summaries():
    summaries = [
        "[a] First event used by the dek.",
        "[b] Second event with a new angle. Extra detail.",
        "[c] Third event happened.",
        "[d] Fourth event closed the loop.",
    ]
    result = build_fallback_deep(summaries)
    assert "deep" in result
    assert "First event" not in result["deep"]
    assert "Second event" in result["deep"]
    assert "Third event" in result["deep"]


def test_fallback_deep_two_paragraphs_when_more_than_2():
    summaries = [
        "[a] First.",
        "[b] Second event here.",
        "[c] Third event here.",
        "[d] Fourth event here.",
    ]
    result = build_fallback_deep(summaries)
    assert result["deep"].count("\n\n") >= 1


def test_fallback_deep_headline_from_second_summary():
    summaries = [
        "[a] First event used by the dek.",
        "[b] Second event with a new angle.",
        "[c] Third event.",
    ]
    result = build_fallback_deep(summaries)
    assert result.get("deepHeadline") == "Second event with a new angle."


def test_fallback_deep_strips_category_prefixes():
    summaries = ["[a] First.", "[b] Second event.", "[c] Third."]
    result = build_fallback_deep(summaries)
    assert "[b]" not in result.get("deep", "")
    assert "[c]" not in result.get("deep", "")


# ── filter_citations ─────────────────────────────────────────────────────────


def test_filter_citations_drops_unknown():
    db = ["sess-aaa", "sess-bbb"]
    model = ["sess-aaa", "fabricated-xyz", "sess-bbb", "made-up-123"]
    assert filter_citations(model, db) == ["sess-aaa", "sess-bbb"]


def test_filter_citations_empty_known():
    assert filter_citations(["any"], []) == []


def test_filter_citations_empty_model():
    assert filter_citations([], ["real"]) == []


def test_filter_citations_preserves_order():
    db = ["a", "b", "c"]
    model = ["c", "a"]
    assert filter_citations(model, db) == ["c", "a"]


def test_filter_citations_all_fabricated():
    assert filter_citations(["fake1", "fake2"], ["real1", "real2"]) == []


# ── contains_banned_words ────────────────────────────────────────────────────


def test_banned_words_river():
    assert contains_banned_words("The river of events keeps flowing") is True


def test_banned_words_sitting():
    assert contains_banned_words("Sitting 3 opened a new branch") is True


def test_banned_words_correspondence():
    assert contains_banned_words("The correspondence covers many topics") is True


def test_banned_words_edition():
    assert contains_banned_words("This edition brings big changes") is True


def test_banned_words_unfolded():
    assert contains_banned_words("The story unfolded over many sessions") is True


def test_banned_words_clean_copy():
    assert contains_banned_words("The team fixed 3 bugs and shipped the auth refactor.") is False


def test_banned_words_case_insensitive():
    assert contains_banned_words("RIVER of changes") is True
    assert contains_banned_words("River of changes") is True


def test_banned_words_no_partial_match():
    # "delivery" doesn't contain whole-word "river"
    assert contains_banned_words("Fast delivery to production") is False


def test_banned_words_babysitting_not_sitting():
    assert contains_banned_words("babysitting the process") is False


# ── deduplicate_trending ─────────────────────────────────────────────────────


def test_dedup_keeps_items_with_no_evidence():
    items = [
        {"featureId": "f1", "featureName": "F1", "heatScore": 5.0, "heatLabel": "still warm", "eventCount": 3},
        {"featureId": "f2", "featureName": "F2", "heatScore": 3.0, "heatLabel": "still warm", "eventCount": 2},
    ]
    result = deduplicate_trending(items, {})
    assert len(result) == 2


def test_dedup_suppresses_heavy_overlap():
    items = [
        {"featureId": "f1", "featureName": "F1", "heatScore": 5.0, "heatLabel": "still warm", "eventCount": 3},
        {"featureId": "f2", "featureName": "F2", "heatScore": 3.0, "heatLabel": "still warm", "eventCount": 2},
    ]
    evidence = {
        "f1": {"summaries": [], "sessionIds": ["s1", "s2", "s3"], "actorInitials": []},
        "f2": {"summaries": [], "sessionIds": ["s1", "s2", "s3"], "actorInitials": []},  # 100% overlap
    }
    result = deduplicate_trending(items, evidence)
    assert len(result) == 1
    assert result[0]["featureId"] == "f1"


def test_dedup_keeps_partial_overlap():
    items = [
        {"featureId": "f1", "featureName": "F1", "heatScore": 5.0, "heatLabel": "still warm", "eventCount": 3},
        {"featureId": "f2", "featureName": "F2", "heatScore": 3.0, "heatLabel": "still warm", "eventCount": 2},
    ]
    evidence = {
        "f1": {"summaries": [], "sessionIds": ["s1", "s2"], "actorInitials": []},
        "f2": {"summaries": [], "sessionIds": ["s1", "s3"], "actorInitials": []},  # 50% overlap = kept
    }
    result = deduplicate_trending(items, evidence)
    assert len(result) == 2


def test_dedup_max_items():
    items = [
        {"featureId": f"f{i}", "featureName": f"F{i}", "heatScore": float(10 - i), "heatLabel": "hot", "eventCount": 1}
        for i in range(10)
    ]
    result = deduplicate_trending(items, {}, max_items=3)
    assert len(result) == 3


# ── build_skeleton_feed ───────────────────────────────────────────────────────


def test_build_skeleton_feed_shape():
    feed = build_skeleton_feed()
    assert feed["editionNumber"] == 0
    assert "composedAt" in feed
    assert "lede" in feed
    assert feed["trending"] == []
    assert "Nothing is digested yet" in feed["lede"]["text"]


# ── Canned-LLM offline tests (compose_feed_editorial) ────────────────────────


def test_compose_feed_editorial_uses_lede_fallback_on_api_error(monkeypatch):
    """compose_feed_editorial falls back to deterministic lede when API call fails."""
    from quire.journal.feed import compose_feed_editorial

    def _fail(*args, **kwargs):
        raise RuntimeError("No API key in test")

    monkeypatch.setattr("quire.journal.feed._call_sonnet", _fail)

    items = [
        {"featureId": "f1", "featureName": "Auth Refactor", "heatScore": 9.0, "heatLabel": "hot", "eventCount": 5},
    ]
    evidence = {
        "f1": {
            "summaries": ["[outcome] Auth token refresh fixed.", "[struggle] DB connection pool exhausted."],
            "sessionIds": ["sess-abc"],
            "actorInitials": ["GK"],
        }
    }
    result = compose_feed_editorial(items, "Quire", evidence, edition_number=3)
    assert result["lede"]["text"] == "Quire has active work across 1 feature."
    assert result["editionNumber"] == 3
    assert len(result["trending"]) == 1
    assert result["trending"][0]["featureName"] == "Auth Refactor"


def test_compose_feed_editorial_voice_guard(monkeypatch):
    """If LLM returns banned words in story, falls back to deterministic copy."""
    from quire.journal.feed import StoryOutput, LedeOutput, compose_feed_editorial

    def _mock_call(system, user, schema):
        if schema is LedeOutput:
            return schema(headline="Active work on 1 feature.", body="The team shipped auth.", citedSessionIds=[])
        # Return story with banned words — should trigger fallback
        return schema(
            headline="The river of changes flowed today.",
            dek="The sitting started well.",
            openQuestion="What next?",
            deepHeadline=None,
            deep=None,
            citedSessionIds=[],
        )

    monkeypatch.setattr("quire.journal.feed._call_sonnet", _mock_call)

    items = [
        {"featureId": "f1", "featureName": "Auth Refactor", "heatScore": 9.0, "heatLabel": "hot", "eventCount": 5},
    ]
    evidence = {
        "f1": {
            "summaries": ["[outcome] Auth token refresh fixed."],
            "sessionIds": ["sess-abc"],
            "actorInitials": ["GK"],
        }
    }
    result = compose_feed_editorial(items, "Quire", evidence, edition_number=1)
    story = result["trending"][0]
    assert "river" not in story["headline"].lower()
    assert "sitting" not in story["dek"].lower()


def test_compose_feed_editorial_citation_validation(monkeypatch):
    """Fabricated citation ids from model are dropped."""
    from quire.journal.feed import StoryOutput, LedeOutput, compose_feed_editorial

    def _mock_call(system, user, schema):
        if schema is LedeOutput:
            return schema(headline="3 active features.", body="Work ongoing.", citedSessionIds=[])
        return schema(
            headline="Auth refactor landed.",
            dek="Token refresh now works correctly.",
            openQuestion="What about refresh token rotation?",
            deepHeadline=None,
            deep=None,
            citedSessionIds=["sess-real", "sess-fabricated-xyz"],
        )

    monkeypatch.setattr("quire.journal.feed._call_sonnet", _mock_call)

    items = [
        {"featureId": "f1", "featureName": "Auth", "heatScore": 9.0, "heatLabel": "hot", "eventCount": 3},
    ]
    evidence = {
        "f1": {
            "summaries": ["[outcome] Auth fixed."],
            "sessionIds": ["sess-real"],
            "actorInitials": ["GK"],
        }
    }
    result = compose_feed_editorial(items, "Quire", evidence, edition_number=1)
    story = result["trending"][0]
    # fabricated id should be dropped
    assert "sess-fabricated-xyz" not in story["citedSessionIds"]
    assert "sess-real" in story["citedSessionIds"]


def test_compose_feed_editorial_lede_always_empty_citations(monkeypatch):
    """Lede citedSessionIds is always [] regardless of what model returns."""
    from quire.journal.feed import LedeOutput, compose_feed_editorial

    def _mock_call(system, user, schema):
        if schema is LedeOutput:
            return schema(headline="Headline.", body="Body text.", citedSessionIds=["some-session-id"])
        # Story won't be called for idx >= 1 items
        from quire.journal.feed import StoryOutput
        return StoryOutput(headline="Story.", dek="Dek.", openQuestion="Q?")

    monkeypatch.setattr("quire.journal.feed._call_sonnet", _mock_call)

    items = [
        {"featureId": "f1", "featureName": "F1", "heatScore": 5.0, "heatLabel": "still warm", "eventCount": 2},
    ]
    result = compose_feed_editorial(items, "Quire", {}, edition_number=1)
    assert result["lede"]["citedSessionIds"] == []
