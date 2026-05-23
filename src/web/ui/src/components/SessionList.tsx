import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import type { Session, TopicSummary } from "../types";

interface Props {
  sessions: Session[];
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
  topics: TopicSummary[];
  onTopicClick: (topicId: string) => void;
}

export function SessionList({
  sessions,
  selectedSessionId,
  onSelectSession,
  topics,
  onTopicClick,
}: Props) {
  // Sort sessions by date descending, then group by date
  const sorted = [...sessions].sort((a, b) => {
    const da = a.started_at ? new Date(a.started_at).getTime() : 0;
    const db = b.started_at ? new Date(b.started_at).getTime() : 0;
    return db - da;
  });

  const groups: [string, Session[]][] = [];
  const groupMap = new Map<string, number>();
  for (const s of sorted) {
    const date = s.started_at
      ? new Date(s.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "Unknown";
    const idx = groupMap.get(date);
    if (idx !== undefined) {
      groups[idx][1].push(s);
    } else {
      groupMap.set(date, groups.length);
      groups.push([date, [s]]);
    }
  }

  const getTitle = (s: Session) => {
    if (!s.narrative_summary) return "No narrative";
    const first = s.narrative_summary.split(/[.!?\n]/)[0];
    return first.length > 60 ? first.slice(0, 57) + "..." : first;
  };

  // Suppress unused warning — kept for future topic-based filtering
  void topics;

  return (
    <>
      {groups.map(([date, dateSessions]) => (
        <SidebarGroup key={date}>
          <SidebarGroupLabel>{date}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {dateSessions.map((s) => (
                <SidebarMenuItem key={s.id}>
                  <SidebarMenuButton
                    isActive={selectedSessionId === s.id}
                    onClick={() => onSelectSession(s.id)}
                    className="flex flex-col items-start h-auto py-2 gap-1"
                  >
                    <span className="font-medium text-sm truncate w-full">{getTitle(s)}</span>
                    <div className="flex items-center gap-1.5">
                      {s.session_shape && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 leading-4">
                          {s.session_shape}
                        </Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        {s.moment_count} moments
                      </span>
                    </div>
                    {s.topics && s.topics.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {s.topics.map((t) => (
                          <Badge
                            key={t.topicId}
                            variant="outline"
                            className="text-[9px] px-1 py-0 cursor-pointer hover:bg-accent"
                            onClick={(e: React.MouseEvent) => {
                              e.stopPropagation();
                              onTopicClick(t.topicId);
                            }}
                          >
                            {t.topicName}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}
