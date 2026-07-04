// Provenance — every river event explains itself (GET /api/events/:id/provenance).
//
// Pure chain-assembly over plain rows: the server route does thin SQL and this
// module turns the fetched material into the full explanation chain —
// event → moment(s) → evidence quotes → anchored transcript events →
// verification → the digester's own trace → related observations.
//
// Fail-safe by contract: every missing link resolves to null/[] — the chain
// renders as far as the record reaches, never a 500. All shaping here is
// dependency-free (except the stats lens' anchoredPct, deliberately reused so
// "anchored %" means the same thing everywhere) and unit-testable without
// Postgres.

import { anchoredPct } from "./stats.js";

// ── Input rows (plain, DB-shaped, decoupled from the ORM) ─────────────

export interface ProvenanceEventRow {
  id: string;
  timestamp: string; // ISO
  category: string;
  summary: string;
  actor: string;
  tags?: string[] | null;
  metadata?: Record<string, unknown> | null;
  sourceType?: string | null;
  sourceId?: string | null;
  sessionId?: string | null;
  featureId?: string | null;
  reviewStatus?: string | null;
}

export interface ProvenanceMomentRow {
  id: string;
  type: string;
  statement: string;
  significance?: string | null;
  agency?: string | null;
  confidence?: string | null;
  verification?: string | null;
}

export interface ProvenanceEvidenceRow {
  id: string;
  momentId: string;
  quote: string;
  quoteType?: string | null;
  sourceType?: string | null;
  /** The anchor — null when the quote never resolved to a transcript event. */
  sourceEventId?: string | null;
}

export interface AnchorEventRow {
  id: string;
  causalOrder: number;
  summary: string;
  category?: string | null;
  actor?: string | null;
  /** From the raw event when available; normalized events carry no clock. */
  timestamp?: string | null;
}

export interface ProvenanceSessionRow {
  id: string;
  sessionShape?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
}

/** Raw digest-quality counts for the session — same shape the stats lens reads. */
export interface ProvenanceQualityRow {
  moments: number;
  quotes: number;
  anchored: number;
  supported: number;
  contradicted: number;
}

/** An agent-trace activity event (the digester's own reasoning). */
export interface TraceEventRow {
  id: string;
  timestamp: string;
  category: string; // agent:tool-call | agent:run
  summary: string;
  metadata?: Record<string, unknown> | null;
}

export interface ObservationEventRow {
  id: string;
  timestamp: string;
  category: string;
  summary: string;
  reviewStatus?: string | null;
  featureId?: string | null;
}

// ── Output (the panel's contract) ─────────────────────────────────────

export type ProvenanceKind =
  | "moment"
  | "narrative"
  | "transition"
  | "outcome"
  | "observation"
  | "consult"
  | "agent-trace"
  | "event";

export type VerificationVerdict = "supported" | "contradicted" | "mixed" | "unverified";

export interface ProvenanceEvidence {
  id: string;
  quote: string;
  quoteType: string | null;
  sourceType: string | null;
  /** True when the quote is pinned to a transcript event. */
  anchored: boolean;
  event: AnchorEventRow | null;
}

export interface ProvenanceMoment {
  id: string;
  type: string;
  statement: string;
  significance: string | null;
  agency: string | null;
  confidence: string | null;
  /** Derived 0–100 from the freeform confidence label; null when unlabeled. */
  confidencePct: number | null;
  verification: string | null;
  evidence: ProvenanceEvidence[];
}

export interface ProvenanceVerdict {
  /** Chain confidence, 0–100 — the primary moment's, else the chain average. */
  confidencePct: number | null;
  verification: VerificationVerdict;
  supported: number;
  contradicted: number;
  unverified: number;
  moments: number;
  quotes: number;
  anchored: number;
  anchoredPct: number | null;
  /** Distinct transcript events the chain traces to. */
  transcriptEvents: number;
}

export interface ProvenanceAgentTrace {
  run: { summary: string; metadata: Record<string, unknown> } | null;
  toolCalls: Array<{ name: string; ms: number | null; argsSummary: string; summary: string }>;
}

export interface ProvenanceResponse {
  event: ProvenanceEventRow | null;
  kind: ProvenanceKind;
  verdict: ProvenanceVerdict;
  moments: ProvenanceMoment[];
  session: { id: string; shape: string | null; startedAt: string | null; endedAt: string | null } | null;
  digest: (ProvenanceQualityRow & { anchoredPct: number | null }) | null;
  agentTrace: ProvenanceAgentTrace | null;
  observations: Array<{
    id: string;
    timestamp: string;
    category: string;
    summary: string;
    reviewStatus: string | null;
    featureId: string | null;
  }>;
  /**
   * RESERVED for digestion-v2: the structured understanding delta this event
   * contributed to the Brain (what changed in Feature understanding, and why).
   * Always null today — the slot exists so clients can bind to it before the
   * digester learns to fill it.
   */
  understandingDelta: null;
}

// ── Helpers ───────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pipeline-local ids ("moment-3") must never hit a uuid column — guard first. */
export function isUuidLike(s: unknown): s is string {
  return typeof s === "string" && UUID_RE.test(s);
}

/** Freeform confidence label → derived 0–100 (the ring's arc). */
export function confidencePct(confidence: string | null | undefined): number | null {
  switch ((confidence ?? "").trim().toLowerCase()) {
    case "high":
      return 90;
    case "medium":
      return 65;
    case "low":
      return 40;
    default:
      return null;
  }
}

/** Classify the event's provenance kind — sourceType first, category prefix second. */
export function provenanceKind(
  sourceType: string | null | undefined,
  category: string | null | undefined,
): ProvenanceKind {
  switch (sourceType ?? "") {
    case "moment":
      return "moment";
    case "narrative":
      return "narrative";
    case "transition":
      return "transition";
    case "outcome":
      return "outcome";
    case "agent-trace":
      return "agent-trace";
    case "mcp":
      return "consult";
  }
  const c = (category ?? "").toLowerCase();
  if (c.startsWith("observation:")) return "observation";
  if (c.startsWith("mcp:")) return "consult";
  if (c.startsWith("agent:")) return "agent-trace";
  return "event";
}

/** Aggregate verification labels into one verdict for the C-level strip. */
export function verificationVerdict(supported: number, contradicted: number): VerificationVerdict {
  if (supported > 0 && contradicted > 0) return "mixed";
  if (contradicted > 0) return "contradicted";
  if (supported > 0) return "supported";
  return "unverified";
}

/** Split agent-trace rows into the run summary and its tool calls. */
export function splitAgentTrace(rows: TraceEventRow[]): ProvenanceAgentTrace | null {
  if (rows.length === 0) return null;
  const runRow = rows.find((r) => r.category === "agent:run") ?? null;
  const toolCalls = rows
    .filter((r) => r.category === "agent:tool-call")
    .map((r) => {
      const m = r.metadata ?? {};
      return {
        name: typeof m["toolName"] === "string" ? (m["toolName"] as string) : r.summary.split("(")[0] || "tool",
        ms: typeof m["ms"] === "number" ? (m["ms"] as number) : null,
        argsSummary: typeof m["argsSummary"] === "string" ? (m["argsSummary"] as string) : "",
        summary: r.summary,
      };
    });
  return {
    run: runRow ? { summary: runRow.summary, metadata: runRow.metadata ?? {} } : null,
    toolCalls,
  };
}

// ── The assembler ─────────────────────────────────────────────────────

export interface ProvenanceInput {
  event: ProvenanceEventRow | null;
  /** Explicit kind override for synthesized chains (e.g. lookup by moment id). */
  kind?: ProvenanceKind;
  moments: ProvenanceMomentRow[];
  evidence: ProvenanceEvidenceRow[];
  anchorEvents: AnchorEventRow[];
  session: ProvenanceSessionRow | null;
  quality: ProvenanceQualityRow | null;
  traceRows: TraceEventRow[];
  observationRows: ObservationEventRow[];
}

export function buildProvenance(input: ProvenanceInput): ProvenanceResponse {
  const kind =
    input.kind ?? provenanceKind(input.event?.sourceType ?? null, input.event?.category ?? null);

  const anchorById = new Map(input.anchorEvents.map((a) => [a.id, a] as const));
  const evidenceByMoment = new Map<string, ProvenanceEvidenceRow[]>();
  for (const e of input.evidence) {
    const list = evidenceByMoment.get(e.momentId) ?? [];
    list.push(e);
    evidenceByMoment.set(e.momentId, list);
  }

  const moments: ProvenanceMoment[] = input.moments.map((m) => ({
    id: m.id,
    type: m.type,
    statement: m.statement,
    significance: m.significance ?? null,
    agency: m.agency ?? null,
    confidence: m.confidence ?? null,
    confidencePct: confidencePct(m.confidence),
    verification: m.verification ?? null,
    evidence: (evidenceByMoment.get(m.id) ?? []).map((e) => {
      const anchor = e.sourceEventId ? (anchorById.get(e.sourceEventId) ?? null) : null;
      return {
        id: e.id,
        quote: e.quote,
        quoteType: e.quoteType ?? null,
        sourceType: e.sourceType ?? null,
        anchored: anchor !== null,
        event: anchor,
      };
    }),
  }));

  // ── verdict (the C-level strip) ──
  const allEvidence = moments.flatMap((m) => m.evidence);
  const quotes = allEvidence.length;
  const anchored = allEvidence.filter((e) => e.anchored).length;
  const transcriptEvents = new Set(allEvidence.filter((e) => e.event).map((e) => e.event!.id)).size;
  const supported = moments.filter((m) => m.verification === "supported").length;
  const contradicted = moments.filter((m) => m.verification === "contradicted").length;
  const unverified = moments.length - supported - contradicted;

  // Confidence: a single-moment chain speaks with its own voice; a multi-moment
  // chain averages the labeled ones.
  const pcts = moments.map((m) => m.confidencePct).filter((p): p is number => p !== null);
  const chainConfidence =
    moments.length === 1
      ? moments[0].confidencePct
      : pcts.length > 0
        ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length)
        : null;

  return {
    event: input.event,
    kind,
    verdict: {
      confidencePct: chainConfidence,
      verification: verificationVerdict(supported, contradicted),
      supported,
      contradicted,
      unverified,
      moments: moments.length,
      quotes,
      anchored,
      anchoredPct: anchoredPct(anchored, quotes),
      transcriptEvents,
    },
    moments,
    session: input.session
      ? {
          id: input.session.id,
          shape: input.session.sessionShape ?? null,
          startedAt: input.session.startedAt ?? null,
          endedAt: input.session.endedAt ?? null,
        }
      : null,
    digest: input.quality
      ? { ...input.quality, anchoredPct: anchoredPct(input.quality.anchored, input.quality.quotes) }
      : null,
    agentTrace: splitAgentTrace(input.traceRows),
    observations: input.observationRows.map((o) => ({
      id: o.id,
      timestamp: o.timestamp,
      category: o.category,
      summary: o.summary,
      reviewStatus: o.reviewStatus ?? null,
      featureId: o.featureId ?? null,
    })),
    understandingDelta: null,
  };
}
