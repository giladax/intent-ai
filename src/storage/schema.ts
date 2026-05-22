import {
  pgTable,
  primaryKey,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";

// ── Enums ──────────────────────────────────────────────────────────────

export const momentRelationTypeEnum = pgEnum("moment_relation_type", [
  "caused",
  "evolved_into",
  "contradicts",
]);

// ── Sessions ───────────────────────────────────────────────────────────

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceType: text("source_type").notNull(),
  sourcePath: text("source_path").notNull(),
  sessionShape: text("session_shape"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Raw Events ─────────────────────────────────────────────────────────

export const rawEvents = pgTable("raw_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }),
  type: text("type").notNull(),
  raw: jsonb("raw").notNull(),
});

// ── Normalized Events ──────────────────────────────────────────────────

export const normalizedEvents = pgTable("normalized_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  rawEventId: uuid("raw_event_id").references(() => rawEvents.id, {
    onDelete: "set null",
  }),
  causalOrder: integer("causal_order").notNull(),
  category: text("category").notNull(),
  actor: text("actor").notNull(),
  summary: text("summary").notNull(),
  detail: text("detail"),
  filesAffected: text("files_affected").array(),
});

// ── Chunks ─────────────────────────────────────────────────────────────

export const chunks = pgTable("chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  topicHint: text("topic_hint"),
  filesInScope: text("files_in_scope").array(),
  eventRangeStart: integer("event_range_start").notNull(),
  eventRangeEnd: integer("event_range_end").notNull(),
});

// ── Moments ────────────────────────────────────────────────────────────

export const moments = pgTable("moments", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  chunkId: uuid("chunk_id").references(() => chunks.id, {
    onDelete: "set null",
  }),
  type: text("type").notNull(),
  statement: text("statement").notNull(),
  significance: text("significance"),
  agency: text("agency"),
  confidence: text("confidence"),
  topicFingerprint: text("topic_fingerprint"),
  arcId: text("arc_id"),
  arcRole: text("arc_role"),
});

// ── Moment Evidence ────────────────────────────────────────────────────

export const momentEvidence = pgTable("moment_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  momentId: uuid("moment_id")
    .notNull()
    .references(() => moments.id, { onDelete: "cascade" }),
  quote: text("quote").notNull(),
  sourceEventId: uuid("source_event_id").references(
    () => normalizedEvents.id,
    { onDelete: "set null" },
  ),
  sourceType: text("source_type"),
  quoteType: text("quote_type"),
});

// ── Moment Relations ───────────────────────────────────────────────────

export const momentRelations = pgTable("moment_relations", {
  momentId: uuid("moment_id")
    .notNull()
    .references(() => moments.id, { onDelete: "cascade" }),
  relatedMomentId: uuid("related_moment_id")
    .notNull()
    .references(() => moments.id, { onDelete: "cascade" }),
  relationType: momentRelationTypeEnum("relation_type").notNull(),
}, (t) => [primaryKey({ columns: [t.momentId, t.relatedMomentId] })]);

// ── Transitions ────────────────────────────────────────────────────────

export const transitions = pgTable("transitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  fromStatement: text("from_statement").notNull(),
  toStatement: text("to_statement").notNull(),
  reason: text("reason"),
  arcId: text("arc_id"),
  confidence: text("confidence"),
});

// ── Transition Moments (join table) ────────────────────────────────────

export const transitionMoments = pgTable("transition_moments", {
  transitionId: uuid("transition_id")
    .notNull()
    .references(() => transitions.id, { onDelete: "cascade" }),
  momentId: uuid("moment_id")
    .notNull()
    .references(() => moments.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.transitionId, t.momentId] })]);

// ── Outcomes ───────────────────────────────────────────────────────────

export const outcomes = pgTable("outcomes", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  statement: text("statement").notNull(),
  confidence: text("confidence"),
});

// ── Outcome Moments (join table) ───────────────────────────────────────

export const outcomeMoments = pgTable("outcome_moments", {
  outcomeId: uuid("outcome_id")
    .notNull()
    .references(() => outcomes.id, { onDelete: "cascade" }),
  momentId: uuid("moment_id")
    .notNull()
    .references(() => moments.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.outcomeId, t.momentId] })]);

// ── Outcome Files (join table) ─────────────────────────────────────────

export const outcomeFiles = pgTable("outcome_files", {
  outcomeId: uuid("outcome_id")
    .notNull()
    .references(() => outcomes.id, { onDelete: "cascade" }),
  filePath: text("file_path").notNull(),
});

// ── Narratives ─────────────────────────────────────────────────────────

export const narratives = pgTable("narratives", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  sessionShape: text("session_shape"),
  summary: text("summary").notNull(),
  progression: text("progression").array(),
  discoveries: text("discoveries").array(),
  stabilizedDirections: text("stabilized_directions").array(),
  abandonedDirections: text("abandoned_directions").array(),
});

// ── Narrative Arcs ─────────────────────────────────────────────────────

export const narrativeArcs = pgTable("narrative_arcs", {
  id: uuid("id").primaryKey().defaultRandom(),
  narrativeId: uuid("narrative_id")
    .notNull()
    .references(() => narratives.id, { onDelete: "cascade" }),
  arcId: text("arc_id").notNull(),
  title: text("title").notNull(),
  summary: text("summary"),
  resolution: text("resolution"),
  momentIds: text("moment_ids").array(),
});
