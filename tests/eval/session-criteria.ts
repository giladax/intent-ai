/**
 * Eval criteria for our conversation session, sliced into 4 scopes.
 *
 * These define WHAT the pipeline should produce — the ground truth
 * we know because we lived through this session.
 *
 * Each scope has:
 * - expectedShape: what classifySession should return
 * - expectedDirectives: what interaction analysis should detect
 * - mustDetectMoments: moments that MUST appear (by topic + type)
 * - mustNotDetect: things the pipeline should NOT hallucinate
 * - expectedTransitions: intent shifts that should be captured
 * - narrativeMusts: phrases/concepts the narrative must contain
 * - narrativeMustNots: anti-patterns (generic, wrong agency, unsupported)
 */

export interface ScopeCriteria {
  name: string;
  fixture: string;
  expectedShape: string;
  expectedDirectives: {
    detectPassiveAcceptance: boolean;
    trackDelegation: boolean;
    detectIgnoredProposals: boolean;
    isLearningExchange: boolean;
  };
  mustDetectMoments: {
    topic: string;
    type: string;
    agency: string;
    containsPhrase?: string; // statement should contain this
  }[];
  mustNotDetect: string[];  // things that should NOT appear as moments
  expectedTransitions: {
    from: string;
    to: string;
  }[];
  narrativeMusts: string[];     // concepts the narrative must mention
  narrativeMustNots: string[];  // anti-patterns
}

// ── Scope 1: Design Phase (PRD → spec approval) ──────────────────────

export const designScope: ScopeCriteria = {
  name: "design-phase",
  fixture: "scope-design.jsonl",
  expectedShape: "narrative",
  expectedDirectives: {
    detectPassiveAcceptance: false,  // developer was engaged in design Q&A
    trackDelegation: true,          // lots of "ok", "yes" to AI proposals
    detectIgnoredProposals: false,
    isLearningExchange: false,      // developer was deciding, not learning
  },
  mustDetectMoments: [
    {
      topic: "tech-stack",
      type: "rejection",
      agency: "developer",
      containsPhrase: "typescript",  // developer corrected Python assumption
    },
    {
      topic: "moment-detection",
      type: "commitment",
      agency: "developer",
      containsPhrase: "painted gold", // developer emphasized this is the core
    },
    {
      topic: "adversarial-review",
      type: "commitment",
      agency: "developer",
      containsPhrase: "all 7",  // accepted all 7 adversarial findings
    },
    {
      topic: "eval-driven",
      type: "commitment",
      agency: "developer",
      // developer insisted on eval-driven development
    },
    {
      topic: "architecture",
      type: "commitment",
      agency: "collaborative",
      containsPhrase: "monolith", // chose monolith CLI approach
    },
    {
      topic: "storage",
      type: "commitment",
      agency: "developer",
      containsPhrase: "postgres", // chose Postgres over SQLite
    },
  ],
  mustNotDetect: [
    "productivity scoring",    // explicitly a non-goal
    "code review tool",        // explicitly a non-goal
    "web UI",                  // deferred
  ],
  expectedTransitions: [
    { from: "Python", to: "TypeScript" },
    { from: "generic moment detection", to: "painted gold with evidence" },
  ],
  narrativeMusts: [
    "TypeScript",              // tech stack correction
    "painted gold",            // core differentiator language
    "adversarial",             // the review
    "eval",                    // EDD commitment
    "monolith",                // architecture choice
  ],
  narrativeMustNots: [
    "the developer decided",   // too generic — should use dev's own words
    "various changes",         // too vague
    "implemented features",    // meaningless
  ],
};

// ── Scope 2: Implementation Phase (spec → quality rejection) ─────────

export const implementationScope: ScopeCriteria = {
  name: "implementation-phase",
  fixture: "scope-implementation.jsonl",
  expectedShape: "narrative",
  expectedDirectives: {
    detectPassiveAcceptance: false,
    trackDelegation: true,          // heavy delegation during implementation
    detectIgnoredProposals: false,
    isLearningExchange: true,       // developer asked about CC log format
  },
  mustDetectMoments: [
    {
      topic: "cc-adapter",
      type: "discovery",
      agency: "collaborative",
      containsPhrase: "claude-code-kit", // discovered existing package
    },
    {
      topic: "chunking",
      type: "struggle",
      agency: "collaborative",
      // the file cluster shift bug that caused 27 micro-chunks
    },
    {
      topic: "chunking",
      type: "breakthrough",
      agency: "collaborative",
      containsPhrase: "forward window", // the fix
    },
    {
      topic: "digest-pipeline",
      type: "struggle",
      agency: "ai",
      containsPhrase: "Zod", // schema mismatch issues
    },
    {
      topic: "first-digest",
      type: "execution",
      agency: "collaborative",
      // first successful digest run
    },
  ],
  mustNotDetect: [
    "the developer reviewed",  // should be specific about what was reviewed
  ],
  expectedTransitions: [
    { from: "custom JSONL parser", to: "claude-code-kit" },
    { from: "27 micro-chunks", to: "11 well-sized chunks" },
  ],
  narrativeMusts: [
    "claude-code-kit",         // package adoption
    "chunk",                   // chunking work
    "smoke test",              // real data testing
    "Zod",                     // schema issues
  ],
  narrativeMustNots: [
    "the code was implemented",  // too generic
    "several improvements",      // too vague
  ],
};

// ── Scope 3: Quality Pivot (rejection → Layer 0) ─────────────────────

export const pivotScope: ScopeCriteria = {
  name: "quality-pivot",
  fixture: "scope-pivot.jsonl",
  expectedShape: "narrative",
  expectedDirectives: {
    detectPassiveAcceptance: false,
    trackDelegation: false,         // developer was driving hard here
    detectIgnoredProposals: false,
    isLearningExchange: true,       // researching approaches
  },
  mustDetectMoments: [
    {
      topic: "quality-rejection",
      type: "rejection",
      agency: "developer",
      containsPhrase: "lack",  // "we lack actual worthwhile meaning"
    },
    {
      topic: "pipeline-architecture",
      type: "discovery",
      agency: "collaborative",
      // architecture review found evidence is destroyed at each stage
    },
    {
      topic: "interaction-stats",
      type: "rejection",
      agency: "developer",
      containsPhrase: "meaningless", // "numerical scores are meaningless"
    },
    {
      topic: "pipeline-directives",
      type: "pivot",
      agency: "developer",
      containsPhrase: "actionable", // "output should be actionable"
    },
    {
      topic: "causal-threading",
      type: "commitment",
      agency: "collaborative",
      // decided on causal threading as Layer 0
    },
  ],
  mustNotDetect: [
    "the team discussed",      // there is no team, it's one developer + AI
  ],
  expectedTransitions: [
    { from: "smart summary", to: "execution memory" },
    { from: "numerical scores", to: "actionable directives" },
    { from: "add more instructions", to: "reduce complexity" },
  ],
  narrativeMusts: [
    "lack",                    // quality rejection language
    "meaningless",             // score rejection language
    "actionable",              // directive design language
    "causal threading",        // Layer 0 commitment
    "exchange",                // interaction pattern concept
  ],
  narrativeMustNots: [
    "the system was improved",   // too generic
    "addressed feedback",        // too vague
  ],
};

// ── Scope 4: Full Session ────────────────────────────────────────────

export const fullScope: ScopeCriteria = {
  name: "full-session",
  fixture: "scope-full.jsonl",
  expectedShape: "narrative",
  expectedDirectives: {
    detectPassiveAcceptance: false,
    trackDelegation: true,
    detectIgnoredProposals: false,
    isLearningExchange: true,
  },
  mustDetectMoments: [
    // Design moments
    { topic: "tech-stack", type: "rejection", agency: "developer" },
    { topic: "moment-detection", type: "commitment", agency: "developer" },
    // Implementation moments
    { topic: "cc-adapter", type: "discovery", agency: "collaborative" },
    { topic: "chunking", type: "struggle", agency: "collaborative" },
    // Pivot moments
    { topic: "quality-rejection", type: "rejection", agency: "developer" },
    { topic: "pipeline-directives", type: "pivot", agency: "developer" },
    // Layer 0 moments
    { topic: "causal-threading", type: "commitment", agency: "collaborative" },
  ],
  mustNotDetect: [],
  expectedTransitions: [
    { from: "Python", to: "TypeScript" },
    { from: "smart summary", to: "execution memory" },
    { from: "numerical scores", to: "actionable directives" },
  ],
  narrativeMusts: [
    "TypeScript",
    "painted gold",
    "claude-code-kit",
    "lack",
    "causal threading",
  ],
  narrativeMustNots: [
    "various improvements",
    "the code was updated",
  ],
};

export const allScopes = [designScope, implementationScope, pivotScope, fullScope];
