import { getClient } from "./connection.js";

export interface AttentionState {
  surface: "feed" | "classic";
  lens: null | {
    type: string;
    featureId?: string;
    featureName?: string;
    timeRange?: unknown;
  };
  expandedStoryIds: string[];
  openSessionId: string | null;
  pendingApprovalVisible: boolean;
  ts: number;
}

export const STALE_MS = 10 * 60 * 1000; // 10 minutes

export function isStaleDate(updatedAt: Date): boolean {
  return Date.now() - updatedAt.getTime() >= STALE_MS;
}

export async function writeAttention(state: AttentionState): Promise<void> {
  const sql = getClient();
  await sql`
    INSERT INTO attention_state (id, state, updated_at)
    VALUES ('current', ${JSON.stringify(state)}::jsonb, now())
    ON CONFLICT (id) DO UPDATE SET state = ${JSON.stringify(state)}::jsonb, updated_at = now()
  `;
}

export async function readAttention(): Promise<{
  state: AttentionState;
  stale: boolean;
  updatedAt: Date;
} | null> {
  const sql = getClient();
  const rows = await sql`SELECT state, updated_at FROM attention_state WHERE id = 'current'`;
  if (rows.length === 0) return null;
  const row = rows[0];
  const state = row.state as AttentionState;
  // treat sentinel empty state as no attention
  if (!state || Object.keys(state).length === 0) return null;
  const updatedAt = new Date(row.updated_at as string);
  return {
    state,
    stale: isStaleDate(updatedAt),
    updatedAt,
  };
}
