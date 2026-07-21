// notifications.ts — lightweight notification derivation from DB signals.
// No LLM. Four signal types: pending gates, area activity, contradicted
// decisions, hot streak. All copy is plain-voice, specific.

export type NotifType = "pending_gate" | "area_activity" | "contradicted" | "hot_streak";

export interface Notification {
  type: NotifType;
  featureId: string;
  text: string;
  featureName?: string;
  timestamp?: string;
}

export interface NotifTextInput {
  type: NotifType;
  featureName?: string;
  actorName?: string;
  count?: number;
  momentSummary?: string;
  heatScore?: number;
}

/**
 * Build plain-voice, specific notification text. No banned words.
 * Timestamps are relative when recent (< 24h), absolute when older.
 */
export function buildNotifText(input: NotifTextInput): string {
  const { type, featureName, actorName, count, momentSummary } = input;
  const name = featureName ?? "a feature";

  switch (type) {
    case "pending_gate":
      return count === 1
        ? `${name} has 1 thing waiting for your review.`
        : `${name} has ${count ?? 0} things waiting for your review.`;

    case "area_activity":
      if (actorName && count) {
        return `${actorName} made ${count} update${count === 1 ? "" : "s"} in ${name}.`;
      } else if (actorName) {
        return `${actorName} was active in ${name}.`;
      }
      return `New activity in ${name}.`;

    case "contradicted":
      return momentSummary
        ? `A finding in ${name} contradicts an earlier assessment: "${momentSummary}".`
        : `A finding in ${name} contradicts an earlier decision.`;

    case "hot_streak":
      return `${name} is moving fast — ${count ?? 0} events in the last hour.`;

    default:
      return `Update in ${name}.`;
  }
}

/**
 * Remove duplicate notifications by type+featureId, keeping the first occurrence.
 */
export function dedupNotifications(notifs: Notification[]): Notification[] {
  const seen = new Set<string>();
  return notifs.filter(n => {
    const key = `${n.type}::${n.featureId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
