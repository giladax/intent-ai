"""Link-community grouping: overlap with weights, constraints, invariants."""

from quire_align.grouping import GroupingConstraints, group_contract


def _ob(i, statement, section=""):
    return {"obligation_id": f"OB-{i}", "statement": statement, "source_section": section}


def _b(ob, path, relation="decides"):
    return {"obligation_id": ob, "path": path, "relation": relation}


REFUNDS = [
    _ob(1, "Premium refund limit decided by policy ceiling", "refunds"),
    _ob(2, "Refund guard ceiling blocks amounts above premium limit", "refunds"),
    _ob(3, "Audit events record refund decision rationale", "audit"),
    _ob(4, "Notification emails respect customer optout preferences", "notify"),
]
BINDINGS = [
    _b("OB-1", "refunds/policy.py"),
    _b("OB-1", "refunds/config.yaml", "configures"),
    _b("OB-2", "refunds/guard.py", "enforces"),
    _b("OB-2", "refunds/config.yaml", "configures"),
    _b("OB-3", "audit/audit.py", "observes"),
    _b("OB-4", "notify/mailer.py"),
]


def _group_of(out, ob):
    return [g["group_id"] for g in out["groups"] if ob in g["obligation_ids"]]


def test_shared_runtime_config_and_vocabulary_group_refund_obligations():
    out = group_contract(REFUNDS, BINDINGS)
    assert _group_of(out, "OB-1") == _group_of(out, "OB-2")
    assert _group_of(out, "OB-4") != _group_of(out, "OB-1")


def test_shared_file_overlap_surfaces_as_bridge():
    # OB-3 audits the refund guard: the guard file now carries edges in two
    # communities — link communities express that as a bridge, the overlap
    # made concrete at the file level.
    bindings = BINDINGS + [_b("OB-3", "refunds/guard.py", "observes")]
    out = group_contract(REFUNDS, bindings)
    bridge_paths = {b["path"]: b["groups"] for b in out["bridges"]}
    assert "refunds/guard.py" in bridge_paths
    assert len(bridge_paths["refunds/guard.py"]) == 2


def test_obligation_level_overlap_with_weights():
    # OB-3 genuinely lives in two worlds: it decides in cluster A's files
    # and in cluster B's files. Its edge mass splits → dual membership.
    obligations = [
        _ob(1, "alpha widget rendering pipeline stages", "a"),
        _ob(2, "alpha widget layout pipeline stages", "a"),
        _ob(3, "spans alpha rendering and beta billing reconciliation", ""),
        _ob(4, "beta billing invoice reconciliation ledger", "b"),
        _ob(5, "beta billing charge reconciliation ledger", "b"),
    ]
    bindings = [
        _b("OB-1", "a/render.py"), _b("OB-1", "a/layout.py"),
        _b("OB-2", "a/render.py"), _b("OB-2", "a/layout.py"),
        _b("OB-3", "a/render.py"), _b("OB-3", "b/ledger.py"),
        _b("OB-4", "b/ledger.py"), _b("OB-4", "b/invoice.py"),
        _b("OB-5", "b/ledger.py"), _b("OB-5", "b/invoice.py"),
    ]
    out = group_contract(obligations, bindings)
    memberships = {
        g["group_id"]: {m["obligation_id"]: m["weight"] for m in g["members"]}
        for g in out["groups"]
    }
    homes = {gid: ms["OB-3"] for gid, ms in memberships.items() if "OB-3" in ms}
    assert len(homes) == 2, f"expected dual membership, got {homes}"
    weights = sorted(homes.values())
    assert weights[0] >= 0.15 and abs(sum(weights) - 1.0) < 0.05
    # and its two homes are the alpha and beta clusters respectively
    alpha_home = next(g for g, ms in memberships.items() if "OB-1" in ms)
    beta_home = next(g for g, ms in memberships.items() if "OB-4" in ms)
    assert set(homes) == {alpha_home, beta_home}


def test_deterministic():
    a = group_contract(REFUNDS, BINDINGS)
    b = group_contract(REFUNDS, BINDINGS)
    assert a == b


def test_cannot_link_keeps_groups_apart():
    # vocabulary would merge these two aggressively
    obligations = [
        _ob(1, "refund limit ceiling premium policy"),
        _ob(2, "refund limit ceiling premium guard"),
    ]
    bindings = [_b("OB-1", "a/x.py"), _b("OB-2", "a/y.py")]
    merged = group_contract(obligations, bindings)
    assert _group_of(merged, "OB-1") == _group_of(merged, "OB-2")

    kept_apart = group_contract(
        obligations,
        bindings,
        GroupingConstraints(cannot_link=[["OB-1", "OB-2"]]),
    )
    assert _group_of(kept_apart, "OB-1") != _group_of(kept_apart, "OB-2")


def test_must_link_merges_groups():
    out = group_contract(
        REFUNDS, BINDINGS, GroupingConstraints(must_link=[["OB-1", "OB-4"]])
    )
    assert _group_of(out, "OB-1") == _group_of(out, "OB-4")


def test_label_override_anchored_to_dominant_member():
    plain = group_contract(REFUNDS, BINDINGS)
    refund_group = next(g for g in plain["groups"] if "OB-1" in g["obligation_ids"])
    out = group_contract(
        REFUNDS, BINDINGS, GroupingConstraints(labels={refund_group["anchor"]: "Refund limits"})
    )
    assert any(g["label"] == "Refund limits" for g in out["groups"])


def test_unbound_obligations_are_not_lost():
    out = group_contract(REFUNDS + [_ob(9, "totally standalone promise wording")], BINDINGS)
    all_members = {i for g in out["groups"] for i in g["obligation_ids"]}
    assert "OB-9" in all_members


def test_duplicate_obligation_ids_do_not_crash_grouping():
    # Regression: an LLM-emitted duplicate id used to create a self-loop
    # text edge and crash _edge_similarity with StopIteration mid-draft.
    obligations = [
        _ob(1, "premium refund ceiling policy limit"),
        _ob(1, "premium refund ceiling policy limit"),  # duplicate id
        _ob(2, "audit events record decision rationale"),
    ]
    bindings = [_b("OB-1", "a/policy.py"), _b("OB-2", "b/audit.py")]
    out = group_contract(obligations, bindings)
    members = [i for g in out["groups"] for i in g["obligation_ids"]]
    assert members.count("OB-1") == 1  # deduped, not doubled
