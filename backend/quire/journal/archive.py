"""Archive helpers — ported from journal/src/web/archive.ts.

Reads the raw-session archive from backend/.intent/raw-sessions/ and
joins it against digested sessions by source_hash.
"""
from __future__ import annotations

from pathlib import Path


def get_archive_dir() -> Path:
    """Return the canonical archive directory (backend/.intent/raw-sessions/)."""
    return Path(__file__).parent.parent.parent / ".intent" / "raw-sessions"


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
