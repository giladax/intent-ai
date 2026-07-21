"""Fidelity eval runner — port of journal/run-fidelity.ts.

Reads stored digests from Postgres and scores them against the fidelity
criteria. Matches the output format of the TS harness precisely so the
calibration comparison is straightforward.

Usage:
    python3 -m evals.fidelity                 # score all sessions (requires Postgres)
    python3 -m evals.fidelity --session-id 20f5efec  # single session prefix
    python3 -m evals.fidelity --help
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys

# Allow running from backend/ or from repo root
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from dotenv import load_dotenv

# Resolve repo root (two levels up from backend/)
_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
load_dotenv(_REPO_ROOT / ".env")

from quire.db.engine import get_session
from evals.fidelity.scorers import (
    score_provenance,
    score_calibration,
    score_tail,
    score_recall,
    score_precision,
    score_agency,
)
from evals.fidelity.criteria import FIDELITY_CRITERIA
from evals.fidelity.loader import (
    load_session_by_hash,
    load_moment_rows,
    load_narrative_text,
    load_transition_confidence_values,
    load_outcome_confidence_values,
    raw_last_event_at,
    resolve_raw_log,
)


def _format_calibration(cal) -> str:
    return json.dumps(cal.distribution, separators=(", ", ":")).replace('"', '"')


def run(session_prefix: str | None = None) -> int:
    """Score all (or one) sessions and print results. Returns 0 always (informational)."""
    repo_root = _REPO_ROOT

    with get_session() as db:
        for c in FIDELITY_CRITERIA:
            # Optional filter by session id prefix
            if session_prefix and not c.cc_session_id.startswith(session_prefix):
                continue

            journal_session = load_session_by_hash(db, c.cc_session_id)
            if journal_session is None:
                print(f"\n## {c.label}\n  NOT DIGESTED — skipping")
                continue

            session_id = journal_session.id
            moments = load_moment_rows(db, session_id)
            narrative_text = load_narrative_text(db, session_id)
            t_conf = load_transition_confidence_values(db, session_id)
            o_conf = load_outcome_confidence_values(db, session_id)

            log_path = resolve_raw_log(c.raw_log_path, c.cc_session_id, repo_root)
            raw_last = raw_last_event_at(log_path) if log_path else None

            prov = score_provenance(moments)
            moment_cal = score_calibration([m.confidence for m in moments])
            to_cal = score_calibration(t_conf + o_conf)
            tail = score_tail(journal_session.ended_at, raw_last)
            statements = [m.statement for m in moments]
            recall = score_recall(c.expected_moments, statements, narrative_text)
            precision = score_precision(c.forbidden_claims, statements, narrative_text)
            agency = score_agency(c.expected_moments, moments)

            # Build output — mirrors TS harness format exactly
            log_note = "" if log_path else " (raw log NOT FOUND — tail score unreliable)"
            short_id = c.cc_session_id[:8]

            # occurred span
            if prov.occurred_time_span_ms is None:
                span_str = "none"
            else:
                span_str = f"{round(prov.occurred_time_span_ms / 60000)}min"

            # chunk spread
            spread_str = "ok" if prov.chunk_spread_ok else "DEGENERATE"

            # calibration distributions
            def _dist_str(cal) -> str:
                # Reproduce TS JSON.stringify format: {"key":count,...}
                parts = [f'"{k}":{v}' for k, v in cal.distribution.items()]
                return "{" + ",".join(parts) + "}"

            moment_cal_str = _dist_str(moment_cal)
            to_cal_str = _dist_str(to_cal)
            moment_info = "" if moment_cal.informative else "UNINFORMATIVE"
            to_info = "" if to_cal.informative else "UNINFORMATIVE"

            # tail
            if tail.covered:
                tail_str = "covered"
            else:
                tail_str = f"LOST {round(tail.lost_ms / 60000)}min"

            # recall
            recall_miss_str = ""
            if recall.missed:
                recall_miss_str = " missed: " + "; ".join(recall.missed)

            # precision
            prec_str = "; ".join(precision.violations) if precision.violations else "none"

            # agency
            agency_wrong_str = ""
            if agency.wrong:
                agency_wrong_str = " wrong: " + "; ".join(agency.wrong)

            print(f"\n## {c.label} ({short_id}){log_note}")
            # Format percentages: strip trailing .0 to match TS output (100 not 100.0)
            def _pct_str(v: float) -> str:
                return str(int(v)) if v == int(v) else str(v)

            print(
                f"  provenance: evidenceReal {_pct_str(prov.evidence_real_pct)}% | anchored {_pct_str(prov.evidence_anchored_pct)}%"
                f" | chunks {prov.distinct_chunks} ({spread_str}) | occurredSpan {span_str}"
            )
            print(
                f"  calibration: moments {moment_cal_str} {moment_info}"
                f" | transitions+outcomes {to_cal_str} {to_info}"
            )
            print(f"  tail: {tail_str}")
            print(f"  recall: {recall.matched}/{recall.expected}{recall_miss_str}")
            print(f"  precision violations: {prec_str}")
            print(f"  agency: {agency.correct}/{agency.checked}{agency_wrong_str}")

    return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run the digest-fidelity eval against stored Postgres digests."
    )
    parser.add_argument(
        "--session-id",
        help="Score only the session whose ID starts with this prefix (e.g. 20f5efec)",
    )
    args = parser.parse_args()
    sys.exit(run(session_prefix=args.session_id))


if __name__ == "__main__":
    main()
