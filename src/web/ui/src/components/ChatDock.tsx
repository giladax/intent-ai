// The always-live chat surface. Mounted once at the app root; slides in
// fluidly, keeps its conversation across views, and sends whatever page
// elements are pinned (plus the auto-followed current view) as context.
import { useEffect, useRef, useState } from "react";
import { streamChat } from "../api";
import type { LiveState } from "../api";
import type { ChatMessage } from "../types";
import { useChatDock, talkKey } from "../chat-dock";
import type { TalkItem } from "../chat-dock";
import { X, ArrowUp, Trash2 } from "lucide-react";

const KIND_GLYPH: Record<TalkItem["kind"], string> = {
  feature: "◈",
  session: "⌁",
  episode: "⌁",
  event: "◇",
  observation: "◉",
  view: "▤",
  note: "✎",
};

export function ChatDock({ liveState }: { liveState?: LiveState | null }) {
  const dock = useChatDock();
  const { open, closeDock, items, unpin, clearItems, autoItem, messages, setMessages } = dock;
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [autoDismissed, setAutoDismissed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll the dock's own pane, never ancestors — scrollIntoView walked up
  // and shoved the page sideways while the dock was parked off-canvas.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // preventScroll: focusing the composer mid-slide must not scroll the
  // content area to "reveal" a textarea that is still translating in.
  useEffect(() => {
    if (open) inputRef.current?.focus({ preventScroll: true });
  }, [open]);

  // A navigation change brings the auto item back after a dismissal.
  useEffect(() => {
    setAutoDismissed(false);
  }, [autoItem?.id, autoItem?.kind]);

  const effectiveAuto = autoItem && !autoDismissed ? autoItem : null;
  const contextItems: TalkItem[] = [
    ...(effectiveAuto ? [effectiveAuto] : []),
    ...items.filter((i) => !effectiveAuto || talkKey(i) !== talkKey(effectiveAuto)),
  ];

  const send = async () => {
    const q = input.trim();
    if (!q || streaming) return;
    const userMsg: ChatMessage = { role: "user", content: q };
    const history = messages.slice(-20);
    setMessages((prev) => [...prev, userMsg, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);

    const appendToLast = (text: string, replace = false) =>
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "assistant") {
          updated[updated.length - 1] = { ...last, content: replace ? text : last.content + text };
        }
        return updated;
      });

    try {
      for await (const event of streamChat(q, history, { contextItems })) {
        if (event.type === "text" && event.content) appendToLast(event.content);
        else if (event.type === "error") appendToLast(`Quire couldn't answer: ${event.content}`, true);
      }
    } catch (err) {
      appendToLast(`Quire couldn't answer: ${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      setStreaming(false);
      inputRef.current?.focus({ preventScroll: true });
    }
  };

  const suggestions = liveState?.suggestion?.suggestions ?? [];

  return (
    <aside className="chat-dock" data-open={open} aria-hidden={!open}>
      {/* masthead */}
      <header className="chat-dock-head">
        <div>
          <div className="ink-kicker">You &amp; Quire, connecting the dots</div>
          <div className="chat-dock-title">The Correspondence</div>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button className="ink-stamp ink-stamp--quiet" title="Clear conversation" onClick={() => setMessages([])}>
              <Trash2 className="size-3" />
            </button>
          )}
          <button className="ink-stamp ink-stamp--quiet" title="Close (Esc)" onClick={closeDock}>
            <X className="size-3.5" />
          </button>
        </div>
      </header>

      {/* the working context — what the conversation is about */}
      <div className="chat-dock-context">
        <span className="chat-dock-context-label">about</span>
        {effectiveAuto && (
          <button
            className="talk-chip talk-chip--auto"
            title="Following your view — click to drop"
            onClick={() => setAutoDismissed(true)}
          >
            <span className="talk-chip-glyph">{KIND_GLYPH[effectiveAuto.kind]}</span>
            {effectiveAuto.label}
            <X className="size-2.5 opacity-60" />
          </button>
        )}
        {items.map((i) => (
          <button key={talkKey(i)} className="talk-chip" title="Unpin" onClick={() => unpin(talkKey(i))}>
            <span className="talk-chip-glyph">{KIND_GLYPH[i.kind]}</span>
            {i.label}
            <X className="size-2.5 opacity-60" />
          </button>
        ))}
        {items.length > 1 && (
          <button className="chat-dock-clear" onClick={clearItems}>clear</button>
        )}
        {!effectiveAuto && items.length === 0 && (
          <span className="chat-dock-context-empty">
            the whole repo — tap <kbd>t</kbd> on anything to pin it
          </span>
        )}
      </div>

      {/* the conversation */}
      <div className="chat-dock-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <p className="chat-dock-empty">
            Everything on the page can join this conversation — hover any entry and
            tap <kbd>talk</kbd>, or navigate with <kbd>j</kbd>/<kbd>k</kbd> and press <kbd>t</kbd>.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "chat-msg chat-msg--user" : "chat-msg chat-msg--brain"}>
            {m.content || (streaming && i === messages.length - 1 ? "…" : "")}
          </div>
        ))}
      </div>

      {/* live-session prompt suggestions, when the daemon is watching */}
      {suggestions.length > 0 && (
        <div className="chat-dock-suggest">
          {suggestions.slice(0, 3).map((s, i) => (
            <button key={i} className="chat-dock-suggest-item" onClick={() => setInput(s.prompt)}>
              {s.prompt}
            </button>
          ))}
        </div>
      )}

      {/* composer */}
      <footer className="chat-dock-compose">
        <textarea
          ref={inputRef}
          className="chat-dock-input"
          rows={2}
          value={input}
          placeholder={
            contextItems.length > 0
              ? `Ask about ${contextItems[0].label}${contextItems.length > 1 ? ` (+${contextItems.length - 1})` : ""}…`
              : "Ask Quire anything…"
          }
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={streaming}
        />
        <button className="chat-dock-send" onClick={send} disabled={streaming || !input.trim()} title="Send (Enter)">
          <ArrowUp className="size-3.5" />
        </button>
      </footer>
    </aside>
  );
}
