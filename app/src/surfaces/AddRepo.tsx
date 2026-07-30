import { useState, useRef } from "react";
import { registerRepo, scanRepo, draftRepo, approveRepo, firstResults } from "../api";
import type { DraftObligation, ScanResult, DraftResult } from "../types";

type Step =
  | "idle"
  | "cloning"
  | "drafting"
  | "review"
  | "approving"
  | "first-results"
  | "done"
  | "error";

interface AddRepoProps {
  onDone: () => void;
}

/** The paste-a-GitHub-URL onboarding flow.
 *  State machine: idle → cloning → drafting → review → approving →
 *  first-results → done. Machines propose; the human signs — the Approve
 *  act is the only gate, and nothing governs without it. */
export function AddRepo({ onDone }: AddRepoProps) {
  const [url, setUrl] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [obligations, setObligations] = useState<DraftObligation[]>([]);
  const workspaceRef = useRef<string>("");

  async function handleRegister() {
    if (!url.trim()) return;
    setError(null);
    setStep("cloning");
    try {
      const reg = await registerRepo(url.trim());
      workspaceRef.current = reg.workspace;
      const s = await scanRepo(reg.workspace);
      setScan(s);
      setStep("drafting");
      // Live LLM inference — honestly takes about a minute.
      const d = await draftRepo(reg.workspace, s.sources);
      setDraft(d);
      setObligations(
        d.obligations.map((o) => ({ ...o, accepted: true, editedStatement: o.statement })),
      );
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  }

  async function handleApprove() {
    if (!draft || !scan) return;
    setError(null);
    setStep("approving");
    const accepted = obligations.filter((o) => o.accepted !== false);
    // Carry any human edits into the statements that get signed.
    const finalObligations = accepted.map((o) => ({
      ...o,
      statement: o.editedStatement ?? o.statement,
    }));
    try {
      await approveRepo(workspaceRef.current, {
        sources: scan.sources,
        obligations: finalObligations,
        bindings: draft.bindings,
        sweep_commits: scan.commits,
      });
      setStep("first-results");
      await firstResults(workspaceRef.current, 2);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  }

  function toggleObligation(id: string) {
    setObligations((prev) =>
      prev.map((o) => (o.obligation_id === id ? { ...o, accepted: o.accepted === false } : o)),
    );
  }

  function editStatement(id: string, value: string) {
    setObligations((prev) =>
      prev.map((o) => (o.obligation_id === id ? { ...o, editedStatement: value } : o)),
    );
  }

  const acceptedCount = obligations.filter((o) => o.accepted !== false).length;

  return (
    <div className="add-repo-modal">
      {step === "idle" && (
        <div>
          <h2>Add a repository</h2>
          <p className="add-repo-sub">
            Paste a GitHub URL. The system reads the repo, drafts its promises — you sign.
            Nothing governs without your signature.
          </p>
          <div className="add-repo-row">
            <input
              className="add-repo-input"
              type="text"
              placeholder="https://github.com/owner/name"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleRegister(); }}
              autoFocus
            />
            <button
              className="ink-btn primary add-repo-submit"
              onClick={handleRegister}
              disabled={!url.trim()}
            >
              Register
            </button>
          </div>
        </div>
      )}

      {step === "cloning" && (
        <Progress title="Cloning…" note="Reading the repository. This takes a few seconds." />
      )}

      {step === "drafting" && (
        <Progress
          title="Drafting promises…"
          note="Reading the repo's docs and drafting candidate promises. This takes about a minute — live reasoning is running."
        />
      )}

      {step === "review" && (
        <div>
          <h2>Promises drafted — your review</h2>
          <p className="add-repo-sub">
            The system found {obligations.length} candidate{obligations.length !== 1 ? "s" : ""}.
            Accept or reject each; edit the wording to match what you actually mean.
            You sign what remains.
          </p>
          <div className="add-repo-cards">
            {obligations.map((o) => (
              <ObligationCard
                key={o.obligation_id}
                obligation={o}
                onToggle={() => toggleObligation(o.obligation_id)}
                onEdit={(v) => editStatement(o.obligation_id, v)}
              />
            ))}
          </div>
          <div className="add-repo-signing">
            <button
              className="ink-btn primary add-repo-sign"
              onClick={handleApprove}
              disabled={acceptedCount === 0}
            >
              Sign — make these promises
            </button>
            {acceptedCount === 0 ? (
              <span className="add-repo-sign-hint">Accept at least one promise to continue.</span>
            ) : (
              <span className="add-repo-sign-hint">
                You are signing {acceptedCount} promise{acceptedCount !== 1 ? "s" : ""}. Machines
                proposed; you decide.
              </span>
            )}
          </div>
        </div>
      )}

      {step === "approving" && (
        <Progress title="Signing…" note="Writing your approved promises to the workspace." />
      )}

      {step === "first-results" && (
        <Progress
          title="Running first checks…"
          note="Replaying recent pull requests against your promises."
        />
      )}

      {step === "done" && (
        <div className="add-repo-done">
          <div className="add-repo-done-icon">✓</div>
          <h2>Repository added</h2>
          <p className="add-repo-sub">
            The repo is now governed — its promises are in effect, and its first check results
            are on the repo. You can see it in the tree.
          </p>
          <button className="ink-btn primary" onClick={onDone}>
            Close
          </button>
        </div>
      )}

      {step === "error" && (
        <div className="add-repo-error">
          <h2>Something went wrong</h2>
          <p className="add-repo-sub" style={{ color: "var(--red)" }}>
            {error ?? "An unexpected error occurred."}
          </p>
          <button className="ink-btn" onClick={() => { setStep("idle"); setError(null); }}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

function Progress({ title, note }: { title: string; note: string }) {
  return (
    <div className="add-repo-progress">
      <div className="add-repo-spinner" aria-hidden />
      <div className="add-repo-progress-text">
        <strong>{title}</strong>
        <span>{note}</span>
      </div>
    </div>
  );
}

interface ObligationCardProps {
  obligation: DraftObligation;
  onToggle: () => void;
  onEdit: (value: string) => void;
}

/** One drafted promise: plain statement (editable), verbatim source quote as
 *  the receipt, and the human's accept/reject call. Ids stay out of the copy. */
function ObligationCard({ obligation: o, onToggle, onEdit }: ObligationCardProps) {
  const accepted = o.accepted !== false;
  return (
    <div className={`obligation-card${accepted ? "" : " obligation-card--rejected"}`}>
      <div className="obligation-card-top">
        <button
          className={`obligation-toggle${accepted ? " obligation-toggle--on" : ""}`}
          onClick={onToggle}
          aria-label={accepted ? "Reject this promise" : "Accept this promise"}
        >
          {accepted ? "Accepted" : "Rejected"}
        </button>
        <textarea
          className="obligation-statement"
          value={o.editedStatement ?? o.statement}
          onChange={(e) => onEdit(e.target.value)}
          disabled={!accepted}
          rows={2}
          aria-label="Promise statement"
        />
      </div>
      {o.source_quote && (
        <div className="obligation-receipt">
          <div className="obligation-receipt-label">Source — verbatim</div>
          <blockquote className="obligation-quote">{o.source_quote}</blockquote>
          <div className="obligation-source-ref">{o.source_reference}</div>
        </div>
      )}
    </div>
  );
}
