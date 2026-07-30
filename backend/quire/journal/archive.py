"""Archive helpers — ported from journal/src/web/archive.ts and
journal/src/pipeline/orchestrator.ts::archiveRawSession.

Reads the raw-session archive from backend/.intent/raw-sessions/ and
joins it against digested sessions by source_hash. Also owns the write
side: archive_raw_session copies a digested .jsonl into the archive.
"""
from __future__ import annotations

from pathlib import Path
from typing import Callable


def get_archive_dir() -> Path:
    """Return the canonical archive directory (backend/.intent/raw-sessions/)."""
    return Path(__file__).parent.parent.parent / ".intent" / "raw-sessions"


def archive_raw_session(
    log_path: Path | str,
    warn: Callable[[str], None] | None = None,
    archive_dir: Path | None = None,
) -> Path | None:
    """Copy a raw session .jsonl into the archive directory.

    Port of orchestrator.ts::archiveRawSession. Claude Code purges its logs
    on a ~30-day clock; the digest must never be the only survivor. Semantics:
    - skip when the destination exists and is >= the source size
    - re-copy when the source has grown (a resumed session)
    - failure-safe: NEVER raises — archive failure must never fail the digest.

    Returns the destination path when a copy happened, None otherwise
    (skipped or failed). `warn` receives the error message on failure.
    """
    try:
        import shutil

        src = Path(log_path)
        dir_ = archive_dir if archive_dir is not None else get_archive_dir()
        dir_.mkdir(parents=True, exist_ok=True)
        dest = dir_ / src.name  # .jsonl filename == CC session id
        src_size = src.stat().st_size
        if dest.exists() and dest.stat().st_size >= src_size:
            return None
        shutil.copy2(str(src), str(dest))
        return dest
    except Exception as err:  # noqa: BLE001 — failure-safe by contract
        if warn is not None:
            try:
                warn(str(err))
            except Exception:
                pass
        return None


def read_raw_session_archive(dir_: Path | str | None = None) -> list[dict]:
    """Read the raw-session archive directory.

    Fail-safe: any filesystem problem returns what could be read — worst case
    an empty list, never a raise.
    """
    d = Path(dir_) if dir_ else get_archive_dir()
    try:
        names = list(d.iterdir())
    except Exception:
        return []
    files = []
    for p in names:
        if not p.name.endswith(".jsonl"):
            continue
        try:
            st = p.stat()
            if not p.is_file():
                continue
            import datetime
            files.append({
                "file": p.name,
                "hash": p.stem,  # basename without .jsonl
                "sizeBytes": st.st_size,
                "lastModified": datetime.datetime.fromtimestamp(
                    st.st_mtime, tz=datetime.timezone.utc
                ).isoformat(),
            })
        except Exception:
            pass
    return files


def join_archive(files: list[dict], sessions: list[dict]) -> list[dict]:
    """Join raw archive files against digested sessions by source_hash.

    Returns entries newest-first by lastModified.
    """
    by_hash: dict[str, dict] = {}
    for s in sessions:
        h = s.get("sourceHash")
        if h:
            by_hash[h] = s

    entries = []
    for f in files:
        match = by_hash.get(f["hash"])
        entries.append({
            "hash": f["hash"],
            "file": f["file"],
            "sizeBytes": f["sizeBytes"],
            "lastModified": f["lastModified"],
            "digested": match is not None,
            "sessionId": match["id"] if match else None,
            "startedAt": match.get("startedAt") if match else None,
        })

    entries.sort(key=lambda e: e["lastModified"], reverse=True)
    return entries
