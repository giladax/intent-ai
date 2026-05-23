import { useState, useRef, useEffect } from "react";
import { streamChat } from "../api";
import type { ChatMessage } from "../types";

interface Props {
  topicId: string | null;
  sessionId: string | null;
  scopeLabel?: string;
}

export function ChatPanel({ topicId, sessionId, scopeLabel }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Clear chat when scope changes
  useEffect(() => {
    setMessages([]);
  }, [topicId, sessionId]);

  const label = () => {
    if (topicId && scopeLabel) return `Topic: ${scopeLabel}`;
    if (sessionId) return `Session: ${sessionId.slice(0, 8)}...`;
    return "Select a topic or session";
  };

  const handleSend = async () => {
    const q = input.trim();
    if (!q || streaming) return;

    const userMsg: ChatMessage = { role: "user", content: q };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStreaming(true);

    const assistantMsg: ChatMessage = { role: "assistant", content: "" };
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      const history = messages.slice(-20);
      for await (const event of streamChat(q, history, undefined, sessionId ?? undefined, topicId ?? undefined)) {
        if (event.type === "text" && event.content) {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last.role === "assistant") {
              updated[updated.length - 1] = { ...last, content: last.content + event.content };
            }
            return updated;
          });
        } else if (event.type === "error") {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last.role === "assistant") {
              updated[updated.length - 1] = { ...last, content: `Error: ${event.content}` };
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
          updated[updated.length - 1] = { ...last, content: `Error: ${err instanceof Error ? err.message : String(err)}` };
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
        <span className="chat-scope">{label()}</span>
      </div>
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            {topicId || sessionId
              ? "Ask about this context..."
              : "Select a topic or session to start."}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-msg-${m.role}`}>
            {m.content || (streaming && i === messages.length - 1 ? "..." : "")}
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
          placeholder="Ask..."
          disabled={streaming}
        />
        <button className="chat-send" onClick={handleSend} disabled={streaming || !input.trim()}>
          Send
        </button>
      </div>
    </aside>
  );
}
