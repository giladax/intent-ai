# The Essence Principle — one mental model for every consumer of the brain

**Date:** 2026-07-05 · **Source:** owner, verbatim: "i feel we are missing the essence. nobody reads so much. also mcp should share the same mental model. should be cleaner, more on demand. the presentation with cards is very descriptive by default."

## The principle

**The brain answers; it doesn't present.** Every surface — the human UI, the MCP tools agents consume, the CLI — defaults to the minimum that orients: a verdict, a few marks, the names of what can be pulled. Everything else is on-demand. Nobody reads by default — not executives, not engineers, and not agents (whose context windows are the scarcest reading budget of all).

## What it means per surface

- **UI**: cards are sparse marks (name, one signal, one delta) — never descriptive paragraphs by default. Prose exists only behind deliberate interaction. The composer is the front door; the answer is short and cited; the citations are the drill path.
- **MCP (same mental model, binding)**: `brain_enter`/`featureContext` return a terse orientation — verdict-grade understanding (2-3 sentences max), counts, and *named drill handles* (moment ids, session ids, evidence availability) — not the full context block. New/parameterized drill tools let the agent pull specific moments, evidence quotes, or narratives only when its task needs them. The agent decides its own reading depth, exactly like the human.
- **CLI/serve generally**: same shape — orientation first, drill handles, pull-based depth.

## Why this is the essence and not a style choice

The product's substance is provenance-anchored understanding. Its value is delivered at the moment someone (or something) *asks* — not by how much is displayed. A dense default buries the one thing that matters (the verdict, the anomaly, the gate) under everything that doesn't. On-demand is also the honest shape for trust: the drill path IS the provenance chain.

## Sequencing note

The MCP redesign happens BEFORE the 42-session campaign, so the campaign measures the serve shape we intend to ship.
