import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { BrainCard } from "../types";

interface Props {
  card: BrainCard;
  onNavigate: (nodeName: string) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  structure: "bg-emerald-600 text-white",
  decision: "bg-blue-500 text-white",
  constraint: "bg-amber-500 text-white",
  behavior: "bg-purple-500 text-white",
  risk: "bg-red-500 text-white",
  interface: "bg-slate-500 text-white",
};

const CATEGORY_ORDER = ["structure", "constraint", "decision", "behavior", "risk", "interface"];

function categoryColor(cat: string): string {
  return CATEGORY_COLORS[cat] ?? "bg-muted text-muted-foreground";
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

export function BrainCardView({ card, onNavigate }: Props) {
  const insights = card.insights ?? [];
  // Pick one per category, ordered by CATEGORY_ORDER, up to 3 total
  const topInsights: typeof insights = [];
  const seen = new Set<string>();
  for (const cat of CATEGORY_ORDER) {
    if (topInsights.length >= 3) break;
    const match = insights.find((i) => i.category === cat && !seen.has(cat));
    if (match) {
      topInsights.push(match);
      seen.add(cat);
    }
  }
  // Fill remaining slots from uncovered categories
  if (topInsights.length < 3) {
    for (const i of insights) {
      if (topInsights.length >= 3) break;
      if (!seen.has(i.category ?? "")) {
        topInsights.push(i);
        seen.add(i.category ?? "");
      }
    }
  }

  const children = card.children ?? [];
  const files = card.files ?? [];
  const sessions = card.sessions ?? [];

  return (
    <Card className="p-4 space-y-3 border-l-2 border-l-primary/30">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-base font-semibold leading-tight">{card.node_name}</h3>
          {card.parent_node && (
            <button
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              onClick={() => onNavigate(card.parent_node!)}
              title={`Navigate to ${card.parent_node}`}
            >
              <span className="text-muted-foreground/60">↑</span>
              <span>{card.parent_node}</span>
            </button>
          )}
          <Badge variant="outline" className="text-[10px] ml-auto shrink-0">{card.level}</Badge>
        </div>
        {card.summary && (
          <p className="text-sm text-muted-foreground leading-relaxed mt-1">
            {truncate(card.summary, 220)}
          </p>
        )}
      </div>

      {/* Top insights — truncated for scanability */}
      {topInsights.length > 0 && (
        <ul className="space-y-1.5">
          {topInsights.map((ins, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <Badge className={`text-[10px] shrink-0 mt-0.5 ${categoryColor(ins.category ?? "")}`}>
                {ins.category ?? "insight"}
              </Badge>
              <span className="leading-snug text-foreground/90">
                {truncate(ins.statement ?? "", 120)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Footer: children / files / sessions */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground border-t pt-2">
        {children.length > 0 && (
          <span>
            {children.length} sub-spec{children.length !== 1 ? "s" : ""}:{" "}
            {children.slice(0, 3).map((c, i) => (
              <span key={c}>
                <button
                  className="underline underline-offset-2 hover:text-foreground transition-colors"
                  onClick={() => onNavigate(c)}
                >
                  {c}
                </button>
                {i < Math.min(children.length, 3) - 1 ? ", " : ""}
              </span>
            ))}
            {children.length > 3 && ` +${children.length - 3} more`}
          </span>
        )}
        {files.length > 0 && (
          <span>{files.length} file{files.length !== 1 ? "s" : ""}</span>
        )}
        {sessions.length > 0 && (
          <span>{sessions.length} session{sessions.length !== 1 ? "s" : ""}</span>
        )}
      </div>
    </Card>
  );
}
