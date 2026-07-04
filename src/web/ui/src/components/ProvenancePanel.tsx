// Provenance — every river event explains itself.
//
// One drawer, two altitudes: a C-level verdict strip (chips in the semantic
// inks — confidence ring, verification, anchored share, transcript reach),
// then the engineer trail — statement → evidence quotes → [#causalOrder]
// anchors → verification tick → the digest run's own trace → what the Brain
// noticed. The chain enters link by link (prov-rise); a verified link earns
// its moss tick with a quiet pop. No badges, no points — just the record.
import { useEffect, useState } from "react";
import "./provenance.css";
import { fetchProvenance } from "../api";
import type { Provenance, ProvenanceMoment } from "../types";
import { momentTone } from "./journal-util";
import { ProvenanceRing } from "./Quality";

// ── The affordance — a marginal "why?" ────────────────────────────────

export function ProvenanceWhy({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      className="prov-why"
      data-open={open}
      aria-expanded={open}
      title="Why is this here? Trace its provenance."
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      why?
    </button>
  );
}

// ── Verdict strip (altitude one — the C-level read) ───────────────────

const VERDICT_LABEL: Record<string, string> = {
  supported: "verified against the code",
  contradicted: "contradicted — read closely",
  mixed: "mixed verification",
  unverified: "unverified",
};

const VERDICT_TONE: Record<string, string | undefined> = {
  supported: "moss",
  contradicted: "red",
  mixed: "red",
  unverified: undefined,
};

function VerdictStrip({ data }: { data: Provenance }) {
  const v = data.verdict;
  const hasChain = v.moments > 0;
  return (
    <div className="prov-verdict">
      {hasChain && (
        <span className="prov-chip" title="Chain confidence, derived from the digester's labels">
          <ProvenanceRing pct={v.confidencePct} size={13} />
          {v.confidencePct !== null ? (
            <>
              <span className="prov-fig">{v.confidencePct}%</span> confidence
            </>
          ) : (
            "unlabeled confidence"
          )}
        </span>
      )}
      {hasChain && (
        <span className="prov-chip" data-tone={VERDICT_TONE[v.verification]}>
          {v.verification === "supported" && <span className="prov-fig">✓</span>}
          {(v.verification === "contradicted" || v.verification === "mixed") && (
            <span className="prov-fig">✕</span>
          )}
          {VERDICT_LABEL[v.verification]}
        </span>
      )}
      {v.quotes > 0 && (
        <span
          className="prov-chip"
          data-tone={v.anchored > 0 ? "teal" : undefined}
          title="Evidence quotes pinned to exact transcript events"
        >
          <span className="prov-fig">
            {v.anchored}/{v.quotes}
          </span>{" "}
          quotes anchored
        </span>
      )}
      {v.transcriptEvents > 0 && (
        <span className="prov-chip" data-tone="teal">
          traces to <span className="prov-fig">{v.transcriptEvents}</span> transcript event
          {v.transcriptEvents === 1 ? "" : "s"}
        </span>
      )}
      {data.digest && data.digest.anchoredPct !== null && (
        <span
          className="prov-chip"
          title={`${data.digest.anchored} of ${data.digest.quotes} quotes anchored across the whole session digest`}
        >
          session digest <span className="prov-fig">{data.digest.anchoredPct}%</span> anchored
        </span>
      )}
    </div>
  );
}

// ── Trail links (altitude two — the engineer chain) ───────────────────

function MomentLink({
  m,
  index,
  onJump,
}: {
  m: ProvenanceMoment;
  index: number;
  onJump?: (causalOrder: number) => void;
}) {
  const tone = momentTone(m.type);
  return (
    <div
      className="prov-link prov-rise"
      data-tone={tone}
      style={{ "--i": index } as React.CSSProperties}
    >
      <span className="prov-link-label">{m.type || "moment"}</span>
      {(m.agency || m.confidence) && (
        <span className="prov-link-meta">
          {[m.agency, m.confidence && `${m.confidence} confidence`].filter(Boolean).join(" · ")}
        </span>
      )}
      <p className="prov-statement">{m.statement}</p>

      {m.evidence.map((e) => (
        <div key={e.id} className="prov-quote">
          <span className="prov-quote-text">{e.quote}</span>
          {e.anchored && e.event ? (
            <button
              className="prov-anchor"
              title={
                onJump
                  ? `Jump to transcript event #${e.event.causalOrder}: ${e.event.summary}`
                  : `Transcript event #${e.event.causalOrder}: ${e.event.summary}`
              }
              onClick={() => e.event && onJump?.(e.event.causalOrder)}
            >
              [#{e.event.causalOrder}]
            </button>
          ) : (
            <span className="prov-anchor" data-dead="true" title="This quote never resolved to a transcript event">
              unanchored
            </span>
          )}
        </div>
      ))}

      <div
        className="prov-verify"
        data-verdict={
          m.verification === "supported" || m.verification === "contradicted"
            ? m.verification
            : "unverified"
        }
        style={{ "--i": index } as React.CSSProperties}
      >
        {m.verification === "supported" ? (
          <>
            <span className="prov-tick">✓</span> verified against the code
          </>
        ) : m.verification === "contradicted" ? (
          <>
            <span className="prov-tick">✕</span> contradicted by the code
          </>
        ) : (
          <>— unverified</>
        )}
      </div>
    </div>
  );
}

function TraceLink({ data, index }: { data: NonNullable<Provenance["agentTrace"]>; index: number }) {
  const [showCalls, setShowCalls] = useState(false);
  return (
    <div className="prov-link prov-rise" data-tone="violet" style={{ "--i": index } as React.CSSProperties}>
      <span className="prov-link-label">the digest run</span>
      <p className="prov-statement" style={{ fontSize: "0.85rem" }}>
        {data.run?.summary ?? `${data.toolCalls.length} tool call${data.toolCalls.length === 1 ? "" : "s"} recorded`}
      </p>
      {data.toolCalls.length > 0 && (
        <>
          <button className="prov-toggle" onClick={() => setShowCalls((v) => !v)}>
            {showCalls ? "fold the trace" : `read the ${data.toolCalls.length} tool call${data.toolCalls.length === 1 ? "" : "s"}`}
          </button>
          {showCalls && (
            <div className="prov-trace-calls">
              {data.toolCalls.slice(0, 16).map((tc, i) => (
                <div key={i}>
                  {tc.name}({tc.argsSummary}){" "}
                  {tc.ms !== null && <span className="prov-trace-ms">{tc.ms}ms</span>}
                </div>
              ))}
              {data.toolCalls.length > 16 && (
                <div className="prov-trace-ms">… {data.toolCalls.length - 16} more</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── The drawer ────────────────────────────────────────────────────────

interface DrawerProps {
  /** Activity-event id, source id, or bare moment id — the API resolves all three. */
  eventId: string;
  open: boolean;
  /** Jump to a transcript event by causal order (session-detail surface). */
  onJump?: (causalOrder: number) => void;
  /** Open the owning session record (journal surface). */
  onOpenSession?: (sessionId: string) => void;
}

/** A narrative chain can carry dozens of moments — open with the first few. */
const MOMENTS_FOLD = 6;

export function ProvenanceDrawer({ eventId, open, onJump, onOpenSession }: DrawerProps) {
  const [data, setData] = useState<Provenance | null>(null);
  const [failed, setFailed] = useState(false);
  const [requested, setRequested] = useState(false);
  const [showAllMoments, setShowAllMoments] = useState(false);

  useEffect(() => {
    if (!open || requested) return;
    setRequested(true);
    fetchProvenance(eventId)
      .then(setData)
      .catch(() => setFailed(true));
  }, [open, requested, eventId]);

  // On the journal surface an anchor opens the session record instead.
  const jump =
    onJump ??
    (onOpenSession && data?.session
      ? () => onOpenSession(data.session!.id)
      : undefined);

  let stagger = 0;

  return (
    <div className="prov-clip" data-open={open}>
      <div>
        <div className="prov-drawer">
          <div className="prov-kicker">provenance · {data ? data.kind : "…"}</div>

          {failed && <p className="prov-quiet">The chain isn&rsquo;t answering — the record keeps its silence.</p>}
          {!failed && !data && <p className="prov-loading">Tracing the chain&hellip;</p>}

          {data && (
            <>
              <VerdictStrip data={data} />

              {data.moments.length === 0 && (
                <p className="prov-quiet">
                  This event is its own record — no digested chain stands behind it
                  {data.kind === "consult" ? "; it was a live consult of the Brain" : ""}.
                </p>
              )}

              <div className="prov-trail">
                {(showAllMoments ? data.moments : data.moments.slice(0, MOMENTS_FOLD)).map((m) => (
                  <MomentLink key={m.id} m={m} index={Math.min(++stagger, 14)} onJump={jump} />
                ))}
                {data.moments.length > MOMENTS_FOLD && !showAllMoments && (
                  <div className="prov-link" data-tone="teal">
                    <button className="prov-toggle" onClick={() => setShowAllMoments(true)}>
                      trace all {data.moments.length} supporting moments
                    </button>
                  </div>
                )}

                {data.agentTrace && <TraceLink data={data.agentTrace} index={Math.min(++stagger, 14)} />}

                {data.observations.length > 0 && (
                  <div
                    className="prov-link prov-rise"
                    data-tone="gold"
                    style={{ "--i": Math.min(++stagger, 14) } as React.CSSProperties}
                  >
                    <span className="prov-link-label">the brain noticed</span>
                    {data.observations.slice(0, 5).map((o) => (
                      <p key={o.id} className="prov-obs">
                        {o.summary}
                        <span className="prov-obs-status" data-status={o.reviewStatus ?? undefined}>
                          {o.reviewStatus ?? "noted"}
                        </span>
                      </p>
                    ))}
                  </div>
                )}

                {/* the reserved slot — digestion-v2 will write here */}
                <div
                  className="prov-link prov-rise"
                  data-tone="gold"
                  data-reserved="true"
                  style={{ "--i": Math.min(++stagger, 14) } as React.CSSProperties}
                >
                  <span className="prov-link-label">understanding delta</span>
                  <p className="prov-reserved-text">
                    reserved — digestion v2 will record what this changed in the Brain.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
