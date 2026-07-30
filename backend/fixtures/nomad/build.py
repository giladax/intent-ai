"""Build the nomad fixture's entity graph (graph/diffs.yaml).

Mirrors how acme-stream was seeded: propose CreateEntity + Attach diffs,
then sign each with a dated human decision. Multiple signers (kai, sam,
devon) so the stream carries >=3 users and the signings are a real source.

Run:  python -m fixtures.nomad.build   (from the backend/ root)
Idempotent enough for a fixture: it writes graph/diffs.yaml fresh.
"""

from __future__ import annotations

import pathlib

from quire.entity_graph import Attach, CreateEntity, GraphDiff, append_proposals, decide

WS = pathlib.Path(__file__).parent


def _reset():
    (WS / "graph").mkdir(exist_ok=True)
    (WS / "graph" / "diffs.yaml").write_text("[]\n")


def main():
    _reset()

    # (question, ops, signer, dated-at)
    plan = [
        (
            "Create CLI?",
            [
                CreateEntity(
                    entity_id="ent-cli",
                    name="CLI",
                    identity_sentence="The command surface — commands, flags, and exit codes.",
                    aliases=["command line", "flags"],
                ),
                Attach(entity_id="ent-cli", kind="promise", ref="OB-CLI-1"),
                Attach(entity_id="ent-cli", kind="promise", ref="OB-CLI-2"),
                Attach(entity_id="ent-cli", kind="promise", ref="OB-CLI-3"),
                Attach(entity_id="ent-cli", kind="code", ref="repo/cmd/export.go"),
                Attach(entity_id="ent-cli", kind="code", ref="repo/cmd/flags.go"),
            ],
            "kai",
            "2026-06-30T10:00:00+00:00",
        ),
        (
            "Create Config?",
            [
                CreateEntity(
                    entity_id="ent-config",
                    name="Config",
                    identity_sentence="How settings files are read, validated, and migrated.",
                    aliases=["configuration", "settings"],
                ),
                Attach(entity_id="ent-config", kind="promise", ref="OB-CFG-1"),
                Attach(entity_id="ent-config", kind="promise", ref="OB-CFG-2"),
                Attach(entity_id="ent-config", kind="code", ref="repo/config/load.go"),
            ],
            "sam",
            "2026-06-30T11:00:00+00:00",
        ),
        (
            "Create Plugins?",
            [
                CreateEntity(
                    entity_id="ent-plugins",
                    name="Plugins",
                    identity_sentence="Third-party extensions and the isolation that keeps them from crashing the host.",
                    aliases=["plugin", "extensions"],
                ),
                Attach(entity_id="ent-plugins", kind="promise", ref="OB-PLG-1"),
                Attach(entity_id="ent-plugins", kind="promise", ref="OB-PLG-2"),
                Attach(entity_id="ent-plugins", kind="code", ref="repo/host/plugins.go"),
            ],
            "devon",
            "2026-07-01T09:00:00+00:00",
        ),
    ]

    for question, ops, signer, at in plan:
        report = append_proposals(
            WS,
            [GraphDiff(diff_id="pending", question=question, operations=ops)],
            now=at,
            human=True,
        )
        diff_id = report["added"][0]
        decide(WS, diff_id, "approved", by=signer, now=at)
        print(f"signed {diff_id}: {question} by {signer} @ {at}")


if __name__ == "__main__":
    main()
