import { useState, useEffect } from "react";
import { fetchTimeline } from "../api";
import type { TimelineData, BrainVersion } from "../types";
import { Badge } from "@/components/ui/badge";
import { Brain } from "lucide-react";

interface Props {
  repoId: string;
}

export function BranchTimeline({ repoId }: Props) {
  const [data, setData] = useState<TimelineData | null>(null);

  useEffect(() => {
    fetchTimeline(repoId).then(setData).catch(() => setData(null));
  }, [repoId]);

  if (!data || data.commits.length === 0) return null;

  const versionBySha = new Map<string, BrainVersion>();
  for (const v of data.brainVersions) {
    if (v.commit_sha) versionBySha.set(v.commit_sha, v);
  }

  const versionNumbers = new Map<string, number>();
  const sorted = [...data.brainVersions].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  sorted.forEach((v, i) => versionNumbers.set(v.id, i + 1));

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div className="space-y-0">
      {data.commits.map((commit, idx) => {
        const version = versionBySha.get(commit.sha);
        const vNum = version ? versionNumbers.get(version.id) : null;
        const isLast = idx === data.commits.length - 1;

        return (
          <div key={commit.sha} className="flex gap-3">
            <div className="flex flex-col items-center w-4 shrink-0">
              <div className={`w-2 h-2 rounded-full mt-2 ${version ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
              {!isLast && <div className="w-px flex-1 bg-border" />}
            </div>
            <div className={`pb-4 min-w-0 ${version ? "" : "opacity-50"}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <code className="text-[11px] text-muted-foreground font-mono">{commit.sha.slice(0, 7)}</code>
                <span className="text-sm truncate">{commit.message}</span>
                {version && vNum && (
                  <Badge variant="secondary" className="shrink-0 text-[10px] gap-1">
                    <Brain className="size-3" />
                    v{vNum}
                  </Badge>
                )}
              </div>
              {version && (
                <div className="text-xs text-muted-foreground mt-0.5 ml-[52px]">
                  {version.topic_count} topics, {version.insight_count} insights
                </div>
              )}
              <div className="text-[10px] text-muted-foreground/60 mt-0.5">{formatDate(commit.date)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
