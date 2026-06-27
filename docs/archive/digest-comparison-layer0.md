# Digest Comparison: Before vs After Layer 0

## Before Layer 0 (first digest)

```
Summary: The developer set out to design and implement an Execution Memory System —
a tool to capture the full cognitive arc of coding sessions, not just what survived
in git. The session moved from architecture design through spec writing, adversarial
review, and into full implementation via subagent-driven development.

Arcs: 7 arcs (all resolved except "Wiring and debugging the LLM pipeline")
Moments: 30 total (30 high)
Transitions: 7
```

**Issues:** Generic project status update. Arcs like "Correcting tech stack assumptions"
are trivial. No behavioral patterns. No causal analysis. Doesn't capture WHY decisions
were made or HOW the developer worked.

## After Layer 0 (with causal threading + interaction analysis)

```
Summary: The developer set out to build an Execution Memory System from scratch — a CLI
tool that ingests Claude Code session logs and produces structured digests of developer
behavior. The session moved through full system design, spec writing, input pipeline
implementation, a first real digest run, and then a significant pivot after rejecting
the digest quality as lacking genuine insight. The session ended with Layer 0 causal
threading fully implemented and smoke-tested against real session data, producing
actionable pipeline directives.

Arcs: 4 deeper arcs with progression narratives
Moments: 35 total (35 high)
Transitions: 6

Directives computed:
  trackDelegation: true
  isLearningExchange: true
  detectPassiveAcceptance: false
  detectIgnoredProposals: false
  Exchanges: 64 total, 28 short, 11 with questions
```

**Improvements:**
- Captures the quality rejection pivot: "rejected as lacking genuine insight"
- Uses developer's own words: "rejected by the developer as 'meaningless almost'"
- Fewer, deeper arcs (4 vs 7)
- Narrative tracks actual cognitive arc, not just task completion

**Still missing:**
- All 35 moments are "high" confidence — no discrimination
- No behavioral patterns (despite directives being computed)
- Transitions and narrative prompts still don't receive full evidence
- No critic pass catches generic moments
