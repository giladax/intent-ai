import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchReview, submitReview } from "../api";
import type { ReviewDetail, ReviewFile, ReviewFileNote, ReviewPromiseCard } from "../types";
import { VerdictBadge } from "../ink/Badge";
import { SigningBlock } from "../ink/SigningBlock";

/** The review room (mock 09)  -- three zones:
 *  1. verdict head: ONE plain sentence + stamps;
 *  2. manuscript body: changed files with deltas, expandable to the diff,
 *     with file-level promise notes inline where a binding anchors a promise;
 *  3. the rail: what the review found, promise cards with verbatim receipts,
 *     the coverage gap, "why the author did it", and your call (the signing
 *     ceremony). Every verdict reads in plain language; ids are footnotes. */
export function ReviewRoom() {
  const { ws, n } = useParams();
  const prNumber = Number(n);
  const [review, setReview] = useState<ReviewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!ws || Number.isNaN(prNumber)) return;
    let live = true;
    setLoading(true);
    setError(false);
    (async () => {
      try {
        const r = await fetchReview(ws, prNumber);
        if (live) { setReview(r); setLoading(false); }
      } catch {
        if (live) { setError(true); setLoading(false); }
      }
    })();
    return () => { live = false; };
  }, [ws, prNumber]);

  if (loading) {
    return (
      <>
        <main className="ink-main"><div className="ink-empty">Loading the review…</div></main>
        <aside className="ink-detail" />
      </>
    );
  }
  if (error || !review) {
    return (
      <>
        <main className="ink-main">
          <div className="ink-empty">
            <div className="big">No such review</div>
            <span className="rv-foot">PR #{n} on {ws}</span>
          </div>
        </main>
        <aside className="ink-detail" />
      </>
    );
  }

  const noteById = new Map(review.file_notes.map((nt) => [nt.id, nt]));

  return (
    <>
      <main className="ink-main">
        <div className="ink-crumb">
          <b>Quire</b> <span className="sep">/</span>{" "}
          <Link to={`/repo/${review.workspace}`} style={{ color: "inherit", textDecoration: "none" }}>
            {review.workspace}
          </Link>{" "}
          <span className="sep">/</span> Reviews <span className="sep">/</span> <b>#{review.pr_number}</b>
        </div>

        {/* ── zone 1: verdict head ── */}
        <div className="rv-head">
          <h1 className="rv-h1">
            {review.title} <VerdictBadge label={review.label} ink={review.ink} />
          </h1>
          <div className="rv-meta">
            <span>{review.workspace}</span>
            <span className="rv-mono">{review.head_sha.slice(0, 7)}</span>
            <span>{review.files.length} file{review.files.length !== 1 ? "s" : ""}</span>
            <DeltaSum files={review.files} />
            {review.why?.session ? <span>· session attached</span> : null}
          </div>
        </div>

        <div className={`rv-verdict-line ink-${review.ink}`}>
          {review.verdict_sentence}
        </div>

        {/* ── zone 2: manuscript body ── */}
        <div className="rv-files">
          {review.files.map((f) => (
            <FileBlock key={f.path} file={f} notes={f.notes.map((id) => noteById.get(id)!).filter(Boolean)} />
          ))}
        </div>
      </main>

      {/* ── zone 3: the rail ── */}
      <aside className="ink-detail">
        <div className="ink-detail-body">
          <div className="ink-d-sec">What this review found</div>
          <FoundCard review={review} />

          {review.promises.length > 0 && (
            <>
              <div className="ink-d-sec">Promises checked</div>
              {review.promises.map((p) => (
                <RailPromise key={p.obligation_id} promise={p} />
              ))}
            </>
          )}

          {review.gap.has_gap && (
            <>
              <div className="ink-d-sec">The gap</div>
              <div className="rv-gap">
                <b>{review.gap.summary}</b>
                <ul className="rv-gap-list">
                  {review.gap.items.map((g, i) => <li key={i}>{g}</li>)}
                </ul>
              </div>
            </>
          )}

          {review.why && (
            <>
              <div className="ink-d-sec">Why the author did it</div>
              <WhyCard why={review.why} />
            </>
          )}

          <div className="ink-d-sec">Your call</div>
          <YourCall review={review} />

          <div className="rv-foot">
            analysis of head {review.head_sha.slice(0, 7)} · analyzer {review.analyzer_version} ·
            every quote above verified verbatim against its source
          </div>
        </div>
      </aside>
    </>
  );
}

function DeltaSum({ files }: { files: ReviewFile[] }) {
  const adds = files.reduce((s, f) => s + f.additions, 0);
  const dels = files.reduce((s, f) => s + f.deletions, 0);
  return (
    <span className="rv-mono">
      {adds > 0 && <span style={{ color: "var(--green)" }}>+{adds}</span>}
      {adds > 0 && dels > 0 && " "}
      {dels > 0 && <span style={{ color: "var(--red)" }}>−{dels}</span>}
    </span>
  );
}

/** One changed file  -- a delta header, expandable to its diff, with any
 *  file-level promise notes anchored inline (the margin content in familiar
 *  review-comment chrome). */
function FileBlock({ file, notes }: { file: ReviewFile; notes: ReviewFileNote[] }) {
  const [open, setOpen] = useState(notes.length > 0); // notes-bearing files open by default
  const lines = useMemo(() => parsePatch(file.patch), [file.patch]);

  return (
    <div className="rv-file">
      <button className="rv-file-head" onClick={() => setOpen((o) => !o)}>
        <span className="rv-chev">{open ? "▾" : "▸"}</span>
        <span className="rv-file-path">{file.path}</span>
        {file.additions > 0 && <span className="rv-plus">+{file.additions}</span>}
        {file.deletions > 0 && <span className="rv-minus">−{file.deletions}</span>}
        {notes.length > 0 && (
          <span className="rv-note-chip">{notes.length} note{notes.length !== 1 ? "s" : ""}</span>
        )}
      </button>

      {open && (
        <>
          {lines.length > 0 && (
            <div className="rv-hunk">
              {lines.map((ln, i) =>
                ln.kind === "hunk" ? (
                  <div key={i} className="rv-hh">{ln.text}</div>
                ) : (
                  <div key={i} className={`rv-ln rv-ln-${ln.kind}`}>
                    <span className="rv-no">{ln.no ?? ""}</span>
                    <span className="rv-code">{ln.text}</span>
                  </div>
                ),
              )}
            </div>
          )}
          {notes.map((nt) => (
            <div key={nt.id} className="rv-inline-note">
              <div className="rv-note-h">
                <VerdictBadge label={nt.label} ink={nt.ink} />
                <b>Quire</b> · on {nt.path}
              </div>
              <div className="rv-note-b">
                <div className="rv-note-statement">Promise: "{nt.statement}"</div>
                {nt.reasoning && <div className="rv-note-reason">{nt.reasoning}</div>}
                <div className="rv-note-src">{nt.source_ref} · checked against this change</div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function FoundCard({ review }: { review: ReviewDetail }) {
  const c = review.counts;
  return (
    <div className="rv-card">
      <b>{summarizeCounts(c)}</b>
      <div className="rv-chips">
        <VerdictBadge label={`${c.broken} broken`} ink={c.broken > 0 ? "red" : "green"} />
        {c.partial > 0 && <VerdictBadge label={`${c.partial} partly kept`} ink="amber" />}
        {c.kept > 0 && <VerdictBadge label={`${c.kept} kept`} ink="green" />}
        {c.not_verified > 0 && <VerdictBadge label={`${c.not_verified} not verified by tests`} ink="amber" />}
      </div>
    </div>
  );
}

function summarizeCounts(c: ReviewDetail["counts"]): string {
  if (c.broken > 0) return "Breaks a promise it touches.";
  if (c.partial > 0) return "Partly keeps the promises it touches.";
  if (c.kept > 0 && c.not_verified === 0) return "Keeps every promise it touches.";
  if (c.kept > 0) return "Keeps every promise it touches. Adds behavior no promise covers.";
  return "Adds behavior no promise covers.";
}

function RailPromise({ promise: p }: { promise: ReviewPromiseCard }) {
  const receipt = p.citations.find((c) => c.excerpt);
  return (
    <div className="rv-card rv-promise">
      <div className="rv-promise-t">
        <span className={`dot d-${p.ink}`} /> {p.statement || p.obligation_id}
      </div>
      {p.reasoning && <div className="rv-promise-why">{p.reasoning}</div>}
      {receipt && (
        <>
          <div className={`rv-quote ink-${p.ink}`}>"{receipt.excerpt}"</div>
          <div className="rv-promise-src">
            {receipt.reference}
            {receipt.lines[0] ? ` · lines ${receipt.lines[0]}–${receipt.lines[1]}` : ""}
            {" · "}{p.obligation_id} · quote verified verbatim
          </div>
        </>
      )}
      {!receipt && <div className="rv-promise-src">{p.obligation_id} · {p.label.toLowerCase()}</div>}
    </div>
  );
}

function WhyCard({ why }: { why: NonNullable<ReviewDetail["why"]> }) {
  return (
    <div className="rv-consult">
      <div>
        {why.summary || "The author's own reasoning shipped with this change."}
        {why.session ? (
          <>
            {" "}
            <Link to={why.session.link} className="rv-consult-link">
              Walk the session{why.session.steps ? ` (${why.session.steps} steps)` : ""} →
            </Link>
            <div className="rv-consult-src">
              Reasoned in session {why.session.id.slice(0, 10)}… · attached by {why.session.kind ?? "trailer"}
            </div>
          </>
        ) : (
          <div className="rv-consult-src">
            The author's declared reasoning. No coding session is attached to this change.
          </div>
        )}
      </div>
    </div>
  );
}

type SignAct = { label: string; tone: "primary" | "danger"; state: string };

/** The signing act  -- mock 09's "Draw the missing promise & sign / Wave it
 *  through / Send back". Choosing an act opens the signing ceremony (name,
 *  role, deliberate confirm). Pending reviews get the ceremony; a settled
 *  review shows who signed.
 *
 *  The sign is durable: onSign submits to POST /analyses/{id}/review and only
 *  shows "It is on the record" after the server confirms. On failure an honest
 *  error is shown  -- the record was NOT updated. A page reload renders the
 *  settled state from the GET endpoint (review_state/reviewer/review_note). */
function YourCall({ review }: { review: ReviewDetail }) {
  const [act, setAct] = useState<SignAct | null>(null);
  const [settled, setSettled] = useState<{ act: string; by: string } | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (review.review_state !== "pending") {
    return (
      <div className="rv-settled">
        {review.reviewer
          ? <>Signed off by <b>{review.reviewer}</b>{review.review_note ? ` — ${review.review_note}` : ""}.</>
          : <>This review needs no human call — nothing it touched is governed.</>}
      </div>
    );
  }

  if (settled) {
    const rolePart = settled.by.startsWith("as ") ? settled.by : `as ${settled.by}`;
    return (
      <div className="rv-settled rv-settled--fresh">
        You signed: <b>{settled.act}</b> — {rolePart}. It is on the record.
      </div>
    );
  }

  const acts: Array<{ label: string; tone: "primary" | "danger" | "plain"; state: string }> =
    review.ink === "blue" || review.counts.not_verified > 0
      ? [
          { label: "Draw the missing promise & sign", tone: "primary", state: "approved" },
          { label: "Wave it through", tone: "plain", state: "approved" },
          { label: "Send back", tone: "danger", state: "rejected" },
        ]
      : [
          { label: "Wave it through", tone: "primary", state: "approved" },
          { label: "Send back", tone: "danger", state: "rejected" },
        ];

  if (!act) {
    return (
      <div className="ink-actions rv-actions">
        {acts.map((a) => (
          <button
            key={a.label}
            className={`ink-btn ${a.tone === "primary" ? "primary" : a.tone === "danger" ? "danger" : ""}`}
            onClick={() => { setApiError(null); setAct({ label: a.label, tone: a.tone === "danger" ? "danger" : "primary", state: a.state }); }}
          >
            {a.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <>
      {apiError && (
        <div className="rv-sign-error" role="alert">
          {apiError} The record was NOT updated — try again.
        </div>
      )}
      <SigningBlock
        actLabel={act.label}
        tone={act.tone}
        prompt={`You are about to ${act.label.toLowerCase()} — PR #${review.pr_number} on ${review.workspace}.`}
        busy={busy}
        onSign={async ({ name, role }) => {
          setBusy(true);
          setApiError(null);
          try {
            await submitReview(review.analysis_id, act.state, name, role || undefined);
            // role gets its own field when the review contract grows (A3+)
            setSettled({ act: act.label, by: role ? `as ${role}` : name });
          } catch (err) {
            setApiError(err instanceof Error ? err.message : "Network error.");
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

// ── diff parsing (structural, regex-free) ────────────────────────────
interface PLine { kind: "add" | "del" | "ctx" | "hunk"; text: string; no?: number }

function parsePatch(patch: string): PLine[] {
  const out: PLine[] = [];
  let newNo = 0;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("--- ") || raw.startsWith("+++ ")) continue;
    if (raw.startsWith("@@")) {
      out.push({ kind: "hunk", text: raw });
      // "@@ -a,b +c,d @@"  -- take the new-file start line.
      const plus = raw.split("+")[1];
      newNo = plus ? parseInt(plus, 10) || 0 : 0;
      continue;
    }
    if (raw.startsWith("+")) { out.push({ kind: "add", text: raw.slice(1), no: newNo }); newNo++; }
    else if (raw.startsWith("-")) { out.push({ kind: "del", text: raw.slice(1) }); }
    else { out.push({ kind: "ctx", text: raw.startsWith(" ") ? raw.slice(1) : raw, no: newNo }); newNo++; }
  }
  // Trim a trailing empty context line from the split.
  while (out.length && out[out.length - 1].kind === "ctx" && out[out.length - 1].text === "") out.pop();
  return out;
}
