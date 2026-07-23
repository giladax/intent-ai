import { useEffect, useState } from "react";
import { LensChatView } from "../components/LensChatView";
import { fetchFeatures } from "../api";
import type { Feature } from "../types";
import { useNavigate } from "react-router-dom";

/** Channels — Telegram config lands here in A5. Placeholder for A0 so the nav
 *  item is never a dead end. */
export function Channels() {
  return (
    <main className="ink-main">
      <div className="ink-crumb"><b>Quire</b> <span className="sep">/</span> Channels</div>
      <div className="ink-main-head">
        <h1>Channels</h1>
        <div className="sub">Where the org taps you on the shoulder.</div>
      </div>
      <div className="ink-empty">
        <div className="big">Telegram, coming to this room</div>
        Connect a channel and alarms will deep-link you to the exact review.
      </div>
    </main>
  );
}

/** Correspondence — the chat room (the retired lens-chat surface, now one room
 *  among many rather than the landing). */
export function Correspondence() {
  const nav = useNavigate();
  const [features, setFeatures] = useState<Feature[]>([]);
  useEffect(() => { fetchFeatures("").then(setFeatures).catch(() => setFeatures([])); }, []);
  return (
    <div className="ink-embed ink-legacy" style={{ background: "var(--bg)" }}>
      <LensChatView features={features} projectId={null} onSessionClick={(id) => nav(`/session/${id}`)} />
    </div>
  );
}
