import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  fetchSessionExperience,
  type SessionExperienceData,
  type SxBlock,
  type SxQuote,
  type SxToolBlock,
  type SxTurn,
} from "../api";
import { VerdictBadge } from "../ink/Badge";

/** The session experience — one uploaded session, remembered.
 *
 *  The manuscript and the margin: the human's crafted prompts render as
 *  manuscript (serif, elevated paper cards — valued, not log lines); the
 *  machine's work renders as quiet ledger chrome (collapsed tool artifacts,
 *  inline change chips). Where Quire extracted a quote, the exact span
 *  carries a gold receipt mark — "your words became governing evidence" —
 *  and the rail shows where each receipt anchors (reviews, memos).
 *
 *  Two audiences, one surface: the adopter reads their session as a story;
 *  the exec reads the header's effort band (turns · tool calls · files ·
 *  duration — honest proxies, never invented spend). */
export function SessionExperience() {
  const { id } = useParams();
  const [data, setData] = useState<SessionExperienceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id) return;
    let live = true;
    setLoading(true);
    setError(false);
    fetchSessionExperience(id)
      .then((d) => { if (live) { setData(d); setLoading(false); } })
      .catch(() => { if (live) { setError(true); setLoading(false); } });
    return () => { live = false; };
  }, [id]);

  if (loading) {
    return (
      <>
        <main className="ink-main"><div className="ink-empty">Opening the session…</div></main>
        <aside className="ink-detail" />
      </>
    );
  }
  if (error || !data) {
    return (
      <>
        <main className="ink-main">
          <div className="ink-empty">
            <div className="big">Quire has no record of this session</div>
            It was never uploaded or digested here.
          </div>
        </main>
        <aside className="ink-detail" />
      </>
    );
  }

  return <SessionExperienceView data={data} />;
}

/** Pure view — testable without the router fetch. */
export function SessionExperienceView({ data }: { data: SessionExperienceData }) {
  const { header, turns, quotes, produced, referenced_by, digest, notes } = data;

  // anchored quotes per (turn, block) — the marks in the manuscript.
  const marksByLoc = useMemo(() => {
    const m = new Map<string, Array<{ quote: SxQuote; n: number }>>();
    quotes.forEach((q, i) => {
      if (!q.anchor) return;
      const key = `${q.anchor.turn}:${q.anchor.block}`;
      const list = m.get(key) ?? [];
      list.push({ quote: q, n: i });
      m.set(key, list);
    });
    return m;
  }, [quotes]);

  const prompts = turns.filter((t) => t.role === "user");

  return (
    <>
      <main className="ink-main sx-room">
        <div className="ink-crumb">
          <b>Quire</b> <span className="sep">/</span>{" "}
          <Link to="/sessions" style={{ color: "inherit", textDecoration: "none" }}>Sessions</Link>{" "}
          <span className="sep">/</span> <b>{shortId(data.session_id)}</b>
        </div>

        <div className="sx-column">
          {/* ── masthead ── */}
          <header className="sx-head">
            <div className="ink-kicker ink-rise" style={vi(0)}>The session, remembered</div>
            <h1 className="ink-masthead ink-rise" style={vi(1)}>{header.title}</h1>
            {header.summary && (
              <p className="ink-deck ink-rise" style={vi(2)}>{header.summary}</p>
            )}
            <div className="sx-byline ink-rise" style={vi(2)}>
              {header.actor && <span className="sx-actor">{header.actor}</span>}
              {header.repo && <span>{header.repo}</span>}
              {header.pr ? <span>coupled to PR #{header.pr}</span> : null}
              {header.started_at && <span>{formatWhen(header.started_at)}</span>}
            </div>
            {/* the work, measured — honest effort proxies, never dollars */}
            <div className="sx-effort ink-rise" style={vi(3)}>
              <EffortFig n={header.effort.prompts} unit={header.effort.prompts === 1 ? "prompt" : "prompts"} />
              <EffortFig n={header.effort.tool_calls} unit="tool calls" />
              <EffortFig n={header.effort.files_touched} unit={header.effort.files_touched === 1 ? "file changed" : "files changed"} />
              {header.effort.duration_seconds != null && (
                <EffortFig text={formatDuration(header.effort.duration_seconds)} unit="of work" />
              )}
            </div>
            {notes.map((n, i) => (
              <div key={i} className="sx-note ink-rise" style={vi(4)}>{n}</div>
            ))}
          </header>

          {/* ── the conversation ── */}
          <div className="sx-thread">
            {turns.map((t, i) => (
              <TurnBlock
                key={t.index}
                turn={t}
                rise={Math.min(i + 4, 12)}
                promptNo={t.role === "user" ? prompts.indexOf(t) + 1 : 0}
                promptCount={prompts.length}
                marks={marksByLoc}
              />
            ))}
            {turns.length === 0 && (
              <div className="ink-empty">
                The transcript isn&rsquo;t on disk any more — the rail keeps what Quire extracted.
              </div>
            )}
          </div>

          {turns.length > 0 && (
            <div className="sx-colophon">
              — end of session · {header.effort.prompts} prompt{header.effort.prompts === 1 ? "" : "s"},{" "}
              {header.effort.tool_calls} tool calls, remembered in full —
            </div>
          )}
        </div>
      </main>

      {/* ── the margin: what Quire kept ── */}
      <aside className="ink-detail">
        <div className="ink-detail-body">
          {digest && (
            <>
              <div className="ink-d-sec">What Quire kept</div>
              <div className="sx-kept">
                {digest.summary && <p className="sx-kept-sum">{digest.summary}</p>}
                {digest.decisions.map((d, i) => (
                  <div key={i} className="sx-decision">
                    <span className="sx-decision-glyph">◆</span>
                    <div>
                      <div className="sx-decision-choice">{d.choice}</div>
                      {d.why && <div className="sx-decision-why">{d.why}</div>}
                      {d.rejected && <div className="sx-decision-rej">rejected: {d.rejected}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {quotes.length > 0 && (
            <>
              <div className="ink-d-sec">Quotes that became receipts</div>
              {quotes.map((q, i) => (
                <ReceiptCard key={i} q={q} n={i} />
              ))}
            </>
          )}

          {produced.length > 0 && (
            <>
              <div className="ink-d-sec">This session produced →</div>
              {produced.map((p, i) => (
                <Link key={i} to={p.link} className="sx-rel sx-rel--out">
                  <span className="sx-rel-kind">signed intent memo</span>
                  <span className="sx-rel-title">{p.title}</span>
                  <span className="sx-rel-foot">{p.reference} · {p.workspace}</span>
                </Link>
              ))}
            </>
          )}

          {referenced_by.length > 0 && (
            <>
              <div className="ink-d-sec">Referenced by ←</div>
              {referenced_by.map((r, i) => (
                <Link key={i} to={r.link} className="sx-rel sx-rel--in">
                  <span className="sx-rel-title">
                    {r.title} <VerdictBadge label={r.label} ink={r.ink} />
                  </span>
                  <span className="sx-rel-foot">
                    PR #{r.pr_number} on {r.workspace} · coupled by {r.via || "upload"}
                  </span>
                </Link>
              ))}
            </>
          )}

          {produced.length === 0 && referenced_by.length === 0 && !digest && (
            <div className="ink-empty" style={{ padding: "24px 0" }}>
              Nothing extracted yet — the session is archived and safe.
            </div>
          )}

          <div className="rv-foot">
            every quote verified verbatim against the transcript · effort figures are
            proxies (turns, tools, files) — spend integration is roadmap
          </div>
        </div>
      </aside>
    </>
  );
}

/* ── turns ─────────────────────────────────────────────────────────── */

function TurnBlock({
  turn, rise, promptNo, promptCount, marks,
}: {
  turn: SxTurn;
  rise: number;
  promptNo: number;
  promptCount: number;
  marks: Map<string, Array<{ quote: SxQuote; n: number }>>;
}) {
  if (turn.role === "user") {
    const quoteMarks = marks.get(`${turn.index}:0`) ?? [];
    return (
      <article className="sx-prompt ink-rise" style={vi(rise)}>
        <div className="sx-prompt-head">
          <span className="sx-ava">You</span>
          <span className="sx-turn-meta">
            {formatClock(turn.ts)}
            {promptCount > 1 ? ` · prompt ${promptNo} of ${promptCount}` : ""}
          </span>
          {quoteMarks.length > 0 && (
            <span className="sx-receipt-flag" title="Quire quoted these words as evidence">
              ❝ quoted by Quire
            </span>
          )}
        </div>
        <div className="sx-prompt-body">
          <Prose text={turn.text ?? ""} marks={quoteMarks} />
        </div>
      </article>
    );
  }

  const blocks = turn.blocks ?? [];
  return (
    <article className="sx-reply ink-rise" style={vi(rise)}>
      <div className="sx-reply-head">
        <span className="sx-turn-who">◇ the agent</span>
        <span className="sx-turn-meta">{formatClock(turn.ts)}</span>
      </div>
      {blocks.map((b, bi) => (
        <BlockView key={bi} block={b} marks={marks.get(`${turn.index}:${bi}`) ?? []} />
      ))}
      {(turn.files_changed ?? []).length > 0 && (
        <div className="sx-turn-artifacts">
          {(turn.files_changed ?? []).map((f, i) => (
            <span key={i} className="sx-file-pill" title={f.path}>
              <span className="sx-file-pill-glyph">±</span>
              {baseName(f.path)}
              {f.additions > 0 && <b className="add">+{f.additions}</b>}
              {f.deletions > 0 && <b className="del">−{f.deletions}</b>}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

function BlockView({ block, marks }: { block: SxBlock; marks: Array<{ quote: SxQuote; n: number }> }) {
  if (block.type === "text") {
    return <div className="sx-reply-text"><Prose text={block.text} marks={marks} /></div>;
  }
  return <ToolChip tool={block} />;
}

/* ── tool calls: designed artifacts, not JSON dumps ────────────────── */

const TOOL_GLYPH: Record<string, string> = {
  Edit: "±", MultiEdit: "±", Write: "✎", NotebookEdit: "✎",
  Read: "❏", NotebookRead: "❏", Bash: "❯", Grep: "⌕", Glob: "⌕", LS: "❏",
};

function ToolChip({ tool }: { tool: SxToolBlock }) {
  const [open, setOpen] = useState(false);
  const fc = tool.file_change;
  return (
    <div className={`sx-tool${open ? " open" : ""}`}>
      <button className="sx-tool-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="sx-tool-glyph">{TOOL_GLYPH[tool.name] ?? "·"}</span>
        <span className="sx-tool-sum">{tool.summary}</span>
        {fc && (
          <span className="sx-tool-delta">
            {fc.additions > 0 && <b className="add">+{fc.additions}</b>}
            {fc.deletions > 0 && <b className="del">−{fc.deletions}</b>}
          </span>
        )}
        {tool.result_note && !fc && <span className="sx-tool-note">{tool.result_note}</span>}
        <span className="sx-tool-chev">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="sx-tool-deep">
          {fc ? (
            <DiffView path={fc.path} diff={fc.diff} />
          ) : (
            <>
              <div className="sx-deep-label">input</div>
              <pre className="sx-deep-pre">{tool.input_display}</pre>
            </>
          )}
          {tool.result_display && (
            <>
              <div className="sx-deep-label">result</div>
              <pre className="sx-deep-pre">{tool.result_display}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A change artifact — the diff the session wrote, in review-room chrome. */
function DiffView({ path, diff }: { path: string; diff: string }) {
  const lines = diff.split("\n");
  return (
    <div className="sx-diff">
      <div className="sx-diff-path">{path}</div>
      <div className="rv-hunk">
        {lines.map((l, i) => {
          const kind = l.startsWith("@@") ? "hunk" : l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : "ctx";
          if (kind === "hunk") return <div key={i} className="rv-hh">{l}</div>;
          return (
            <div key={i} className={`rv-ln rv-ln-${kind}`}>
              <span className="rv-no" />
              <span className="rv-code">{kind === "ctx" ? l.replace(/^ /, "") : l.slice(1)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── the receipts (rail) ───────────────────────────────────────────── */

function ReceiptCard({ q, n }: { q: SxQuote; n: number }) {
  return (
    <button
      id={`receipt-${n}`}
      className="sx-receipt"
      onClick={() => {
        if (!q.anchor) return;
        const el = document.getElementById(`sx-mark-${n}`);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.remove("sx-mark-flash");
        void el.offsetWidth;
        el.classList.add("sx-mark-flash");
      }}
      title={q.anchor ? "Show these words in the conversation" : "This quote no longer resolves in the transcript"}
    >
      <span className="sx-receipt-quote">&ldquo;{q.quote}&rdquo;</span>
      {q.why && <span className="sx-receipt-why">{q.why}</span>}
      <span className="sx-receipt-foot">
        {q.kind === "intent_card" ? "became a signed intent card" : "held as evidence"}
        {q.anchor ? " · verbatim in the transcript" : " · span no longer resolves"}
      </span>
    </button>
  );
}

/* ── prose: markdown-lite + receipt marks ──────────────────────────── */

/** Deterministic markdown-lite: fenced code, bullet lists, paragraphs;
 *  inline `code` and **bold**. Receipt marks are injected around the exact
 *  quoted span (whitespace-tolerant), wrapped in a gold <mark>. */
function Prose({ text, marks }: { text: string; marks: Array<{ quote: SxQuote; n: number }> }) {
  const segments = useMemo(() => splitFences(text), [text]);
  return (
    <>
      {segments.map((seg, i) =>
        seg.fence ? (
          <pre key={i} className="sx-fence">{seg.text}</pre>
        ) : (
          <ProseBody key={i} text={seg.text} marks={marks} />
        ),
      )}
    </>
  );
}

function ProseBody({ text, marks }: { text: string; marks: Array<{ quote: SxQuote; n: number }> }) {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <>
      {paras.map((p, i) => {
        const listLines = p.split("\n");
        const isList = listLines.length > 0 && listLines.every((l) => /^[-*•]\s/.test(l.trim()));
        if (isList) {
          return (
            <ul key={i} className="sx-ul">
              {listLines.map((l, j) => (
                <li key={j}>{inline(l.trim().replace(/^[-*•]\s+/, ""), marks)}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{inline(p, marks)}</p>;
      })}
    </>
  );
}

function splitFences(text: string): Array<{ fence: boolean; text: string }> {
  const out: Array<{ fence: boolean; text: string }> = [];
  const parts = text.split(/```[a-zA-Z]*\n?/);
  parts.forEach((part, i) => {
    if (!part) return;
    out.push({ fence: i % 2 === 1, text: part.replace(/\n?```\s*$/, "") });
  });
  return out;
}

/** Inline rendering: receipt marks first (they own the span), then `code`
 *  and **bold** inside unmarked stretches. */
function inline(text: string, marks: Array<{ quote: SxQuote; n: number }>): React.ReactNode[] {
  for (const m of marks) {
    const re = quotePattern(m.quote.quote);
    const match = re ? text.match(re) : null;
    if (match && match.index != null) {
      const before = text.slice(0, match.index);
      const hit = match[0];
      const after = text.slice(match.index + hit.length);
      return [
        ...inline(before, marks.filter((x) => x !== m)),
        <mark
          key={`mark-${m.n}`}
          id={`sx-mark-${m.n}`}
          className="sx-mark"
          title={m.quote.why || "Quire holds these words as evidence"}
        >
          {hit}
          <sup className="sx-mark-sig" aria-label="became a receipt">❝</sup>
        </mark>,
        ...inline(after, marks.filter((x) => x !== m)),
      ];
    }
  }
  return inlineFmt(text);
}

function quotePattern(quote: string): RegExp | null {
  const words = quote.trim().split(/\s+/).map(escapeRe);
  if (words.length === 0) return null;
  try {
    return new RegExp(words.join("\\s+"));
  } catch {
    return null;
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inlineFmt(text: string): React.ReactNode[] {
  // split on `code` and **bold**, structural only.
  const out: React.ReactNode[] = [];
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(re)) {
    if (m.index == null) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) out.push(<code key={`c${k++}`} className="sx-code">{tok.slice(1, -1)}</code>);
    else out.push(<b key={`b${k++}`}>{tok.slice(2, -2)}</b>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/* ── small pieces ──────────────────────────────────────────────────── */

function EffortFig({ n, text, unit }: { n?: number; text?: string; unit: string }) {
  return (
    <span className="sx-fig">
      <b>{text ?? n}</b> {unit}
    </span>
  );
}

function vi(i: number): React.CSSProperties {
  return { "--i": i } as React.CSSProperties;
}

function baseName(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1] || p;
}

function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 14)}…` : id;
}

function formatWhen(ts: string): string {
  try {
    return new Date(ts).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

function formatClock(ts: string): string {
  try {
    if (!ts) return "";
    return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatDuration(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
