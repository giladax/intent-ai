/**
 * Deduplication quality criteria.
 * Used to evaluate whether near-duplicate insights are caught.
 */
export interface DedupTestCase {
  name: string;
  topicId: string;  // will be filled at runtime
  insights: { category: string; statement: string; confidence: number }[];
  expectedUniqueCount: number;  // how many should survive dedup
  // Pairs that should be recognized as duplicates:
  duplicatePairs: [number, number][];  // indices into insights array
}

export const dedupCriteria: DedupTestCase[] = [
  {
    name: "exact duplicates (baseline — should already work)",
    topicId: "",
    insights: [
      { category: "constraint", statement: "Must use streaming API.", confidence: 90 },
      { category: "constraint", statement: "Must use streaming API.", confidence: 80 },
      { category: "decision", statement: "Chose Postgres over SQLite.", confidence: 85 },
    ],
    expectedUniqueCount: 2,
    duplicatePairs: [[0, 1]],
  },
  {
    name: "case-only duplicates (should already work)",
    topicId: "",
    insights: [
      { category: "structure", statement: "Two-model strategy for pipeline.", confidence: 90 },
      { category: "structure", statement: "two-model strategy for pipeline.", confidence: 70 },
    ],
    expectedUniqueCount: 1,
    duplicatePairs: [[0, 1]],
  },
  {
    name: "near-duplicate: rephrased same concept",
    topicId: "",
    insights: [
      { category: "constraint", statement: "The Anthropic LLM client MUST use streaming — never client.messages.create().", confidence: 90 },
      { category: "constraint", statement: "Must use client.messages.stream() with .finalMessage() — the non-streaming version times out.", confidence: 85 },
      { category: "decision", statement: "CC logs chosen over git diffs as primary data source.", confidence: 80 },
    ],
    expectedUniqueCount: 2,
    duplicatePairs: [[0, 1]],
  },
  {
    name: "near-duplicate: subset statement",
    topicId: "",
    insights: [
      { category: "decision", statement: "PostgreSQL with pgvector was chosen over SQLite.", confidence: 85 },
      { category: "decision", statement: "PostgreSQL with pgvector was chosen over SQLite to support semantic similarity search, cross-project queries, and eventual multi-user access.", confidence: 90 },
      { category: "structure", statement: "Single process, no IPC.", confidence: 80 },
    ],
    expectedUniqueCount: 2,
    duplicatePairs: [[0, 1]],
  },
  {
    name: "near-duplicate: same concept different category",
    topicId: "",
    insights: [
      { category: "constraint", statement: "Zod schemas for LLM output must be lenient.", confidence: 90 },
      { category: "decision", statement: "Zod schemas for LLM output must be lenient — LLMs return unexpected values.", confidence: 85 },
      { category: "behavior", statement: "Pipeline runs end-to-end in single process.", confidence: 80 },
    ],
    expectedUniqueCount: 2,
    duplicatePairs: [[0, 1]],
  },
  {
    name: "NOT duplicates: similar words, different meaning",
    topicId: "",
    insights: [
      { category: "structure", statement: "The pipeline uses a two-model strategy: Haiku for classification, Sonnet for detection.", confidence: 90 },
      { category: "decision", statement: "The architecture is a monolith CLI — all subsystems in one process.", confidence: 85 },
      { category: "constraint", statement: "Digest processes must run sequentially, not in parallel.", confidence: 80 },
    ],
    expectedUniqueCount: 3,
    duplicatePairs: [],
  },
];
