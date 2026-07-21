"""One writer's discipline, shared: write-then-rename, so a crash
mid-write can never truncate a file the product treats as a record.

Extracted 2026-07-19 (quality loop): the same mkstemp/os.replace dance
had grown four independent copies (the graph log, the story cache, and
both writers of the working mind).
"""

from __future__ import annotations

import contextlib
import os
import pathlib
import tempfile


def atomic_write_text(path: pathlib.Path, payload: str) -> None:
    """Atomic replace: the payload lands whole or not at all. (Concurrent
    writers remain a read-modify-write race — acceptable for a
    single-operator local tool; revisit before multi-user.)"""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as handle:
            handle.write(payload)
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise
