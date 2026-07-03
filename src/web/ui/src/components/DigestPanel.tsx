// The intake — new Claude Code sessions become journal entries.
// Digest now (SSE progress), or set the press schedule: how often to scan,
// and how long a session must be quiet before it's considered finished.
import { useEffect, useState } from "react";
import { fetchDigestSchedule, saveDigestSchedule, type DigestSchedule } from "../api";
import { Zap, CalendarClock } from "lucide-react";

interface Props {
  repoId: string;
  undigestedCount: number;
  onDone: () => void;
}

export function DigestPanel({ repoId, undigestedCount, onDone }: Props) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [digested, setDigested] = useState<number | null>(null);
  const [schedule, setSchedule] = useState<DigestSchedule | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchDigestSchedule().then(setSchedule).catch(() => setSchedule(null));
  }, []);

  const digestNow = async () => {
    setRunning(true);
    setDigested(null);
    setProgress("Opening the mailbag…");
    try {
      const res = await fetch("/api/brain/digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId }),
      });
      const reader = res.body?.getReader();
      if (!reader) throw new Error("no stream");
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.message) setProgress(ev.message);
            if (ev.phase === "done") setDigested(ev.digestedCount ?? 0);
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      setProgress(`The intake jammed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  };

  const updateSchedule = async (patch: Partial<DigestSchedule>) => {
    if (!schedule) return;
    const next = { ...schedule, ...patch };
    setSchedule(next);
    setSaving(true);
    try {
      const saved = await saveDigestSchedule(next);
      setSchedule(saved);
    } catch { /* keep optimistic state */ }
    setSaving(false);
  };

  return (
    <div className="mx-auto max-w-2xl px-8 pb-24 pt-12">
      <header>
        <span className="ink-kicker ink-rise" style={{ "--i": 0 } as React.CSSProperties}>
          The intake — sessions become journal entries
        </span>
        <h1 className="ink-masthead ink-rise mt-2" style={{ "--i": 1 } as React.CSSProperties}>Digest</h1>
        <div className="ink-rule-double ink-rise mt-4" style={{ "--i": 1 } as React.CSSProperties} />
        <p className="ink-deck ink-rise mt-4" style={{ "--i": 2 } as React.CSSProperties}>
          {digested !== null ? (
            <>Done — <span style={{ fontStyle: "normal", fontWeight: 600, color: "var(--j-moss)" }}>{digested}</span> session{digested === 1 ? "" : "s"} entered the river.</>
          ) : undigestedCount > 0 ? (
            <><span style={{ fontStyle: "normal", fontWeight: 600, color: "var(--j-red)" }}>{undigestedCount}</span> session{undigestedCount === 1 ? "" : "s"} waiting to be read.</>
          ) : (
            <>The journal is current — every finished session has been read.</>
          )}
        </p>
      </header>

      {/* digest now */}
      <section className="ink-rise mt-10" style={{ "--i": 3 } as React.CSSProperties}>
        <h3 className="ink-section"><Zap className="mr-1 inline size-3" />Now</h3>
        <div className="mt-4 flex items-center gap-3">
          <button
            className="ink-stamp ink-stamp--approve"
            disabled={running || (undigestedCount === 0 && digested === null)}
            onClick={digestNow}
          >
            {running ? "Reading…" : `Digest ${undigestedCount > 0 ? undigestedCount + " " : ""}now`}
          </button>
          {digested !== null && !running && (
            <button className="ink-stamp ink-stamp--quiet" onClick={onDone}>Open the Journal</button>
          )}
        </div>
        {progress && (
          <p className="ink-chrome mt-3 italic">{progress}</p>
        )}
      </section>

      {/* the press schedule */}
      <section className="ink-rise mt-10" style={{ "--i": 4 } as React.CSSProperties}>
        <h3 className="ink-section"><CalendarClock className="mr-1 inline size-3" />The press schedule</h3>
        {schedule === null ? (
          <p className="ink-chrome mt-3 italic">Loading the schedule…</p>
        ) : (
          <div className="mt-4 space-y-4">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={schedule.enabled}
                onChange={(e) => updateSchedule({ enabled: e.target.checked })}
                className="size-3.5 accent-current"
                style={{ accentColor: "var(--j-moss)" }}
              />
              <span className="ink-prose" style={{ fontSize: "0.95rem" }}>
                Run the press automatically{saving ? " (saving…)" : ""}
              </span>
            </label>

            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-3 ink-prose" style={{ fontSize: "0.95rem", opacity: schedule.enabled ? 1 : 0.45 }}>
              <span>Check every</span>
              <input
                type="number"
                min={1}
                max={1440}
                value={schedule.intervalMinutes}
                disabled={!schedule.enabled}
                onChange={(e) => updateSchedule({ intervalMinutes: Number(e.target.value) })}
                className="ink-input text-center"
                style={{ fontFamily: "var(--j-mono)", width: "3.5rem" }}
              />
              <span>minutes, and only read sessions quiet for</span>
              <input
                type="number"
                min={0}
                max={120}
                value={schedule.debounceMinutes}
                disabled={!schedule.enabled}
                onChange={(e) => updateSchedule({ debounceMinutes: Number(e.target.value) })}
                className="ink-input text-center"
                style={{ fontFamily: "var(--j-mono)", width: "3.5rem" }}
              />
              <span>minutes — a session still typing isn&rsquo;t finished.</span>
            </div>

            {schedule.lastRun && (
              <p className="ink-chrome italic">
                Last pass {new Date(schedule.lastRun.at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} —
                {" "}{schedule.lastRun.digested} digested{schedule.lastRun.skippedLive > 0 ? `, ${schedule.lastRun.skippedLive} still live` : ""}.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
