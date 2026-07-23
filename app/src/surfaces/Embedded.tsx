/* Thin router adapters for the surfaces that carry over unchanged into the
 * familiar shell (A0 mounts them under their routes; later slices reshape
 * them). Each wrapper turns the old callback props into navigation, and
 * mounts the surface full-width inside the shell's content column. */
import { useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { FeaturesPage } from "../components/FeaturesPage";
import { FeaturePage } from "./FeaturePage";
import { ReviewQueue } from "../components/ReviewQueue";
import { JournalPage } from "../components/JournalPage";
import { SessionsPage } from "../components/SessionsPage";
import { SessionDetailPage } from "../components/SessionDetailPage";
import { fetchFeatures, fetchSessions } from "../api";
import type { Feature, Session } from "../types";

function EmbedFrame({ children }: { children: React.ReactNode }) {
  return <main className="ink-main">{children}</main>;
}

export function FeaturesRoute() {
  const nav = useNavigate();
  return <EmbedFrame><FeaturesPage repoId={null} onFeatureClick={(id) => nav(`/feature/${id}`)} /></EmbedFrame>;
}

/** The feature definition page brings its own main + right rail (mock 05),
 *  so it mounts bare — no EmbedFrame. */
export function FeatureRoute() {
  const { id } = useParams();
  if (!id) return null;
  return <FeaturePage featureId={id} />;
}

export function ReviewsRoute() {
  const nav = useNavigate();
  return <EmbedFrame><ReviewQueue repoId={null} onFeatureClick={(id) => nav(`/feature/${id}`)} /></EmbedFrame>;
}

export function JournalRoute() {
  const nav = useNavigate();
  const [features, setFeatures] = useState<Feature[]>([]);
  useEffect(() => { fetchFeatures("").then(setFeatures).catch(() => setFeatures([])); }, []);
  return (
    <EmbedFrame>
      <JournalPage
        repoId={null}
        features={features}
        onSessionClick={(id) => nav(`/session/${id}`)}
        onFeatureClick={(id) => nav(`/feature/${id}`)}
        onReviewClick={() => nav("/reviews")}
      />
    </EmbedFrame>
  );
}

export function SessionsRoute() {
  const nav = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  useEffect(() => { fetchSessions().then(setSessions).catch(() => setSessions([])); }, []);
  return (
    <EmbedFrame>
      <SessionsPage
        repoId={null}
        sessions={sessions}
        undigestedCount={0}
        liveState={null}
        onSync={() => {}}
        onSessionClick={(id) => { if (id !== "live") nav(`/session/${id}`); }}
      />
    </EmbedFrame>
  );
}

export function SessionRoute() {
  const { id } = useParams();
  const nav = useNavigate();
  if (!id) return null;
  return <EmbedFrame><SessionDetailPage sessionId={id} onBack={() => nav("/sessions")} /></EmbedFrame>;
}
