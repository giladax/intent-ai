import { useState, useEffect } from "react";
import { fetchTopicDetail } from "../api";
import type { TopicDetail as TopicDetailType } from "../types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  topicId: string | null;
  onTopicClick: (topicId: string) => void;
}

const CATEGORY_ORDER = ["structure", "constraint", "decision", "behavior", "risk", "interface"];

const CATEGORY_COLORS: Record<string, string> = {
  structure: "bg-emerald-600",
  decision: "bg-blue-500",
  constraint: "bg-amber-500",
  behavior: "bg-purple-500",
  risk: "bg-red-500",
  interface: "bg-slate-500",
};

export function TopicDetail({ topicId, onTopicClick }: Props) {
  const [detail, setDetail] = useState<TopicDetailType | null>(null);

  useEffect(() => {
    if (!topicId) {
      setDetail(null);
      return;
    }
    fetchTopicDetail(topicId).then(setDetail).catch(() => setDetail(null));
  }, [topicId]);

  if (!topicId) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Select a topic to explore its insights
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="max-w-2xl p-6 space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    );
  }

  // Group insights by category
  const byCategory = new Map<string, typeof detail.insights>();
  for (const i of detail.insights) {
    const list = byCategory.get(i.category) || [];
    list.push(i);
    byCategory.set(i.category, list);
  }

  const formatDate = (d: string | null) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const truncate = (s: string, max: number) =>
    s.length > max ? s.slice(0, max - 3) + "..." : s;

  return (
    <div className="max-w-2xl p-6 space-y-6">
      {/* 1. Header */}
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{detail.topic.name}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed mt-1">{detail.topic.summary}</p>
      </div>

      {/* 2. Sessions */}
      {detail.sessions.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sessions</h3>
          <div className="space-y-1">
            {detail.sessions.map((s) => (
              <div key={s.session_id} className="flex items-center gap-3 py-2 px-3 rounded hover:bg-accent/50">
                <span className="text-xs text-muted-foreground shrink-0 w-12">{formatDate(s.started_at)}</span>
                <span className="text-sm truncate flex-1">{truncate(s.summary || s.session_shape || "Session", 80)}</span>
                <span className="text-xs text-muted-foreground shrink-0">{s.moment_count} moments</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Related topics */}
      {detail.relatedTopics.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Related</h3>
          <div className="flex flex-wrap gap-2">
            {detail.relatedTopics.map((r) => (
              <Badge
                key={r.id}
                variant="outline"
                className="cursor-pointer hover:bg-accent transition-colors"
                onClick={() => onTopicClick(r.id)}
              >
                {r.name}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* 4. Insights by category */}
      {CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((cat) => (
        <div key={cat} className="space-y-2">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${CATEGORY_COLORS[cat]}`} />
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{cat}</span>
            <span className="text-xs text-muted-foreground">({byCategory.get(cat)!.length})</span>
          </div>
          {byCategory.get(cat)!.map((insight, i) => (
            <Card key={i} className="p-3">
              <p className="text-sm leading-relaxed">{insight.statement}</p>
            </Card>
          ))}
        </div>
      ))}

      {/* 5. Files */}
      {detail.files.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Files</h3>
          <div className="space-y-1">
            {detail.files.map((f, i) => (
              <div key={i} className="flex items-baseline gap-2">
                <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{f.file_path}</code>
                {f.role && <Badge variant="secondary" className="text-[10px]">{f.role}</Badge>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
