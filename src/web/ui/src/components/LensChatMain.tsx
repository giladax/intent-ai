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
import { streamChat, fetchLensOpening, fetchSessions, type FeedComposed } from "../api";
import type { ChatMessage, Session } from "../types";
import type { LensType } from "./LensRail";
import { FeedStream, type PressedStory } from "./FeedStream";

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

// ── Markdown renderer for brain turns ────────────────────────────────

function renderMarkdown(text: string): React.ReactNode[] {
  return text.split("\n\n").map((para, i) => {
    const cleaned = para
      // Escape raw HTML first — the model's output is not trusted markup.
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/^#{1,3}\s+/gm, "")  // strip headers
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/^[-*]\s+/gm, "• ");  // list dashes to bullets
    return (
      <p key={i} className="lc-brainline" style={{ marginBottom: "14px" }} dangerouslySetInnerHTML={{ __html: cleaned }} />
    );
  });
}

// ── Opening paragraphs with an in-place "more" affordance ─────────────
// Long understanding text collapses to 3 paragraphs; "more" expands inline.

const OPENING_COLLAPSE_COUNT = 3;

function OpeningParagraphs({
  turn,
  expanded,
  onExpand,
}: {
  turn: string | null;
  expanded: boolean;
  onExpand: () => void;
}) {
  if (!turn) return null;
  const paras = turn
    .replace(/\[s:[a-f0-9]+\]/gi, "")
    .replace(/\.\s*\./g, ".")
    .trim()
    .split("\n\n")
    .filter((p) => p.trim().length > 0);
  const collapsed = !expanded && paras.length > OPENING_COLLAPSE_COUNT;
  const shown = collapsed ? paras.slice(0, OPENING_COLLAPSE_COUNT) : paras;
  return (
    <>
      {shown.map((para, i) => (
        <p key={i} className="lc-brainline" style={{ marginBottom: "14px" }}>
          {para}
        </p>
      ))}
      {collapsed && (
        <button className="lc-more" onClick={onExpand}>
          more · {paras.length - OPENING_COLLAPSE_COUNT} paragraph{paras.length - OPENING_COLLAPSE_COUNT === 1 ? "" : "s"} ↓
        </button>
      )}
    </>
  );
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
  /** The composed editorial feed — shown when the org lens is active. */
  feed: FeedComposed | null;
  feedLoading: boolean;
  /** Stories pressed open in the feed (press-and-unfold stack). */
  pressedStories: PressedStory[];
  onStoryPress: (featureId: string, featureName: string) => void;
  /** Notification card slot — rendered at the top of the feed stream. */
  notifSlot?: React.ReactNode;
  /** Navigate to a session's detail page when a feed citation chip is clicked. */
  onSessionClick?: (sessionId: string) => void;
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
  feed,
  feedLoading,
  pressedStories,
  onStoryPress,
  notifSlot,
  onSessionClick,
}: LensChatMainProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [openingTurn, setOpeningTurn] = useState<string | null>(null);
  const [openingLoading, setOpeningLoading] = useState(false);
  const [openingExpanded, setOpeningExpanded] = useState(false);
  const [timelineSessions, setTimelineSessions] = useState<Session[] | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  // Seeded opening — fetched when a feature is selected. The opening IS the
  // chat's first turn: understanding + recent insights + pending count.
  useEffect(() => {
    setOpeningExpanded(false);
    if (!selectedFeatureId) {
      setOpeningTurn(null);
      setOpeningLoading(false);
      return;
    }
    let cancelled = false;
    setOpeningLoading(true);
    setOpeningTurn(null);
    fetchLensOpening(selectedFeatureId)
      .then((res) => {
        if (!cancelled) setOpeningTurn(res.turn);
      })
      .catch(() => {
        if (!cancelled) setOpeningTurn(null); // fail-safe: no opening, chat still works
      })
      .finally(() => {
        if (!cancelled) setOpeningLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedFeatureId]);

  // Timeline seeded opening — a real sessions list for the selected window.
  // Same mechanic as the feature opening: select a lens value, get a first turn.
  useEffect(() => {
    if (focusedLens !== "timeline" || !selectedTimeRange) {
      setTimelineSessions(null);
      setTimelineLoading(false);
      return;
    }
    let cancelled = false;
    setTimelineLoading(true);
    fetchSessions()
      .then((sessions) => {
        if (cancelled) return;
        const now = new Date();
        const since = new Date(now);
        if (selectedTimeRange === "today") since.setHours(0, 0, 0, 0);
        else since.setDate(since.getDate() - 7);
        const inWindow = sessions.filter((s) => {
          const t = s.started_at ?? s.created_at;
          return t ? new Date(t).getTime() >= since.getTime() : false;
        });
        setTimelineSessions(inWindow.slice(0, 8));
      })
      .catch(() => {
        if (!cancelled) setTimelineSessions([]); // fail-safe: empty list, chat still works
      })
      .finally(() => {
        if (!cancelled) setTimelineLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [focusedLens, selectedTimeRange]);

  // Scroll to bottom after new messages
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  // Feed mode: the org lens is active, OR a story press opened the feature
  // lens from within the feed (the stream stays — presses extend it).
  // Rail-driven lens selection leaves feed mode (feature page instead).
  const feedMode = focusedLens === null || pressedStories.length > 0;
  const feedVisible = feedMode || (focusedLens !== null && !selectedFeatureId && !selectedTimeRange);
  const feedDimmed = feedVisible && !feedMode; // lens focused but nothing selected yet

  const scopeLabel = focusedLens === "feature" && selectedFeatureName
    ? `◉ ${selectedFeatureName.toUpperCase()}`
    : focusedLens === "timeline" && selectedTimeRange
    ? `◉ ${selectedTimeRange === "today" ? "TODAY" : "THIS WEEK"}`
    : null;

  const speakerScope = focusedLens === "feature" && selectedFeatureName
    ? selectedFeatureName.toUpperCase()
    : focusedLens === "timeline" && selectedTimeRange
    ? `lens: timeline / ${selectedTimeRange === "today" ? "TODAY" : "THIS WEEK"}`
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
        else if (event.type === "error") {
          console.error("[LensChatMain] stream event error:", event.content);
          appendToLast("Quire lost the thread — ask again.", true);
        }
      }
    } catch (err) {
      console.error("[LensChatMain] stream error:", err);
      appendToLast("Quire lost the thread — ask again.", true);
    } finally {
      setStreaming(false);
      inputRef.current?.focus({ preventScroll: true });
    }
  };

  return (
    <main className="lc-main" ref={chatRef}>
      {/* meta-top pill replaced by the NotifButton (rendered by LensChatView) */}

      <div className="lc-chat">
        {/* The feed — editorial org overview (replaces the arrival turn) */}
        {feedVisible && (
          <div style={feedDimmed ? { opacity: 0.35, filter: "saturate(0.6)", transition: "opacity 0.4s, filter 0.4s", pointerEvents: "none" } : undefined}>
            <FeedStream
              feed={feed}
              loading={feedLoading}
              sessionsDigested={arrivalTotals.sessions}
              pressedStories={pressedStories}
              onStoryPress={onStoryPress}
              notifSlot={notifSlot}
              onSessionClick={onSessionClick}
            />
          </div>
        )}

        {/* Seeded opening — the feature lens's first turn (before any message):
            understanding + insights, then the seam, then inline approvals. */}
        {focusedLens === "feature" && selectedFeatureId && (
          <>
            <section className="lc-turn-brain lc-rise" aria-label="Feature opening">
              <div className="lc-speaker">
                Quire{speakerScope ? <> · <span className="lc-scope">{speakerScope}</span></> : ""}
              </div>
              {openingLoading ? (
                <div className="fs-skel" aria-label="Loading understanding">
                  <span /><span />
                </div>
              ) : (
                <OpeningParagraphs
                  turn={openingTurn}
                  expanded={openingExpanded}
                  onExpand={() => setOpeningExpanded(true)}
                />
              )}
            </section>
            <div className="feed-seam" aria-hidden="true" />
            {pendingObservations.length > 0 && messages.length === 0 && (
              <PendingApprovalTurns
                observations={pendingObservations}
                onApprove={onApprove}
                onReject={onReject}
              />
            )}
          </>
        )}

        {/* Timeline seeded opening — the window's sessions as a clickable list.
            One mechanic at every altitude: select a lens value, get a first turn. */}
        {focusedLens === "timeline" && selectedTimeRange && (
          <>
            <section className="lc-turn-brain lc-rise" aria-label="Timeline opening">
              <div className="lc-speaker">
                Quire{speakerScope ? <> · <span className="lc-scope">{speakerScope}</span></> : ""}
              </div>
              {timelineLoading ? (
                <div className="fs-skel" aria-label="Loading sessions">
                  <span /><span />
                </div>
              ) : timelineSessions && timelineSessions.length > 0 ? (
                <>
                  <p className="lc-brainline">
                    {timelineSessions.length} session{timelineSessions.length === 1 ? "" : "s"} recorded{" "}
                    {selectedTimeRange === "today" ? "today" : "this week"}. The record, newest first:
                  </p>
                  <div className="lc-sessionlist">
                    {timelineSessions.map((s) => (
                      <button
                        key={s.id}
                        className="lc-sessionrow"
                        onClick={() => onSessionClick?.(s.id)}
                        title="Open session"
                      >
                        <span className="lc-sessionrow-date">
                          {s.started_at
                            ? new Date(s.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                            : "—"}
                          {s.session_shape ? ` · ${s.session_shape}` : ""}
                        </span>
                        <span className="lc-sessionrow-sum">
                          {s.narrative_summary ?? "No narrative yet — digested without a summary."}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="lc-brainline">
                  Nothing recorded {selectedTimeRange === "today" ? "today" : "this week"} yet — new
                  sessions will appear here as they are digested.
                </p>
              )}
            </section>
            <div className="feed-seam" aria-hidden="true" />
          </>
        )}

        {/* Pending observations as in-chat approval cards (org lens) */}
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
                Quire{speakerScope ? <> · <span className="lc-scope">{speakerScope}</span></> : " · just now"}
              </div>
              {m.content
                ? renderMarkdown(m.content)
                : (streaming && i === messages.length - 1 ? <p className="lc-brainline">…</p> : null)}
            </div>
          )
        ))}
      </div>

      {/* Ask bar */}
      <div className="lc-askwrap">
        <div className={`lc-ask${scopeLabel ? " lc-ask--scoped" : ""} lc-rise`} style={{ animationDelay: "1.1s" }}>
          <span className="lc-brand-dot" aria-hidden="true" />
          {scopeLabel && (
            <button className="lc-scopetag" onClick={onClearScope} title={selectedFeatureName ?? "Clear lens scope"}>
              {scopeLabel} <span className="lc-x" aria-hidden="true">×</span>
            </button>
          )}
          <input
            ref={inputRef}
            type="text"
            value={input}
            placeholder={
              focusedLens === "feature" && selectedFeatureName
                ? `Ask within ${selectedFeatureName}…`
                : focusedLens === "timeline" && selectedTimeRange
                ? `Ask within ${selectedTimeRange === "today" ? "today" : "this week"}…`
                : "Ask Quire anything — or expand a story…"
            }
            aria-label="Ask Quire"
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
      <div className="lc-speaker">Quire · <span className="lc-scope">pending stamp</span></div>
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
