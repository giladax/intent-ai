# Activity Event Backbone

## What

A single `activity_events` table that captures everything significant that happens in the system — coding sessions, system observations, knowledge creation — as time-ordered, searchable, embeddable events.

## Why

Today, session data lives in moment/transition/outcome tables. System activity (brain synthesis, pattern detection) is invisible. There's no unified stream to query, search, or derive knowledge from. The event table becomes the backbone for search, memory derivation, and audit — one place to ask "what happened?"

## Mental Model

```
Facts (events) → Observations (LLM-derived, also events) → Memory → Scaffolds → Better sessions → more events
```

Everything is an event. Observations about events are events. Memory creation emits events. The stream is self-describing.

## Hierarchy

- **Events** — facts. "This happened at this time."
- **Observations** — LLM-derived. "I notice X across these events." Also stored as events.
- **Memory** — synthesized from events + observations. Topics, insights, skills. Creation/updates emit events.
- **Scaffolds** — exported from memory. AGENTS.md, .repo/, MCP.

Events and observations are in the event table. Memory stays in existing tables (topics, insights, skills). The event table is an index layer that points into detailed records, not a replacement.

## Schema

```sql
activity_events (
  id            UUID PRIMARY KEY,
  timestamp     TIMESTAMPTZ NOT NULL,
  category      TEXT NOT NULL,
  tags          TEXT[] DEFAULT '{}',
  actor         TEXT NOT NULL,
  summary       TEXT NOT NULL,
  metadata      JSONB DEFAULT '{}',
  source_type   TEXT,
  source_id     UUID,
  session_id    UUID,
  topic_ids     UUID[] DEFAULT '{}',
  files         TEXT[] DEFAULT '{}',
  embedding     vector(1536),
  created_at    TIMESTAMPTZ DEFAULT now()
)
```

**No enums. No fixed taxonomy.** Categories, tags, actor values are freeform. Conventions emerge from usage.

**Indexes:** `category` (text_pattern_ops), `timestamp`, `session_id`, `tags` (GIN), `topic_ids` (GIN), `files` (GIN), `embedding` (HNSW), composite `(category, timestamp)`.

## Event Sources

**Session digest:** moments, transitions, outcomes promoted into the event stream after digestion.

**Brain/learning:** topic, insight, skill creation and updates emitted as events.

**Daemon:** significant live observations during active sessions.

**Observation layer:** LLM looks at recent events, produces observations — also emitted as events.

## Observation Layer

Not pattern detection. Not rule-based.

- **Input:** window of recent events
- **Model:** Haiku
- **Prompt:** "Here are recent events. What do you observe?"
- **Output (Zod):** `observations[]` with `statement`, `confidence`, `supporting_event_ids[]`, `suggested_tags[]`
- **Each observation → event** in the stream
- **Trigger:** configurable — post-digest, periodic, manual

## RAG Readiness

Three retrieval layers:
- **Structured:** filter by category, tags, files, timestamp, session_id, topic_ids
- **Semantic:** embedding similarity on summary
- **Hybrid:** filter then rank by embedding distance

Embeddings populated async. Events are useful immediately via structured queries.

## What Changes

- Pipeline gets an **emit step** — promotes moments/transitions/outcomes to activity_events
- Brain pipeline emits events for knowledge mutations
- Search queries the event table instead of scanning individual tables
- Dashboard gets a unified timeline view
- **Existing tables stay** — activity_events is an index layer, not a replacement

## Memory Derivation

- **Automatic:** observation layer notices recurring signals, emits observations. Lightweight, LLM-driven, no hardcoded rules.
- **Manual:** `intent brain` reads from event stream instead of raw session data. Deep synthesis stays deliberate.
- **Closed loop:** scaffolds improve agents → better sessions → more events → richer observations → better memory.
