import type { Session } from "../types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, CircleDot } from "lucide-react";

interface Props {
  sessions: Session[];
  undigestedCount: number;
  onSync: () => void;
  onSessionClick: (id: string) => void;
}

export function SessionsPage({ sessions, undigestedCount, onSync, onSessionClick }: Props) {
  const sorted = [...sessions].sort((a, b) => {
    const da = a.started_at ? new Date(a.started_at).getTime() : 0;
    const db = b.started_at ? new Date(b.started_at).getTime() : 0;
    return db - da;
  });

  const formatDate = (d: string | null) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Sessions</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {sessions.length} digested
            {undigestedCount > 0 && (
              <span className="text-amber-600 dark:text-amber-400"> · {undigestedCount} waiting</span>
            )}
          </p>
        </div>
        {undigestedCount > 0 && (
          <Button size="sm" className="gap-1.5" onClick={onSync}>
            <RefreshCw className="size-3" />
            Digest {undigestedCount} new
          </Button>
        )}
      </div>

      {/* Undigested banner */}
      {undigestedCount > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 text-sm">
          <div className="flex gap-1">
            {Array.from({ length: Math.min(undigestedCount, 5) }).map((_, i) => (
              <div key={i} className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" style={{ animationDelay: `${i * 200}ms` }} />
            ))}
          </div>
          <span>{undigestedCount} Claude Code session{undigestedCount !== 1 ? "s" : ""} not yet digested</span>
        </div>
      )}

      {/* Session list */}
      {sorted.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-12">
          <p>No digested sessions yet.</p>
          {undigestedCount > 0 && (
            <Button size="sm" variant="outline" className="mt-3 gap-1.5" onClick={onSync}>
              <RefreshCw className="size-3" />
              Start digesting
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-0.5">
          {sorted.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer group"
              onClick={() => onSessionClick(s.id)}
            >
              <CircleDot className="size-3 shrink-0 text-emerald-500" />
              <span className="text-xs text-muted-foreground shrink-0 w-16 tabular-nums">
                {formatDate(s.started_at)}
              </span>
              <span className="text-sm flex-1 truncate">
                {s.narrative_summary?.split(/[.!?\n]/)[0] || "No narrative"}
              </span>
              {s.session_shape && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">{s.session_shape}</Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
