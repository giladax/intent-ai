from quire_align.models import Authority, BindingRelation, ControlPointRole


def test_manifest_loads(refund_workspace):
    manifest = refund_workspace.manifest()
    assert manifest.workflow_id == "refund-agent"
    assert manifest.requirements.reference == "refund-policy-prd"
    assert refund_workspace.repository() == "company/refund-agent"
    assert manifest.eval_sources[0].paths == ["tests/refunds/**", "evals/refund_agent/**"]


def test_pr_metadata_and_changed_files(refund_workspace):
    pr = refund_workspace.get_pr(101)
    assert pr.head_sha == "pr101head01"
    assert pr.issue_key == "REF-42"
    assert refund_workspace.changed_files(pr) == ["refund_agent/policy.py"]


def test_diff_shows_limit_change(refund_workspace):
    pr = refund_workspace.get_pr(101)
    diff = refund_workspace.diff(pr)
    assert "-    PREMIUM_MAX_AUTO_REFUND = 50.0" in diff
    assert "+    PREMIUM_MAX_AUTO_REFUND = 100.0" in diff
    assert "a/refund_agent/policy.py" in diff


def test_head_file_falls_back_to_base(refund_workspace):
    pr = refund_workspace.get_pr(101)
    guard = refund_workspace.file_content(pr, "refund_agent/guard.py", "head")
    assert guard is not None and "guard_ceiling" in guard


def test_requirement_artifacts_carry_authority(refund_workspace):
    artifacts = {a.reference: a for a in refund_workspace.requirement_artifacts()}
    assert artifacts["refund-policy-prd"].authority == Authority.APPROVED
    assert artifacts["refund-policy-prd-v4-draft"].authority == Authority.DRAFT
    assert artifacts["refund-policy-prd-v2"].authority == Authority.STALE
    assert all(a.content_hash for a in artifacts.values())


def test_obligations_pinned_to_source_hash(refund_workspace):
    obligations = {o.obligation_id: o for o in refund_workspace.obligations()}
    assert len(obligations) == 6
    ob = obligations["OB-101"]
    assert ob.kind.value == "permission"
    prd = next(
        a
        for a in refund_workspace.requirement_artifacts()
        if a.reference == "refund-policy-prd"
    )
    assert ob.source_content_hash == prd.content_hash


def test_bindings_and_control_points(refund_workspace):
    cps = {c.control_point_id: c for c in refund_workspace.control_points()}
    assert cps["CP-guard"].role == ControlPointRole.ENFORCEMENT
    bindings = refund_workspace.bindings()
    guard_bindings = [b for b in bindings if b.control_point_id == "CP-guard"]
    assert {b.relation for b in guard_bindings} == {BindingRelation.ENFORCES}


def test_issue_links_requirement(refund_workspace):
    issue = refund_workspace.issue("REF-42")
    assert issue.requirements == ["refund-policy-prd"]
    assert refund_workspace.issue("REF-999") is None
