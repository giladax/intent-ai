"""Workflow manifest: how an onboarded production-agent workflow is described."""

from __future__ import annotations

import pathlib

import yaml
from pydantic import BaseModel, Field


class RequirementsSource(BaseModel):
    provider: str
    reference: str


class RepositoryRef(BaseModel):
    provider: str
    repository: str
    path: str = "."  # local checkout, relative to the workspace dir (git provider)


class WorkTracking(BaseModel):
    provider: str
    project: str


class EvalSource(BaseModel):
    type: str
    paths: list[str] = Field(default_factory=list)


class WorkflowManifest(BaseModel):
    workflow_id: str
    requirements: RequirementsSource
    repositories: list[RepositoryRef]
    work_tracking: WorkTracking | None = None
    eval_sources: list[EvalSource] = Field(default_factory=list)


def load_manifest(path: str | pathlib.Path) -> WorkflowManifest:
    data = yaml.safe_load(pathlib.Path(path).read_text())
    return WorkflowManifest.model_validate(data)
