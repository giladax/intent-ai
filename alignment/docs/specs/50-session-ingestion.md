# 50 — Session ingestion (coding sessions as evidence)

Ports the *value* of the abandoned TS session pipeline (`src/pipeline/`)
into Python: a Claude Code coding session becomes reasoning-bearing
evidence in the map. Cross-links: [30 derived layers](30-graph-and-derived-layers.md),
[40 extending the graph](40-extending-the-graph.md) (the worked example),
[20 LLM call sites](20-llm-call-sites.md) (this adds call #18).

## Why

The reasoning an agent or engineer produces *while working* is paid for
once and normally discarded. We capture it — we do **not** re-analyze
code. The token-saving story is literal: one summarization call over
text already written. And it completes the thesis: intent → **the
session where it was reasoned** → merge → drift.

## Trust tier — OBSERVED (deviation from the guide, justified)

`40-extending-the-graph.md` offers tier-3 (LLM proposal → sign). A
session is instead **tier-2 observed evidence**, like a check: it
objectively happened, its touched files are mechanical (from tool_use
inputs), and its reasoning is the agent's **own verbatim words**, not
our inference. So it never enters the signed layer — one-mutation-path
is untouched. It is persisted (not a disposable cache): the transcript
is the external source of record.

## Pipeline (`quire_align/session.py`)

```
.jsonl transcript ─ read_transcript (deterministic, no LLM)
                     → RawSession {touched_paths, reasoning_text, turns}
                   ─ SessionDigesterLLM.digest (ONE Sonnet call, temp 0)
                     → SessionDigest {title, summary, decisions[], reasoning}
                   ─ digest_session → sessions.yaml (atomic, idempotent on id)
```

- `read_transcript`: parses line-delimited JSON directly (no JS dep);
  assistant `text` blocks are the reasoning, `tool_use` Edit/Write
  inputs are the touched files; the reasoning corpus is bounded
  head+tail (opening intent + closing decisions).
- `digest`: leads with **decisions** (chosen / rejected / pivots — the
  gold), then distilled reasoning in the agent's own frame. Validated
  by structured output; `FakeSessionDigester` for offline/tests.
- Relation: `sessions_for_check(pr)` and `sessions_for_entity` (by
  touched-path match against a code holding, or via the coupled PR's
  check touching a promise the entity holds).

## Propagation — the three paths (the point, not an inert attachment)

1. **Reasoning** kept on the node (`_around_session` in `model.py`):
   reasoning first-class, decisions in the body, related to its PR and
   touched entities; sessions appear as `observed` neighbors on entity
   and check focuses.
2. **Story** (`story.py`): `session` is a citable, reason-bearing
   citation kind (universe includes session refs; licenses "because");
   `_session_lines` feeds the org story so it narrates the decisions.
3. **Search** (`relevance.py`): `_session_parts` folds a session's
   reasoning about an entity into the entity's vector — the same
   propagation diff reasoning already gets.

## Surface

- CLI: `digest-session <ws> <transcript.jsonl> [--pr N] [--offline]`.
- Read: `/api/model/{ws}/around/session-<prefix>`; navigator renders the
  walk `check/PR → session → reasoning` and `entity → its sessions`.

## Verified

A real 332-turn session (5.6 MB) ingested into quire-brain, coupled to
check #7, extracted 5 real decisions in the org's own frame ("treatment
arm must serve only Brain-derived constraints…"), related to four
entities by touched path. One Sonnet call.

## Out of scope (later)

The full TS pipeline (chunk / weave / verify / narrative / observe),
multi-session observation, Feature convergence. Also: a session shelf on
the ring (today sessions surface via entity/check neighbors and the
story, not their own top-level branch).
