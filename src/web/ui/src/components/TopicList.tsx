import { useState } from "react";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import type { TopicSummary } from "../types";

interface Props {
  topics: TopicSummary[];
  selectedTopicId: string | null;
  onSelectTopic: (id: string) => void;
}

export function TopicList({ topics, selectedTopicId, onSelectTopic }: Props) {
  const [search, setSearch] = useState("");

  const filtered = topics.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="flex justify-between">
        <span>Topics</span>
        <span className="text-xs text-muted-foreground font-normal">{topics.length}</span>
      </SidebarGroupLabel>
      <div className="px-2 pb-2">
        <Input
          placeholder="Search topics..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-7 text-xs"
        />
      </div>
      <SidebarGroupContent>
        <SidebarMenu>
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              {topics.length === 0 ? (
                <>
                  No topics yet. Run{" "}
                  <code className="bg-muted px-1 rounded text-[11px]">intent brain</code> to
                  synthesize.
                </>
              ) : (
                "No matching topics."
              )}
            </div>
          )}
          {filtered.map((t) => (
            <SidebarMenuItem key={t.id}>
              <SidebarMenuButton
                isActive={selectedTopicId === t.id}
                onClick={() => onSelectTopic(t.id)}
                className="flex flex-col items-start h-auto py-2"
              >
                <span className="font-medium text-sm truncate w-full">{t.name}</span>
                <span className="text-xs text-muted-foreground">
                  {t.insight_count} insights · {t.session_count} sessions
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
