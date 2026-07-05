import type { AttentionState } from "../storage/attention-store.js";

export function buildAttentionContext(state: AttentionState | null): string | null {
  if (!state || typeof state !== "object" || !("surface" in state)) return null;
  const parts: string[] = [];
  if (state.lens?.featureName) {
    parts.push(`The user is currently looking at the "${state.lens.featureName}" feature lens.`);
  } else if (state.lens?.type === "timeline") {
    parts.push("The user is looking at the Timeline lens.");
  } else if (state.surface === "feed") {
    parts.push("The user is viewing the feed (no specific lens focused).");
  }
  if (state.openSessionId) {
    parts.push(`Session ${state.openSessionId.slice(0, 8)} is open.`);
  }
  if (!parts.length) return null;
  return parts.join(" ");
}
