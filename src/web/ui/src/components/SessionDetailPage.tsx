import { useState, useEffect } from "react";
import { fetchSessionDetail } from "../api";
import type { SessionDetail } from "../types";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  sessionId: string;
}

const MOMENT_COLORS: Record<string, string> = {
  discovery: "bg-emerald-500",
  decision: "bg-blue-500",
  commitment: "bg-indigo-500",
  implementation: "bg-purple-500",
  struggle: "bg-amber-500",
  realization: "bg-cyan-500",
  refactor: "bg-orange-500",
  pivot: "bg-red-500",
  proposal: "bg-teal-500",
  confirmation: "bg-green-500",
  rejection: "bg-rose-500",
  transition: "bg-violet-500",
};

export function SessionDetailPage({ sessionId }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchSessionDetail(sessionId)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Session not found
      </div>
    );
  }

  const { narrative, moments, transitions } = detail;

  const formatDate = (d: string | null) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("en-US", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{formatDate(narrative?.started_at ?? null) || "Session"}</h2>
          {narrative?.session_shape && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{narrative.session_shape}</Badge>
          )}
        </div>
      </div>

      {/* Narrative */}
      {narrative?.summary && (
        <Card className="p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Narrative</h3>
          <p className="text-sm leading-relaxed">{narrative.summary}</p>
        </Card>
      )}

      {/* Moments */}
      {moments && moments.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {moments.length} Moments
          </h3>
          <div className="space-y-2">
            {moments.map((m: any, i: number) => (
              <div key={m.id || i} className="flex gap-3 group">
                {/* Timeline dot */}
                <div className="flex flex-col items-center pt-1.5">
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${MOMENT_COLORS[m.type] || "bg-muted-foreground"}`} />
                  {i < moments.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                </div>
                {/* Content */}
                <div className="flex-1 pb-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">{m.type || "moment"}</Badge>
                    {m.agency && (
                      <span className="text-[10px] text-muted-foreground">{m.agency}</span>
                    )}
                    {m.confidence && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{m.confidence}</Badge>
                    )}
                  </div>
                  <p className="text-sm leading-relaxed">{m.statement}</p>
                  {m.significance && (
                    <p className="text-xs text-muted-foreground mt-1">{m.significance}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transitions */}
      {transitions && transitions.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Transitions</h3>
          {transitions.map((t: any, i: number) => (
            <Card key={i} className="p-3">
              <p className="text-sm">{t.description || t.summary || JSON.stringify(t)}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
