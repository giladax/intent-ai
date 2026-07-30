// The chat dock's shared state — mounted once at the app root so the
// conversation is always live: messages, pinned page elements, and the
// auto-context that follows navigation all survive view changes.
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode, Dispatch, SetStateAction } from "react";
import type { ChatMessage } from "./types";

/** A page element pinned into the conversation. */
export interface TalkItem {
  kind: "feature" | "session" | "episode" | "event" | "observation" | "view" | "note";
  id: string;
  label: string;
  summary?: string;
  /** True when the dock added it itself by following navigation. */
  auto?: boolean;
}

export function talkKey(item: Pick<TalkItem, "kind" | "id">): string {
  return `${item.kind}:${item.id}`;
}

interface ChatDockState {
  open: boolean;
  openDock(): void;
  closeDock(): void;
  toggleDock(): void;
  /** Elements the user pinned (tap / keyboard) — deduped by kind:id. */
  items: TalkItem[];
  pin(item: TalkItem): void;
  unpin(key: string): void;
  clearItems(): void;
  /** What the user is currently looking at; the dock includes it unless dismissed. */
  autoItem: TalkItem | null;
  setAutoItem(item: TalkItem | null): void;
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
}

const Ctx = createContext<ChatDockState | null>(null);

export function ChatDockProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<TalkItem[]>([]);
  const [autoItem, setAutoItem] = useState<TalkItem | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const pin = useCallback((item: TalkItem) => {
    setItems((prev) => {
      const key = talkKey(item);
      if (prev.some((i) => talkKey(i) === key)) return prev;
      return [...prev, { ...item, auto: false }];
    });
    setOpen(true);
  }, []);

  const unpin = useCallback((key: string) => {
    setItems((prev) => prev.filter((i) => talkKey(i) !== key));
  }, []);

  const value = useMemo<ChatDockState>(
    () => ({
      open,
      openDock: () => setOpen(true),
      closeDock: () => setOpen(false),
      toggleDock: () => setOpen((v) => !v),
      items,
      pin,
      unpin,
      clearItems: () => setItems([]),
      autoItem,
      setAutoItem,
      messages,
      setMessages,
    }),
    [open, items, autoItem, messages, pin, unpin],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChatDock(): ChatDockState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useChatDock must be used inside ChatDockProvider");
  return ctx;
}

/** Like useChatDock, but returns null instead of throwing when no provider is
 *  present — for chrome (e.g. the masthead opener) that may render in isolation
 *  (unit tests) where the dock isn't mounted. */
export function useChatDockOptional(): ChatDockState | null {
  return useContext(Ctx);
}
