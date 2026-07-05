import type { AttentionState } from "../storage/attention-store.js";

export function formatAttentionMcpText(
  state: AttentionState | null,
  updatedAt: Date | null,
  stale = false,
): string {
  if (!state || !("surface" in state)) {
    return "No attention reported — the Brain dashboard does not appear to be open.";
  }
  const staleMark = stale ? " (stale — older than 10 min)" : "";
  const lines: string[] = [];
  lines.push(`## User Attention${staleMark}`);
  lines.push(`Surface: ${state.surface}`);
  if (state.lens?.featureName) {
    lines.push(`Lens: Feature — "${state.lens.featureName}" (id: ${state.lens.featureId ?? "unknown"})`);
  } else if (state.lens?.type) {
    lines.push(`Lens: ${state.lens.type}`);
  } else {
    lines.push("Lens: feed (no specific lens focused)");
  }
  if (state.openSessionId) lines.push(`Open session: ${state.openSessionId}`);
  if (state.expandedStoryIds?.length) {
    lines.push(`Expanded stories: ${state.expandedStoryIds.slice(0, 5).join(", ")}`);
  }
  if (updatedAt) lines.push(`\n_Updated at: ${updatedAt.toISOString()}_`);
  return lines.join("\n");
}
