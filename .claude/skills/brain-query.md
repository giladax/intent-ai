---
name: brain-query
description: Query the intent-ai Brain MCP server for feature context. Use when you need to understand how something works, find relevant files, get constraints, or understand why something was built a certain way. The Brain uses an orientation-first, drill-on-demand model.
---

# Brain Query Skill

Query the project's accumulated feature knowledge over MCP. The Brain answers in
two tiers: a terse orientation by default, full depth on demand.

## Orientation-first, drill on demand

`brain_enter` and `brain_feature_context` return a **terse orientation** (~15 lines):
- Feature name + id
- Verdict-grade understanding (2-3 sentences, with citations)
- Constraints as one-liners (shown in full if ≤3; count + drill hint if >3)
- **Drill handles**: moment/session counts + truncated ids pointing to drill tools

Read the orientation first. Pull depth only when your task needs it.

## Primary entry tools

### brain_enter (start here)

Resolve a file or task to its Feature and get an orientation.

```
mcp__intent-brain__brain_enter({
  file: "src/pipeline/emit-events.ts",   // or
  task: "add a new MCP tool",
  depth: "orientation"  // default — omit this; pass "full" only if you need everything
})
```

Returns: feature name+id, understanding verdict, constraints, drill handles.
On 0 or >1 matches: candidate list to pick from — never guesses.

### brain_feature_context (by id)

Fetch a Feature's orientation (or full context) when you already have the id.

```
mcp__intent-brain__brain_feature_context({
  featureId: "abc-123",
  depth: "orientation"  // default; or "full" for the complete assembled block
})
```

## Drill tools (pull only what you need)

### brain_moments — terse moment list

```
mcp__intent-brain__brain_moments({ featureId: "abc-123" })
```

Returns: terse moment statements with confidence, verification status, and moment ids.
No evidence quotes — call `brain_evidence` to pull those.

### brain_evidence — anchored quotes for one moment

```
mcp__intent-brain__brain_evidence({ momentId: "moment-id-from-brain-moments" })
```

Returns: verbatim transcript excerpts that ground the claim (the provenance chain).
Use after `brain_moments` to verify a specific claim before relying on it.

### brain_narrative — one session's arc

```
mcp__intent-brain__brain_narrative({ sessionId: "session-id-from-orientation" })
```

Returns: session summary, progression (how intent evolved), key discoveries.
Use when the session id appears in the orientation drill handles and you want to
understand what happened in that session.

## Full context (backward compat / when you need everything)

Pass `depth: "full"` to any of the above to get the complete assembled block:
understanding + all key moments with evidence + sessions + files + agent instructions.

```
mcp__intent-brain__brain_feature_context({ featureId: "abc-123", depth: "full" })
```

## Search

```
mcp__intent-brain__brain_search({ query: "activity events" })
```

Returns: top-matching Features with ids, for use with `brain_feature_context`.

## Write-back (report what you learn)

After your session, report back to the Brain:

```
mcp__intent-brain__brain_report_observation({ featureId, summary, kind, sessionId })
mcp__intent-brain__brain_report_unknown({ featureId, summary, sessionId })
mcp__intent-brain__brain_rate_context({ featureId, rating, comment, sessionId })
```

## When to use each tool

| Situation | Tool |
|-----------|------|
| Starting work on unfamiliar code | `brain_enter(file: ...)` |
| Starting work on a task/goal | `brain_enter(task: ...)` |
| Need the constraints for a feature you already know | `brain_feature_context(featureId)` |
| Want to verify a specific claim | `brain_moments(featureId)` → `brain_evidence(momentId)` |
| Need to understand what happened in a session | `brain_narrative(sessionId)` |
| Need everything (rare — costs context) | any tool with `depth: "full"` |
| Searching by concept | `brain_search(query)` |
