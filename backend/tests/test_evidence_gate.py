"""Adversarial evidence validation (blind review 2026-07-20, B1): the
gate must reject presence-without-substance, not just confirm a string
exists somewhere in the file."""

from quire.analysis.evidence import _substantive, _excerpt_in


def test_trivial_excerpts_carry_no_weight():
    assert not _substantive("+")
    assert not _substantive("def")
    assert not _substantive("   ")
    assert not _substantive("};")
    assert _substantive("if risk_score > threshold:")


def test_scattered_fragments_do_not_match_as_one():
    source = "line one here\nunrelated middle\nline two there"
    # a real contiguous quote matches
    assert _excerpt_in("line one here", source)
    # fragments assembled across non-adjacent lines must NOT (the old
    # newline-flattening normalizer let this through)
    assert not _excerpt_in("line one here\nline two there", source)
