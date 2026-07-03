import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJournal, approveObservation, rejectObservation } from "../api";
import type {
  Feature,
  JournalResponse,
  JournalEpisode,
  JournalBeat,
  JournalPendingItem,
} from "../types";
import {
  groupByDay,
  showUnreadLine,
  matchesClause,
  matchesSearch,
  formatDuration,
  shortId,
  episodeGlyph,
  beatGlyph,
  beatLabel,
  beatIsMiss,
  type ClauseFilter,
} from "./journal-util";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Search,
  ExternalLink,
  BookOpen,
} from "lucide-react";

interface Props {
  repoId: string | null;
  features: Feature[];
  onSessionClick: (sessionId: string) => void;
  onFeatureClick: (featureId: string) => void;
  onReviewClick: () => void;
}

function formatSince(since: string | null): string {
  if (!since) return "you last looked";
  const d = new Date(since);
  if (Number.isNaN(d.getTime())) return "you last looked";
  return d.toLocaleString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Pulse strip ───────────────────────────────────────────────────────
function PulseStrip({
  pulse,
  clause,
  onClause,
  onReview,
}: {
  pulse: JournalResponse["pulse"];
  clause: ClauseFilter | null;
  onClause: (c: ClauseFilter | null) => void;
  onReview: () => void;
}) {
  const toggle = (c: ClauseFilter) => onClause(clause === c ? null : c);
  const link = "underline decoration-dotted underline-offset-4 hover:text-foreground transition-colors";

  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Pulse · since {formatSince(pulse.since)}
      </div>
      <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">
        <button className={link} onClick={() => toggle("sessions")}>
          {pulse.sessionsDigested} session{pulse.sessionsDigested === 1 ? "" : "s"} digested
        </button>
        {" · agents consulted Brain "}
        <button className={link} onClick={() => toggle("consults")}>
          {pulse.consults}×
        </button>
        {pulse.consultMisses > 0 && (
          <>
            {" ("}
            <button className={`${link} text-amber-600 dark:text-amber-500`} onClick={() => toggle("misses")}>
              {pulse.consultMisses} miss{pulse.consultMisses === 1 ? "" : "es"}
            </button>
            {")"}
          </>
        )}
        {" · Brain noticed "}
        <button className={link} onClick={() => toggle("observations")}>
          {pulse.observationsNoticed} thing{pulse.observationsNoticed === 1 ? "" : "s"}
        </button>
        {pulse.pendingReview > 0 ? (
          <>
            {", "}
            <button className={`${link} font-medium text-foreground`} onClick={onReview}>
              {pulse.pendingReview} await your review
            </button>
          </>
        ) : (
          <>{" · nothing awaits review"}</>
        )}
        {" · "}
        <button className={link} onClick={() => toggle("learnings")}>
          {pulse.learnings} learning{pulse.learnings === 1 ? "" : "s"}
        </button>
        {pulse.reviewActions > 0 && ` · ${pulse.reviewActions} review action${pulse.reviewActions === 1 ? "" : "s"}`}
        {"."}
      </p>
    </div>
  );
}

// ── Beat row (expanded episode) ───────────────────────────────────────
function BeatRow({ beat, onFeatureClick }: { beat: JournalBeat; onFeatureClick: (id: string) => void }) {
  const miss = beatIsMiss(beat.metadata);
  const time = new Date(beat.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const featureId = typeof beat.metadata?.["featureId"] === "string" ? (beat.metadata["featureId"] as string) : null;
  return (
    <div className="flex gap-2.5 text-sm">
      <span className="w-11 shrink-0 pt-px text-right font-mono text-[11px] tabular-nums text-muted-foreground">
        {time}
      </span>
      <span className={`shrink-0 select-none ${miss ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground"}`}>
        {beatGlyph(beat.category)}
      </span>
      <div className="min-w-0 flex-1 pb-1">
        <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {beatLabel(beat.category)}
        </span>
        {miss && (
          <span className="mr-1.5 rounded bg-amber-500/15 px-1 text-[10px] font-semibold uppercase text-amber-600 dark:text-amber-500">
            miss
          </span>
        )}
        <span className="leading-relaxed">{beat.summary}</span>
        {featureId && (
          <button
            className="ml-1.5 text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
            onClick={() => onFeatureClick(featureId)}
          >
            feature ↗
          </button>
        )}
      </div>
    </div>
  );
}

// ── Rollup line ───────────────────────────────────────────────────────
function rollupParts(ep: JournalEpisode): string[] {
  const parts: string[] = [];
  const dur = formatDuration(ep.startedAt, ep.endedAt);
  if (dur) parts.push(dur);
  if (ep.counts.moments > 0) parts.push(`${ep.counts.moments} moment${ep.counts.moments === 1 ? "" : "s"}`);
  if (ep.counts.consults > 0) {
    const miss = ep.counts.consultMisses > 0 ? ` (${ep.counts.consultMisses} miss${ep.counts.consultMisses === 1 ? "" : "es"})` : "";
    parts.push(`consulted Brain ${ep.counts.consults}×${miss}`);
  }
  if (ep.counts.observations > 0) parts.push(`raised ${ep.counts.observations} observation${ep.counts.observations === 1 ? "" : "s"}`);
  return parts;
}

// ── Episode card ──────────────────────────────────────────────────────
function EpisodeCard({
  ep,
  busyPending,
  featureNames,
  onApprove,
  onReject,
  onSessionClick,
  onFeatureClick,
}: {
  ep: JournalEpisode;
  busyPending: string | null;
  featureNames: Map<string, string>;
  onApprove: (p: JournalPendingItem, ep: JournalEpisode) => void;
  onReject: (p: JournalPendingItem, ep: JournalEpisode) => void;
  onSessionClick: (sessionId: string) => void;
  onFeatureClick: (featureId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const time = new Date(ep.startedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const parts = rollupParts(ep);
  const sessionId = ep.kind === "session" ? ep.id.slice("session:".length) : null;
  const hasBeats = ep.beats.length > 0;

  return (
    <Card className="p-4">
      <div className="flex gap-3">
        {/* actor glyph rail */}
        <div className="flex w-6 shrink-0 flex-col items-center pt-0.5">
          <span className="text-lg leading-none text-muted-foreground select-none" title={ep.actor}>
            {episodeGlyph(ep.kind)}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="font-mono tabular-nums">{time}</span>
            <span className="font-semibold uppercase tracking-wider">{ep.kind === "review-batch" ? "review" : ep.kind}</span>
            <span className="truncate">· {ep.actor}</span>
            {sessionId && (
              <button
                className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                onClick={() => onSessionClick(sessionId)}
              >
                open <ExternalLink className="size-3" />
              </button>
            )}
          </div>

          <p className="mt-1 text-[15px] font-medium leading-snug text-foreground">
            {ep.title || `Session ${shortId(ep.id)}`}
          </p>

          {parts.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">{parts.join(" · ")}</p>
          )}

          {/* feature deep links */}
          {ep.featureIds.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ep.featureIds.map((fid) => (
                <Badge
                  key={fid}
                  variant="outline"
                  className="cursor-pointer text-[10px] hover:bg-accent"
                  onClick={() => onFeatureClick(fid)}
                >
                  {featureNames.get(fid) ?? fid}
                </Badge>
              ))}
            </div>
          )}

          {/* inline pending observations — the gate meets you where you read */}
          {ep.pending.length > 0 && (
            <div className="mt-3 space-y-2">
              {ep.pending.map((p) => {
                const busy = busyPending === p.id;
                return (
                  <div key={p.id} className="rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 p-2.5">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-500">
                      <span className="size-1.5 rounded-full bg-amber-500" />
                      {beatLabel(p.category) || "observation"} · pending
                    </div>
                    <p className="mt-1 text-sm leading-relaxed">{p.summary}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <Button size="sm" disabled={busy} onClick={() => onApprove(p, ep)}>
                        <Check className="mr-1 size-3.5" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => onReject(p, ep)}>
                        <X className="mr-1 size-3.5" /> Reject
                      </Button>
                      {p.featureId && (
                        <button
                          className="text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
                          onClick={() => onFeatureClick(p.featureId as string)}
                        >
                          feature ↗
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* expand into beats — once inside, the story reads forward */}
          {hasBeats && (
            <>
              <button
                className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                {expanded ? "collapse" : `expand ${ep.beats.length} beat${ep.beats.length === 1 ? "" : "s"}`}
              </button>
              {expanded && (
                <div className="mt-2 space-y-0.5 border-l pl-3">
                  {ep.beats.map((b) => (
                    <BeatRow key={b.id} beat={b} onFeatureClick={onFeatureClick} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────
export function JournalPage({ repoId, features, onSessionClick, onFeatureClick, onReviewClick }: Props) {
  const [data, setData] = useState<JournalResponse | null>(null);
  const [error, setError] = useState(false);
  const [clause, setClause] = useState<ClauseFilter | null>(null);
  const [actor, setActor] = useState<string | null>(null);
  const [featureId, setFeatureId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busyPending, setBusyPending] = useState<string | null>(null);

  const [lastLooked, setLastLooked] = useState<string | null>(null);
  const capturedRef = useRef(false);
  const cursorKey = `journal:lastLooked:${repoId ?? "default"}`;

  // reset the read-cursor capture when switching repos
  useEffect(() => {
    capturedRef.current = false;
    setLastLooked(null);
  }, [cursorKey]);

  const load = useCallback(() => {
    setData(null);
    setError(false);
    fetchJournal({ actor: actor ?? undefined, featureId: featureId ?? undefined, limit: 200 })
      .then(setData)
      .catch(() => {
        setError(true);
        setData({ pulse: emptyPulse(), episodes: [] });
      });
    // repoId participates so a project switch refetches
  }, [actor, featureId, repoId]);

  useEffect(() => {
    load();
  }, [load]);

  // capture the previous read-cursor once, then advance it to newest
  useEffect(() => {
    if (!data) return;
    if (!capturedRef.current) {
      capturedRef.current = true;
      setLastLooked(localStorage.getItem(cursorKey));
    }
    const newest = data.episodes[0]?.startedAt;
    if (newest) {
      try {
        localStorage.setItem(cursorKey, newest);
      } catch {
        /* ignore quota / disabled storage */
      }
    }
  }, [data, cursorKey]);

  const resolvePending = useCallback(
    async (p: JournalPendingItem, ep: JournalEpisode, fn: (id: string) => Promise<unknown>) => {
      setBusyPending(p.id);
      try {
        await fn(p.id);
        setData((prev) => {
          if (!prev) return prev;
          return {
            pulse: { ...prev.pulse, pendingReview: Math.max(0, prev.pulse.pendingReview - 1) },
            episodes: prev.episodes.map((e) =>
              e.id === ep.id ? { ...e, pending: e.pending.filter((x) => x.id !== p.id) } : e,
            ),
          };
        });
      } catch {
        /* leave the item in place on failure */
      } finally {
        setBusyPending(null);
      }
    },
    [],
  );

  if (data === null) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  // actor options derived from the loaded window
  const actorOptions = Array.from(new Set(data.episodes.map((e) => e.actor))).sort();

  // apply client-side lenses (clause + search + defensive actor/feature filters)
  const filtered = data.episodes.filter(
    (e) =>
      matchesClause(e, clause) &&
      matchesSearch(e, search) &&
      (!actor || e.actor === actor) &&
      (!featureId || e.featureIds.includes(featureId)),
  );

  const chapters = groupByDay(filtered);
  const unreadAt = showUnreadLine(filtered, lastLooked);
  const featureNames = new Map(features.map((f) => [f.id, f.name] as const));
  const selectedFeatureName = featureId ? featureNames.get(featureId) : undefined;

  // running index across chapters so the unread divider lands at the right seam
  let seen = 0;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <BookOpen className="size-5" /> Journal
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Brain narrating itself — sessions, consults, and learnings as a river you catch up on.
        </p>
      </div>

      <PulseStrip pulse={data.pulse} clause={clause} onClause={setClause} onReview={onReviewClick} />

      {error && (
        <p className="text-xs text-muted-foreground">
          The journal endpoint isn't answering yet — showing an empty river.
        </p>
      )}

      {/* filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
              {actor ?? "all actors"} <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
            <DropdownMenuItem onClick={() => setActor(null)}>all actors</DropdownMenuItem>
            {actorOptions.map((a) => (
              <DropdownMenuItem key={a} onClick={() => setActor(a)}>
                {a}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
              {selectedFeatureName ?? "all features"} <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
            <DropdownMenuItem onClick={() => setFeatureId(null)}>all features</DropdownMenuItem>
            {features.map((f) => (
              <DropdownMenuItem key={f.id} onClick={() => setFeatureId(f.id)}>
                {f.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="relative flex-1 min-w-[8rem]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="search the river"
            className="h-8 pl-8 text-xs"
          />
        </div>

        {clause && (
          <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={() => setClause(null)}>
            showing: {clause} <X className="size-3" />
          </Button>
        )}
      </div>

      {/* river */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <BookOpen className="size-8" />
          <p className="text-sm">Nothing in this window yet.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {chapters.map((chapter) => (
            <div key={chapter.key} className="space-y-3">
              <div className="flex items-center gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {chapter.label}
                </h3>
                <span className="h-px flex-1 bg-border" />
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {chapter.episodes.length} episode{chapter.episodes.length === 1 ? "" : "s"}
                </span>
              </div>

              {chapter.episodes.map((ep) => {
                const showLineBefore = unreadAt !== null && seen === unreadAt;
                seen++;
                return (
                  <div key={ep.id} className="space-y-3">
                    {showLineBefore && (
                      <div className="flex items-center gap-3 py-1">
                        <span className="h-px flex-1 bg-border" />
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          you last looked here
                        </span>
                        <span className="h-px flex-1 bg-border" />
                      </div>
                    )}
                    <EpisodeCard
                      ep={ep}
                      busyPending={busyPending}
                      featureNames={featureNames}
                      onApprove={(p, e) => resolvePending(p, e, approveObservation)}
                      onReject={(p, e) => resolvePending(p, e, rejectObservation)}
                      onSessionClick={onSessionClick}
                      onFeatureClick={onFeatureClick}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function emptyPulse(): JournalResponse["pulse"] {
  return {
    since: null,
    sessionsDigested: 0,
    consults: 0,
    consultMisses: 0,
    observationsNoticed: 0,
    pendingReview: 0,
    reviewActions: 0,
    learnings: 0,
  };
}
