import { useState, useRef, useEffect } from "react";
import { streamChat } from "../api";
import type { ChatMessage } from "../types";

interface Props {
  featureId: string | null;
  sessionId: string | null;
  featureName?: string;
}

export function ChatPanel({ featureId, sessionId, featureName }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Clear chat when scope changes
  useEffect(() => {
    setMessages([]);
  }, [featureId, sessionId]);

  const scopeLabel = () => {
    if (featureId && featureId !== "__untagged__" && featureName) {
      return `Feature: ${featureName}`;
    }
    if (sessionId) {
      return `Session: ${sessionId.slice(0, 8)}...`;
    }
    return "No scope selected";
  };

  const handleSend = async () => {
    const q = input.trim();
    if (!q || streaming) return;

    const userMsg: ChatMessage = { role: "user", content: q };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStreaming(true);

    // Add placeholder for assistant
    const assistantMsg: ChatMessage = { role: "assistant", content: "" };
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      const effectiveFeatureId = featureId === "__untagged__" ? undefined : featureId ?? undefined;
      const history = messages.slice(-20);

      for await (const event of streamChat(q, history, effectiveFeatureId, sessionId ?? undefined)) {
        if (event.type === "text" && event.content) {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last.role === "assistant") {
              updated[updated.length - 1] = {
                ...last,
                content: last.content + event.content,
              };
            }
            return updated;
          });
        } else if (event.type === "error") {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last.role === "assistant") {
              updated[updated.length - 1] = {
                ...last,
                content: `Error: ${event.content}`,
              };
            }
            return updated;
          });
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last.role === "assistant") {
          updated[updated.length - 1] = {
            ...last,
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
        return updated;
      });
    } finally {
      setStreaming(false);
      inputRef.current?.focus();
    }
  };

  return (
    <aside className="chat">
      <div className="chat-header">
        <span className="chat-scope">{scopeLabel()}</span>
      </div>
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            {featureId || sessionId
              ? "Ask a question about this context..."
              : "Select a feature or session, then ask questions here."}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-msg-${m.role}`}>
            <div className="chat-msg-content">{m.content || (streaming && i === messages.length - 1 ? "..." : "")}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-input-row">
        <input
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Ask about this session or feature..."
          disabled={streaming}
        />
        <button className="chat-send" onClick={handleSend} disabled={streaming || !input.trim()}>
          Send
        </button>
      </div>
    </aside>
  );
}
