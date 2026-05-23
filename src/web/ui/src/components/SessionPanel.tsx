import { useState, useEffect } from "react";
import { fetchSessionDetail } from "../api";
import type { SessionDetail } from "../types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Props {
  sessionId: string | null;
}

const SHAPE_COLORS: Record<string, string> = {
  narrative: "bg-emerald-700 text-white",
  debugging: "bg-amber-600 text-white",
  exploratory: "bg-purple-600 text-white",
  janitorial: "bg-slate-500 text-white",
  review: "bg-blue-600 text-white",
};

export function SessionPanel({ sessionId }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setDetail(null);
      return;
    }
    fetchSessionDetail(sessionId).then(setDetail).catch(() => setDetail(null));
  }, [sessionId]);

  if (!sessionId) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Select a session to explore your execution memory
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  const { narrative, moments, transitions, outcomes } = detail;

  return (
    <ScrollArea className="h-full">
      <div className="max-w-2xl p-6 space-y-6">
        {/* Narrative */}
        {narrative && (
          <>
            <div className="flex items-center gap-3">
              <Badge className={SHAPE_COLORS[narrative.sessionShape] || "bg-muted"}>
                {narrative.sessionShape}
              </Badge>
              <span className="text-xs text-muted-foreground">{moments.length} moments</span>
              <span className="text-xs text-muted-foreground">{transitions.length} transitions</span>
            </div>

            <p className="text-sm leading-relaxed">{narrative.summary}</p>

            {/* Arcs */}
            {narrative.arcs.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Arcs</h3>
                {narrative.arcs.map((arc, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-sm font-medium">{arc.title}</span>
                    <Badge variant={arc.resolution === "resolved" ? "default" : "secondary"} className="text-[10px]">
                      {arc.resolution}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Moments */}
        {moments.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Moments</h3>
            {moments.map((m, i) => (
              <Card key={i} className="p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] uppercase">{m.type}</Badge>
                  <span className="text-[10px] text-muted-foreground">{m.agency}</span>
                </div>
                <p className="text-sm leading-relaxed">{m.statement}</p>
              </Card>
            ))}
          </div>
        )}

        {/* Outcomes */}
        {outcomes.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Outcomes</h3>
            {outcomes.map((o, i) => (
              <div key={i} className="text-sm pl-3 border-l-2 border-muted-foreground/20 py-1">
                {o.statement}
              </div>
            ))}
          </div>
        )}

        {/* Abandoned */}
        {narrative && narrative.abandonedDirections.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Abandoned</h3>
            {narrative.abandonedDirections.map((d, i) => (
              <div key={i} className="text-sm pl-3 border-l-2 border-amber-500/50 py-1 text-muted-foreground">
                {d}
              </div>
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
