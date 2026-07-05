// LensChatView — the lens-rail + chat-first default view.
// Composes LensRail and LensChatMain; owns the lens focus state.

import { useState, useEffect, useCallback } from "react";
import { LensRail, type LensType } from "./LensRail";
import { LensChatMain } from "./LensChatMain";
import { fetchLensArrival, fetchPendingObservations, approveObservation, rejectObservation, fetchNotifications, fetchFeed, type Notification, type FeedComposed } from "../api";
import type { PressedStory } from "./FeedStream";
import type { Feature, LensArrivalData, PendingObservation } from "../types";

interface LensChatViewProps {
  features: Feature[];
  projectId: string | null;
}

export function LensChatView({ features, projectId }: LensChatViewProps) {
  const [focusedLens, setFocusedLens] = useState<LensType>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [selectedFeatureName, setSelectedFeatureName] = useState<string | null>(null);
  const [selectedTimeRange, setSelectedTimeRange] = useState<"today" | "week" | null>(null);
  const [arrivalData, setArrivalData] = useState<LensArrivalData | null>(null);
  const [pendingObs, setPendingObs] = useState<PendingObservation[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [feed, setFeed] = useState<FeedComposed | null>(null);
  const [feedLoading, setFeedLoading] = useState(true);
  const [pressedStories, setPressedStories] = useState<PressedStory[]>([]);

  useEffect(() => {
    fetchLensArrival()
      .then(setArrivalData)
      .catch(() => {/* fail-safe: undefined arrival data shows empty state */});
  }, []);

  // The composed feed — fail-safe: null keeps the skeleton visible.
  useEffect(() => {
    fetchFeed()
      .then(setFeed)
      .catch(() => setFeed(null))
      .finally(() => setFeedLoading(false));
  }, []);

  // Notification polling — on mount + every 30 seconds. Fail-safe: quiet.
  useEffect(() => {
    const poll = () => {
      fetchNotifications()
        .then((data) => {
          setNotifications(data.notifications);
          setUnreadNotifCount(data.unreadCount);
        })
        .catch(() => {/* fail-safe: no notifications */});
    };
    poll();
    const timer = setInterval(poll, 30_000);
    return () => clearInterval(timer);
  }, []);

  const refreshPending = useCallback(() => {
    fetchPendingObservations(projectId ?? undefined)
      .then(setPendingObs)
      .catch(() => setPendingObs([]));
  }, [projectId]);

  useEffect(() => {
    refreshPending();
  }, [refreshPending]);

  function handleLensFocus(lens: LensType) {
    setFocusedLens(lens);
    if (lens === null) {
      setSelectedFeatureId(null);
      setSelectedFeatureName(null);
      setSelectedTimeRange(null);
    }
  }

  function handleFeatureSelect(featureId: string, featureName: string) {
    // Rail-driven selection leaves feed mode — the feature page takes over.
    setPressedStories([]);
    setSelectedFeatureId(featureId);
    setSelectedFeatureName(featureName);
  }

  function handleTimeRangeSelect(range: "today" | "week") {
    setSelectedTimeRange(range);
  }

  function handleClearScope() {
    setFocusedLens(null);
    setSelectedFeatureId(null);
    setSelectedFeatureName(null);
    setSelectedTimeRange(null);
    setPressedStories([]);
  }

  // A story press IS the feature lens selection — the stream stays and the
  // unfold appends in-stream; the seeded opening follows below.
  function handleStoryPress(featureId: string, featureName: string) {
    setPressedStories((prev) =>
      prev.some((p) => p.featureId === featureId) ? prev : [...prev, { featureId, featureName }],
    );
    setFocusedLens("feature");
    setSelectedFeatureId(featureId);
    setSelectedFeatureName(featureName);
  }

  async function handleApprove(id: string) {
    await approveObservation(id);
    refreshPending();
  }

  async function handleReject(id: string) {
    await rejectObservation(id);
    refreshPending();
  }

  const totals = arrivalData?.totals ?? { sessions: 0, events: 0, moments: 0 };
  const pendingCount = arrivalData?.pendingCount ?? 0;

  const pendingObsForChat = pendingObs.slice(0, 5).map((o) => ({
    id: o.id,
    summary: o.summary,
    featureName: o.feature_name,
    category: o.category,
  }));

  return (
    <div
      className="lc-shell"
      style={{
        display: "grid",
        gridTemplateColumns: "var(--lc-rail-w) 1fr",
        height: "100vh",
        overflow: "hidden",
        background: "var(--lc-paper)",
        color: "var(--lc-ink)",
        fontFamily: "'Hanken Grotesk', sans-serif",
        fontSize: "15px",
      }}
    >
      <LensRail
        features={features}
        pendingCount={pendingCount}
        arrivalTotals={totals}
        focusedLens={focusedLens}
        selectedFeatureId={selectedFeatureId}
        selectedTimeRange={selectedTimeRange}
        onLensFocus={handleLensFocus}
        onFeatureSelect={handleFeatureSelect}
        onTimeRangeSelect={handleTimeRangeSelect}
        onOrgSelect={handleClearScope}
        unreadNotifCount={unreadNotifCount}
      />
      <LensChatMain
        pendingCount={pendingCount}
        arrivalTotals={totals}
        focusedLens={focusedLens}
        selectedFeatureId={selectedFeatureId}
        selectedFeatureName={selectedFeatureName}
        selectedTimeRange={selectedTimeRange}
        onClearScope={handleClearScope}
        pendingObservations={pendingObsForChat}
        onApprove={handleApprove}
        onReject={handleReject}
        feed={feed}
        feedLoading={feedLoading}
        pressedStories={pressedStories}
        onStoryPress={handleStoryPress}
      />
    </div>
  );
}
