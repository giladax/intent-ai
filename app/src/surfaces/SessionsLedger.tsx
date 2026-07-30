import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchSessions,
  fetchSessionsLedger,
  type LedgerSession,
  type SessionsLedgerData,
} from "../api";
import type { Session } from "../types";
import { VerdictBadge } from "../ink/Badge";

/** The sessions ledger — the org's AI work, remembered.
 *
 *  Two audiences, one list: each row is somebody's session (their prompts,
 *  kept), and the header strip is the org read — how AI effort distributes
 *  across repos. Effort proxies only (sessions, turns, files touched);
 *  no invented spend — that integration is roadmap and the footer says so. */
export function SessionsLedger() {
  const [ledger, setLedger] = useState<SessionsLedgerData | null>(null);
  const [journal, setJournal] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    Promise.allSettled([fetchSessionsLedger(), fetchSessions()]).then(([l, j]) => {
      if (!live) return;
      if (l.status === "fulfilled") setLedger(l.value);
      if (j.status === "fulfilled") setJournal(j.value);
      setLoading(false);
    });
    return () => { live = false; };
  }, []);

  const repoShare = useMemo(() => {
    if (!ledger || ledger.by_repo.length === 0) return [];
    const total = Math.max(1, ledger.by_repo.reduce((s, r) => s + r.turns, 0));
    return ledger.by_repo.map((r, i) => ({
      ...r,
      pct: Math.max(4, Math.round((r.turns / total) * 100)),
      tone: SHARE_TONES[i % SHARE_TONES.length],
    }));
  }, [ledger]);

  if (loading) {
    return <main className="ink-main"><div className="ink-empty">Opening the ledger…</div></main>;
  }

  const rows = ledger?.sessions ?? [];

  return (
    <main className="ink-main sx-room">
      <div className="ink-crumb"><b>Quire</b> <span className="sep">/</span> Sessions</div>
      <div className="sx-column sx-column--wide">
        <header className="sx-head">
          <div className="ink-kicker ink-rise" style={vi(0)}>The ledger</div>
          <h1 className="ink-masthead ink-rise" style={vi(1)}>Sessions, remembered</h1>
          <p className="ink-deck ink-rise" style={vi(2)}>
            Every uploaded coding session — the prompts your people crafted, the
            work the agents did, and where that effort went.
          </p>

          {ledger && ledger.totals.sessions > 0 && (
            <div className="sx-effort ink-rise" style={vi(3)}>
              <span className="sx-fig"><b>{ledger.totals.sessions}</b> sessions</span>
              <span className="sx-fig"><b>{ledger.totals.turns}</b> agent turns</span>
              <span className="sx-fig"><b>{ledger.totals.files_touched}</b> files touched</span>
            </div>
          )}

          {/* how AI effort distributes — honest share by agent turns */}
          {repoShare.length > 0 && (
            <div className="sx-share ink-rise" style={vi(4)}>
              <div className="sx-share-bar">
                {repoShare.map((r) => (
                  <span
                    key={r.repo}
                    className="sx-share-seg"
                    style={{ width: `${r.pct}%`, background: `var(--j-${r.tone})` }}
                    title={`${r.repo} — ${r.sessions} session${r.sessions === 1 ? "" : "s"}, ${r.turns} turns`}
                  />
                ))}
              </div>
              <div className="sx-share-legend">
                {repoShare.map((r) => (
                  <span key={r.repo} className="sx-share-key">
                    <span className="dot" style={{ background: `var(--j-${r.tone})` }} />
                    {r.repo} <span className="n">{r.sessions}</span>
                  </span>
                ))}
                <span className="sx-share-note">share of agent turns — effort proxy, not spend</span>
              </div>
            </div>
          )}
        </header>

        {rows.length === 0 && (
          <div className="ink-empty">
            <div className="big">No sessions in the ledger yet</div>
            Upload a Claude Code transcript and Quire will remember it — prompts, decisions, receipts.
          </div>
        )}

        <div className="sx-ledger">
          {rows.map((s, i) => <LedgerRow key={`${s.workspace}-${s.session_id}`} s={s} rise={Math.min(5 + i, 12)} />)}
        </div>

        {journal.length > 0 && (
          <section className="sx-journal-sec">
            <h3 className="ink-section" style={{ marginBottom: 8 }}>
              Journal digests — {journal.length} development session{journal.length === 1 ? "" : "s"} of this repo
            </h3>
            <div className="sx-ledger">
              {journal.slice(0, 30).map((s) => (
                <Link key={s.id} to={`/session/${s.id}`} className="sx-lrow sx-lrow--quiet">
                  <div className="sx-lrow-main">
                    <span className="sx-lrow-title">{s.narrative_summary || s.session_shape || "Coding session"}</span>
                    <span className="sx-lrow-meta">
                      {s.started_at ? formatWhen(s.started_at) : "undated"} · {s.moment_count} moments extracted
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <div className="rv-foot" style={{ padding: "18px 0 32px" }}>
          effort figures are proxies (sessions, turns, files) · spend integration is roadmap
        </div>
      </div>
    </main>
  );
}

const SHARE_TONES = ["consult", "gold", "teal", "violet", "moss", "red"] as const;

function LedgerRow({ s, rise }: { s: LedgerSession; rise: number }) {
  return (
    <Link to={s.link} className="sx-lrow ink-rise" style={vi(rise)}>
      <div className="sx-lrow-main">
        <span className="sx-lrow-title">{s.title || "Coding session"}</span>
        <span className="sx-lrow-meta">
          {[s.actor, s.repo, s.when ? formatWhen(s.when) : "", `${s.turns} turns`,
            s.files_touched ? `${s.files_touched} file${s.files_touched === 1 ? "" : "s"}` : ""]
            .filter(Boolean).join(" · ")}
        </span>
        {s.summary && <span className="sx-lrow-sum">{s.summary}</span>}
      </div>
      <div className="sx-lrow-side">
        {s.verdict && <VerdictBadge label={s.verdict.label} ink={s.verdict.ink} />}
        {s.pr && <span className="sx-lrow-pr">PR #{s.pr}</span>}
      </div>
    </Link>
  );
}

function vi(i: number): React.CSSProperties {
  return { "--i": i } as React.CSSProperties;
}

function formatWhen(ts: string): string {
  try {
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return ts;
  }
}
