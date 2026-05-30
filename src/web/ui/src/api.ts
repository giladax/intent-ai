import type {
  Project,
  Feature,
  Session,
  FeatureDetail,
  SessionDetail,
  ChatMessage,
  TopicSummary,
  TopicDetail,
  TimelineData,
  BrainDiscoverResult,
  SyncJobStatus,
  BrainCard,
} from "./types";

const BASE = "";

async function json<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, opts);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json();
}

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

// Topics (Brain)
export const fetchTopics = (repoId: string) =>
  json<TopicSummary[]>(`/api/topics?repoId=${repoId}`);
export const fetchTopicDetail = (topicId: string) =>
  json<TopicDetail>(`/api/topics/${topicId}`);

// Timeline
export const fetchTimeline = (repoId: string) =>
  json<TimelineData>(`/api/timeline?repoId=${repoId}`);

// Sessions
export const fetchSessions = (repoId?: string) =>
  json<Session[]>(repoId ? `/api/sessions?repoId=${repoId}` : "/api/sessions");
export const fetchSessionDetail = (id: string) =>
  json<SessionDetail>(`/api/sessions/${id}`);

// Brain Cards
export const fetchBrainCards = (repoId: string) =>
  json<BrainCard[]>(`/api/brain/cards/${repoId}`);
export const fetchBrainCard = (repoId: string, nodeName: string) =>
  json<BrainCard>(`/api/brain/cards/${repoId}/${encodeURIComponent(nodeName)}`);

// Brain Sync
export const getSyncStatus = (repoId: string) =>
  json<SyncJobStatus | null>(`/api/brain/sync-status?repoId=${repoId}`);
export const discoverBrainSessions = (repoId: string) =>
  json<BrainDiscoverResult>("/api/brain/discover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoId }),
  });
// proposeBrainSync and applyBrainSync now use SSE streaming directly in BrainSync.tsx

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

// Chat (streaming)
export async function* streamChat(
  question: string,
  history: ChatMessage[],
  featureId?: string,
  sessionId?: string,
  topicId?: string,
): AsyncGenerator<{ type: string; content?: string }> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, history, featureId, sessionId, topicId }),
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
