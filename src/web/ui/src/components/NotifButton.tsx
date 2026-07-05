// NotifButton — the quiet bell in the top-right shell chrome. Carries the
// page meta (repo · branch · date) — it replaces the old meta-top pill.
// Pressing it injects a NotifCard ("WHILE YOU WERE AWAY") at the top of
// the feed stream. NotifCard + NotifUnfold live here too.

import { useEffect, useState } from "react";
import type { Notification } from "../api";
import { getLastSeenFromStorage, setLastSeenInStorage, hoursSince } from "./notif-utils";

interface NotifButtonProps {
  unreadCount: number;
  onOpen: () => void;
  repo?: string;
  branch?: string;
}

export function NotifButton({ unreadCount, onOpen, repo, branch }: NotifButtonProps) {
  const metaDate = new Date()
    .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    .toLowerCase()
    .replace(",", "");

  const repoLabel = repo || branch
    ? `${repo || "—"} · ${branch || "—"}`
    : "intent-ai · feat/repo-brain";

  return (
    <button className="notif-btn lc-rise" style={{ animationDelay: "0.6s" }} onClick={onOpen} aria-label="Notifications">
      <span className="icon" aria-hidden="true">🔔</span>
      <span className="meta">{repoLabel} · {metaDate}</span>
      {unreadCount > 0 && (
        <span className="notif-badge" aria-label={`${unreadCount} notifications`}>{unreadCount}</span>
      )}
    </button>
  );
}

/**
 * Track the viewer's last visit. Returns the PREVIOUS last-seen timestamp
 * (null on first visit) and stamps the current time on mount.
 */
export function useLastSeen(): string | null {
  const [prev] = useState<string | null>(() => getLastSeenFromStorage());
  useEffect(() => {
    setLastSeenInStorage(new Date().toISOString());
  }, []);
  return prev;
}

// ── The while-you-were-away card ───────────────────────────────────────

interface NotifCardProps {
  notifications: Notification[];
  lastSeen: string | null;
  onDismiss: () => void;
}

export function NotifCard({ notifications, lastSeen, onDismiss }: NotifCardProps) {
  const [expanded, setExpanded] = useState(false);

  const gapLabel = lastSeen ? `${hoursSince(lastSeen)} HOURS` : "FIRST VISIT";
  const headliners = notifications.slice(0, 2).map((n) => n.text);
  const title = headliners.length > 0 ? headliners.join(" ") : "Nothing new since your last visit.";
  const count = notifications.length;
  const pendingGateCount = notifications.filter((n) => n.type === "pending_gate").length;

  return (
    <div>
      <div className="notif-card">
        <div className="nkick"><span className="dot" />WHILE YOU WERE AWAY · {gapLabel}</div>
        <div className="ntitle">{title}</div>
        <div className="nbody">
          {count === 0
            ? "Quiet since you left. Nothing needs you right now."
            : <>{count} thing{count === 1 ? "" : "s"} happened that touch work you follow.{pendingGateCount === 0 ? <> <b>Nothing is blocked.</b></> : null}</>}
        </div>
        <div className="nfoot">
          <span>{count} update{count === 1 ? "" : "s"}</span>
          {count > 2 && !expanded && (
            <button className="dismiss" onClick={() => setExpanded(true)}>EXPAND ↓</button>
          )}
          <button className="dismiss" onClick={onDismiss}>
            {expanded || count <= 2 ? "MARK READ" : "DISMISS"}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="notif-unfold">
          <div className="fs-speaker" style={{ marginBottom: "10px" }}>
            Quire · <span className="fs-scope" style={{ color: "var(--lc-cobalt)" }}>for you</span>
          </div>
          {notifications.map((n, i) => (
            <p
              key={`${n.type}-${n.featureId}-${i}`}
              style={{ fontSize: "15px", lineHeight: 1.65, maxWidth: "54ch", marginBottom: "12px", color: "var(--lc-ink-60)" }}
            >
              {n.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
