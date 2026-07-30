import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  approveIntentCards,
  fetchIntentCards,
  type IntentCard,
  type IntentCardsResult,
} from "../api";
import { SigningBlock } from "../ink/SigningBlock";

/** O4 — Sessions as INTENT.
 *
 *  A session where a founder worked out product direction proposes intent.
 *  This room shows the distilled cards — each a plain statement backed by a
 *  verbatim quote from the session — with per-card accept / edit / reject, and
 *  a signing block. The signature is the authority act: it writes the memo and
 *  registers it as approved intent. The session itself stays observed evidence;
 *  only the signed memo governs. */
export function IntentReview() {
  const { id } = useParams<{ id: string }>();
  const uploadId = id ?? "";

  const [data, setData] = useState<IntentCardsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Per-card decisions: accepted + editable statement. A ref mirrors the
  // latest decisions so the signing handler always reads the current state,
  // never a stale closure captured before the last accept/reject/edit.
  const [decisions, setDecisions] = useState<
    Array<{ accept: boolean; statement: string; source_quote: string; speaker?: string }>
  >([]);
  const decisionsRef = useRef(decisions);
  decisionsRef.current = decisions;
  const [signing, setSigning] = useState(false);
  const [settled, setSettled] = useState<{
    reference: string;
    workspace: string;
    count: number;
  } | null>(null);

  useEffect(() => {
    if (!uploadId) return;
    fetchIntentCards(uploadId)
      .then((d) => {
        setData(d);
        setDecisions(
          d.cards.map((c) => ({
            accept: true,
            statement: c.statement,
            source_quote: c.source_quote,
            speaker: c.speaker,
          })),
        );
      })
      .catch((e) => setError(String(e)));
  }, [uploadId]);

  const acceptedCount = decisions.filter((d) => d.accept).length;

  async function handleSign(signer: { name: string; role: string }) {
    if (!uploadId || acceptedCount === 0) return;
    setSigning(true);
    setError(null);
    const approvedBy = signer.role
      ? `${signer.name} (${signer.role})`
      : signer.name;
    try {
      const cards: Array<IntentCard & { accept: boolean }> = decisionsRef.current.map((d) => ({
        statement: d.statement,
        source_quote: d.source_quote,
        speaker: d.speaker,
        accept: d.accept,
      }));
      const res = await approveIntentCards(uploadId, approvedBy, cards);
      setSettled({
        reference: res.reference,
        workspace: res.workspace,
        count: res.signed,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setSigning(false);
    }
  }

  if (!uploadId) return <main className="ink-main">No session.</main>;

  if (settled) {
    // Honest settled state: the memo landed as approved intent.
    return (
      <main className="ink-main">
        <div className="ink-crumb">
          <b>Quire</b> <span className="sep">/</span> Needs you{" "}
          <span className="sep">/</span> Session intent
        </div>
        <div className="ink-empty">
          <div className="big">Signed — the intent is now approved</div>
          {settled.count} statement{settled.count === 1 ? "" : "s"} became a signed
          session memo. It governs the analyzer like any PRD; the session stays
          observed evidence.
          <div style={{ marginTop: 16 }}>
            <Link className="ink-btn primary" to={`/repo/${settled.workspace}`}>
              See it on the repo →
            </Link>{" "}
            <Link className="ink-btn" to="/needs-you">
              Back to Needs you
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="ink-main">
      <div className="ink-crumb">
        <b>Quire</b> <span className="sep">/</span> Needs you{" "}
        <span className="sep">/</span> Session intent
      </div>
      <div className="ink-main-head">
        <h1>A session proposes intent</h1>
        <div className="sub">
          {data
            ? `${data.cards.length} card${data.cards.length === 1 ? "" : "s"} distilled from the session — accept, edit, or reject, then sign.`
            : "Distilling the session…"}
        </div>
      </div>

      {error && <div className="ink-error">{error}</div>}

      {data === null && !error ? (
        <div className="ink-empty">Distilling the session…</div>
      ) : data && data.cards.length === 0 ? (
        <div className="ink-empty">
          <div className="big">No product direction found</div>
          Nothing in this session reads as a statement of product direction with a
          verbatim quote. Nothing to sign.
        </div>
      ) : (
        <>
          <div className="intent-source">
            From session{" "}
            <span className="mono">{data?.session_id}</span> ·{" "}
            <span>{data?.repo}</span>
          </div>

          {data?.cards.map((card, i) => (
            <IntentCardRow
              key={i}
              card={card}
              accepted={decisions[i]?.accept ?? true}
              statement={decisions[i]?.statement ?? card.statement}
              onToggle={() =>
                setDecisions((ds) =>
                  ds.map((d, j) => (j === i ? { ...d, accept: !d.accept } : d)),
                )
              }
              onEdit={(s) =>
                setDecisions((ds) =>
                  ds.map((d, j) => (j === i ? { ...d, statement: s } : d)),
                )
              }
            />
          ))}

          {data && data.notes.length > 0 && (
            <div className="intent-notes">
              {data.notes.length} candidate
              {data.notes.length === 1 ? " was" : "s were"} dropped — their quotes
              did not resolve verbatim against the session transcript.
            </div>
          )}

          <SigningBlock
            actLabel="approve this intent"
            prompt={`Sign ${acceptedCount} statement${acceptedCount === 1 ? "" : "s"} — they become an approved session memo that governs the analyzer.`}
            onSign={handleSign}
            disabled={acceptedCount === 0 || signing}
            disabledHint={
              acceptedCount === 0 ? "Accept at least one card to sign." : undefined
            }
            busy={signing}
          />
        </>
      )}
    </main>
  );
}

function IntentCardRow({
  card,
  accepted,
  statement,
  onToggle,
  onEdit,
}: {
  card: IntentCard;
  accepted: boolean;
  statement: string;
  onToggle: () => void;
  onEdit: (s: string) => void;
}) {
  return (
    <div className={`intent-card${accepted ? "" : " rejected"}`}>
      <div className="intent-card-top">
        <button
          className={`ink-btn intent-toggle ${accepted ? "primary" : ""}`}
          onClick={onToggle}
          aria-pressed={accepted}
        >
          {accepted ? "Accepted" : "Rejected"}
        </button>
        <span className="intent-kind">product direction</span>
      </div>
      <textarea
        className="intent-statement"
        value={statement}
        disabled={!accepted}
        onChange={(e) => onEdit(e.target.value)}
        rows={2}
        aria-label="Intent statement"
      />
      <div className="intent-quote">
        <span className="intent-quote-mark">“</span>
        {card.source_quote}
        <span className="intent-quote-mark">”</span>
        {card.speaker && <span className="intent-speaker"> — {card.speaker}</span>}
      </div>
    </div>
  );
}
