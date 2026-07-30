import { useEffect, useState } from "react";
import { LensChatView } from "../components/LensChatView";
import { fetchFeatures, fetchChannels, addChannel, deleteChannel, testChannel } from "../api";
import type { ChannelRow } from "../api";
import type { Feature } from "../types";
import { useNavigate } from "react-router-dom";

/** Channels — Telegram config, test-send, alarm routing (A5).
 *  Where the org taps you on the shoulder. Silent on healthy work. */
export function Channels() {
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, string>>({});

  const load = () => {
    setLoading(true);
    fetchChannels()
      .then((chs) => { setChannels(chs); setFetchError(null); })
      .catch((e: Error) => setFetchError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!token.trim() || !chatId.trim()) {
      setSaveStatus("Both token and chat ID are required.");
      return;
    }
    setSaveStatus("Saving…");
    try {
      await addChannel("telegram", { token: token.trim(), chat_id: chatId.trim() }, ["alarms"]);
      setToken(""); setChatId(""); setAdding(false);
      setSaveStatus(null);
      load();
    } catch (e: unknown) {
      setSaveStatus(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteChannel(id).catch(() => null);
    load();
  };

  const handleTest = async (id: string) => {
    setTestResults((r) => ({ ...r, [id]: "Sending…" }));
    try {
      const result = await testChannel(id);
      setTestResults((r) => ({
        ...r,
        [id]: result.ok ? "Sent ✓" : `Failed: ${result.error ?? "unknown error"}`,
      }));
    } catch (e: unknown) {
      setTestResults((r) => ({
        ...r,
        [id]: `Failed: ${e instanceof Error ? e.message : String(e)}`,
      }));
    }
  };

  return (
    <main className="ink-main">
      <div className="ink-crumb"><b>Quire</b> <span className="sep">/</span> Channels</div>
      <div className="ink-main-head">
        <h1>Channels</h1>
        <div className="sub">Where the org taps you on the shoulder. Quiet when work is healthy.</div>
      </div>

      {loading && <div className="ink-empty">Loading…</div>}
      {fetchError && (
        <div className="ink-empty" style={{ color: "var(--ink-red, #c0392b)" }}>
          {fetchError}
        </div>
      )}

      {!loading && !fetchError && channels.length === 0 && (
        <div className="ink-empty">
          <div className="big">No channels yet</div>
          Add a Telegram channel and a broken promise taps you with the quote — and a link
          to the exact review.
        </div>
      )}

      {channels.map((ch) => (
        <div key={ch.id} className="ink-card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <span style={{ fontWeight: 600 }}>{ch.transport}</span>
              {ch.config_public.chat_id && (
                <span style={{ color: "var(--ink-muted, #888)", marginLeft: 8, fontSize: 13 }}>
                  chat {ch.config_public.chat_id}
                </span>
              )}
              {ch.purposes.includes("alarms") && (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 11,
                    fontWeight: 500,
                    color: "var(--ink-amber, #d68910)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  alarms
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button className="ink-btn" onClick={() => handleTest(ch.id)}>
                Send a test message
              </button>
              <button
                className="ink-btn ink-btn--ghost"
                onClick={() => handleDelete(ch.id)}
              >
                Remove
              </button>
            </div>
          </div>
          {testResults[ch.id] && (
            <div
              style={{
                marginTop: 8,
                fontSize: 13,
                color: testResults[ch.id].startsWith("Sent")
                  ? "var(--ink-green, #27ae60)"
                  : "var(--ink-red, #c0392b)",
              }}
            >
              {testResults[ch.id]}
            </div>
          )}
        </div>
      ))}

      <div style={{ marginTop: 24 }}>
        {!adding ? (
          <button className="ink-btn" onClick={() => { setAdding(true); setSaveStatus(null); }}>
            Add Telegram channel
          </button>
        ) : (
          <div className="ink-card">
            <div className="ink-card-head" style={{ marginBottom: 12, fontWeight: 600 }}>
              Add a Telegram channel
            </div>
            <div style={{ marginBottom: 16, color: "var(--ink-muted, #666)", fontSize: 13, lineHeight: 1.7 }}>
              <ol style={{ paddingLeft: 20, margin: 0 }}>
                <li>
                  Message <strong>@BotFather</strong> on Telegram and run{" "}
                  <code>/newbot</code>. Copy the token it gives you.
                </li>
                <li>Add your bot to the chat or channel that should receive alarms.</li>
                <li>
                  Paste the bot token and chat ID below. To find your chat ID: add{" "}
                  <strong>@userinfobot</strong> to the chat — it will show you the ID.
                </li>
              </ol>
            </div>
            <label style={{ display: "block", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Bot token</div>
              <input
                className="ink-input"
                type="password"
                placeholder="1234567890:ABCdefGHIjklMNOpqrsTUVwxyz"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box" }}
              />
            </label>
            <label style={{ display: "block", marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Chat ID</div>
              <input
                className="ink-input"
                placeholder="-1001234567890"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box" }}
              />
            </label>
            {saveStatus && (
              <div style={{ marginBottom: 10, fontSize: 13, color: "var(--ink-muted, #666)" }}>
                {saveStatus}
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="ink-btn" onClick={handleAdd}>
                Save
              </button>
              <button
                className="ink-btn ink-btn--ghost"
                onClick={() => { setAdding(false); setSaveStatus(null); }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
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
