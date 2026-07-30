import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchOrgFeatureDetail } from "../api";
import type { OrgFeatureDetail, FeaturePromise, FeatureTimelineItem } from "../types";
import { VerdictBadge, Dot } from "../ink/Badge";
import type { Ink } from "../ink/vocab";
import { WorkspaceTasks } from "./Handoff";

interface FeaturePageProps {
  featureId: string;
}

/** Feature definition page — what this feature IS now.
 *  Grammar from mock 05: header (name + status + plain counts) → the promises
 *  we made (statement + status + receipt) → why the code is like this (the
 *  session card) → what happened recently (timeline), with the right rail for
 *  repo / related / talked-about context. Renders the OrgFeatureDetail
 *  contract only — the same understanding the brain serves agents. */
export function FeaturePage({ featureId }: FeaturePageProps) {
  const [feature, setFeature] = useState<OrgFeatureDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchOrgFeatureDetail(featureId)
      .then((f) => { setFeature(f); setLoading(false); })
      .catch(() => { setFeature(null); setLoading(false); });
  }, [featureId]);

  if (loading) {
    return (
      <>
        <main className="ink-main"><div className="ink-empty">Loading…</div></main>
        <aside className="ink-detail" />
      </>
    );
  }

  if (!feature) {
    return (
      <>
        <main className="ink-main">
          <div className="ink-empty">
            <div className="big">Feature not found</div>
            <span className="fpage-rule-src">{featureId}</span>
          </div>
        </main>
        <aside className="ink-detail" />
      </>
    );
  }

  return (
    <>
      <main className="ink-main">
        <div className="ink-crumb">
          <b>Quire</b>
          <span className="sep">/</span>
          <Link to={`/repo/${feature.repoWorkspace}`} style={{ color: "inherit", textDecoration: "none" }}>
            {feature.repo}
          </Link>
          <span className="sep">/</span>
          {feature.name}
        </div>

        <div className="fpage-head">
          <h1 className="fpage-h1">
            {feature.name}
            <VerdictBadge label={feature.statusLabel} ink={feature.statusInk} />
          </h1>
          {feature.summary && <div className="fpage-sum">{feature.summary}</div>}
          <div className="fpage-props">
            <span className="fpage-prop">Repo <b>{feature.repo}</b></span>
            <span className="fpage-prop">
              <b>{feature.promiseCount}</b> promise{feature.promiseCount !== 1 ? "s" : ""}
              {feature.brokenCount > 0 && (
                <> · <b style={{ color: "var(--red)" }}>{feature.brokenCount} broken</b></>
              )}
            </span>
            <span className="fpage-prop">
              <b>{feature.sessionCount}</b> coding session{feature.sessionCount !== 1 ? "s" : ""}
            </span>
            {feature.fileCount > 0 && (
              <span className="fpage-prop">
                <b>{feature.fileCount}</b> code file{feature.fileCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>

        <div className="fpage-body">
          {feature.promises.length > 0 && (
            <>
              <div className="fpage-h2">The promises we made</div>
              {feature.promises.map((p) => (
                <PromiseCard key={p.id} promise={p} />
              ))}
            </>
          )}

          {feature.whyCard && (
            <>
              <div className="fpage-h2">Why the code is like this</div>
              <div className="fpage-why-card">
                <span className="fpage-why-ic">◷</span>
                <div>
                  {feature.whyCard.summary}
                  {feature.whyCard.sessionLink && (
                    <>
                      {" "}
                      <Link
                        to={feature.whyCard.sessionLink}
                        style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}
                      >
                        Open the coding session
                        {feature.whyCard.sessionSteps ? ` (${feature.whyCard.sessionSteps} steps)` : ""} →
                      </Link>
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          {feature.timeline.length > 0 && (
            <>
              <div className="fpage-h2">What happened recently</div>
              <div className="fpage-tl">
                {feature.timeline.map((item) => (
                  <TimelineItem key={item.id} item={item} />
                ))}
              </div>
            </>
          )}

          {/* The work — task cards for this feature's workspace (A4.5) */}
          {feature.repoWorkspace && (
            <WorkspaceTasks workspace={feature.repoWorkspace} featureId={featureId} />
          )}

          {feature.promises.length === 0 && !feature.whyCard && feature.timeline.length === 0 && (
            <div className="ink-empty">
              <div className="big">Nothing here yet</div>
              As sessions and reviews touch this feature, its definition assembles here.
            </div>
          )}
        </div>
      </main>

      <aside className="ink-detail">
        <div className="ink-detail-body">
          <div className="ink-d-sec">Part of</div>
          <Link to={`/repo/${feature.repoWorkspace}`} className="fpage-rel" style={{ textDecoration: "none" }}>
            <span className="lk">▤</span> {feature.repo}
          </Link>

          {feature.relatedFeatures.length > 0 && (
            <>
              <div className="ink-d-sec" style={{ marginTop: "22px" }}>Related features</div>
              {feature.relatedFeatures.map((rf) => (
                <Link key={rf.id} to={`/feature/${rf.id}`} className="fpage-rel" style={{ textDecoration: "none" }}>
                  <Dot ink={rf.ink as Ink} />
                  {rf.name}
                </Link>
              ))}
            </>
          )}

          {feature.mentionedIn &&
            feature.mentionedIn.sessions + feature.mentionedIn.threads + feature.mentionedIn.specs > 0 && (
            <>
              <div className="ink-d-sec" style={{ marginTop: "22px" }}>Talked about in</div>
              <div className="fpage-mention-text">
                <MentionedIn m={feature.mentionedIn} /> mention this feature. Everything here can be
                clicked down to the exact quote.
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

/** "4 coding sessions, 2 chat threads, and 1 spec" — a plain sentence. */
function MentionedIn({ m }: { m: NonNullable<OrgFeatureDetail["mentionedIn"]> }) {
  const parts: React.ReactNode[] = [];
  if (m.sessions > 0) {
    parts.push(
      <Link key="s" to="/sessions" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}>
        {m.sessions} coding session{m.sessions !== 1 ? "s" : ""}
      </Link>,
    );
  }
  if (m.threads > 0) parts.push(`${m.threads} chat thread${m.threads !== 1 ? "s" : ""}`);
  if (m.specs > 0) parts.push(`${m.specs} spec${m.specs !== 1 ? "s" : ""}`);
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && (i === parts.length - 1 ? ", and " : ", ")}
          {p}
        </span>
      ))}
    </>
  );
}

/** One promise: plain-language status badge, the statement as the headline,
 *  the explanation, and the receipt (source footnote / review link). */
function PromiseCard({ promise: p }: { promise: FeaturePromise }) {
  return (
    <div className="fpage-rule">
      <div className="fpage-rule-top">
        <VerdictBadge label={p.statusLabel} ink={p.statusInk} />
        <span className="fpage-rule-t">{p.statement}</span>
      </div>
      {p.explanation && <div className="fpage-rule-why">{p.explanation}</div>}
      {(p.reviewLink || p.sourceRef || p.status === "no_rule") && (
        <div className="fpage-rule-foot">
          {p.reviewLink && (
            <Link
              to={p.reviewLink}
              style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600, fontSize: "12px" }}
            >
              See where it {p.status === "broken" ? "broke" : "was checked"} →
            </Link>
          )}
          {p.sourceRef && <span className="fpage-rule-src">{p.sourceRef}</span>}
          {!p.reviewLink && p.status === "no_rule" && (
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>+ Add a promise for this</span>
          )}
        </div>
      )}
    </div>
  );
}

function TimelineItem({ item }: { item: FeatureTimelineItem }) {
  return (
    <div className="fpage-tl-item">
      <span className={`fpage-tl-dot dot d-${item.ink}`} />
      <div>
        <div className="fpage-tl-t">{item.title}</div>
        <div className="fpage-tl-m">{item.meta}</div>
      </div>
    </div>
  );
}
