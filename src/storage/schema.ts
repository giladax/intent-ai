import {
  pgTable,
  primaryKey,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

// ── Enums ──────────────────────────────────────────────────────────────

export const momentRelationTypeEnum = pgEnum("moment_relation_type", [
  "caused",
  "evolved_into",
  "contradicts",
]);

export const insightCategoryEnum = pgEnum("insight_category", [
  "structure",
  "decision",
  "constraint",
  "behavior",
  "risk",
  "interface",
  "navigation",
  "pitfall",
]);

export const insightStatusEnum = pgEnum("insight_status", [
  "active",
  "stale",
  "deprecated",
]);

// ── Projects ──────────────────────────────────────────────────────────

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  path: text("path").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Features ──────────────────────────────────────────────────────────

export const features = pgTable("features", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").references(() => projects.id).notNull(),
  name: text("name").notNull(),
  description: text("description").default(""),
  // ── Understanding fields (PRD v0.3) ──
  // currentUnderstanding: Brain's synthesized answer for the Feature
  // (Week-1 = description + approved Observations, assembled).
  currentUnderstanding: text("current_understanding"),
  // constraints / knownUnknowns: freeform JSON arrays of strings.
  constraints: jsonb("constraints").default([]).notNull(),
  knownUnknowns: jsonb("known_unknowns").default([]).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Feature Files (file ↔ Feature map) ────────────────────────────────
// Maps a glob OR an exact file_path to a Feature. The brain.enter resolver
// uses longest-glob-wins over this table. Bootstrap from feature_sessions
// affected files, then human-correct.

export const featureFiles = pgTable("feature_files", {
  id: uuid("id").defaultRandom().primaryKey(),
  featureId: uuid("feature_id").references(() => features.id, { onDelete: "cascade" }).notNull(),
  glob: text("glob"),
  filePath: text("file_path"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("idx_ff_feature_id").on(t.featureId)]);

// ── Sessions ───────────────────────────────────────────────────────────

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceType: text("source_type").notNull(),
  sourcePath: text("source_path").notNull(),
  sessionShape: text("session_shape"),
  sourceHash: text("source_hash"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Feature Sessions (join table) ─────────────────────────────────────

export const featureSessions = pgTable("feature_sessions", {
  featureId: uuid("feature_id").references(() => features.id).notNull(),
  sessionId: uuid("session_id").references(() => sessions.id).notNull(),
  role: text("role").notNull(),
}, (t) => [primaryKey({ columns: [t.featureId, t.sessionId] })]);

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

// ── Brain: Topics ─────────────────────────────────────────────────────

export const topics = pgTable("topics", {
  id: uuid("id").primaryKey().defaultRandom(),
  repoId: uuid("repo_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  summary: text("summary").notNull(),
  // parent_topic_id RETIRED (PRD v0.3): the topic tree no longer competes
  // with the Feature graph.
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Brain: Insights ───────────────────────────────────────────────────

export const insights = pgTable("insights", {
  id: uuid("id").primaryKey().defaultRandom(),
  topicId: uuid("topic_id").references(() => topics.id, { onDelete: "cascade" }).notNull(),
  category: insightCategoryEnum("category").notNull(),
  statement: text("statement").notNull(),
  confidence: integer("confidence").default(80).notNull(),
  status: insightStatusEnum("status").default("active").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Brain: Insight Evidence ───────────────────────────────────────────

export const insightEvidence = pgTable("insight_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  insightId: uuid("insight_id").references(() => insights.id, { onDelete: "cascade" }).notNull(),
  sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "cascade" }).notNull(),
  momentId: uuid("moment_id").references(() => moments.id, { onDelete: "set null" }),
  reasoning: text("reasoning"),
});

// ── Brain: Topic Files ────────────────────────────────────────────────

export const topicFiles = pgTable("topic_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  topicId: uuid("topic_id").references(() => topics.id, { onDelete: "cascade" }).notNull(),
  filePath: text("file_path").notNull(),
  role: text("role").notNull(),
  sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "set null" }),
});

// ── Brain: Topic Relations ────────────────────────────────────────────

export const topicRelations = pgTable("topic_relations", {
  topicId: uuid("topic_id").references(() => topics.id, { onDelete: "cascade" }).notNull(),
  relatedTopicId: uuid("related_topic_id").references(() => topics.id, { onDelete: "cascade" }).notNull(),
  relationship: text("relationship").notNull(),
}, (t) => [primaryKey({ columns: [t.topicId, t.relatedTopicId] })]);

// ── Brain: Topic Sessions ─────────────────────────────────────────────

export const topicSessions = pgTable("topic_sessions", {
  topicId: uuid("topic_id").references(() => topics.id, { onDelete: "cascade" }).notNull(),
  sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "cascade" }).notNull(),
}, (t) => [primaryKey({ columns: [t.topicId, t.sessionId] })]);

// ── Brain: Versions ───────────────────────────────────────────────────

export const brainVersions = pgTable("brain_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  repoId: uuid("repo_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  commitSha: text("commit_sha"),
  parentVersionId: uuid("parent_version_id").references((): any => brainVersions.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Brain: Cards ──────────────────────────────────────────────────────

export const brainCards = pgTable("brain_cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  nodeName: text("node_name").notNull(),
  level: text("level").notNull(),
  path: text("path"),
  parentNode: text("parent_node"),
  summary: text("summary").notNull(),
  insights: jsonb("insights").notNull().default([]),
  files: jsonb("files").default([]),
  exports: jsonb("exports").default([]),
  related: jsonb("related").default([]),
  children: jsonb("children").default([]),
  sessions: jsonb("sessions").default([]),
  versionId: uuid("version_id").references(() => brainVersions.id),
  repoId: uuid("repo_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Brain: Topic Patterns ─────────────────────────────────────────────

export const topicPatterns = pgTable("topic_patterns", {
  id: uuid("id").primaryKey().defaultRandom(),
  topicId: uuid("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // "request" | "struggle" | "file_access"
  statement: text("statement").notNull(),
  frequency: integer("frequency").notNull().default(1),
  confidence: text("confidence").notNull().default("medium"),
  fileAssociations: jsonb("file_associations").notNull().default([]),
  evidence: jsonb("evidence").notNull().default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ── Brain: Topic Skills ───────────────────────────────────────────────

export const skillStatusEnum = pgEnum("skill_status", [
  "draft",
  "approved",
  "validated",
]);

export const topicSkills = pgTable("topic_skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  topicId: uuid("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  steps: jsonb("steps").notNull().default([]),
  pitfalls: jsonb("pitfalls").notNull().default([]),
  files: jsonb("files").notNull().default([]),
  status: skillStatusEnum("status").notNull().default("draft"),
  evidence: jsonb("evidence").notNull().default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ── Activity Events ─────────────────────────────────────────────────

export const activityEvents = pgTable("activity_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  category: text("category").notNull(),
  tags: text("tags").array().default([]),
  actor: text("actor").notNull(),
  summary: text("summary").notNull(),
  metadata: jsonb("metadata").default({}),

  // Source pointer
  sourceType: text("source_type"),
  sourceId: text("source_id"),

  // Session context (denormalized)
  sessionId: uuid("session_id"),
  repo: text("repo"),
  branch: text("branch"),
  worktree: text("worktree"),

  // Feature link (DENORMALIZED — intentionally NOT a foreign key, keeps
  // activity_events self-contained per the backbone anti-patterns).
  featureId: text("feature_id"),
  // Observation review lifecycle. Freeform TEXT by convention
  // (pending | approved | rejected) — NO enum, NO CHECK constraint.
  reviewStatus: text("review_status").default("pending"),

  // Searchable dimensions
  topicIds: uuid("topic_ids").array().default([]),
  files: text("files").array().default([]),

  // RAG — stored as text for now, cast to vector in queries when pgvector is enabled
  embedding: text("embedding"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  index("idx_ae_category").using("btree", t.category.op("text_pattern_ops")),
  index("idx_ae_timestamp").on(t.timestamp),
  index("idx_ae_session_id").on(t.sessionId),
  index("idx_ae_repo").on(t.repo),
  index("idx_ae_branch").on(t.branch),
  index("idx_ae_tags").using("gin", t.tags),
  index("idx_ae_topic_ids").using("gin", t.topicIds),
  index("idx_ae_files").using("gin", t.files),
  index("idx_ae_category_ts").on(t.category, t.timestamp),
  index("idx_ae_repo_branch").on(t.repo, t.branch),
  index("idx_ae_feature_review").on(t.featureId, t.reviewStatus),
]);
