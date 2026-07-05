import { useState, useEffect, useCallback } from "react";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/newsreader/wght-italic.css";
import "./app-ink.css";
import { ChatDock } from "./components/ChatDock";
import { TalkLayer } from "./components/TalkLayer";
import { ChatDockProvider, useChatDock } from "./chat-dock";
import { SessionsPage } from "./components/SessionsPage";
import { SessionDetailPage } from "./components/SessionDetailPage";
import { FeaturesPage } from "./components/FeaturesPage";
import { FeatureDetail } from "./components/FeatureDetail";
import { ReviewQueue } from "./components/ReviewQueue";
import { JournalPage } from "./components/JournalPage";
import { DigestPanel } from "./components/DigestPanel";
import { LensChatView } from "./components/LensChatView";
import { fetchProjects, fetchSessions, fetchFeatures, fetchPendingObservations } from "./api";
import type { LiveState } from "./api";
import type { Project, Session, Feature } from "./types";
import { Feather, ChevronDown, MessageSquare, X, Zap } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type View =
  | "lens-chat"   // ← new default
  | "journal"
  | "features"
  | "feature-detail"
  | "review"
  | "sessions"
  | "session-detail"
  | "digest";

/** Which masthead section a view belongs to — detail views light their parent. */
type Section = "journal" | "features" | "review" | "sessions";
function sectionOf(view: View): Section | null {
  switch (view) {
    case "journal": return "journal";
    case "features":
    case "feature-detail": return "features";
    case "review": return "review";
    case "sessions":
    case "session-detail": return "sessions";
    default: return null; // lens-chat, digest, and the intake stand apart
  }
}

export function App() {
  return (
    <ChatDockProvider>
      <AppShell />
    </ChatDockProvider>
  );
}

function AppShell() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [view, setView] = useState<View>("lens-chat");
  const [undigestedCount, setUndigestedCount] = useState(0);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [liveState, setLiveState] = useState<LiveState | null>(null);

  // Poll live state from observe daemon
  useEffect(() => {
    const poll = async () => {
      const { fetchLiveState } = await import("./api");
      const state = await fetchLiveState();
      setLiveState(state);
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchProjects().then((ps) => {
      setProjects(ps);
      if (ps.length > 0) setSelectedProject(ps[0]);
    });
  }, []);

  const refreshProject = useCallback(() => {
    if (!selectedProject) { setSessions([]); setFeatures([]); setPendingCount(0); return; }
    fetchSessions(selectedProject.id).then(setSessions).catch(() => setSessions([]));
    fetchFeatures(selectedProject.id).then(setFeatures).catch(() => setFeatures([]));
    fetchPendingObservations(selectedProject.id)
      .then((obs) => setPendingCount(obs.length))
      .catch(() => setPendingCount(0));
    fetch("/api/brain/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoId: selectedProject.id }),
    })
      .then((r) => r.json())
      .then((data) => setUndigestedCount(data.undigestedCount ?? 0))
      .catch(() => {});
  }, [selectedProject]);

  useEffect(() => {
    refreshProject();
  }, [refreshProject]);

  const handleProjectChange = (p: Project) => {
    setSelectedProject(p);
    setView("journal");
  };

  const handleFeatureSelect = useCallback((id: string) => {
    setSelectedFeatureId(id);
    setView("feature-detail");
  }, []);

  // Section navigation always lands on the section's front page.
  const goTo = (section: Section) => {
    if (section === "features") setSelectedFeatureId(null);
    if (section === "sessions") setSelectedSessionId(null);
    setView(section);
  };

  const selectedFeatureName = features.find((f) => f.id === selectedFeatureId)?.name;

  const selectedSession = sessions.find((s) => s.id === selectedSessionId);
  const selectedSessionLabel = selectedSession
    ? `${selectedSession.started_at ? new Date(selectedSession.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}${selectedSession.session_shape ? " · " + selectedSession.session_shape : ""}`
    : "Session";

  const activeSection = sectionOf(view);

  // The chat dock follows navigation — whatever you're reading is its context.
  const { setAutoItem } = useChatDock();
  useEffect(() => {
    if (view === "feature-detail" && selectedFeatureId) {
      setAutoItem({ kind: "feature", id: selectedFeatureId, label: selectedFeatureName ?? "this feature", auto: true });
    } else if (view === "session-detail" && selectedSessionId) {
      setAutoItem({ kind: "session", id: selectedSessionId, label: selectedSessionLabel, auto: true });
    } else {
      setAutoItem(null);
    }
  }, [view, selectedFeatureId, selectedFeatureName, selectedSessionId, selectedSessionLabel, setAutoItem]);

  // Lens-chat default view — full page, no masthead
  if (view === "lens-chat") {
    return (
      <div className="lc-root" style={{ position: "relative", height: "100%" }}>
        <LensChatView
          features={features}
          projectId={selectedProject?.id ?? null}
        />
        {/* "ledger" link — unobtrusive corner affordance to reach classic shell */}
        <button
          className="lc-ledger-toggle"
          onClick={() => setView("journal")}
          title="Switch to classic ledger view"
          style={{
            position: "fixed",
            bottom: "16px",
            right: "16px",
            zIndex: 50,
            fontFamily: "'Spline Sans Mono', monospace",
            fontSize: "10px",
            letterSpacing: "0.12em",
            color: "var(--lc-ink-40)",
            background: "transparent",
            border: "1px solid var(--lc-ink-12)",
            borderRadius: "6px",
            padding: "4px 10px",
            cursor: "pointer",
            textTransform: "uppercase",
          }}
        >
          ledger ↗
        </button>
      </div>
    );
  }

  return (
    <div className="ink-app flex h-svh flex-col overflow-hidden">
      {/* The masthead — one ribbon: wordmark, sections, the intake, the Correspondence */}
      <header className="ink-mast">
        <div className="ink-mast-inner">
          <DropdownMenu>
            <DropdownMenuTrigger render={<button className="ink-mast-wordmark" title="Switch project" />}>
              <Feather className="size-3.5" style={{ color: "var(--j-ink-soft)" }} />
              <span>{selectedProject?.name ?? "Brain"}</span>
              <ChevronDown className="size-3 opacity-50" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {projects.map((p) => (
                <DropdownMenuItem key={p.id} onClick={() => handleProjectChange(p)}>
                  {p.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <nav className="ink-mast-nav">
            {/* The front page */}
            <button className="ink-mast-section" data-active={activeSection === "journal"} onClick={() => goTo("journal")}>
              Journal
            </button>
            {/* The atlas — lenses over the river */}
            <button className="ink-mast-section" data-active={activeSection === "features"} onClick={() => goTo("features")}>
              Features<span className="ink-mast-count">{features.length}</span>
            </button>
            {/* The gate */}
            <button className="ink-mast-section" data-active={activeSection === "review"} onClick={() => goTo("review")}>
              Review
              {pendingCount > 0 && <span className="ink-badge-red ml-1.5">{pendingCount}</span>}
            </button>
            {/* The record */}
            <button className="ink-mast-section" data-active={activeSection === "sessions"} onClick={() => goTo("sessions")}>
              Sessions<span className="ink-mast-count">{sessions.length}</span>
            </button>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {/* Back to lens-chat surface */}
            <button
              className="ink-mast-section"
              onClick={() => setView("lens-chat")}
              title="Back to lens view"
              style={{ fontSize: "11px", opacity: 0.6 }}
            >
              ← lens
            </button>
            {/* The intake — always reachable; urgent when sessions wait */}
            {selectedProject && (
              <button
                className={undigestedCount > 0 ? "ink-intake ink-intake--waiting" : "ink-intake"}
                data-active={view === "digest"}
                onClick={() => setView("digest")}
              >
                <Zap className="size-3" />
                <span>{undigestedCount > 0 ? `${undigestedCount} waiting` : "current"}</span>
              </button>
            )}
            <AskBrainButton />
          </div>
        </div>
      </header>

      {/* Content area — the Correspondence slides in under the masthead,
          so the masthead controls (intake, Ask the Brain) stay reachable.
          overflow-clip (not hidden): the parked dock overflows to the right,
          and clip forbids the programmatic ancestor-scroll that focus() would
          otherwise trigger — which dragged the whole page sideways. min-h-0:
          unlike hidden, clip keeps the flex item's automatic min-height, so
          without it the area grows to content height and scrolling dies. */}
      <div className="relative min-h-0 flex-1 overflow-clip">
        {/* keyed on view: each section turn re-enters like a fresh page */}
        <div key={view} className="ink-page h-full overflow-y-auto">
          {view === "journal" ? (
            <JournalPage
              repoId={selectedProject?.id ?? null}
              features={features}
              onSessionClick={(id) => { setSelectedSessionId(id); setView("session-detail"); }}
              onFeatureClick={handleFeatureSelect}
              onReviewClick={() => setView("review")}
            />
          ) : view === "digest" && selectedProject ? (
            <DigestPanel
              repoId={selectedProject.id}
              undigestedCount={undigestedCount}
              onDone={() => { refreshProject(); setView("journal"); }}
            />
          ) : view === "session-detail" && selectedSessionId ? (
            <SessionDetailPage sessionId={selectedSessionId} onBack={() => goTo("sessions")} />
          ) : view === "sessions" ? (
            <SessionsPage
              repoId={selectedProject?.id ?? null}
              sessions={sessions}
              undigestedCount={undigestedCount}
              liveState={liveState}
              onSync={() => setView("digest")}
              onSessionClick={(id) => {
                if (id === "live") return;
                setSelectedSessionId(id);
                setView("session-detail");
              }}
            />
          ) : view === "review" ? (
            <ReviewQueue repoId={selectedProject?.id ?? null} onFeatureClick={handleFeatureSelect} />
          ) : view === "feature-detail" && selectedFeatureId ? (
            <FeatureDetail
              featureId={selectedFeatureId}
              onSessionClick={(id) => { setSelectedSessionId(id); setView("session-detail"); }}
            />
          ) : (
            <FeaturesPage repoId={selectedProject?.id ?? null} onFeatureClick={handleFeatureSelect} />
          )}
        </div>

        {/* Always-live conversational layer — a sheet over the page, under the masthead */}
        <ChatDock liveState={liveState} />
      </div>

      <TalkLayer />
    </div>
  );
}

// The header toggle — reads pinned-count so the button itself tells the story.
// Styled as .ink-ask: a consult-blue glow on hover, a satisfying give on press.
function AskBrainButton() {
  const { open, toggleDock, items } = useChatDock();
  return (
    <button className="ink-ask" data-open={open} title="⌘J" onClick={toggleDock}>
      {open ? <X className="size-3" /> : <MessageSquare className="size-3" />}
      {open ? "Close" : items.length > 0 ? `Correspondence · ${items.length}` : "Ask the Brain"}
    </button>
  );
}
