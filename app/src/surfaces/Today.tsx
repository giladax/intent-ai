import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchNeedsYou, fetchFeed, fetchOrg, type NeedsYouItem, type FeedComposed, type Org } from "../api";
import { VerdictBadge, Dot } from "../ink/Badge";
import { age } from "../ink/age";
import type { Ink } from "../ink/vocab";

/** Today / Overview — what IS going on now: the day's greeting, the stakes
 *  chips, the few things that need you, and what changed (the feed lede +
 *  trending, real). Not an edition; the current understanding, live. */
export function Today() {
  const [needsYou, setNeedsYou] = useState<NeedsYouItem[]>([]);
  const [feed, setFeed] = useState<FeedComposed | null>(null);
  const [org, setOrg] = useState<Org | null>(null);

  useEffect(() => {
    fetchNeedsYou().then(setNeedsYou).catch(() => setNeedsYou([]));
    fetchFeed().then(setFeed).catch(() => setFeed(null));
    fetchOrg().then(setOrg).catch(() => setOrg(null));
  }, []);

  const broke = needsYou.filter((n) => n.ink === "red" || n.ink === "amber").length;
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" });

  return (
    <main className="ink-main">
      <div className="ink-today-head">
        <div className="date">{today}</div>
        <h1>Good morning, Gilad</h1>
        <div className="sub">Here's what's going on, and what needs you.</div>
        <div className="ink-chips">
          <div className="ink-chip red"><b>{needsYou.length}</b> need you</div>
          <div className="ink-chip amber"><b>{broke}</b> touched a promise</div>
          <div className="ink-chip gray"><b>{org?.repos.length ?? 0}</b> repositories</div>
        </div>
      </div>

      {/* The lede — the day's headline, from the real feed */}
      {feed?.lede?.text && (
        <div className="ink-sect">
          <div className="ink-sect-h">What's going on</div>
          {feed.lede.headline && (
            <div style={{ fontSize: "17px", fontWeight: 700, letterSpacing: "-0.01em", marginTop: "6px" }}>
              {feed.lede.headline}
            </div>
          )}
          <div style={{ color: "var(--muted)", marginTop: "6px", fontSize: "14px", lineHeight: 1.55, maxWidth: "62ch" }}>
            {feed.lede.text}
          </div>
        </div>
      )}

      {/* Needs you — a preview of the top few, deep-linking into the room */}
      <div className="ink-sect"><div className="ink-sect-h">Needs you</div></div>
      <div className="ink-listwrap">
        {needsYou.length === 0 ? (
          <div style={{ color: "var(--muted)", padding: "8px 0 16px", fontSize: "13.5px" }}>
            Nothing needs you right now.
          </div>
        ) : (
          needsYou.slice(0, 3).map((it) => (
            <Link key={it.id} to={`/needs-you?item=${it.id}`} className="ink-row" style={{ textDecoration: "none" }}>
              <Dot ink={it.ink as Ink} />
              <VerdictBadge label={it.label} ink={it.ink} />
              <div className="title">
                <div className="t">{it.label} on {it.repo}</div>
                <div className="m"><span>{it.repo}</span> · <span className="mono">PR {it.pr_number}</span></div>
              </div>
              <div className="rt"><span className="age">{age(it.ts)}</span><span className="act">Review →</span></div>
            </Link>
          ))
        )}
      </div>

      {/* Trending — what's moving, from the real feed */}
      {feed?.trending && feed.trending.length > 0 && (
        <>
          <div className="ink-sect"><div className="ink-sect-h">What's moving</div></div>
          <div className="ink-listwrap">
            {feed.trending.slice(0, 5).map((s) => (
              <div className="ink-chg" key={s.featureId}>
                <span className={`dot d-${heatInk(s.heatLabel)} cdot`} />
                <div>
                  <div className="ct"><b>{s.featureName}</b> — {s.headline}</div>
                  <div className="cm">{s.eventCount} events · {s.heatLabel}</div>
                </div>
                <Link className="clink" to={`/feature/${s.featureId}`}>view</Link>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

function heatInk(label: string): Ink {
  if (label === "hot") return "red";
  if (label === "still warm") return "amber";
  return "gray";
}
