from quire.propose import (
    BindingCandidates,
    CandidateBinding,
    CandidateObligation,
    group_candidates,
)


def _ob(i, statement):
    return CandidateObligation(
        obligation_id=f"OB-{i}", kind="hard_rule", statement=statement, source_quote="q"
    )


def _bind(ob, path):
    return CandidateBinding(
        obligation_id=ob, path=path, role="decision", relation="decides", why="w"
    )


def test_groups_form_over_shared_files_and_vocabulary():
    obligations = [
        _ob(1, "Premium refund limit must be enforced by the guard ceiling"),
        _ob(2, "Refund guard ceiling must block amounts above the premium limit"),
        _ob(3, "Every audit event must record the decision rationale"),
        _ob(4, "Notification emails must respect customer opt-out preferences"),
    ]
    bindings = [
        _bind("OB-1", "policy.py"),
        _bind("OB-2", "guard.py"),
        _bind("OB-3", "audit.py"),
        _bind("OB-3", "guard.py"),  # audit observes the guard → bridges via file
        _bind("OB-4", "notify.py"),
    ]
    out = group_candidates(obligations, bindings)
    groups = {g["group_id"]: set(g["obligation_ids"]) for g in out["groups"]}

    # OB-2 lives in two worlds: with OB-1 via refund vocabulary AND with
    # OB-3 via the shared guard.py — soft membership, not transitive glue
    # (v0's union semantics are superseded by weighted link communities).
    homes_ob2 = [gid for gid, m in groups.items() if "OB-2" in m]
    assert len(homes_ob2) == 2
    assert any("OB-1" in groups[g] for g in homes_ob2)
    assert any("OB-3" in groups[g] for g in homes_ob2)
    # OB-4 stands alone — different vocabulary, disjoint files
    assert any(m == {"OB-4"} for m in groups.values())
    # labels carry the shared vocabulary
    assert any("guard" in g["label"] or "refund" in g["label"] for g in out["groups"])


def test_verification_files_bridge_groups_without_merging_them():
    obligations = [
        _ob(1, "Alpha widgets render dashboards quickly"),
        _ob(2, "Beta billing charges customers monthly"),
    ]
    bindings = [
        _bind("OB-1", "alpha.py"),
        _bind("OB-2", "beta.py"),
        CandidateBinding(
            obligation_id="OB-1", path="tests/e2e.py", role="test_or_eval",
            relation="verifies", why="w",
        ),
        CandidateBinding(
            obligation_id="OB-2", path="tests/e2e.py", role="test_or_eval",
            relation="verifies", why="w",
        ),
    ]
    out = group_candidates(obligations, bindings)
    # the shared e2e suite does NOT merge unrelated concerns…
    assert len(out["groups"]) == 2
    # …it shows up as the overlap between them
    assert out["bridges"] == [{"path": "tests/e2e.py", "groups": ["G1", "G2"]}]

    # a shared RUNTIME file, by contrast, does merge groups
    bindings.append(_bind("OB-1", "shared_config.yaml"))
    bindings.append(_bind("OB-2", "shared_config.yaml"))
    out = group_candidates(obligations, bindings)
    assert len(out["groups"]) == 1
