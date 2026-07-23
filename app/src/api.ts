import type {
  Project,
  Feature,
  Session,
  FeatureDetail,
  FeatureFile,
  PendingObservation,
  SessionDetail,
  SessionEventsWithWindows,
  ArchiveResponse,
  ChatMessage,
  JournalResponse,
  JournalParams,
  StatsOverview,
  Provenance,
  LensArrivalData,
  RegisterResult,
  ScanResult,
  DraftResult,
  ApproveResult,
  FirstResultsResult,
  OrgFeatureDetail,
  ReviewRow,
  ReviewDetail,
  FeaturePromisesResult,
} from "./types";

// Alias for use in fetchOrgFeatureDetail to avoid shadowing the local FeatureDetail import.
type FeatureDetailShape = FeatureDetail;

export type { LensArrivalData };

const BASE = "";

async function json<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, opts);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json();
}

// ── Org (O0) — the familiar shell's tree + repo cards ────────────────
export interface RepoCard {
  workspace: string;
  display_name: string;
  latest_verdict: string | null;
  open_review_count: number;
  coupled_session_count: number;
  github_remote: string | null;
  status: string;
  read_only: boolean;
  intent_ledger_url: string;
}
export interface Org {
  id: string;
  name: string;
  repos: RepoCard[];
}
export const fetchOrg = () => json<Org>("/api/org");

// ── Needs you — the few decisions awaiting a human, enriched for the
// list AND the detail pane from one contract (ruling 4). ──────────────
export interface NeedsYouPromise {
  obligation_id: string | null;
  relation: string | null;
  reasoning: string | null;
  statement: string | null;
}
export interface NeedsYouItem {
  id: string;
  kind: string;
  verdict: string;          // raw enum (translate via /api/vocab)
  label: string;            // plain label, already translated server-side
  ink: string;              // verdict ink token
  severity: string;
  title: string;
  repo: string;
  pr_number: number;
  link: string;
  ts: string;
  promise: NeedsYouPromise | null;
  why: { summary: string } | null;
}
export const fetchNeedsYou = () => json<NeedsYouItem[]>("/api/needs-you");

// Projects
export const fetchProjects = () => json<Project[]>("/api/projects");
export const createProject = (name: string, path: string) =>
  json<Project>("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, path }),
  });

// Features
export const fetchFeatures = (projectId: string) =>
  json<Feature[]>(`/api/projects/${projectId}/features`);
export const createFeature = (projectId: string, name: string, description = "") =>
  json<Feature>(`/api/projects/${projectId}/features`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description }),
  });

// Feature detail
export const fetchFeatureDetail = (featureId: string) =>
  json<FeatureDetail>(`/api/features/${featureId}`);

// Feature understanding (manual curation)
export const updateFeatureUnderstanding = (
  featureId: string,
  patch: { currentUnderstanding?: string; constraints?: string[]; knownUnknowns?: string[] },
) =>
  json<{ feature: Feature }>(`/api/features/${featureId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });

// Feature↔file map
export const fetchFeatureFiles = (featureId: string) =>
  json<FeatureFile[]>(`/api/features/${featureId}/files`);
export const addFeatureFile = (featureId: string, glob: string, filePath?: string) =>
  json<FeatureFile>(`/api/features/${featureId}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ glob, filePath }),
  });
export const removeFeatureFile = (featureId: string, fileId: string) =>
  json<{ ok: boolean }>(`/api/features/${featureId}/files/${fileId}`, {
    method: "DELETE",
  });

// Observation review queue
export const fetchPendingObservations = (repoId?: string) =>
  json<PendingObservation[]>(
    repoId ? `/api/observations/pending?repoId=${repoId}` : "/api/observations/pending",
  );
export const approveObservation = (id: string) =>
  json<{ ok: boolean; status: string }>(`/api/observations/${id}/approve`, { method: "POST" });
export const rejectObservation = (id: string) =>
  json<{ ok: boolean; status: string }>(`/api/observations/${id}/reject`, { method: "POST" });
export const editObservation = (id: string, summary: string) =>
  json<{ id: string; summary: string; review_status: string }>(`/api/observations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ summary }),
  });

// Feature sessions
export const tagSession = (featureId: string, sessionId: string, role: string) =>
  json<{ ok: boolean }>(`/api/features/${featureId}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, role }),
  });
export const untagSession = (featureId: string, sessionId: string) =>
  json<{ ok: boolean }>(`/api/features/${featureId}/sessions/${sessionId}`, {
    method: "DELETE",
  });

// Journal (observability) — GET /api/journal?since&actor&featureId&limit
export const fetchJournal = (params: JournalParams = {}) => {
  const q = new URLSearchParams();
  if (params.since) q.set("since", params.since);
  if (params.actor) q.set("actor", params.actor);
  if (params.featureId) q.set("featureId", params.featureId);
  if (params.limit != null) q.set("limit", String(params.limit));
  const qs = q.toString();
  return json<JournalResponse>(`/api/journal${qs ? `?${qs}` : ""}`);
};

// Sessions
export const fetchSessions = (repoId?: string) =>
  json<Session[]>(repoId ? `/api/sessions?repoId=${repoId}` : "/api/sessions");
export const fetchSessionDetail = (id: string) =>
  json<SessionDetail>(`/api/sessions/${id}`);

export const fetchSessionEventsWithWindows = (id: string) =>
  json<SessionEventsWithWindows>(`/api/sessions/${id}/events-with-windows`);

// Local session archive — .intent/raw-sessions joined against the sessions table
export const fetchArchive = () => json<ArchiveResponse>("/api/archive");

// Provenance — the chain that lets any river event explain itself.
// Accepts an activity-event id, a source id, or a bare moment id.
export const fetchProvenance = (id: string) =>
  json<Provenance>(`/api/events/${id}/provenance`);

// Stats overview — the altitude layer (cadence, provenance quality, momentum).
// Fail-safe by contract: the server answers the empty shape rather than 500.
export const fetchStatsOverview = (repoId?: string) =>
  json<StatsOverview>(repoId ? `/api/stats/overview?repoId=${repoId}` : "/api/stats/overview");

export const fetchLensArrival = () => json<LensArrivalData>("/api/lens/arrival");

// Feed — editorial overview composed by the brain. Cached; recomposes on new events.
export interface FeedStory {
  featureId: string;
  featureName: string;
  heatScore: number;
  heatLabel: "hot" | "still warm" | "cooling";
  eventCount: number;
  headline: string;
  dek: string;
  openQuestion: string;
  citedSessionIds: string[];
  actorInitials: string[];
  deepHeadline?: string;
  deep?: string;
}

export interface FeedComposed {
  editionNumber: number;
  composedAt: string;
  lede: { headline?: string; text: string; citedSessionIds: string[] };
  trending: FeedStory[];
}

export const fetchFeed = (refresh = false) =>
  json<FeedComposed>(`/api/feed${refresh ? "?refresh=1" : ""}`);

// Lens opening turn — seeded first turn for any feature lens.
export interface LensOpeningResult {
  turn: string;
  polished: boolean;
  citedSessionIds: string[];
}
export const fetchLensOpening = (featureId: string) =>
  json<LensOpeningResult>(`/api/lens/opening/${encodeURIComponent(featureId)}`);

// Notifications — derived from DB signals (no LLM). Fail-safe: returns [].
export interface Notification {
  type: "pending_gate" | "area_activity" | "contradicted" | "hot_streak";
  featureId: string;
  text: string;
  featureName?: string;
  timestamp?: string;
}

export const fetchNotifications = (lastSeen?: string, actor?: string) => {
  const params = new URLSearchParams();
  if (lastSeen) params.set("lastSeen", lastSeen);
  if (actor) params.set("actor", actor);
  const query = params.toString();
  return json<{ notifications: Notification[]; unreadCount: number }>(
    `/api/notifications${query ? `?${query}` : ""}`
  );
};

// Digest — the intake and its press schedule (cron elapse settings)
export interface DigestSchedule {
  enabled: boolean;
  intervalMinutes: number;
  debounceMinutes: number;
  lastRun?: { at: number; digested: number; skippedLive: number } | null;
}
export const fetchDigestSchedule = () => json<DigestSchedule>("/api/digest/schedule");
export const saveDigestSchedule = (s: DigestSchedule) =>
  json<DigestSchedule>("/api/digest/schedule", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(s),
  });

// Live state (observe daemon)
export interface LiveState {
  state: {
    sessionId: string;
    startedAt: number;
    transcriptPath: string;
    turnCount: number;
    currentIntent: string;
    filesInFocus: string[];
    significantEvents: string[];
  } | null;
  suggestion: {
    suggestions: Array<{
      prompt: string;
      reasoning: string;
      category: 'continue' | 'refine' | 'redirect' | 'verify' | 'explain';
    }>;
    sessionSummary: string;
    updatedAt: number;
  } | null;
}

export async function fetchLiveState(): Promise<LiveState | null> {
  try {
    const res = await fetch('http://127.0.0.1:4317/live');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // daemon not running
  }
}

// ── O1 add-repo flow ─────────────────────────────────────────────────

export const registerRepo = (url: string) =>
  json<RegisterResult>("/api/org/repos/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

export const scanRepo = (workspace: string) =>
  json<ScanResult>(`/api/org/repos/${workspace}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

export const draftRepo = (workspace: string, sources: ScanResult["sources"]) =>
  json<DraftResult>(`/api/org/repos/${workspace}/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sources }),
  });

export const approveRepo = (
  workspace: string,
  payload: {
    sources: ScanResult["sources"];
    obligations: DraftResult["obligations"];
    bindings: DraftResult["bindings"];
    sweep_commits: ScanResult["commits"];
  },
) =>
  json<ApproveResult>(`/api/org/repos/${workspace}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

export const firstResults = (workspace: string, n_prs = 3) =>
  json<FirstResultsResult>(`/api/org/repos/${workspace}/first-results`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ n_prs }),
  });

// ── A2 review room ───────────────────────────────────────────────────
// The repo's reviews (newest first, plain verdict + human title + when),
// the assembled review room for one PR, and a feature's held promises.
// Each renders a documented JSON contract the same way an agent reads it.

export const fetchRepoReviews = (workspace: string) =>
  json<{ workspace: string; reviews: ReviewRow[] }>(
    `/api/repos/${encodeURIComponent(workspace)}/reviews`,
  );

export const fetchReview = (workspace: string, prNumber: number) =>
  json<ReviewDetail>(
    `/api/reviews/${encodeURIComponent(workspace)}/${prNumber}`,
  );

export const fetchFeaturePromises = (featureId: string) =>
  json<FeaturePromisesResult>(`/api/features/${encodeURIComponent(featureId)}/promises`);

/** Fetch the Feature definition page data.
 *  Uses the existing /api/features/{id} endpoint (FeatureDetail shape);
 *  maps into the OrgFeatureDetail shape for the feature page renderer.
 *  Promises come from /api/features/{id} observations for now (A2 will
 *  replace with a real obligations endpoint). */
export async function fetchOrgFeatureDetail(featureId: string): Promise<OrgFeatureDetail> {
  const detail = await json<FeatureDetailShape>(`/api/features/${featureId}`);
  const f = detail.feature;
  // The real promises this feature holds — the deterministic edge between the
  // feature's files and the obligations that govern them (bindings ∩ files).
  // Fail-quiet: a repo with no onboarded contract yields an empty, count-0
  // body, and the feature page falls back to its observation-derived cards.
  let held: FeaturePromisesResult = { promises: [], promiseCount: 0 };
  try {
    held = await json<FeaturePromisesResult>(`/api/features/${featureId}/promises`);
  } catch {
    // keep the empty fallback
  }
  // Resolve the owning project's DISPLAY NAME — ids stay footnotes, never headlines.
  // Fail-quiet: if the projects list is unreachable, fall back to the id.
  let repoName = f.project_id;
  try {
    const projects = await json<Project[]>("/api/projects");
    repoName = projects.find((p) => p.id === f.project_id)?.name ?? f.project_id;
  } catch {
    // keep the id fallback
  }
  return {
    id: f.id,
    name: f.name,
    repo: repoName,
    // Use the backend-resolved workspace key (slug) for /repo/:ws routing.
    // Falls back to repoName when backend doesn't carry the field yet (degraded state).
    repoWorkspace: detail.workspace ?? repoName,
    summary: f.description || f.current_understanding || undefined,
    statusLabel: "No reviews yet",
    statusInk: "gray",
    promiseCount: held.promiseCount,
    brokenCount: 0,
    sessionCount: detail.sessions.length,
    fileCount: (detail.files ?? []).length,
    lastChange: detail.sessions[0]?.startedAt ?? undefined,
    // Prefer the real held promises (signed obligations governing this
    // feature's files); fall back to observation-derived cards when the
    // repo carries no contract yet. A held promise reads as a plain
    // statement with its obligation id as a footnote.
    promises: held.promises.length > 0
      ? held.promises.slice(0, 8).map((p) => ({
          id: p.obligation_id,
          statement: p.statement || p.obligation_id,
          status: "kept",
          statusLabel: "A promise we made",
          statusInk: "green",
          explanation: undefined,
          sourceRef: p.obligation_id,
          reviewLink: undefined,
        }))
      : (detail.observations ?? []).slice(0, 5).map((o) => ({
          id: o.id,
          statement: o.summary,
          status: "no_rule",
          statusLabel: "No rule yet",
          statusInk: "gray",
          explanation: undefined,
          sourceRef: undefined,
          reviewLink: undefined,
        })),
    whyCard: detail.sessions[0]?.narrativeSummary
      ? {
          summary: detail.sessions[0].narrativeSummary,
          sessionLink: `/session/${detail.sessions[0].id}`,
          sessionSteps: detail.sessions[0].momentCount,
        }
      : undefined,
    timeline: detail.sessions.slice(0, 5).map((s) => ({
      id: s.id,
      title: s.narrativeSummary || s.sessionShape || "Coding session",
      meta: `${s.startedAt ? new Date(s.startedAt).toLocaleDateString() : "unknown date"} · ${s.momentCount} steps · reasoning saved`,
      ink: "blue",
    })),
    relatedFeatures: [],
    mentionedIn:
      detail.sessions.length > 0
        ? { sessions: detail.sessions.length, threads: 0, specs: 0 }
        : undefined,
  };
}

// Chat (streaming). Context can be scoped by feature/session id or by
// pinned page elements (contextItems from the chat dock).
export interface ChatContextItem {
  kind: string;
  id: string;
  label: string;
  summary?: string;
}

export async function* streamChat(
  question: string,
  history: ChatMessage[],
  opts: {
    featureId?: string;
    sessionId?: string;
    contextItems?: ChatContextItem[];
    lensScope?: {
      featureId?: string;
      timeRange?: { since: string; until: string; label: string };
    };
  } = {},
): AsyncGenerator<{ type: string; content?: string }> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, history, ...opts }),
  });

  if (!res.ok) {
    throw new Error(`Chat failed: ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          yield data;
        } catch {
          // skip malformed lines
        }
      }
    }
  }
}
