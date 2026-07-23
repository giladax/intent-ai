import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchOrg, fetchRepoReviews, fetchFeatures, type Org, type RepoCard } from "../api";
import type { Feature, ReviewRow } from "../types";
import { loadVocab, verdictOf, type VocabPayload, type Ink } from "../ink/vocab";
import { VerdictBadge, Dot } from "../ink/Badge";
import { age } from "../ink/age";

/** The Repositories room — the org's repos as a familiar list, each with its
 *  latest verdict, open reviews, and coupled sessions. */
export function Repositories() {
  const [org, setOrg] = useState<Org | null>(null);
  const [vocab, setVocab] = useState<VocabPayload | null>(null);
  useEffect(() => { loadVocab().then(setVocab); fetchOrg().then(setOrg).catch(() => setOrg(null)); }, []);

  return (
    <main className="ink-main">
      <div className="ink-crumb"><b>Quire</b> <span className="sep">/</span> Repositories</div>
      <div className="ink-main-head">
        <h1>Repositories</h1>
        <div className="sub">{org?.repos.length ?? 0} repositories in this org.</div>
      </div>
      {org?.repos.map((r) => {
        const v = verdictOf(vocab, r.latest_verdict);
        return (
          <Link key={r.workspace} to={`/repo/${r.workspace}`} className="ink-row" style={{ textDecoration: "none" }}>
            <Dot ink={v.ink} />
            {r.latest_verdict ? <VerdictBadge label={v.label} ink={v.ink} /> : <span className="ink-badge" style={{ color: "var(--muted)", background: "var(--gray-bg)" }}>No reviews yet</span>}
            <div className="title">
              <div className="t">{r.display_name}{r.read_only ? " · frozen" : ""}</div>
              <div className="m">
                <span>{r.open_review_count} open {r.open_review_count === 1 ? "review" : "reviews"}</span>
                {" · "}<span>{r.coupled_session_count} coupled {r.coupled_session_count === 1 ? "session" : "sessions"}</span>
              </div>
            </div>
            <div className="rt"><span className="act">Open →</span></div>
          </Link>
        );
      })}
    </main>
  );
}

/** The repo page — the repo's header (remote, status, verdict), its reviews
 *  (newest first, plain-language verdict + when), the features it holds, and
 *  the link to its intent ledger. Data: /api/org (the repo card) + the repo's
 *  reviews listing (/api/repos/:ws/reviews) + its features. Ids are footnotes;
 *  every verdict reads in plain language. */
export function RepoPage() {
  const { ws } = useParams();
  const [org, setOrg] = useState<Org | null>(null);
  const [vocab, setVocab] = useState<VocabPayload | null>(null);
  const [reviews, setReviews] = useState<ReviewRow[] | null>(null);
  const [features, setFeatures] = useState<Feature[] | null>(null);

  useEffect(() => {
    loadVocab().then(setVocab);
    fetchOrg().then(setOrg).catch(() => setOrg(null));
  }, []);

  useEffect(() => {
    if (!ws) return;
    setReviews(null); setFeatures(null);
    fetchRepoReviews(ws).then((r) => setReviews(r.reviews)).catch(() => setReviews([]));
    fetchFeatures(ws).then(setFeatures).catch(() => setFeatures([]));
  }, [ws]);

  const repo: RepoCard | undefined = org?.repos.find((r) => r.workspace === ws);
  if (!org) return <main className="ink-main"><div className="ink-empty">Loading…</div></main>;
  if (!repo) return <main className="ink-main"><div className="ink-empty"><div className="big">No such repo</div>{ws}</div></main>;
  const v = verdictOf(vocab, repo.latest_verdict);

  return (
    <main className="ink-main">
      <div className="ink-crumb">
        <b>Quire</b> <span className="sep">/</span>{" "}
        <Link to="/repositories" style={{ color: "inherit" }}>Repositories</Link>{" "}
        <span className="sep">/</span> {repo.display_name}
      </div>
      <div className="ink-main-head">
        <h1><Dot ink={v.ink as Ink} /> {repo.display_name}{repo.read_only ? " · frozen" : ""}</h1>
        <div className="sub">
          {repo.github_remote
            ? <a href={repo.github_remote} style={{ color: "var(--accent)", textDecoration: "none" }}>{repo.github_remote}</a>
            : "local fixture"} · {repo.status}
        </div>
        <div className="ink-chips" style={{ marginTop: "14px" }}>
          {repo.latest_verdict && <VerdictBadge label={v.label} ink={v.ink} />}
          <div className="ink-chip"><b>{repo.open_review_count}</b> open review{repo.open_review_count !== 1 ? "s" : ""}</div>
          <div className="ink-chip"><b>{repo.coupled_session_count}</b> coupled session{repo.coupled_session_count !== 1 ? "s" : ""}</div>
          <a className="ink-chip" href={repo.intent_ledger_url} style={{ textDecoration: "none", color: "inherit" }}>
            The promise ledger →
          </a>
        </div>
      </div>

      <div className="ink-sect">
        <div className="ink-sect-h">Reviews {reviews ? <span className="ink-tab"><span className="n">{reviews.length}</span></span> : null}</div>
      </div>
      <div className="ink-listwrap">
        {reviews === null && <div className="ink-empty">Loading reviews…</div>}
        {reviews !== null && reviews.length === 0 && (
          <div className="ink-empty" style={{ padding: "24px 0", textAlign: "left" }}>
            No reviews yet on this repo.
          </div>
        )}
        {reviews?.map((r) => (
          <Link key={r.pr_number} to={r.link} className="ink-row" style={{ textDecoration: "none" }}>
            <Dot ink={r.ink} />
            <VerdictBadge label={r.label} ink={r.ink} />
            <div className="title">
              <div className="t">{r.title}</div>
              <div className="m">
                <span className="mono">#{r.pr_number}</span>
                {" · "}<span className="mono">{r.head_sha.slice(0, 7)}</span>
                {r.review_state === "pending" ? " · awaiting your call" : ""}
              </div>
            </div>
            <div className="rt"><span className="age">{age(r.ts)}</span><span className="act">Open →</span></div>
          </Link>
        ))}
      </div>

      {features && features.length > 0 && (
        <>
          <div className="ink-sect"><div className="ink-sect-h">Features it holds</div></div>
          <div className="ink-listwrap">
            {features.map((f) => (
              <Link key={f.id} to={`/feature/${f.id}`} className="ink-row" style={{ textDecoration: "none" }}>
                <Dot ink="gray" />
                <div className="title">
                  <div className="t">{f.name}</div>
                  {f.description && <div className="m">{f.description}</div>}
                </div>
                <div className="rt"><span className="act">Open →</span></div>
              </Link>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
