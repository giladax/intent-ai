// LensRail — the numbered flat-color lens boxes on the left.
// Each box is a state toggle: selecting one focuses the rail (others
// fade to 26% opacity) and emits the lens selection up.

import "./LensRail.css";
import type { Feature } from "../types";

export type LensType = "feature" | "timeline" | null;

export interface TimeRangeOption {
  value: "today" | "week";
  label: string;
}

const TIME_OPTIONS: TimeRangeOption[] = [
  { value: "today", label: "today" },
  { value: "week", label: "this week" },
];

interface LensRailProps {
  features: Feature[];
  pendingCount: number;
  arrivalTotals: { sessions: number; events: number; moments: number };
  focusedLens: LensType;
  selectedFeatureId: string | null;
  selectedTimeRange: "today" | "week" | null;
  onLensFocus: (lens: LensType) => void;
  onFeatureSelect: (featureId: string, featureName: string) => void;
  onTimeRangeSelect: (range: "today" | "week") => void;
  /** Pressing 00 ORG returns to the org feed (clears any lens scope). */
  onOrgSelect: () => void;
  /** Unread notification count — shows the vermilion dot on the wordmark. */
  unreadNotifCount: number;
}

export function LensRail({
  features,
  pendingCount,
  arrivalTotals,
  focusedLens,
  selectedFeatureId,
  selectedTimeRange,
  onLensFocus,
  onFeatureSelect,
  onTimeRangeSelect,
  onOrgSelect,
  unreadNotifCount,
}: LensRailProps) {
  const hasFocus = focusedLens !== null;

  function handleFeatureLensClick() {
    if (focusedLens === "feature") {
      onLensFocus(null); // toggle off
    } else {
      onLensFocus("feature");
    }
  }

  function handleTimelineLensClick() {
    if (focusedLens === "timeline") {
      onLensFocus(null);
    } else {
      onLensFocus("timeline");
    }
  }

  return (
    <nav className={`lc-rail${hasFocus ? " lc-rail--has-focus" : ""}`} aria-label="Lenses">
      {/* Wordmark */}
      <div className="lc-wordmark lc-rise" style={{ animationDelay: "0.05s" }}>
        Quire.<span className="lc-pulse" aria-hidden="true" />
        {unreadNotifCount > 0 && <span className="lc-notif-dot" aria-label={`${unreadNotifCount} unread notifications`} />}
      </div>

      {/* Lens boxes */}
      <div className="lc-lenses">
        {/* 00 ORG — the feed, "you are here" */}
        <button
          className="lc-lens lc-lens--org lc-rise"
          style={{ animationDelay: "0.1s" }}
          onClick={onOrgSelect}
          aria-current={focusedLens === null ? "true" : undefined}
        >
          <span className="lc-num">00</span>
          <span className="lc-mark">↗</span>
          <span className="lc-label" style={{ marginTop: "auto" }}>Org</span>
          <span className="lc-sub">
            {focusedLens === null ? "the feed · you are here" : "back to the feed"}
          </span>
        </button>

        {/* 01 FEATURE */}
        <button
          className={`lc-lens lc-lens--feature lc-rise${focusedLens === "feature" ? " lc-lens--focused" : ""}`}
          style={{ animationDelay: "0.16s" }}
          onClick={handleFeatureLensClick}
          aria-expanded={focusedLens === "feature"}
        >
          <span className="lc-num">01</span>
          <span className="lc-mark">{focusedLens === "feature" ? "↓" : "↗"}</span>
          <span className="lc-label" style={{ marginTop: "14px" }}>Feature</span>
          <span className="lc-sub">{features.length} under watch</span>

          {/* Feature list — visible when focused */}
          {focusedLens === "feature" && features.length > 0 && (
            <ul className="lc-flist" role="listbox" aria-label="Features">
              {features.slice(0, 6).map((f) => (
                <li
                  key={f.id}
                  role="option"
                  aria-selected={f.id === selectedFeatureId}
                  className={f.id === selectedFeatureId ? "lc-flist-item lc-flist-item--sel" : "lc-flist-item"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onFeatureSelect(f.id, f.name);
                  }}
                >
                  <span className="lc-flist-name">{f.name.toLowerCase()}</span>
                  <span className="lc-flist-n">{f.session_count}</span>
                </li>
              ))}
            </ul>
          )}

          {pendingCount > 0 && (
            <span className="lc-needs" title={`${pendingCount} delta${pendingCount === 1 ? "" : "s"} await your stamp`} />
          )}
        </button>

        {/* 02 TIMELINE */}
        <button
          className={`lc-lens lc-lens--timeline lc-rise${focusedLens === "timeline" ? " lc-lens--focused" : ""}`}
          style={{ animationDelay: "0.24s" }}
          onClick={handleTimelineLensClick}
          aria-expanded={focusedLens === "timeline"}
        >
          <span className="lc-num">02</span>
          <span className="lc-mark">{focusedLens === "timeline" ? "↓" : "↗"}</span>
          <span className="lc-label">Timeline</span>
          <span className="lc-sub">{selectedTimeRange ?? "jun 21 — today"}</span>

          {focusedLens === "timeline" && (
            <ul className="lc-flist" role="listbox" aria-label="Time ranges">
              {TIME_OPTIONS.map((opt) => (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={opt.value === selectedTimeRange}
                  className={opt.value === selectedTimeRange ? "lc-flist-item lc-flist-item--sel" : "lc-flist-item"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTimeRangeSelect(opt.value);
                  }}
                >
                  <span className="lc-flist-name">{opt.label}</span>
                </li>
              ))}
            </ul>
          )}
        </button>

        {/* 03 TEAM — disabled "soon" */}
        <button
          className="lc-lens lc-lens--team lc-lens--soon lc-rise"
          style={{ animationDelay: "0.32s" }}
          disabled
          aria-disabled="true"
        >
          <span className="lc-num">03</span>
          <span className="lc-mark">↗</span>
          <span className="lc-label">Team</span>
          <span className="lc-sub">1 human · n agents</span>
        </button>

        {/* Ghost slot */}
        <button
          className="lc-lens lc-lens--ghost lc-rise"
          style={{ animationDelay: "0.4s" }}
          title="Lenses shaped by your seat in the company — coming"
          disabled
        >
          <span className="lc-glabel">+ ROLE LENS</span>
          <span className="lc-gsub">exec · product · eng — soon</span>
        </button>
      </div>

      {/* Rail foot — sparkline + totals */}
      <div className="lc-rail-foot lc-rise" style={{ animationDelay: "0.5s" }}>
        <span className="lc-river" aria-hidden="true" />
        {arrivalTotals.sessions} sessions<br />
        {arrivalTotals.events} events<br />
        {arrivalTotals.moments} moments
      </div>
    </nav>
  );
}
