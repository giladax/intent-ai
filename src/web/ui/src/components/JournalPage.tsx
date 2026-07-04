import { useCallback, useEffect, useRef, useState } from "react";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/newsreader/wght-italic.css";
import "./journal.css";
import { fetchJournal, fetchStatsOverview, approveObservation, rejectObservation } from "../api";
import type {
  Feature,
  JournalResponse,
  JournalEpisode,
  JournalBeat,
  JournalPendingItem,
  StatsOverview,
} from "../types";
import { FortnightStrip } from "./Quality";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, ChevronRight, Search, ArrowUpRight, X } from "lucide-react";

interface Props {
  repoId: string | null;
  features: Feature[];
  onSessionClick: (sessionId: string) => void;
  onFeatureClick: (featureId: string) => void;
  onReviewClick: () => void;
}

function formatSince(since: string | null): string {
  if (!since) return "the beginning";
  const d = new Date(since);
  if (Number.isNaN(d.getTime())) return "the beginning";
  return d.toLocaleString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Tone for the spine node, by episode kind. */
function nodeTone(ep: JournalEpisode): "red" | "moss" | undefined {
  if (ep.pending.length > 0 || ep.counts.consultMisses > 0) return "red";
  if (ep.kind === "review-batch") return "moss";
  return undefined;
}

function beatTone(beat: JournalBeat): "consult" | "red" | "moss" | undefined {
  if (beatIsMiss(beat.metadata)) return "red";
  const c = beat.category.toLowerCase();
  if (c.startsWith("mcp:")) return "consult";
  if (c.startsWith("review:") || c.includes("outcome")) return "moss";
  if (c.includes("struggle") || c.includes("blocker")) return "red";
  return undefined;
}

// ── Pulse — the masthead sentence ─────────────────────────────────────
function Pulse({
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
  const fig = (n: number) => <span className="j-fig">{n}</span>;

  return (
    <p className="j-pulse">
      <button data-active={clause === "sessions"} onClick={() => toggle("sessions")}>
        {fig(pulse.sessionsDigested)} session{pulse.sessionsDigested === 1 ? "" : "s"} digested
      </button>
      {", agents consulted the Brain "}
      <button data-active={clause === "consults"} onClick={() => toggle("consults")}>
        {fig(pulse.consults)} time{pulse.consults === 1 ? "" : "s"}
      </button>
      {pulse.consultMisses > 0 && (
        <span className="j-nowrap">
          {" ("}
          <button className="j-red-clause" data-active={clause === "misses"} onClick={() => toggle("misses")}>
            {fig(pulse.consultMisses)} miss{pulse.consultMisses === 1 ? "" : "es"}
          </button>
          {")"}
        </span>
      )}
      {"; the Brain noticed "}
      <button data-active={clause === "observations"} onClick={() => toggle("observations")}>
        {fig(pulse.observationsNoticed)} thing{pulse.observationsNoticed === 1 ? "" : "s"}
      </button>
      {pulse.pendingReview > 0 ? (
        <>
          {" — "}
          <button className="j-red-clause" onClick={onReview}>
            {fig(pulse.pendingReview)} await{pulse.pendingReview === 1 ? "s" : ""} your review
          </button>
        </>
      ) : (
        <>{" and nothing awaits review"}</>
      )}
      {pulse.learnings > 0 && (
        <>
          {"; "}
          <button className="j-moss-clause" data-active={clause === "learnings"} onClick={() => toggle("learnings")}>
            {fig(pulse.learnings)} learning{pulse.learnings === 1 ? "" : "s"} landed
          </button>
        </>
      )}
      {"."}
    </p>
  );
}

// ── Beat row ──────────────────────────────────────────────────────────
function BeatRow({ beat, onFeatureClick }: { beat: JournalBeat; onFeatureClick: (id: string) => void }) {
  const miss = beatIsMiss(beat.metadata);
  const time = new Date(beat.timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const featureId = typeof beat.metadata?.["featureId"] === "string" ? (beat.metadata["featureId"] as string) : null;
  return (
    <div
      className="j-beat"
      data-talk
      data-talk-kind="event"
      data-talk-id={beat.id}
      data-talk-label={beatLabel(beat.category) || beat.category}
      data-talk-summary={beat.summary}
    >
      <span className="j-beat-time">{time}</span>
      <span className="j-beat-glyph" data-tone={beatTone(beat)}>
        {beatGlyph(beat.category)}
      </span>
      <div className="j-beat-body">
        <span className="j-beat-kind">{beatLabel(beat.category)}</span>
        {miss && <span className="j-beat-miss">miss</span>}
        {beat.summary}
        {featureId && (
          <button className="j-feature-tag ml-2 align-middle" onClick={() => onFeatureClick(featureId)}>
            feature
          </button>
        )}
      </div>
    </div>
  );
}

// ── Rollup line ───────────────────────────────────────────────────────
function Rollup({ ep }: { ep: JournalEpisode }) {
  const parts: React.ReactNode[] = [];
  const dur = formatDuration(ep.startedAt, ep.endedAt);
  if (dur) parts.push(dur);
  if (ep.counts.moments > 0) parts.push(`${ep.counts.moments} moment${ep.counts.moments === 1 ? "" : "s"}`);
  if (ep.counts.consults > 0) {
    parts.push(
      <span key="c">
        consulted {ep.counts.consults}×
        {ep.counts.consultMisses > 0 && (
          <span className="j-miss-fig">
            {" "}
            ({ep.counts.consultMisses} miss{ep.counts.consultMisses === 1 ? "" : "es"})
          </span>
        )}
      </span>,
    );
  }
  if (ep.counts.observations > 0)
    parts.push(`${ep.counts.observations} observation${ep.counts.observations === 1 ? "" : "s"}`);
  if (parts.length === 0) return null;
  return (
    <p className="j-rollup">
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span> · </span>}
          {p}
        </span>
      ))}
    </p>
  );
}

// ── Episode entry ─────────────────────────────────────────────────────
function Entry({
  ep,
  index,
  busyPending,
  featureNames,
  onApprove,
  onReject,
  onSessionClick,
  onFeatureClick,
}: {
  ep: JournalEpisode;
  index: number;
  busyPending: string | null;
  featureNames: Map<string, string>;
  onApprove: (p: JournalPendingItem, ep: JournalEpisode) => void;
  onReject: (p: JournalPendingItem, ep: JournalEpisode) => void;
  onSessionClick: (sessionId: string) => void;
  onFeatureClick: (featureId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const time = new Date(ep.startedAt).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const sessionId = ep.kind === "session" ? ep.id.slice("session:".length) : null;

  return (
    <article
      className="j-entry j-rise"
      style={{ "--i": index } as React.CSSProperties}
      data-talk
      data-talk-kind="episode"
      data-talk-id={ep.id}
      data-talk-label={ep.title || `${ep.kind} ${shortId(ep.id)}`}
      data-talk-summary={`${ep.kind} by ${ep.actor}`}
    >
      <span className="j-node" data-tone={nodeTone(ep)} title={ep.actor}>
        {episodeGlyph(ep.kind)}
      </span>

      <div className="j-meta">
        <span className="j-time">{time}</span>
        <span>{ep.kind === "review-batch" ? "review" : ep.kind}</span>
        <span className="truncate normal-case tracking-normal">{ep.actor}</span>
        {sessionId && (
          <button className="j-open-link" onClick={() => onSessionClick(sessionId)}>
            open session <ArrowUpRight className="size-3" />
          </button>
        )}
      </div>

      <h4 className="j-title">{ep.title || `Session ${shortId(ep.id)}`}</h4>

      <Rollup ep={ep} />

      {ep.featureIds.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ep.featureIds.map((fid) => (
            <button key={fid} className="j-feature-tag" onClick={() => onFeatureClick(fid)}>
              {featureNames.get(fid) ?? shortId(fid)}
            </button>
          ))}
        </div>
      )}

      {/* pending observations — red-ink margin notes; the gate meets you where you read */}
      {ep.pending.map((p) => {
        const busy = busyPending === p.id;
        return (
          <div
            key={p.id}
            className="j-margin-note"
            data-talk
            data-talk-kind="observation"
            data-talk-id={p.id}
            data-talk-label={beatLabel(p.category) || "observation"}
            data-talk-summary={p.summary}
          >
            <div className="j-margin-note-label">{beatLabel(p.category) || "observation"} · awaiting review</div>
            <p className="j-margin-note-text">{p.summary}</p>
            <div className="mt-2.5 flex items-center gap-2">
              <button className="j-stamp j-stamp-approve" disabled={busy} onClick={() => onApprove(p, ep)}>
                Approve
              </button>
              <button className="j-stamp j-stamp-reject" disabled={busy} onClick={() => onReject(p, ep)}>
                Reject
              </button>
              {p.featureId && (
                <button className="j-feature-tag" onClick={() => onFeatureClick(p.featureId as string)}>
                  {featureNames.get(p.featureId) ?? "feature"}
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* beats — once inside, the story reads forward */}
      {ep.beats.length > 0 && (
        <>
          <button className="j-expand" onClick={() => setExpanded((v) => !v)}>
            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            {expanded ? "close" : `read the ${ep.beats.length} beat${ep.beats.length === 1 ? "" : "s"}`}
          </button>
          <div className="j-beats-clip" data-open={expanded}>
            <div>
              <div className="j-beats">
                {ep.beats.map((b) => (
                  <BeatRow key={b.id} beat={b} onFeatureClick={onFeatureClick} />
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </article>
  );
}

// ── Page ──────────────────────────────────────────────────────────────
export function JournalPage({ repoId, features, onSessionClick, onFeatureClick, onReviewClick }: Props) {
  const [data, setData] = useState<JournalResponse | null>(null);
  const [stats, setStats] = useState<StatsOverview | null>(null);
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

  // the altitude layer — cadence for the fortnight strip (fail-safe chrome)
  useEffect(() => {
    fetchStatsOverview(repoId ?? undefined).then(setStats).catch(() => setStats(null));
  }, [repoId]);

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
      <div className="journal-page h-full overflow-y-auto">
        <div className="mx-auto max-w-2xl px-8 py-12">
          <div className="j-kicker j-rise" style={{ "--i": 0 } as React.CSSProperties}>
            The repo, narrated
          </div>
          <div className="j-empty">The Journal is being written&hellip;</div>
        </div>
      </div>
    );
  }

  const actorOptions = Array.from(new Set(data.episodes.map((e) => e.actor))).sort();

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
  // stagger index across the whole render, capped inside the CSS
  let stagger = 0;

  return (
    <div className="journal-page h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-8 pb-24 pt-12">
        {/* masthead */}
        <header>
          <div className="j-rise flex items-baseline justify-between gap-4" style={{ "--i": 0 } as React.CSSProperties}>
            <span className="j-kicker">The repo, narrated</span>
            <span className="j-chrome">since {formatSince(data.pulse.since ?? lastLooked)}</span>
          </div>
          <h1 className="j-masthead-title j-rise mt-2" style={{ "--i": 1 } as React.CSSProperties}>
            Journal
          </h1>
          {/* the fortnight — cadence at C-level altitude, every bar a real day */}
          {stats && stats.cadenceSummary.totalEvents > 0 && (
            <div className="j-rise mt-3" style={{ "--i": 1 } as React.CSSProperties}>
              <FortnightStrip cadence={stats.cadence} summary={stats.cadenceSummary} />
            </div>
          )}
          <div className="j-rule-double j-rise mt-4" style={{ "--i": 1 } as React.CSSProperties} />
          <div className="j-rise mt-5" style={{ "--i": 2 } as React.CSSProperties}>
            <Pulse pulse={data.pulse} clause={clause} onClause={setClause} onReview={onReviewClick} />
          </div>
        </header>

        {error && (
          <p className="j-chrome mt-4 italic">The journal endpoint isn&rsquo;t answering yet — the river runs empty.</p>
        )}

        {/* quiet chrome: lenses */}
        <div className="j-rise mt-7 flex flex-wrap items-center gap-2" style={{ "--i": 3 } as React.CSSProperties}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="j-chip" data-active={!!actor}>
                {actor ?? "all actors"} <ChevronDown className="size-3" />
              </button>
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
              <button className="j-chip" data-active={!!featureId}>
                {selectedFeatureName ?? "all features"} <ChevronDown className="size-3" />
              </button>
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

          {clause && (
            <button className="j-chip" data-active="true" onClick={() => setClause(null)}>
              lens: {clause} <X className="size-3" />
            </button>
          )}

          <div className="relative min-w-[9rem] flex-1">
            <Search className="pointer-events-none absolute left-1 top-1/2 size-3 -translate-y-1/2" style={{ color: "var(--j-faint)" }} />
            <input
              className="j-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="search the river…"
            />
          </div>
        </div>

        {/* the river */}
        {filtered.length === 0 ? (
          <div className="j-empty j-rise" style={{ "--i": 4 } as React.CSSProperties}>
            The river is quiet. Work a session with the Brain enabled,
            <br />
            and the Journal will narrate it here.
          </div>
        ) : (
          <div className="j-river mt-8 space-y-2">
            {chapters.map((chapter) => (
              <section key={chapter.key} className="space-y-1 pb-4">
                <div className="j-runhead j-rise py-2" style={{ "--i": Math.min(++stagger, 14) } as React.CSSProperties}>
                  <span className="j-runhead-date">{chapter.label}</span>
                  <span className="j-runhead-count">
                    {chapter.episodes.length} entr{chapter.episodes.length === 1 ? "y" : "ies"}
                  </span>
                </div>

                {chapter.episodes.map((ep) => {
                  const showLineBefore = unreadAt !== null && seen === unreadAt;
                  seen++;
                  return (
                    <div key={ep.id}>
                      {showLineBefore && (
                        <div className="j-unread j-rise">
                          <span>you last looked here</span>
                        </div>
                      )}
                      <Entry
                        ep={ep}
                        index={Math.min(++stagger, 14)}
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
              </section>
            ))}
          </div>
        )}
      </div>
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
