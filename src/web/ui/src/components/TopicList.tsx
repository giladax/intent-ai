import { useState } from "react";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronRight } from "lucide-react";
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

  // Build tree: roots (no parent) and children grouped by parent
  const roots = filtered.filter((t) => !t.parent_topic_id);
  const childrenByParent = new Map<string, TopicSummary[]>();
  for (const t of filtered) {
    if (t.parent_topic_id) {
      const list = childrenByParent.get(t.parent_topic_id) || [];
      list.push(t);
      childrenByParent.set(t.parent_topic_id, list);
    }
  }

  // If searching, show flat results (search breaks tree context)
  const isSearching = search.length > 0;

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="flex justify-between">
        <span>Brain</span>
        <span className="text-xs text-muted-foreground font-normal">{topics.length}</span>
      </SidebarGroupLabel>
      <div className="px-2 pb-2">
        <Input
          placeholder="Search..."
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

          {isSearching
            ? filtered.map((t) => (
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
              ))
            : roots.map((root) => {
                const children = childrenByParent.get(root.id) || [];
                if (children.length === 0) {
                  return (
                    <SidebarMenuItem key={root.id}>
                      <SidebarMenuButton
                        isActive={selectedTopicId === root.id}
                        onClick={() => onSelectTopic(root.id)}
                        className="flex flex-col items-start h-auto py-2"
                      >
                        <span className="font-medium text-sm truncate w-full">{root.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {root.insight_count} insights
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                }

                return (
                  <Collapsible key={root.id} defaultOpen className="group/collapsible">
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton
                          isActive={selectedTopicId === root.id}
                          onClick={() => onSelectTopic(root.id)}
                          className="flex items-center h-auto py-2"
                        >
                          <ChevronRight className="mr-1 h-3.5 w-3.5 shrink-0 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                          <div className="flex flex-col items-start min-w-0">
                            <span className="font-medium text-sm truncate w-full">{root.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {root.insight_count} insights
                            </span>
                          </div>
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {children.map((child) => (
                            <SidebarMenuSubItem key={child.id}>
                              <SidebarMenuSubButton
                                isActive={selectedTopicId === child.id}
                                onClick={() => onSelectTopic(child.id)}
                                className="flex flex-col items-start h-auto py-1.5"
                              >
                                <span className="text-sm truncate w-full">{child.name}</span>
                                <span className="text-xs text-muted-foreground">
                                  {child.insight_count} insights
                                </span>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                );
              })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
