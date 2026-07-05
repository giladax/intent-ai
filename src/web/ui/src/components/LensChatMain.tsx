// LensChatMain — the chat surface (right side of the lens-chat shell).
// Arrival: verdict word-by-word + brainline + whispers. When a lens is
// selected: the arrival dissolves and a scoped turn materializes.
// Ask-bar is always fixed at the bottom with an optional scope tag.
//
// NOTE: buildLensScopeContext and buildArrivalBrief are copied inline
// here (from src/web/lens-chat-utils.ts) to avoid cross-boundary imports
// between the server-side src/web/ and UI src/web/ui/src/ trees.

import { useState, useEffect, useRef } from "react";
import "./LensChatMain.css";
import { streamChat } from "../api";
import type { ChatMessage } from "../types";
import type { LensType } from "./LensRail";

// ── Inlined pure utilities (mirrors src/web/lens-chat-utils.ts) ───────

interface LensScopeContext {
  featureId: string | null;
  timeRange: { since: string; until: string; label: string } | null;
}

function buildLensScopeContext(
  lensType: "feature" | "timeline" | null,
  lensValue: string | null,
): LensScopeContext {
  if (!lensType || !lensValue) return { featureId: null, timeRange: null };

  if (lensType === "feature") {
    return { featureId: lensValue, timeRange: null };
  }

  if (lensType === "timeline") {
    const now = new Date();
    if (lensValue === "today") {
      const since = new Date(now);
      since.setHours(0, 0, 0, 0);
      return {
        featureId: null,
        timeRange: { since: since.toISOString(), until: now.toISOString(), label: "today" },
      };
    }
    if (lensValue === "week") {
      const since = new Date(now);
      since.setDate(since.getDate() - 7);
      return {
        featureId: null,
        timeRange: { since: since.toISOString(), until: now.toISOString(), label: "this week" },
      };
    }
    const since = new Date(now);
    since.setDate(since.getDate() - 7);
    return {
      featureId: null,
      timeRange: { since: since.toISOString(), until: now.toISOString(), label: lensValue },
    };
  }

  return { featureId: null, timeRange: null };
}

function buildArrivalBrief(
  _stats: null | { streak: number; totalEvents: number },
  pendingCount: number,
): string {
  if (pendingCount > 0) {
    return `On course — ${pendingCount} thing${pendingCount === 1 ? "" : "s"} waiting for your stamp.`;
  }
  return "Quiet, and on course.";
}

// ── Component ─────────────────────────────────────────────────────────

interface LensChatMainProps {
  pendingCount: number;
  arrivalTotals: { sessions: number; events: number; moments: number };
  focusedLens: LensType;
  selectedFeatureId: string | null;
  selectedFeatureName: string | null;
  selectedTimeRange: "today" | "week" | null;
  onClearScope: () => void;
  /** Called when user clicks a citation chip — opens evidence walk inline. */
  onCitationClick?: (eventId: string) => void;
  /** Pending observations to show as in-chat approval cards. */
  pendingObservations: Array<{ id: string; summary: string; featureName: string | null; category: string }>;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}

export function LensChatMain({
  pendingCount,
  arrivalTotals,
  focusedLens,
  selectedFeatureId,
  selectedFeatureName,
  selectedTimeRange,
  onClearScope,
  pendingObservations,
  onApprove,
  onReject,
}: LensChatMainProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [arrivalDissolved, setArrivalDissolved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  // When a lens is focused for the first time, dissolve the arrival turn.
  useEffect(() => {
    if (focusedLens !== null && !arrivalDissolved) {
      const t = setTimeout(() => setArrivalDissolved(true), 420);
      return () => clearTimeout(t);
    }
  }, [focusedLens, arrivalDissolved]);

  // Scroll to bottom after new messages
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  const verdictText = buildArrivalBrief(null, pendingCount);

  const scopeLabel = focusedLens === "feature" && selectedFeatureName
    ? `◉ ${selectedFeatureName.toUpperCase()}`
    : focusedLens === "timeline" && selectedTimeRange
    ? `◉ ${selectedTimeRange === "today" ? "TODAY" : "THIS WEEK"}`
    : null;

  const lensScope = buildLensScopeContext(
    focusedLens,
    focusedLens === "feature" ? (selectedFeatureId ?? null) : (selectedTimeRange ?? null),
  );

  const send = async () => {
    const q = input.trim();
    if (!q || streaming) return;

    const history = messages.slice(-20);
    setMessages((prev) => [...prev, { role: "user", content: q }, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);

    const appendToLast = (text: string, replace = false) =>
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "assistant") {
          updated[updated.length - 1] = { ...last, content: replace ? text : last.content + text };
        }
        return updated;
      });

    try {
      for await (const event of streamChat(q, history, {
        lensScope: {
          featureId: lensScope.featureId ?? undefined,
          timeRange: lensScope.timeRange ?? undefined,
        },
      })) {
        if (event.type === "text" && event.content) appendToLast(event.content);
        else if (event.type === "error") appendToLast(`The Brain couldn't answer: ${event.content}`, true);
      }
    } catch (err) {
      appendToLast(`The Brain couldn't answer: ${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      setStreaming(false);
      inputRef.current?.focus({ preventScroll: true });
    }
  };

  // Verdict words animate one-by-one
  const verdictWords = verdictText.split(" ");

  return (
    <main className="lc-main" ref={chatRef}>
      <div className="lc-meta-top lc-rise" style={{ animationDelay: "0.6s" }}>
        intent-ai · feat/repo-brain
      </div>

      <div className="lc-chat">
        {/* Arrival turn */}
        {!arrivalDissolved && (
          <section
            className={`lc-turn-brain${focusedLens ? " lc-dissolve" : ""}`}
            aria-label="Arrival brief"
          >
            <div className="lc-speaker lc-rise" style={{ animationDelay: "0.7s" }}>
              brain · just now
            </div>
            <h1 className="lc-verdict" aria-label={verdictText}>
              {verdictWords.map((word, i) => (
                <span key={i}>
                  <span
                    className="lc-word"
                    style={{ animationDelay: `${0.95 + i * 0.24}s` }}
                  >
                    {word}
                  </span>
                  {i < verdictWords.length - 1 ? " " : ""}
                </span>
              ))}
            </h1>
            <p className="lc-brainline lc-rise" style={{ animationDelay: "2.15s" }}>
              {arrivalTotals.sessions} sessions digested, {arrivalTotals.events} events recorded.
              {pendingCount > 0 && (
                <>
                  {" "}<span className="lc-dim">One thing waits:</span>{" "}
                  <span className="lc-handle lc-handle--amber">
                    {pendingCount} understanding delta{pendingCount === 1 ? "" : "s"} await{pendingCount === 1 ? "s" : ""} your stamp.
                  </span>
                </>
              )}
            </p>
            <div className="lc-whispers lc-rise" style={{ animationDelay: "2.5s" }}>
              <button className="lc-chip">
                <span className="lc-dot" style={{ background: "var(--lc-cobalt)" }} />
                {arrivalTotals.sessions} sessions
              </button>
              <button className="lc-chip">
                <span className="lc-dot" style={{ background: "var(--lc-moss)" }} />
                {arrivalTotals.events} events
              </button>
              {pendingCount > 0 && (
                <button className="lc-chip">
                  <span className="lc-dot" style={{ background: "var(--lc-amber)" }} />
                  {pendingCount} pending
                </button>
              )}
            </div>
          </section>
        )}

        {/* Pending observations as in-chat approval cards */}
        {pendingObservations.length > 0 && messages.length === 0 && focusedLens === null && (
          <PendingApprovalTurns
            observations={pendingObservations}
            onApprove={onApprove}
            onReject={onReject}
          />
        )}

        {/* Chat conversation */}
        {messages.map((m, i) => (
          m.role === "user" ? (
            <div key={i} className="lc-turn-user">
              <div className="lc-who">you</div>
              <div className="lc-bubble">{m.content}</div>
            </div>
          ) : (
            <div key={i} className="lc-turn-brain">
              <div className="lc-speaker">
                brain{focusedLens && scopeLabel ? <> · <span className="lc-scope">{scopeLabel}</span></> : " · now"}
              </div>
              <p className="lc-brainline">
                {m.content || (streaming && i === messages.length - 1 ? "…" : "")}
              </p>
            </div>
          )
        ))}
      </div>

      {/* Ask bar */}
      <div className="lc-askwrap">
        <div className={`lc-ask${scopeLabel ? " lc-ask--scoped" : ""} lc-rise`} style={{ animationDelay: "1.1s" }}>
          <span className="lc-brand-dot" aria-hidden="true" />
          {scopeLabel && (
            <button className="lc-scopetag" onClick={onClearScope} title="Clear lens scope">
              {scopeLabel} <span className="lc-x" aria-hidden="true">×</span>
            </button>
          )}
          <input
            ref={inputRef}
            type="text"
            value={input}
            placeholder={
              scopeLabel
                ? `Ask within ${selectedFeatureName ?? selectedTimeRange ?? "this lens"}…`
                : "Ask the brain anything — or pick a lens to focus…"
            }
            aria-label="Ask the brain"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); send(); }
            }}
            disabled={streaming}
          />
          <span className="lc-enter">⏎</span>
        </div>
      </div>
    </main>
  );
}

// ── Pending approval cards (inline in conversation) ───────────────────

interface ApprovalObs {
  id: string;
  summary: string;
  featureName: string | null;
  category: string;
}

function PendingApprovalTurns({
  observations,
  onApprove,
  onReject,
}: {
  observations: ApprovalObs[];
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}) {
  return (
    <>
      {observations.slice(0, 3).map((obs, i) => (
        <ApprovalCard
          key={obs.id}
          obs={obs}
          index={i}
          onApprove={onApprove}
          onReject={onReject}
        />
      ))}
    </>
  );
}

function ApprovalCard({
  obs,
  index,
  onApprove,
  onReject,
}: {
  obs: ApprovalObs;
  index: number;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}) {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const [loading, setLoading] = useState(false);

  async function handleApprove() {
    setLoading(true);
    try {
      await onApprove(obs.id);
      setStatus("approved");
    } finally {
      setLoading(false);
    }
  }

  async function handleReject() {
    setLoading(true);
    try {
      await onReject(obs.id);
      setStatus("rejected");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="lc-turn-brain lc-rise"
      style={{ animationDelay: `${index * 0.15}s` }}
    >
      <div className="lc-speaker">brain · <span className="lc-scope">pending stamp</span></div>
      <div className={`lc-seal-card${status !== "pending" ? " lc-seal-card--sealed" : ""}`}>
        <span className={`lc-seal-tag lc-seal-tag--${status}`}>
          {status === "pending" ? "AWAITS YOUR STAMP" : status === "approved" ? "APPROVED" : "REJECTED"}
        </span>
        {obs.featureName && (
          <div className="lc-seal-feature">{obs.featureName}</div>
        )}
        <p className="lc-seal-summary">{obs.summary}</p>
        {status === "pending" && (
          <div className="lc-seal-actions">
            <button
              className="lc-btn lc-btn--approve"
              onClick={handleApprove}
              disabled={loading}
            >
              Seal into memory
            </button>
            <button
              className="lc-btn lc-btn--reject"
              onClick={handleReject}
              disabled={loading}
            >
              Discard
            </button>
          </div>
        )}
        {status === "approved" && (
          <div className="lc-stamp lc-stamp--approved" aria-label="Approved">✓ SEALED</div>
        )}
        {status === "rejected" && (
          <div className="lc-stamp lc-stamp--rejected" aria-label="Rejected">✕ DISCARDED</div>
        )}
      </div>
    </div>
  );
}
