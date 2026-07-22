import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchOrg, type Org, type RepoCard } from "../api";
import { loadVocab, verdictOf, type VocabPayload, type Ink } from "../ink/vocab";
import { VerdictBadge, Dot } from "../ink/Badge";

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

/** A repo page stub — the repo's card facts and a link into its reviews.
 *  The full repo page (features · promises · reviews · sessions) is A2. */
export function RepoPage() {
  const { ws } = useParams();
  const [org, setOrg] = useState<Org | null>(null);
  const [vocab, setVocab] = useState<VocabPayload | null>(null);
  useEffect(() => { loadVocab().then(setVocab); fetchOrg().then(setOrg).catch(() => setOrg(null)); }, []);
  const repo: RepoCard | undefined = org?.repos.find((r) => r.workspace === ws);
  if (!org) return <main className="ink-main"><div className="ink-empty">Loading…</div></main>;
  if (!repo) return <main className="ink-main"><div className="ink-empty"><div className="big">No such repo</div>{ws}</div></main>;
  const v = verdictOf(vocab, repo.latest_verdict);
  return (
    <main className="ink-main">
      <div className="ink-crumb"><b>Quire</b> <span className="sep">/</span> <Link to="/repositories" style={{ color: "inherit" }}>Repositories</Link> <span className="sep">/</span> {repo.display_name}</div>
      <div className="ink-main-head">
        <h1><Dot ink={v.ink as Ink} /> {repo.display_name}</h1>
        <div className="sub">
          {repo.github_remote
            ? <a href={repo.github_remote} style={{ color: "var(--accent)", textDecoration: "none" }}>{repo.github_remote}</a>
            : "local fixture"} · {repo.status}
        </div>
      </div>
      <div className="ink-listwrap" style={{ paddingTop: "16px" }}>
        <div className="ink-chips">
          {repo.latest_verdict && <VerdictBadge label={v.label} ink={v.ink} />}
          <div className="ink-chip"><b>{repo.open_review_count}</b> open reviews</div>
          <div className="ink-chip"><b>{repo.coupled_session_count}</b> coupled sessions</div>
        </div>
        <p style={{ color: "var(--muted)", marginTop: "18px", fontSize: "13.5px", lineHeight: 1.6, maxWidth: "60ch" }}>
          The full repo page — features, promises, reviews and sessions — arrives with the review room. For now:{" "}
          <Link to="/reviews" style={{ color: "var(--accent)" }}>see the reviews</Link> or{" "}
          <a href={repo.intent_ledger_url} style={{ color: "var(--accent)" }}>the promise ledger</a>.
        </p>
      </div>
    </main>
  );
}
