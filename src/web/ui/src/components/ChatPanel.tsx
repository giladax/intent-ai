import { useState, useRef, useEffect } from "react";
import { streamChat } from "../api";
import { fetchTopicDetail } from "../api";
import type { ChatMessage, TopicSession } from "../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Trash2 } from "lucide-react";

interface Props {
  topicId: string;
  topicName: string;
}

const MAX_VISIBLE_CHIPS = 5;

export function ChatPanel({ topicId, topicName }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [sessions, setSessions] = useState<TopicSession[]>([]);
  const [enabledSessionIds, setEnabledSessionIds] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load sessions when topic changes
  useEffect(() => {
    setMessages([]);
    setSessions([]);
    setEnabledSessionIds(new Set());
    fetchTopicDetail(topicId).then((detail) => {
      const sorted = [...detail.sessions].sort((a, b) => {
        const da = a.started_at ? new Date(a.started_at).getTime() : 0;
        const db = b.started_at ? new Date(b.started_at).getTime() : 0;
        return db - da;
      });
      setSessions(sorted);
      // Default: 3 most recent ON
      setEnabledSessionIds(new Set(sorted.slice(0, 3).map((s) => s.session_id)));
    });
  }, [topicId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const toggleSession = (id: string) => {
    setEnabledSessionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const formatDate = (d: string | null) => {
    if (!d) return "?";
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
      // Send first enabled session ID for context (API currently takes one sessionId)
      const firstEnabledSession = sessions.find((s) => enabledSessionIds.has(s.session_id));
      for await (const event of streamChat(
        q, history, undefined,
        firstEnabledSession?.session_id,
        topicId,
      )) {
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

  const visibleChips = sessions.slice(0, MAX_VISIBLE_CHIPS);
  const overflowChips = sessions.slice(MAX_VISIBLE_CHIPS);

  return (
    <div className="flex flex-col h-full border-l">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b">
        <span className="text-sm font-medium">Chat: {topicName}</span>
        {messages.length > 0 && (
          <Button variant="ghost" size="icon" className="size-6" onClick={() => setMessages([])}>
            <Trash2 className="size-3" />
          </Button>
        )}
      </div>

      {/* Session context chips */}
      {sessions.length > 0 && (
        <div className="shrink-0 flex flex-wrap gap-1.5 px-3 py-2 border-b">
          {visibleChips.map((s) => (
            <button
              key={s.session_id}
              aria-pressed={enabledSessionIds.has(s.session_id)}
              onClick={() => toggleSession(s.session_id)}
              className="focus:outline-none"
            >
              <Badge
                variant={enabledSessionIds.has(s.session_id) ? "default" : "outline"}
                className="text-[10px] cursor-pointer transition-colors"
              >
                {formatDate(s.started_at)}
              </Badge>
            </button>
          ))}
          {overflowChips.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button className="focus:outline-none">
                  <Badge variant="outline" className="text-[10px] cursor-pointer">
                    +{overflowChips.length} more
                  </Badge>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-48 p-2">
                <div className="space-y-1">
                  {overflowChips.map((s) => (
                    <button
                      key={s.session_id}
                      aria-pressed={enabledSessionIds.has(s.session_id)}
                      onClick={() => toggleSession(s.session_id)}
                      className="flex items-center gap-2 w-full px-2 py-1 rounded hover:bg-accent text-xs focus:outline-none"
                    >
                      <Badge
                        variant={enabledSessionIds.has(s.session_id) ? "default" : "outline"}
                        className="text-[9px]"
                      >
                        {enabledSessionIds.has(s.session_id) ? "\u2713" : ""}
                      </Badge>
                      <span className="truncate">{formatDate(s.started_at)}</span>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="space-y-2">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground text-xs py-8">
              Ask about {topicName}...
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={cn(
              "max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words",
              m.role === "user"
                ? "ml-auto bg-primary text-primary-foreground rounded-br-sm"
                : "bg-muted rounded-bl-sm"
            )}>
              {m.content || (streaming && i === messages.length - 1 ? "..." : "")}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="shrink-0 flex gap-2 p-3 border-t">
        <Input
          ref={inputRef}
          aria-label="Chat message"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder={`Ask about ${topicName}...`}
          disabled={streaming}
          className="text-sm"
        />
        <Button size="sm" onClick={handleSend} disabled={streaming || !input.trim()}>
          Send
        </Button>
      </div>
    </div>
  );
}
