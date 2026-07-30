// notif-utils — pure helpers for the notification surface.
// localStorage access is guarded: falls back to an in-memory store when
// localStorage is unavailable (e.g. node test env, privacy mode).

const LAST_SEEN_KEY = "quire-last-seen";

const memoryStore = new Map<string, string>();

function storageGet(key: string): string | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage.getItem(key);
  } catch {
    /* fall through to memory */
  }
  return memoryStore.get(key) ?? null;
}

function storageSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value);
      return;
    }
  } catch {
    /* fall through to memory */
  }
  memoryStore.set(key, value);
}

/**
 * Format a last-seen timestamp for the "WHILE YOU WERE AWAY" header.
 * Relative when recent (< 24h: "4 hours ago"), "yesterday" for 24-48h,
 * absolute locale date when older.
 */
export function formatLastSeen(iso: string): string {
  const then = new Date(iso).getTime();
  const hours = Math.round((Date.now() - then) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  if (hours < 48) return "yesterday";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toLowerCase();
}

/** Read the stored last-seen ISO timestamp; null if never set. */
export function getLastSeenFromStorage(): string | null {
  return storageGet(LAST_SEEN_KEY);
}

/** Persist the last-seen ISO timestamp. */
export function setLastSeenInStorage(iso: string): void {
  storageSet(LAST_SEEN_KEY, iso);
}

/** Hours between a stored last-seen timestamp and now (min 1). */
export function hoursSince(iso: string): number {
  return Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000));
}
