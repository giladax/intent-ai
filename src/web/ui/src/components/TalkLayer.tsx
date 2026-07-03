// Makes the page itself conversational. Any element that declares
//   data-talk data-talk-kind="feature" data-talk-id="…" data-talk-label="…"
// becomes navigable (j/k or arrows), pinnable (t / Enter), and grows a
// hover affordance — no imports needed in the page components themselves.
// ⌘J (or c) toggles the dock; Esc closes it.
import { useCallback, useEffect, useRef, useState } from "react";
import { useChatDock } from "../chat-dock";
import type { TalkItem } from "../chat-dock";

const FOCUS_CLASS = "talk-focused";

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function readItem(el: HTMLElement): TalkItem | null {
  const { talkKind, talkId, talkLabel, talkSummary } = el.dataset;
  if (!talkKind || !talkId || !talkLabel) return null;
  // a clipping is a stub, not the article — keep labels pin-sized
  const label = talkLabel.length > 64 ? `${talkLabel.slice(0, 61)}…` : talkLabel;
  return {
    kind: talkKind as TalkItem["kind"],
    id: talkId,
    label,
    summary: talkSummary,
  };
}

function visibleTalkables(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-talk]")).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

export function TalkLayer() {
  const { pin, toggleDock, closeDock, open } = useChatDock();
  const focusedRef = useRef<HTMLElement | null>(null);
  const [hovered, setHovered] = useState<{ el: HTMLElement; top: number; right: number } | null>(null);

  const setFocused = useCallback((el: HTMLElement | null) => {
    focusedRef.current?.classList.remove(FOCUS_CLASS);
    focusedRef.current = el;
    if (el) {
      el.classList.add(FOCUS_CLASS);
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, []);

  const move = useCallback(
    (dir: 1 | -1) => {
      const all = visibleTalkables();
      if (all.length === 0) return;
      const current = focusedRef.current;
      const idx = current ? all.indexOf(current) : -1;
      const next =
        idx === -1
          ? dir === 1
            ? all[0]
            : all[all.length - 1]
          : all[Math.min(all.length - 1, Math.max(0, idx + dir))];
      setFocused(next ?? null);
    },
    [setFocused],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘J / Ctrl+J toggles the dock from anywhere, even while typing.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggleDock();
        return;
      }
      if (isTyping(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          move(1);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          move(-1);
          break;
        case "t":
        case "Enter": {
          const el = focusedRef.current;
          if (!el) return;
          const item = readItem(el);
          if (item) {
            e.preventDefault();
            pin(item);
          }
          break;
        }
        case "c":
          e.preventDefault();
          toggleDock();
          break;
        case "Escape":
          if (open) closeDock();
          else setFocused(null);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, pin, toggleDock, closeDock, open, setFocused]);

  // Hover affordance — a small "talk" tab pinned to the element's top-right.
  useEffect(() => {
    const onOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-talk]") ?? null;
      if (!el) {
        setHovered((prev) => (prev ? null : prev));
        return;
      }
      const r = el.getBoundingClientRect();
      setHovered((prev) =>
        prev?.el === el ? prev : { el, top: r.top, right: window.innerWidth - r.right },
      );
    };
    document.addEventListener("mouseover", onOver);
    return () => document.removeEventListener("mouseover", onOver);
  }, []);

  const hoveredItem = hovered ? readItem(hovered.el) : null;

  return hovered && hoveredItem ? (
    <button
      className="talk-affordance"
      style={{ top: hovered.top + 6, right: Math.max(hovered.right, 8) + 6 }}
      onMouseDown={(e) => {
        // mousedown, not click: beat row-level onClick navigation handlers
        e.preventDefault();
        e.stopPropagation();
        pin(hoveredItem);
        setHovered(null);
      }}
    >
      talk
    </button>
  ) : null;
}
