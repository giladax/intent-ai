"""Quire Align CLI.

    python3 -m quire.cli demo                 # offline fixture demo (PR 101 → PARTIAL)
    python3 -m quire.cli demo --live          # same, but with real LLM inference
    python3 -m quire.cli analyze fixtures/refund-agent 102 --offline
    python3 -m quire.cli show <analysis_id>
    python3 -m quire.cli review <analysis_id> approved --reviewer you
    python3 -m quire.cli serve --port 8321
    python3 -m quire.cli journal events            # read activity_events from Postgres
    python3 -m quire.cli journal digest --dry-run <log>  # parse+normalize+chunk, print stats
"""

from __future__ import annotations

import pathlib

import typer

from quire import workspace as workspace_mod
from quire.models import ReviewState
from quire.store import Store

app = typer.Typer(no_args_is_help=True, add_completion=False)

# ANTHROPIC_API_KEY / LANGSMITH_* / GITHUB_TOKEN live in the repo-root .env.
workspace_mod.load_env()

# ── Journal sub-group ──────────────────────────────────────────────────
# Future slices will hang more commands here (features, sessions, etc.).

journal_app = typer.Typer(no_args_is_help=True, add_completion=False,
                          help="Read from the journal Postgres (activity_events, sessions, …).")
app.add_typer(journal_app, name="journal")


def _adapter(workspace: str):
    try:
        return workspace_mod.build_adapter(workspace)
    except FileNotFoundError as error:
        raise typer.BadParameter(str(error))


def _error_text(error: BaseException) -> str:
    # str(KeyError) wraps the message in repr quotes — unwrap it so the
    # terminal reads a sentence, not a Python artifact (same bug class as
    # the API's _detail helper).
    if isinstance(error, KeyError) and error.args:
        return str(error.args[0])
    return str(error)


def _llm(offline: bool, pr_number: int):
    if offline:
        from quire.canned import fake_for_pr, known_pr_numbers

        try:
            return fake_for_pr(pr_number)
        except KeyError:
            raise typer.BadParameter(
                f"--offline uses canned model outputs, and PR {pr_number} has "
                f"none. Fixture PRs with canned outputs: {known_pr_numbers()}. "
                "Drop --offline to run real inference."
            )
    from quire.analysis.llm import AnthropicAlignmentLLM

    return AnthropicAlignmentLLM()


def _print_analysis(analysis) -> None:
    from quire.analysis.render import DISPLAY_LABELS

    typer.echo(analysis.comment_markdown)
    typer.echo("")
    label = DISPLAY_LABELS[analysis.classification]
    if analysis.human_review_required:
        verdict = f"Verdict: {label} — needs a human ({analysis.review_state.value})."
    else:
        verdict = f"Verdict: {label} — no review needed."
    typer.secho(verdict, fg=typer.colors.CYAN)
    typer.secho(
        f"Analysis id: {analysis.analysis_id} — revisit it with "
        f"`show {analysis.analysis_id}`, or record a decision with "
        f"`review {analysis.analysis_id} approved --reviewer <you>`.",
        fg=typer.colors.CYAN,
    )


@app.command()
def analyze(
    workspace: str = typer.Argument(help="workspace dir (or fixture name, e.g. refund-agent)"),
    pr_number: int = typer.Argument(),
    offline: bool = typer.Option(False, help="use canned LLM outputs (fixture PRs only)"),
    variant: str = typer.Option("linear-v1", help="analyzer config variant"),
    force: bool = typer.Option(False, help="re-run even if this identity was analyzed"),
    publish: bool = typer.Option(
        False, help="post/update the verdict comment on the PR (loud verdicts only)"
    ),
    publish_all: bool = typer.Option(
        False,
        help="with --publish: also post quiet verdicts (aligned / not covered / no product impact)",
    ),
    db: str = typer.Option("", help="database URL (default sqlite file)"),
):
    """Check one PR against its workflow's approved promises."""
    from quire.analysis.graph import run_analysis
    from quire.analysis.render import DISPLAY_LABELS, LOUD_CLASSIFICATIONS, MARKER

    adapter = _adapter(workspace)
    store = Store(url=db or None)
    analysis = run_analysis(
        adapter,
        pr_number,
        llm=_llm(offline, pr_number),
        store=store,
        variant=variant,
        force=force,
    )
    _print_analysis(analysis)
    if publish:
        if not hasattr(adapter, "publish_comment"):
            typer.secho(
                "--publish: this workspace's provider cannot post comments "
                "(GitHub provider only)",
                fg=typer.colors.YELLOW,
            )
        elif analysis.classification in LOUD_CLASSIFICATIONS or publish_all:
            pr = adapter.get_pr(pr_number)
            url = adapter.publish_comment(pr, analysis.comment_markdown, MARKER)
            typer.secho(f"published: {url}", fg=typer.colors.GREEN)
        else:
            typer.secho(
                f"quiet verdict ({DISPLAY_LABELS[analysis.classification]}) — "
                "not posted (use --publish-all to post anyway)",
                fg=typer.colors.YELLOW,
            )


@app.command()
def demo(
    live: bool = typer.Option(False, help="use the real LLM instead of canned outputs"),
):
    """Run the refund-agent demo: PR 101 raises the policy limit to $100 while
    the guard still blocks at $50 → expected PARTIAL, human review required."""
    from quire.analysis.graph import run_analysis

    adapter = _adapter("refund-agent")
    store = Store()
    typer.secho(
        "Demo: PR #101 — policy allows $100, guard still rejects >$50\n",
        fg=typer.colors.YELLOW,
    )
    analysis = run_analysis(
        adapter, 101, llm=_llm(not live, 101), store=store, force=True
    )
    _print_analysis(analysis)


@app.command()
def show(
    analysis_id: str,
    as_json: bool = typer.Option(False, "--json", help="dump the full analysis JSON"),
    db: str = typer.Option("", help="database URL"),
):
    """Print a stored analysis."""
    store = Store(url=db or None)
    analysis = store.get_analysis(analysis_id)
    if analysis is None:
        typer.secho(
            f"No analysis with id {analysis_id} — run `list` to see stored analyses.",
            fg=typer.colors.RED,
        )
        raise typer.Exit(1)
    if as_json:
        typer.echo(analysis.model_dump_json(indent=2))
    else:
        _print_analysis(analysis)


@app.command("list")
def list_cmd(
    repository: str = typer.Option("", help="filter by repository"),
    pr: int = typer.Option(-1, help="filter by PR number"),
    db: str = typer.Option("", help="database URL"),
):
    """List stored analyses."""
    from quire.analysis.render import DISPLAY_LABELS

    store = Store(url=db or None)
    analyses = store.list_analyses(
        repository=repository or None, pr_number=pr if pr >= 0 else None
    )
    if not analyses:
        typer.echo("No analyses stored yet — run `analyze <workspace> <pr>` first.")
        return
    typer.secho(
        f"{'analysis id':<26}{'PR':<42}{'verdict':<20}review", fg=typer.colors.CYAN
    )
    for a in analyses:
        pr_cell = f"{a.repository}#{a.pr_number} @ {a.head_sha[:10]}"
        typer.echo(
            f"{a.analysis_id:<26}{pr_cell:<42}"
            f"{DISPLAY_LABELS[a.classification]:<20}{a.review_state.value}"
        )


@app.command()
def review(
    analysis_id: str,
    state: str = typer.Argument(help="approved | rejected"),
    reviewer: str = typer.Option(..., help="who reviewed"),
    note: str = typer.Option("", help="review note"),
    db: str = typer.Option("", help="database URL"),
):
    """Record a human-review decision on an analysis."""
    store = Store(url=db or None)
    try:
        review_state = ReviewState(state)
    except ValueError:
        raise typer.BadParameter("state must be one of: approved, rejected, pending")
    try:
        analysis = store.update_review(analysis_id, review_state, reviewer, note)
    except KeyError:
        typer.secho(
            f"No analysis with id {analysis_id} — run `list` to see stored analyses.",
            fg=typer.colors.RED,
        )
        raise typer.Exit(1)
    typer.secho(
        f"{analysis.analysis_id} review={analysis.review_state.value} by {reviewer}",
        fg=typer.colors.GREEN,
    )


@app.command()
def propose(
    doc: str = typer.Argument(help="path to an approved intent document"),
    repo: str = typer.Option(".", help="repository root to scan for code locations"),
    out: str = typer.Option(..., help="output workspace dir for the draft contract"),
    reference: str = typer.Option("", help="source reference name (defaults to doc stem)"),
):
    """Draft a contract from an intent doc + repo: candidate promises with
    verbatim provenance quotes and proposed code locations, written as
    *.draft.yaml for human approval. Machines propose; humans approve."""
    from quire.propose import propose_contract

    doc_path = pathlib.Path(doc)
    obligations, bindings, notes = propose_contract(
        doc_path,
        pathlib.Path(repo),
        pathlib.Path(out),
        reference or doc_path.stem,
    )
    typer.secho(
        f"drafted {len(obligations)} promises, {len(bindings)} code bindings → {out}",
        fg=typer.colors.GREEN,
    )
    for o in obligations:
        bound = [b.path for b in bindings if b.obligation_id == o.obligation_id]
        typer.echo(f"  {o.obligation_id} [{o.kind}] {o.statement[:80]}")
        for path in bound:
            typer.echo(f"      ↳ {path}")
    if notes:
        typer.secho(
            f"  {len(notes)} candidate(s) set aside — their quotes or paths "
            "didn't check out (details in proposal-notes.txt)",
            fg=typer.colors.YELLOW,
        )
    typer.echo("Review, edit, then rename *.draft.yaml → *.yaml to approve.")


_RESOLUTION_METHOD_LABELS = {
    "alias": "saved alias",
    "label": "exact name match",
    "lexical": "matched by name",
    "llm": "best guess",
}

# one promise-health vocabulary everywhere — the mirror's (The Hush):
# kept / partly kept / broken / not yet exercised


@app.command()
def ask(
    workspace: str = typer.Argument(help="workspace dir or name"),
    query: str = typer.Argument(help="a term in your org's vocabulary, e.g. 'payments'"),
    no_llm: bool = typer.Option(
        False, help="answer without the LLM fallback (saved-alias and name matches only)"
    ),
    save: bool = typer.Option(False, help="confirm the resolution as a durable alias"),
):
    """Resolve a term from the org's dialect to a product area and show
    everything known about it: promises, health, files, open findings."""
    from quire.ask import (
        community_card,
        haiku_pick,
        load_group_state,
        resolve_term,
        save_alias,
    )
    from quire.mirror import HEALTH_LABELS

    adapter = _adapter(workspace)
    ws_dir = workspace_mod.resolve_workspace_dir(workspace)
    state = load_group_state(ws_dir, adapter)
    obligations = [
        {"obligation_id": o.obligation_id, "statement": o.statement}
        for o in adapter.obligations()
    ]
    resolution = resolve_term(
        query, state, obligations, llm_pick=None if no_llm else haiku_pick
    )
    if resolution["group"] is None:
        nearest = ", ".join(resolution["alternatives"]) or "none"
        typer.secho(
            f"Couldn't match '{query}' to a product area. Closest areas: {nearest}. "
            "Try a different word, or teach it: resolve a related term and "
            "confirm with --save.",
            fg=typer.colors.YELLOW,
        )
        raise typer.Exit(1)
    group = resolution["group"]
    card = community_card(adapter, Store(), group, state)
    method = _RESOLUTION_METHOD_LABELS.get(resolution["method"], resolution["method"])
    confidence = f" ({int(resolution['confidence'] * 100)}%)" if resolution["confidence"] < 1 else ""
    typer.secho(
        f"◉ “{card['label']}” ({card['group_id']}) — {method}{confidence}",
        fg=typer.colors.CYAN,
    )
    if card["aliases"]:
        typer.echo(f"  answers to: {', '.join(card['aliases'])}")
    typer.echo("\n  Promises:")
    for ob in card["obligations"]:
        health = ob["health"]["status"]
        mark = {"satisfies": "🟢", "partially_satisfies": "🟡", "contradicts": "🔴"}.get(health, "⚪")
        weight = f" ({int(ob['weight'] * 100)}%)" if ob["weight"] < 1 else ""
        health_label = HEALTH_LABELS.get(health, health.replace("_", " "))
        typer.echo(
            f"   {mark} {ob['obligation_id']}{weight} [{health_label}] {ob.get('statement', '')[:76]}"
        )
    typer.echo(f"\n  Code locations: {len(card['files'])} files"
               + (f", {len(card['bridges'])} shared with other areas" if card["bridges"] else ""))
    if card["recent_events"]:
        typer.echo("  Recent checks touching this area:")
        for e in card["recent_events"][-4:]:
            typer.echo(f"   · #{e['pr_number']} {e['verdict']:18} {e['title'][:56]}")
    if card["open_findings"]:
        typer.secho("  Open findings (awaiting a human):", fg=typer.colors.YELLOW)
        for f in card["open_findings"]:
            typer.echo(f"   ⚑ #{f['pr_number']} {f['verdict']} — {f['title'][:60]}")
    if save:
        save_alias(ws_dir, query, group["anchor"])
        typer.secho(f"\n  alias saved: '{query}' → {group['group_id']}", fg=typer.colors.GREEN)


@app.command()
def serve(
    port: int = typer.Option(8321),
    host: str = typer.Option("127.0.0.1"),
):
    """Start the minimal HTTP API."""
    import uvicorn

    from quire.api import create_app

    uvicorn.run(create_app(), host=host, port=port)


@app.command()
def enrich(
    workspace: str = typer.Argument(help="workspace dir or name"),
):
    """Run the LLM heuristic pass: name unnamed areas in product language
    and adjudicate borderline promise pairs. Human renames always win;
    results persist with the workspace."""
    from quire.graph_heuristics import GraphHeuristics, enrich_workspace
    from quire.text import plural as _plural

    adapter = _adapter(workspace)
    ws_dir = workspace_mod.resolve_workspace_dir(workspace)
    out = enrich_workspace(ws_dir, adapter, GraphHeuristics())
    typer.secho(
        f"adjudicated {_plural(out['new_pair_hints'], 'new borderline pair')} "
        f"({len(out['pair_hints'])} on file)",
        fg=typer.colors.CYAN,
    )
    if out["named"]:
        for anchor, name in out["named"].items():
            typer.echo(f"  named: {anchor} → “{name}”")
    else:
        typer.echo("  every area already has a name")
    typer.echo("areas now:")
    for g in out["groups"]:
        typer.echo(f"  ◉ {g['label']} ({_plural(len(g['obligation_ids']), 'promise')})")


def _graph_now() -> str:
    from quire.entity_graph import now_iso

    return now_iso()


@app.command()
def entities(workspace: str = typer.Argument(help="workspace dir or name")):
    """The entity map — a fold over approved graph diffs, nothing else."""
    from quire.entity_graph import graph_state, load_diffs

    ws_dir = workspace_mod.resolve_workspace_dir(workspace)
    state = graph_state(load_diffs(ws_dir))
    if not state["entities"]:
        typer.echo("no entities yet — run propose-entities, then decide in the inbox")
        return
    for entity in sorted(state["entities"].values(), key=lambda e: e["name"].lower()):
        frozen = (
            f"  [frozen → {entity['superseded_by']}]"
            if entity["status"] == "superseded"
            else ""
        )
        typer.secho(f"◉ {entity['name']} ({entity['entity_id']}){frozen}", bold=True)
        if entity["identity_sentence"]:
            typer.echo(f"  {entity['identity_sentence']}")
        by_kind: dict[str, int] = {}
        for holding in entity["holdings"]:
            by_kind[holding["kind"]] = by_kind.get(holding["kind"], 0) + 1
        if by_kind:
            typer.echo(
                "  holds: " + ", ".join(f"{n} {k}" for k, n in sorted(by_kind.items()))
            )
        for rel in entity["relations"]:
            typer.echo(f"  {rel['relation'].replace('_', ' ')} {rel['other_id']}")


@app.command()
def propose_entities(workspace: str = typer.Argument(help="workspace dir or name")):
    """LLM proposals that consolidate the derived areas into entities —
    open questions for the inbox; nothing mutates until a human approves."""
    from quire.entity_graph import MAX_OPEN_PROPOSALS
    from quire.entity_propose import (
        EntityProposerLLM,
        haiku_doc_complement_judge,
        seed_proposals,
    )

    adapter = _adapter(workspace)
    ws_dir = workspace_mod.resolve_workspace_dir(workspace)
    report = seed_proposals(
        ws_dir, adapter, EntityProposerLLM(), _graph_now(),
        doc_judge=haiku_doc_complement_judge,
    )
    typer.secho(
        f"proposed: {len(report['added'])} ({report['open']} now open, "
        f"capped at {MAX_OPEN_PROPOSALS})",
        fg=typer.colors.CYAN,
    )
    for note in report["notes"]:
        typer.echo(f"  · {note}")
    for skipped in report["skipped_rejected_shape"]:
        typer.echo(f"  withheld: {skipped[:100]}")
    for skipped in report["skipped_duplicate"]:
        typer.echo(f"  already asked (open or approved): {skipped[:100]}")
    for skipped in report["skipped_cap"]:
        typer.echo(f"  deferred (inbox full): {skipped[:100]}")
    if report["unplaced"]:
        typer.secho(
            f"  no home proposed for: {', '.join(report['unplaced'])}",
            fg=typer.colors.YELLOW,
        )


@app.command()
def proposals(workspace: str = typer.Argument(help="workspace dir or name")):
    """Open proposals, highest stakes first."""
    from quire.entity_graph import load_diffs, open_proposals, stakes_label

    ws_dir = workspace_mod.resolve_workspace_dir(workspace)
    diffs = open_proposals(load_diffs(ws_dir))
    if not diffs:
        typer.echo("nothing awaits you")
        return
    for d in diffs:
        typer.secho(f"{d.diff_id} [{stakes_label(d.stakes)} stakes]", bold=True)
        typer.echo(f"  {d.question}")
        for q in d.evidence[:2]:
            typer.echo(f"  “{q.quote[:70]}” — {q.source}")


@app.command()
def graph_decide(
    workspace: str = typer.Argument(help="workspace dir or name"),
    diff_id: str = typer.Argument(help="proposal id, e.g. GD-1"),
    action: str = typer.Argument(help="approved | rejected"),
    by: str = typer.Option(..., help="decisions are signed"),
    reason: str = typer.Option(
        "", help="rejection reason code: not_one_thing|wrong_name|bad_evidence|other"
    ),
    note: str = typer.Option("", help="free-text reason (required for 'other')"),
):
    """Decide one proposal — the only path that mutates the map."""
    from quire.entity_graph import GraphIntegrityError, decide

    ws_dir = workspace_mod.resolve_workspace_dir(workspace)
    try:
        decided = decide(
            ws_dir, diff_id, action, by=by, now=_graph_now(),
            reason_code=reason, reason_text=note,
        )
    except (KeyError, GraphIntegrityError) as error:
        typer.secho(_error_text(error), fg=typer.colors.RED)
        raise typer.Exit(1)
    typer.secho(f"{decided.diff_id}: {decided.status}", fg=typer.colors.GREEN)


@app.command()
def teach(
    workspace: str = typer.Argument(help="workspace dir or name"),
    term: str = typer.Argument(help="the word, in your dialect"),
    alias_of: str = typer.Option("", help="entity id this term names (teaches an alias)"),
    new: bool = typer.Option(False, "--new", help="the map lacks this thing — open a create card"),
    by: str = typer.Option(..., help="teachings are signed"),
    note: str = typer.Option("", help="one sentence of what it is"),
):
    """Teach the map a word: an alias lands instantly (you are the
    authority on your own dialect); a new thing opens an inbox card."""
    from quire.entity_graph import GraphIntegrityError
    from quire.teach import teach_alias, teach_create

    ws_dir = workspace_mod.resolve_workspace_dir(workspace)
    try:
        if alias_of:
            diff = teach_alias(ws_dir, term, alias_of, by, _graph_now())
            typer.secho(
                f"learned: “{term}” → {alias_of} ({diff.diff_id}, signed {by})",
                fg=typer.colors.GREEN,
            )
        elif new:
            diff = teach_create(ws_dir, term, by, _graph_now(), note=note)
            typer.secho(
                f"opened {diff.diff_id}: “{term}” — shape and approve it in the inbox",
                fg=typer.colors.CYAN,
            )
        else:
            raise typer.BadParameter("say --alias-of <entity-id> or --new")
    except (KeyError, GraphIntegrityError) as error:
        typer.secho(_error_text(error), fg=typer.colors.RED)
        raise typer.Exit(1)


@app.command()
def up(
    workspace: str = typer.Argument("quire-brain", help="workspace dir or name"),
    port: int = typer.Option(8321),
    host: str = typer.Option("127.0.0.1"),
    open_browser: bool = typer.Option(
        True, "--open/--no-open", help="open the map in your browser"
    ),
    print_only: bool = typer.Option(False, hidden=True),
):
    """The common setup, one command: check credentials, show where the
    map stands, print every door, open the inbox, start serving."""
    import os

    from quire.entity_graph import graph_state, load_diffs, open_proposals
    from quire.text import plural as _plural

    ws_dir = workspace_mod.resolve_workspace_dir(workspace)
    diffs = load_diffs(ws_dir)
    entities = graph_state(diffs)["entities"]
    active = [e for e in entities.values() if e["status"] == "active"]
    awaiting = len(open_proposals(diffs))

    already_running = False
    if not print_only:
        port, already_running = _resolve_port(host, port)
    base = f"http://{host}:{port}"

    typer.secho(f"workspace: {workspace}  ({ws_dir})", bold=True)
    typer.echo(
        f"  the map: {_plural(len(active), 'entity', 'entities')}, "
        f"{_plural(awaiting, 'proposal')} awaiting a human"
    )
    if os.environ.get("ANTHROPIC_API_KEY"):
        typer.echo("  credentials: ANTHROPIC_API_KEY found — live features on")
    else:
        typer.secho(
            "  credentials: no ANTHROPIC_API_KEY — checks and proposals that "
            "need the model will fail; offline analysis still works",
            fg=typer.colors.YELLOW,
        )
    typer.echo("doors:")
    typer.echo(f"  the map (start here):        {base}/app/{workspace}")
    typer.echo(f"  inbox (decide proposals):    {base}/inbox/{workspace}")
    # (/mirror/<ws> still answers, but it forwards to the map since the
    # 2026-07-19 UX pass — listing it as a separate door would mislead)
    typer.echo(f"  promise ledger:              {base}/intent/{workspace}")
    typer.echo("commands while this runs:")
    typer.echo(f"  python3 -m quire.cli propose-entities {workspace}")
    typer.echo(f"  python3 -m quire.cli entities {workspace}")
    typer.echo(f"  python3 -m quire.cli teach {workspace} <term> --alias-of <entity-id> --by you")
    if print_only:
        return

    if already_running:
        typer.secho(
            f"already serving on port {port} — using the running server",
            fg=typer.colors.CYAN,
        )
        if open_browser:
            import webbrowser

            # same front door as a fresh start — the map, not the inbox
            webbrowser.open(f"{base}/app/{workspace}")
        return

    if open_browser:
        import threading
        import webbrowser

        threading.Timer(
            1.2, webbrowser.open, [f"{base}/app/{workspace}"]
        ).start()

    import uvicorn

    from quire.api import create_app

    uvicorn.run(create_app(), host=host, port=port)


def _resolve_port(host: str, port: int) -> tuple[int, bool]:
    """(port, already_running). If the requested port is busy: reuse it
    when the occupant is a Quire server, otherwise walk to a free one."""
    import socket
    import urllib.request

    for candidate in range(port, port + 10):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            free = probe.connect_ex((host, candidate)) != 0
        if free:
            return candidate, False
        try:
            with urllib.request.urlopen(
                f"http://{host}:{candidate}/openapi.json", timeout=1.5
            ) as response:
                import json

                spec = json.load(response)
                ours = spec.get("info", {}).get("title") == "Quire Align"
                # Reuse only a CURRENT Quire — a stale process from an
                # older session answers 404 on today's doors, which reads
                # as the product being broken. Marker: the newest door.
                current = "/app/{workspace}" in (spec.get("paths") or {})
                if ours and current:
                    return candidate, True
                if ours:
                    typer.secho(
                        f"port {candidate}: a Quire server from an older "
                        f"session (missing current pages) — leaving it and "
                        f"taking the next port; stop it with: "
                        f"lsof -ti tcp:{candidate} | xargs kill",
                        fg=typer.colors.YELLOW,
                    )
        except Exception:
            pass  # busy, but not ours — try the next port
    raise typer.BadParameter(
        f"no free port in {port}..{port + 9} and none of them is a current "
        f"Quire server"
    )


@app.command()
def digest_session(
    workspace: str = typer.Argument(help="workspace dir or name"),
    transcript: str = typer.Argument(help="path to a Claude Code .jsonl session"),
    pr: int = typer.Option(-1, help="couple the session to this PR/check number"),
    offline: bool = typer.Option(False, help="skip the LLM (metadata only, for tests)"),
):
    """Ingest a coding session as observed evidence — its reasoning kept,
    not re-derived; related to the PR it produced and the entities it
    touched. The reasoning was already paid for once; we keep it."""
    import pathlib

    from quire.session import (
        FakeSessionDigester,
        SessionDigest,
        SessionDigesterLLM,
        digest_session as run_digest,
        read_transcript,
    )

    ws_dir = workspace_mod.resolve_workspace_dir(workspace)
    path = pathlib.Path(transcript).expanduser()
    if not path.exists():
        raise typer.BadParameter(f"no such transcript: {path}")
    if offline:
        raw = read_transcript(path)
        digester = FakeSessionDigester(SessionDigest(
            title=f"session {raw.session_id[:8]}",
            summary=f"{raw.turns} turns touching {len(raw.touched_paths)} files",
            reasoning=raw.reasoning_text[:1500],
        ))
    else:
        digester = SessionDigesterLLM()
    record = run_digest(
        ws_dir, path, digester, _graph_now(),
        pr=pr if pr >= 0 else None,
    )
    typer.secho(f"ingested: {record['title']}", fg=typer.colors.GREEN)
    typer.echo(f"  {record['turns']} turns · {len(record['touched_paths'])} files touched"
               + (f" · coupled to check #{record['pr']}" if record.get('pr') else ""))
    for d in record["decisions"][:5]:
        typer.echo(f"  ◆ {d['choice']}")


@app.command()
def watch(
    workspace: str = typer.Argument(help="workspace dir or name"),
    window_days: float = typer.Option(14, help="'is anyone watching' window"),
):
    """The tap on the shoulder: fire the alarms this org warrants right now,
    loudest first. A CEO does not read a dashboard — they get told the one
    thing on fire, who signed it, what broke it, and that nobody is watching.
    Silent on everything that is healthy."""
    from quire.alarms import ConsoleNotifier, alarms_for, deliver

    ws_dir = workspace_mod.resolve_workspace_dir(workspace)
    try:
        adapter = _adapter(workspace)
    except typer.BadParameter:
        adapter = None
    store, store_error = None, None
    if adapter is not None:
        try:
            store = Store()
        except Exception as error:  # offline fixtures carry their own checks
            store_error = error

    # A live workspace with no fixture checks needs the store to see checks.
    # If that store is unreachable, an empty result is NOT "all clear" — it
    # is a blind spot, and reporting a false all-clear is the one thing this
    # product must never do. Warn instead of quietly reassuring.
    checks_blind = (store_error is not None and store is None
                    and not (ws_dir / "checks.yaml").exists())

    alarms = alarms_for(ws_dir, adapter, store, window_days=window_days)
    if checks_blind:
        typer.secho(
            f"⚠ could not reach the analysis store ({_error_text(store_error)}) — "
            "checks did not load, so drift alarms may be incomplete. This is a "
            "blind spot, not an all-clear.", fg=typer.colors.RED)
    if not alarms:
        msg = ("no checks loaded — cannot vouch for anything." if checks_blind
               else "all quiet — nothing warrants a page.")
        typer.secho(msg, fg=typer.colors.YELLOW if checks_blind else typer.colors.GREEN)
        return
    loud = sum(1 for a in alarms if a.severity in ("critical", "high"))
    typer.secho(f"⚡ {len(alarms)} alarm(s), {loud} urgent — page order:\n",
                fg=typer.colors.YELLOW)
    deliver(alarms, ConsoleNotifier())


@journal_app.command("digest")
def journal_digest(
    log_path: str = typer.Argument(..., help="path to a Claude Code .jsonl log file"),
    dry_run: bool = typer.Option(False, "--dry-run", help="run deterministic pipeline only (no LLM), print stats"),
):
    """Ingest a Claude Code session log.

    With --dry-run: runs parse → normalize → chunk deterministically (no LLM),
    and prints the same stats block as `npx tsx src/cli/index.ts digest --dry-run`.
    This is the parity-check entry point for Slice 3.
    """
    import pathlib
    from datetime import datetime, timezone

    from quire.ingest import parse_transcript, normalize, chunk_session, analyze_interactions

    if not dry_run:
        typer.echo("Only --dry-run is implemented in Slice 3. Full digestion (LLM) is future work.", err=True)
        raise typer.Exit(1)

    path = pathlib.Path(log_path)
    if not path.exists():
        typer.echo(f"File not found: {log_path}", err=True)
        raise typer.Exit(1)

    typer.echo(f"Log: {log_path}")

    raw_events = parse_transcript(path)
    session_id = "dry-run"
    normalized_events = normalize(raw_events, session_id)
    chunks = chunk_session(normalized_events, session_id)

    # Timestamps
    timestamps = [e.timestamp for e in raw_events if e.timestamp]
    if timestamps:
        from quire.ingest.sittings import _parse_ts
        ms_vals = [_parse_ts(t, None) for t in timestamps]
        ms_vals = [m for m in ms_vals if m is not None]
        if ms_vals:
            started_ms = min(ms_vals)
            ended_ms = max(ms_vals)
            started_dt = datetime.fromtimestamp(started_ms / 1000, tz=timezone.utc)
            ended_dt = datetime.fromtimestamp(ended_ms / 1000, tz=timezone.utc)
            duration_min = round((ended_ms - started_ms) / 60000)
            started_fmt = _format_time(started_dt)
            ended_fmt = _format_time(ended_dt)
        else:
            started_fmt = ended_fmt = None
            duration_min = 0
    else:
        started_fmt = ended_fmt = None
        duration_min = 0

    typer.echo(f"  Raw events:        {len(raw_events)}")
    typer.echo(f"  Normalized events: {len(normalized_events)}")
    typer.echo(f"  Chunks:            {len(chunks)}")
    if started_fmt and ended_fmt:
        typer.echo(f"  Time span:         {started_fmt} → {ended_fmt} ({duration_min} min)")

    # Category breakdown
    categories: dict[str, int] = {}
    for e in normalized_events:
        categories[e.category] = categories.get(e.category, 0) + 1
    cat_str = ", ".join(f"{k}:{v}" for k, v in categories.items())
    typer.echo(f"  Categories:        {cat_str}")

    # Directives (structural, synchronous — no LLM)
    directives = analyze_interactions(normalized_events)
    typer.echo("  Directives:")
    typer.echo(f"    detectPassiveAcceptance: {str(directives.prompt_sections.detect_passive_acceptance).lower()}")
    typer.echo(f"    trackDelegation:         {str(directives.prompt_sections.track_delegation).lower()}")
    typer.echo(f"    detectIgnoredProposals:  {str(directives.prompt_sections.detect_ignored_proposals).lower()}")
    typer.echo(f"    isLearningExchange:      {str(directives.prompt_sections.is_learning_exchange).lower()}")
    s = directives.exchange_summary
    typer.echo(f"    Exchanges: {s.total_exchanges} total, {s.short_response_count} short, {s.question_count} with questions")


def _format_time(dt: "datetime") -> str:
    """Format datetime like TS's formatTime: 'May 21, 21:50'."""
    return dt.strftime("%-b %-d, %H:%M")


@journal_app.command("events")
def journal_events(
    limit: int = typer.Option(20, help="number of rows to show (most recent first)"),
    category: str = typer.Option("", help="filter by category prefix"),
    repo: str = typer.Option("", help="filter by repo"),
):
    """List the most recent activity_events from the journal Postgres.

    Reads the shared journal database (DATABASE_URL from .env).
    Rows are returned newest-first; use --limit to control how many.
    Prints: timestamp, category, actor, summary — one line per event.
    """
    from sqlalchemy import select, desc

    from quire.db.engine import get_engine
    from quire.db.models import ActivityEvent, Base

    engine = get_engine()
    from sqlalchemy.orm import Session as SASession

    with SASession(engine) as session:
        stmt = select(ActivityEvent).order_by(desc(ActivityEvent.timestamp)).limit(limit)
        if category:
            stmt = stmt.where(ActivityEvent.category.like(f"{category}%"))
        if repo:
            stmt = stmt.where(ActivityEvent.repo == repo)
        rows = session.execute(stmt).scalars().all()

    if not rows:
        typer.echo("no events found")
        return

    for ev in rows:
        ts = ev.timestamp.strftime("%Y-%m-%d %H:%M") if ev.timestamp else "?"
        typer.echo(f"{ts}  {ev.category:<32}  {ev.actor:<12}  {ev.summary[:80]}")


if __name__ == "__main__":
    app()
