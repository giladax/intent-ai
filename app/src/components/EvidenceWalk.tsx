// EvidenceWalk — the 4-hop provenance card that materializes inline
// when the user clicks a citation chip. Uses the existing fetchProvenance API.

import { useState, useEffect } from "react";
import "./EvidenceWalk.css";
import { fetchProvenance } from "../api";
import type { Provenance } from "../types";

interface EvidenceWalkProps {
  eventId: string;
  onClose: () => void;
}

export function EvidenceWalk({ eventId, onClose }: EvidenceWalkProps) {
  const [data, setData] = useState<Provenance | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchProvenance(eventId)
      .then(setData)
      .catch(() => setFailed(true));
  }, [eventId]);

  const firstMoment = data?.moments[0] ?? null;
  const firstEvidence = firstMoment?.evidence[0] ?? null;
  const hasAnchor = firstEvidence?.anchored && firstEvidence.event;

  return (
    <div className="lc-walk lc-rise">
      <div
        className="lc-walk-close"
        onClick={onClose}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && onClose()}
        aria-label="Close evidence walk"
      >
        ×
      </div>

      {/* Hop breadcrumb */}
      <div className="lc-walk-hops">
        <span className="lc-walk-hop">CLAIM</span>
        <span className="lc-walk-arr">→</span>
        <span className="lc-walk-hop">FEATURE</span>
        <span className="lc-walk-arr">→</span>
        <span className="lc-walk-hop">MOMENT</span>
        <span className="lc-walk-arr">→</span>
        <span className={`lc-walk-hop${hasAnchor ? " lc-walk-hop--last" : ""}`}>TRANSCRIPT</span>
      </div>

      {failed && <p className="lc-walk-quiet">Chain unavailable.</p>}
      {!failed && !data && <p className="lc-walk-quiet">Tracing…</p>}

      {data && (
        <>
          {firstMoment && (
            <p className="lc-walk-statement">{firstMoment.statement}</p>
          )}
          {firstEvidence && (
            <blockquote className="lc-walk-quote">
              {firstEvidence.event && (
                <span className="lc-walk-ln">[#{firstEvidence.event.causalOrder}] </span>
              )}
              {firstEvidence.quote}
            </blockquote>
          )}
          <div className="lc-walk-src">
            {firstMoment?.verification === "supported" && (
              <span className="lc-walk-ok">supported</span>
            )}
            {firstEvidence?.event?.timestamp && (
              <span>{new Date(firstEvidence.event.timestamp).toLocaleTimeString()}</span>
            )}
            {data.session && (
              <span className="lc-walk-session">session {data.session.id.slice(0, 8)}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
