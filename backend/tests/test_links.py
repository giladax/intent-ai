"""Tests for quire.links — session_checks link table and trailer parser.

TDD order: tests first, implementation second. All tests are written to
describe the expected behaviour; they will fail until links.py exists.

Coverage:
- Trailer parsing: real commit range in this repo, multi-trailer commits,
  no-trailer commits, malformed URLs
- SQLAlchemy model: SessionCheck in SQLite in-memory
- Idempotent upsert
- Both query directions: links_for_check, links_for_session
- sessions.yaml projection: pr: field routed through link API
"""
from __future__ import annotations

import pathlib
import re
import subprocess
import uuid

import pytest
import yaml

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

REPO_ROOT = pathlib.Path(__file__).parent.parent.parent  # /path/to/intent-ai


def _git(*args: str, cwd: pathlib.Path | None = None) -> str:
    result = subprocess.run(
        ["git", *args],
        capture_output=True,
        cwd=str(cwd or REPO_ROOT),
    )
    if result.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {result.stderr.decode().strip()}")
    return result.stdout.decode("utf-8", "replace")


def _uid() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def engine():
    """SQLite in-memory engine with session_checks table."""
    from quire.db.engine import make_test_engine
    from quire.db.models import Base
    from quire.links import SessionCheck  # noqa: F401 — ensures table is registered

    eng = make_test_engine()
    Base.metadata.create_all(eng)
    yield eng
    Base.metadata.drop_all(eng)


@pytest.fixture
def sa_session(engine):
    from sqlalchemy.orm import Session
    with Session(engine) as s:
        yield s


@pytest.fixture
def link_store(engine):
    """LinkStore backed by the SQLite test engine."""
    from quire.links import LinkStore
    return LinkStore(engine=engine)


# ---------------------------------------------------------------------------
# 1. Trailer parsing — deterministic, no DB
# ---------------------------------------------------------------------------

class TestTrailerParsing:
    """parse_trailers(git_log_text) -> list[(sha, session_id)] tuples.

    Input format: git log --format=---QUIRE-COMMIT---%n%H%n%B
    Each commit block is: sentinel line, full SHA line, then body.
    """

    # Helper: build synthetic git log text in the sentinel format.
    @staticmethod
    def _log(*commits: tuple[str, str]) -> str:
        """Build sentinel-format git log text from (sha, body) pairs."""
        return "".join(
            f"---QUIRE-COMMIT---\n{sha}\n{body}\n"
            for sha, body in commits
        )

    def test_extracts_session_id_from_single_trailer(self):
        from quire.links import parse_trailers
        sha = "a" * 40
        body = (
            "feat: do something\n\n"
            "Co-Authored-By: Claude <claude@anthropic.com>\n"
            "Claude-Session: https://claude.ai/code/session_016cmqJ7aie4Kap4ZsZraMF1\n"
        )
        result = parse_trailers(self._log((sha, body)))
        assert result == [(sha, "016cmqJ7aie4Kap4ZsZraMF1")]

    def test_no_trailer_yields_empty(self):
        from quire.links import parse_trailers
        sha = "d" * 40
        body = "fix: no session here\n"
        assert parse_trailers(self._log((sha, body))) == []

    def test_malformed_url_no_session_prefix_ignored(self):
        from quire.links import parse_trailers
        sha = "e" * 40
        body = "fix: something\n\nClaude-Session: https://claude.ai/code/NOTASESSION_xyz\n"
        # URL exists but no `session_` prefix → ignored
        assert parse_trailers(self._log((sha, body))) == []

    def test_malformed_url_wrong_domain_ignored(self):
        from quire.links import parse_trailers
        sha = "f" * 40
        body = "fix: something\n\nClaude-Session: https://evil.com/code/session_abc123\n"
        assert parse_trailers(self._log((sha, body))) == []

    def test_multi_trailer_commit_yields_all_sessions(self):
        from quire.links import parse_trailers
        sha = "a" * 40
        body = (
            "feat: multi\n\n"
            "Claude-Session: https://claude.ai/code/session_aaa111\n"
            "Claude-Session: https://claude.ai/code/session_bbb222\n"
        )
        result = parse_trailers(self._log((sha, body)))
        assert len(result) == 2
        assert (sha, "aaa111") in result
        assert (sha, "bbb222") in result

    def test_no_trailer_commit_mixed_with_trailer_commits(self):
        from quire.links import parse_trailers
        sha_a = "a" * 40
        sha_b = "b" * 40
        sha_c = "c" * 40
        log = self._log(
            (sha_a, "feat: has session\n\nClaude-Session: https://claude.ai/code/session_sid1\n"),
            (sha_b, "chore: no session\n"),
            (sha_c, "fix: also has session\n\nClaude-Session: https://claude.ai/code/session_sid2\n"),
        )
        result = parse_trailers(log)
        # sha_b has no trailer — should not appear
        shas = [sha for sha, _ in result]
        assert sha_b not in shas
        assert (sha_a, "sid1") in result
        assert (sha_c, "sid2") in result

    def test_body_line_starting_with_commit_hex_does_not_misalign(self):
        """A commit body that contains a line starting with 'commit <hex>'
        (e.g. a revert subject line or a cherry-pick note) must not cause
        the sentinel-based parser to split the block at the wrong boundary."""
        from quire.links import parse_trailers
        sha = "1" * 40
        # Pathological body: contains a line that looks like a raw-format
        # commit boundary from the old `--format=commit %H%n%B` scheme.
        body = (
            "Revert \"commit deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\"\n\n"
            "This reverts commit 0123456789abcdef0123456789abcdef01234567.\n\n"
            "Claude-Session: https://claude.ai/code/session_pathological1\n"
        )
        result = parse_trailers(self._log((sha, body)))
        # Must find the trailer despite the body line that looks like a commit sentinel
        assert result == [(sha, "pathological1")]


# ---------------------------------------------------------------------------
# 2. Real git range — THIS repo's migration commits
# ---------------------------------------------------------------------------

class TestRealGitRange:
    """Extract trailers from the actual migration range in this repo."""

    # The range used in the controller brief — the backbone of this feature.
    BASE_SHA = "e2c49ec"

    def test_extract_links_from_migration_range(self):
        """The migration range has at least 20 commits with Claude-Session trailers
        and at least 2 distinct session ids. This is the bootstrap dataset."""
        from quire.links import extract_trailer_links

        # Get current HEAD to define the head of the range
        head = _git("rev-parse", "HEAD").strip()
        links = extract_trailer_links(
            base_sha=self.BASE_SHA,
            head_sha=head,
            git_dir=str(REPO_ROOT),
        )
        assert len(links) >= 20, (
            f"Expected >=20 trailer links in migration range, got {len(links)}"
        )
        session_ids = {lnk.session_id for lnk in links}
        assert len(session_ids) >= 2, (
            f"Expected >=2 distinct session ids, got {session_ids}"
        )
        # All links must be trailer kind with confidence 1.0
        for lnk in links:
            assert lnk.kind == "trailer"
            assert lnk.confidence == 1.0
            assert len(lnk.evidence) == 40, (
                f"evidence must be a full SHA-40, got: {lnk.evidence!r}"
            )

    def test_no_trailer_commits_not_included(self):
        """Commits without Claude-Session trailers must not appear."""
        from quire.links import extract_trailer_links

        head = _git("rev-parse", "HEAD").strip()
        links = extract_trailer_links(
            base_sha=self.BASE_SHA,
            head_sha=head,
            git_dir=str(REPO_ROOT),
        )
        # Every link's evidence (commit sha) must have a Claude-Session trailer
        # in its actual commit message.
        for lnk in links:
            commit_msg = _git("log", "-1", "--format=%B", lnk.evidence)
            assert "Claude-Session:" in commit_msg, (
                f"Link evidence {lnk.evidence[:8]} has no Claude-Session trailer"
            )


# ---------------------------------------------------------------------------
# 3. SQLAlchemy model — SessionCheck
# ---------------------------------------------------------------------------

class TestSessionCheckModel:
    def test_table_created(self, engine):
        from sqlalchemy import inspect
        tables = inspect(engine).get_table_names()
        assert "session_checks" in tables

    def test_roundtrip(self, sa_session):
        from quire.links import SessionCheck
        row = SessionCheck(
            id=_uid(),
            session_id="016cmqJ7aie4Kap4ZsZraMF1",
            workspace="backend/workspaces/quire-brain",
            pr_number=5,
            base_sha="a" * 40,
            head_sha="b" * 40,
            kind="trailer",
            confidence=1.0,
            evidence="c" * 40,
        )
        sa_session.add(row)
        sa_session.commit()
        sa_session.expunge_all()

        from sqlalchemy import select
        loaded = sa_session.execute(
            select(SessionCheck).where(SessionCheck.session_id == "016cmqJ7aie4Kap4ZsZraMF1")
        ).scalar_one()
        assert loaded.kind == "trailer"
        assert loaded.confidence == 1.0
        assert loaded.pr_number == 5

    def test_pr_number_nullable(self, sa_session):
        """pr_number may be None — range without a PR number."""
        from quire.links import SessionCheck
        row = SessionCheck(
            id=_uid(),
            session_id="no-pr-session",
            workspace="ws",
            pr_number=None,
            base_sha="a" * 40,
            head_sha="b" * 40,
            kind="trailer",
            confidence=1.0,
            evidence="d" * 40,
        )
        sa_session.add(row)
        sa_session.commit()
        sa_session.expunge_all()

        from sqlalchemy import select
        loaded = sa_session.execute(
            select(SessionCheck).where(SessionCheck.session_id == "no-pr-session")
        ).scalar_one()
        assert loaded.pr_number is None


# ---------------------------------------------------------------------------
# 4. Idempotent upsert
# ---------------------------------------------------------------------------

class TestIdempotentUpsert:
    def test_upsert_creates_on_first_call(self, link_store):
        from quire.links import SessionCheckLink
        link = SessionCheckLink(
            session_id="sid-001",
            workspace="ws1",
            pr_number=7,
            base_sha="a" * 40,
            head_sha="b" * 40,
            kind="trailer",
            confidence=1.0,
            evidence="c" * 40,
        )
        link_store.upsert(link)
        result = link_store.links_for_session("sid-001")
        assert len(result) == 1
        assert result[0].session_id == "sid-001"

    def test_upsert_is_idempotent(self, link_store):
        """Calling upsert twice with the same (session_id, workspace, evidence)
        must not duplicate rows."""
        from quire.links import SessionCheckLink
        link = SessionCheckLink(
            session_id="sid-idem",
            workspace="ws-idem",
            pr_number=3,
            base_sha="a" * 40,
            head_sha="b" * 40,
            kind="trailer",
            confidence=1.0,
            evidence="e" * 40,
        )
        link_store.upsert(link)
        link_store.upsert(link)
        result = link_store.links_for_session("sid-idem")
        assert len(result) == 1, "duplicate upsert must not create extra rows"

    def test_upsert_multiple_sessions_same_check(self, link_store):
        """Multiple sessions may link to the same (workspace, pr_number)."""
        from quire.links import SessionCheckLink
        for i, sid in enumerate(["sid-a", "sid-b", "sid-c"]):
            link_store.upsert(SessionCheckLink(
                session_id=sid,
                workspace="ws-shared",
                pr_number=42,
                base_sha="a" * 40,
                head_sha="b" * 40,
                kind="trailer",
                confidence=1.0,
                evidence=f"{'e' * 38}{i:02d}",
            ))
        result = link_store.links_for_check("ws-shared", 42)
        assert len(result) == 3
        assert {r.session_id for r in result} == {"sid-a", "sid-b", "sid-c"}


# ---------------------------------------------------------------------------
# 5. Both query directions
# ---------------------------------------------------------------------------

class TestQueryDirections:
    def _populate(self, link_store) -> None:
        from quire.links import SessionCheckLink
        # session-A linked to PR 10 and PR 11
        for pr in (10, 11):
            link_store.upsert(SessionCheckLink(
                session_id="session-A",
                workspace="ws-q",
                pr_number=pr,
                base_sha="a" * 40,
                head_sha="b" * 40,
                kind="trailer",
                confidence=1.0,
                evidence=f"e{'0' * 37}{pr}",
            ))
        # session-B linked only to PR 10
        link_store.upsert(SessionCheckLink(
            session_id="session-B",
            workspace="ws-q",
            pr_number=10,
            base_sha="a" * 40,
            head_sha="c" * 40,
            kind="trailer",
            confidence=1.0,
            evidence="f" * 40,
        ))

    def test_links_for_check_returns_all_sessions_for_pr(self, link_store):
        self._populate(link_store)
        result = link_store.links_for_check("ws-q", 10)
        assert {r.session_id for r in result} == {"session-A", "session-B"}

    def test_links_for_check_pr_11_single_result(self, link_store):
        self._populate(link_store)
        result = link_store.links_for_check("ws-q", 11)
        assert len(result) == 1
        assert result[0].session_id == "session-A"

    def test_links_for_check_missing_pr_empty(self, link_store):
        self._populate(link_store)
        assert link_store.links_for_check("ws-q", 999) == []

    def test_links_for_session_returns_all_checks_for_session(self, link_store):
        self._populate(link_store)
        result = link_store.links_for_session("session-A")
        assert {r.pr_number for r in result} == {10, 11}

    def test_links_for_session_missing_session_empty(self, link_store):
        self._populate(link_store)
        assert link_store.links_for_session("ghost-session") == []


# ---------------------------------------------------------------------------
# 6. sessions.yaml projection
# ---------------------------------------------------------------------------

class TestSessionsYamlProjection:
    """The pr: field in sessions.yaml is read/written through the link API.

    The yaml file stays consumable by the existing alignment code (sessions
    still have a `pr:` key); Postgres is the source of truth for links.
    """

    def test_digest_session_with_pr_creates_link(self, tmp_path, link_store):
        """When digest_session is called with pr=N, the link is stored."""
        from quire.links import upsert_from_yaml_record

        record = {
            "session_id": "yaml-session-001",
            "pr": 77,
            "workspace": str(tmp_path),
            "base_sha": "a" * 40,
            "head_sha": "b" * 40,
        }
        upsert_from_yaml_record(record, link_store)
        result = link_store.links_for_session("yaml-session-001")
        assert len(result) == 1
        assert result[0].pr_number == 77
        assert result[0].kind == "attached"  # yaml/CLI-sourced pr: is an explicit human attach
        assert result[0].evidence == "sessions.yaml:yaml-session-001"  # greppable provenance

    def test_digest_session_no_pr_no_link(self, tmp_path, link_store):
        """Records without a pr: field do not create any link."""
        from quire.links import upsert_from_yaml_record

        record = {
            "session_id": "yaml-session-no-pr",
            "pr": None,
            "workspace": str(tmp_path),
            "base_sha": None,
            "head_sha": None,
        }
        upsert_from_yaml_record(record, link_store)
        assert link_store.links_for_session("yaml-session-no-pr") == []

    def test_yaml_sessions_still_have_pr_field(self, tmp_path, link_store):
        """The pr: field remains in sessions.yaml for alignment code consumers."""
        import json
        from quire.session import digest_session, FakeSessionDigester, SessionDigest, Decision

        lines = [
            {"sessionId": "yaml-compat-sess", "timestamp": "2026-07-01T09:00:00Z",
             "message": {"role": "user", "content": "do work"}},
            {"sessionId": "yaml-compat-sess", "timestamp": "2026-07-01T09:01:00Z",
             "message": {"role": "assistant", "content": [
                 {"type": "text", "text": "did the work"},
             ]}},
        ]
        t = tmp_path / "sess.jsonl"
        t.write_text("\n".join(json.dumps(x) for x in lines))

        digester = FakeSessionDigester(SessionDigest(
            title="yaml compat", summary="check yaml pr field",
            decisions=[], reasoning="worked",
        ))
        record = digest_session(
            tmp_path, t, digester, "2026-07-01T10:00:00+00:00", pr=55,
            link_store=link_store,  # explicit test store — never production
        )
        # The YAML record must still carry `pr:` for alignment code consumers.
        assert record["pr"] == 55

        sessions_file = tmp_path / "sessions.yaml"
        sessions = yaml.safe_load(sessions_file.read_text()) or []
        assert any(s.get("pr") == 55 for s in sessions)


# ---------------------------------------------------------------------------
# 7. extract_trailer_links integration — synthetic git repo
# ---------------------------------------------------------------------------

class TestExtractTrailerLinksIntegration:
    """Full round-trip over a temporary git repo."""

    def _make_repo(self, tmp_path: pathlib.Path) -> pathlib.Path:
        repo = tmp_path / "repo"
        repo.mkdir()
        for cmd in [
            ["git", "init", "-q"],
            ["git", "config", "user.email", "t@t"],
            ["git", "config", "user.name", "t"],
        ]:
            subprocess.run(cmd, cwd=str(repo), check=True, capture_output=True)
        return repo

    def _commit(self, repo: pathlib.Path, msg: str, session_id: str | None = None) -> str:
        f = repo / f"f{uuid.uuid4().hex[:6]}.txt"
        f.write_text(msg)
        subprocess.run(["git", "add", "-A"], cwd=str(repo), check=True, capture_output=True)
        full_msg = msg
        if session_id:
            full_msg += f"\n\nClaude-Session: https://claude.ai/code/session_{session_id}"
        subprocess.run(
            ["git", "commit", "-qm", full_msg],
            cwd=str(repo), check=True, capture_output=True,
        )
        return subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=str(repo),
            capture_output=True, text=True,
        ).stdout.strip()

    def test_only_trailer_commits_included(self, tmp_path):
        from quire.links import extract_trailer_links

        repo = self._make_repo(tmp_path)
        base = self._commit(repo, "base commit")
        _sha_no_trailer = self._commit(repo, "no session here")
        sha_with = self._commit(repo, "has session", session_id="sidAAA")
        _sha_no_2 = self._commit(repo, "another no session")
        sha_with2 = self._commit(repo, "second session", session_id="sidBBB")

        links = extract_trailer_links(base_sha=base, head_sha=sha_with2, git_dir=str(repo))
        session_ids = {lnk.session_id for lnk in links}
        assert session_ids == {"sidAAA", "sidBBB"}

    def test_evidence_is_full_sha(self, tmp_path):
        from quire.links import extract_trailer_links

        repo = self._make_repo(tmp_path)
        base = self._commit(repo, "base")
        head = self._commit(repo, "has session", session_id="sidEVID")

        links = extract_trailer_links(base_sha=base, head_sha=head, git_dir=str(repo))
        assert len(links) == 1
        assert links[0].evidence == head  # full 40-char SHA

    def test_multi_trailer_commit(self, tmp_path):
        from quire.links import extract_trailer_links

        repo = self._make_repo(tmp_path)
        base = self._commit(repo, "base")
        # Manually create a commit with two Claude-Session trailers
        f = repo / "multi.txt"
        f.write_text("multi")
        subprocess.run(["git", "add", "-A"], cwd=str(repo), check=True, capture_output=True)
        msg = (
            "multi-session commit\n\n"
            "Claude-Session: https://claude.ai/code/session_multiAAA\n"
            "Claude-Session: https://claude.ai/code/session_multiBBB\n"
        )
        subprocess.run(
            ["git", "commit", "-qm", msg],
            cwd=str(repo), check=True, capture_output=True,
        )
        head = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=str(repo),
            capture_output=True, text=True,
        ).stdout.strip()

        links = extract_trailer_links(base_sha=base, head_sha=head, git_dir=str(repo))
        session_ids = {lnk.session_id for lnk in links}
        assert session_ids == {"multiAAA", "multiBBB"}
        assert all(lnk.evidence == head for lnk in links)

    def test_empty_range_yields_no_links(self, tmp_path):
        from quire.links import extract_trailer_links

        repo = self._make_repo(tmp_path)
        sha = self._commit(repo, "base only")
        # base == head → empty range
        links = extract_trailer_links(base_sha=sha, head_sha=sha, git_dir=str(repo))
        assert links == []
