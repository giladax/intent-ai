"""Quire Align CLI.

    python3 -m quire_align.cli demo                 # offline fixture demo (PR 101 → PARTIAL)
    python3 -m quire_align.cli demo --live          # same, but with real LLM inference
    python3 -m quire_align.cli analyze fixtures/refund-agent 102 --offline
    python3 -m quire_align.cli show <analysis_id>
    python3 -m quire_align.cli review <analysis_id> approved --reviewer you
    python3 -m quire_align.cli serve --port 8321
"""

from __future__ import annotations

import pathlib

import typer

from quire_align import workspace as workspace_mod
from quire_align.models import ReviewState
from quire_align.store import Store

app = typer.Typer(no_args_is_help=True, add_completion=False)

# ANTHROPIC_API_KEY / LANGSMITH_* / GITHUB_TOKEN live in the repo-root .env.
workspace_mod.load_env()


def _adapter(workspace: str):
    try:
        return workspace_mod.build_adapter(workspace)
    except FileNotFoundError as error:
        raise typer.BadParameter(str(error))


def _llm(offline: bool, pr_number: int):
    if offline:
        from quire_align.canned import fake_for_pr, known_pr_numbers

        try:
            return fake_for_pr(pr_number)
        except KeyError:
            raise typer.BadParameter(
                f"--offline uses canned model outputs, and PR {pr_number} has "
                f"none. Fixture PRs with canned outputs: {known_pr_numbers()}. "
                "Drop --offline to run real inference."
            )
    from quire_align.analysis.llm import AnthropicAlignmentLLM

    return AnthropicAlignmentLLM()


def _print_analysis(analysis) -> None:
    from quire_align.analysis.render import DISPLAY_LABELS

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
    from quire_align.analysis.graph import run_analysis
    from quire_align.analysis.render import DISPLAY_LABELS, LOUD_CLASSIFICATIONS, MARKER

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
    from quire_align.analysis.graph import run_analysis

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
    from quire_align.analysis.render import DISPLAY_LABELS

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
    from quire_align.propose import propose_contract

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

_HEALTH_DISPLAY = {
    "unobserved": "no evidence yet",
    "satisfies": "satisfied",
    "partially_satisfies": "partially satisfied",
    "contradicts": "contradicted",
}


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
    from quire_align.ask import (
        community_card,
        haiku_pick,
        load_group_state,
        resolve_term,
        save_alias,
    )

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
        health_label = _HEALTH_DISPLAY.get(health, health.replace("_", " "))
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

    from quire_align.api import create_app

    uvicorn.run(create_app(), host=host, port=port)


@app.command()
def enrich(
    workspace: str = typer.Argument(help="workspace dir or name"),
):
    """Run the LLM heuristic pass: name unnamed areas in product language
    and adjudicate borderline promise pairs. Human renames always win;
    results persist with the workspace."""
    from quire_align.graph_heuristics import GraphHeuristics, enrich_workspace
    from quire_align.mirror import _plural

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


if __name__ == "__main__":
    app()
