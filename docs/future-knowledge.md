# Brain — Future Knowledge

> Not a roadmap. The product hypotheses we **consciously defer** so day-1 stays focused.
> When a deferred item becomes the next bet, promote it into the PRD ([`prd.md`](./prd.md)) — don't grow it here.

---

## Organizational Understanding
- Automatic claim promotion
- Knowledge confidence scoring
- Conflicting understandings / reconciliation
- Knowledge lifecycle, ownership, freshness
- Knowledge review workflow

## Feature Intelligence
- Automatic feature discovery
- Feature merge detection · split suggestions
- Capability graph
- **Cross-repository features** (one Feature spanning many repos)

## Spec-Driven Development (the alignment moat — P2+)
- Pluggable intent-signal ingestion (PRD-first), then specs/tickets/Slack/design
- PRD synchronization
- Requirement coverage · requirement → implementation mapping
- **Spec drift detection** (intent-evidence vs implementation-evidence diverging)
- Automatic scaffold generation

## Agent Intelligence
- Self-improving MCP
- Evaluation-dataset generation from real sessions
- Context-quality scoring
- Agent scaffold optimization
- Automatic `AGENTS.md` generation · skill generation

## Organization (whole-org consumers)
- Support integration · QA integration
- Customer-feedback correlation · incident correlation
- Release knowledge

## Knowledge Evolution
- Knowledge Deltas as first-class history
- Understanding timeline · feature timeline
- Current-understanding snapshots
- Evidence graph

## Search / Retrieval
- Multi-stage retrieval planner
- Evidence ranking · current-understanding-first retrieval
- Impact analysis · "what changed?" / "why?" / "what should I know?"

## Collaboration
- Private vs team vs org observations
- Organizational approval workflow · knowledge reviews
- Workspace proposals · branch understanding · merge understanding

---

## Why these are deferred (the discipline)
Each item above is real and probably right — but none is required to **prove that feature-aware context improves agent performance**, which is the only thing the MVP must establish. We resist building ontology and capability ahead of that proof. The single most important deferred bet is **the alignment moat (Spec-Driven Development)** — it is deferred to **Phase 2**, not abandoned.
