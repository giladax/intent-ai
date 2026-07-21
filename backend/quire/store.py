"""SQLite persistence via SQLAlchemy.

The repo's Postgres schema is TypeScript/Drizzle-owned, so this Python MVP
keeps its own SQLite store (spec: use SQLite when no Python ORM exists).

Analyses are idempotent on analysis_id = hash(repository, pr_number,
head_sha, contract_snapshot_id, analyzer_version): saving the same identity
twice is an upsert, and `get_analysis` lets the graph short-circuit re-runs.
Human-review state lives on the analysis row and survives re-reads.
"""

from __future__ import annotations

import os
import pathlib
from datetime import datetime

from sqlalchemy import JSON, DateTime, Integer, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from quire.models import (
    ArtifactSnapshot,
    ContractSnapshot,
    PRAnalysis,
    ReviewState,
)

# Default DB lives next to the package (backend/quire.db) so every
# CLI/API invocation from any cwd shares one store. Override with the
# QUIRE_DB env var or an explicit url (tests pass tmp sqlite urls).
_DEFAULT_DB = pathlib.Path(__file__).parent.parent / "quire.db"


class Base(DeclarativeBase):
    pass


class ArtifactSnapshotRow(Base):
    __tablename__ = "artifact_snapshots"

    snapshot_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    provider: Mapped[str] = mapped_column(String(64))
    reference: Mapped[str] = mapped_column(String(256), index=True)
    kind: Mapped[str] = mapped_column(String(32))
    content_hash: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSON)


class ContractSnapshotRow(Base):
    __tablename__ = "contract_snapshots"

    contract_snapshot_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    workflow_id: Mapped[str] = mapped_column(String(128), index=True)
    payload: Mapped[dict] = mapped_column(JSON)


class AnalysisRow(Base):
    __tablename__ = "analyses"

    analysis_id: Mapped[str] = mapped_column(String(48), primary_key=True)
    workflow_id: Mapped[str] = mapped_column(String(128), index=True)
    repository: Mapped[str] = mapped_column(String(256), index=True)
    pr_number: Mapped[int] = mapped_column(Integer, index=True)
    head_sha: Mapped[str] = mapped_column(String(64))
    contract_snapshot_id: Mapped[str] = mapped_column(String(32))
    analyzer_version: Mapped[str] = mapped_column(String(16))
    classification: Mapped[str] = mapped_column(String(32))
    review_state: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    payload: Mapped[str] = mapped_column(Text)


class Store:
    def __init__(self, url: str | None = None) -> None:
        url = url or os.environ.get("QUIRE_DB") or f"sqlite:///{_DEFAULT_DB}"
        self.engine = create_engine(url)
        Base.metadata.create_all(self.engine)

    # -- snapshots -----------------------------------------------------------

    def save_snapshots(self, snapshots: list[ArtifactSnapshot]) -> None:
        with Session(self.engine) as session:
            for snap in snapshots:
                if session.get(ArtifactSnapshotRow, snap.snapshot_id) is None:
                    session.add(
                        ArtifactSnapshotRow(
                            snapshot_id=snap.snapshot_id,
                            provider=snap.provider,
                            reference=snap.reference,
                            kind=snap.kind.value,
                            content_hash=snap.content_hash,
                            payload=snap.model_dump(mode="json"),
                        )
                    )
            session.commit()

    def get_snapshot(self, snapshot_id: str) -> ArtifactSnapshot | None:
        with Session(self.engine) as session:
            row = session.get(ArtifactSnapshotRow, snapshot_id)
            return ArtifactSnapshot.model_validate(row.payload) if row else None

    # -- contracts ---------------------------------------------------------------

    def save_contract(self, contract: ContractSnapshot) -> None:
        with Session(self.engine) as session:
            if session.get(ContractSnapshotRow, contract.contract_snapshot_id) is None:
                session.add(
                    ContractSnapshotRow(
                        contract_snapshot_id=contract.contract_snapshot_id,
                        workflow_id=contract.workflow_id,
                        payload=contract.model_dump(mode="json"),
                    )
                )
            session.commit()

    # -- analyses -------------------------------------------------------------------

    def save_analysis(self, analysis: PRAnalysis) -> None:
        with Session(self.engine) as session:
            row = session.get(AnalysisRow, analysis.analysis_id)
            if row is None:
                row = AnalysisRow(analysis_id=analysis.analysis_id)
                session.add(row)
            row.workflow_id = analysis.workflow_id
            row.repository = analysis.repository
            row.pr_number = analysis.pr_number
            row.head_sha = analysis.head_sha
            row.contract_snapshot_id = analysis.contract_snapshot_id
            row.analyzer_version = analysis.analyzer_version
            row.classification = analysis.classification.value
            row.review_state = analysis.review_state.value
            row.created_at = analysis.created_at
            row.payload = analysis.model_dump_json()
            session.commit()

    def get_analysis(self, analysis_id: str) -> PRAnalysis | None:
        with Session(self.engine) as session:
            row = session.get(AnalysisRow, analysis_id)
            return PRAnalysis.model_validate_json(row.payload) if row else None

    def list_analyses(
        self, repository: str | None = None, pr_number: int | None = None
    ) -> list[PRAnalysis]:
        query = select(AnalysisRow).order_by(AnalysisRow.created_at.desc())
        if repository:
            query = query.where(AnalysisRow.repository == repository)
        if pr_number is not None:
            query = query.where(AnalysisRow.pr_number == pr_number)
        with Session(self.engine) as session:
            rows = session.scalars(query).all()
            return [PRAnalysis.model_validate_json(r.payload) for r in rows]

    # -- human review ---------------------------------------------------------------

    def update_review(
        self,
        analysis_id: str,
        state: ReviewState,
        reviewer: str,
        note: str = "",
    ) -> PRAnalysis:
        # NOTE: read-modify-write across two sessions, not atomic — two
        # concurrent reviewers can race and the last save wins. Acceptable
        # for a single-operator MVP; a real deployment would do this in one
        # transaction (SELECT ... FOR UPDATE / compare-and-swap).
        analysis = self.get_analysis(analysis_id)
        if analysis is None:
            raise KeyError(f"no analysis {analysis_id}")
        analysis.review_state = state
        analysis.reviewer = reviewer
        analysis.review_note = note
        self.save_analysis(analysis)
        return analysis
