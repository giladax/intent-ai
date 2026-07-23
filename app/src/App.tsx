import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./ink/tokens.css";
import "./ink/shell.css";
import "./app-ink.css";
import { ChatDockProvider } from "./chat-dock";
import { ChatDock } from "./components/ChatDock";
import { TalkLayer } from "./components/TalkLayer";
import { Shell } from "./shell/Shell";
import { Today } from "./surfaces/Today";
import { NeedsYou } from "./surfaces/NeedsYou";
import { Repositories, RepoPage } from "./surfaces/Repositories";
import { ReviewRoom } from "./surfaces/Review";
import { Channels, Correspondence } from "./surfaces/Misc";
import { Handoff } from "./surfaces/Handoff";
import { IntentReview } from "./surfaces/IntentReview";
import {
  FeaturesRoute, FeatureRoute, ReviewsRoute, JournalRoute,
  SessionsRoute, SessionRoute,
} from "./surfaces/Embedded";

/** The app is a renderer over contracts. The familiar shell mounts at `/`;
 *  every room is a clean URL backed by the same JSON an agent would call.
 *  Lens-chat as landing is retired (ruled) — it lives on as /correspondence. */
export function App() {
  return (
    <ChatDockProvider>
      <BrowserRouter>
        <Routes>
          {/* The Correspondence is full-bleed (its own chrome), so it sits
              outside the three-pane shell wrapper. */}
          <Route path="/correspondence" element={<ShellFrame><Correspondence /></ShellFrame>} />

          {/* Detail-pane rooms */}
          <Route path="/needs-you" element={<ShellFrame detail><NeedsYou /></ShellFrame>} />

          {/* Single-column rooms */}
          <Route path="/" element={<ShellFrame><Today /></ShellFrame>} />
          <Route path="/features" element={<ShellFrame><FeaturesRoute /></ShellFrame>} />
          <Route path="/feature/:id" element={<ShellFrame detail><FeatureRoute /></ShellFrame>} />
          <Route path="/repositories" element={<ShellFrame><Repositories /></ShellFrame>} />
          <Route path="/repo/:ws" element={<ShellFrame><RepoPage /></ShellFrame>} />
          <Route path="/repo/:ws/review/:n" element={<ShellFrame detail><ReviewRoom /></ShellFrame>} />
          <Route path="/handoff" element={<ShellFrame><Handoff /></ShellFrame>} />
          <Route path="/handoff/:ws" element={<ShellFrame><Handoff /></ShellFrame>} />
          <Route path="/intent-review/:id" element={<ShellFrame><IntentReview /></ShellFrame>} />
          <Route path="/reviews" element={<ShellFrame><ReviewsRoute /></ShellFrame>} />
          <Route path="/sessions" element={<ShellFrame><SessionsRoute /></ShellFrame>} />
          <Route path="/session/:id" element={<ShellFrame><SessionRoute /></ShellFrame>} />
          <Route path="/journal" element={<ShellFrame><JournalRoute /></ShellFrame>} />
          <Route path="/channels" element={<ShellFrame><Channels /></ShellFrame>} />

          {/* Unknown paths land on Today. */}
          <Route path="*" element={<ShellFrame><Today /></ShellFrame>} />
        </Routes>
      </BrowserRouter>
    </ChatDockProvider>
  );
}

/** The shell + the always-live conversational layer. */
function ShellFrame({ children, detail = false }: { children: React.ReactNode; detail?: boolean }) {
  return (
    <>
      <Shell detail={detail}>{children}</Shell>
      <ChatDock liveState={null} />
      <TalkLayer />
    </>
  );
}
