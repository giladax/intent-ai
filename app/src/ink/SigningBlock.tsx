import { useState } from "react";

/** The signing ceremony — wherever a human puts their name to a decision.
 *
 *  Signing something that matters should feel deliberate: a name, a role, and
 *  a confirm that reads as the act ("Sign — wave it through", "Sign — make
 *  these promises"). No confetti, no kitsch — the weight comes from the
 *  restraint. Machines propose; the human signs, and nothing governs without
 *  the signature.
 *
 *  Two modes:
 *   - collapsed: a single "your call" affordance that opens the block on click
 *     (used in the review rail, where the buttons ARE the ceremony trigger);
 *   - open: the name/role fields + the deliberate confirm.
 *
 *  Reused by the review rail (a review's pending human act) and the add-repo
 *  flow (signing drafted promises) — one treatment, consistent everywhere. */
export interface SigningBlockProps {
  /** The verb of the act, e.g. "Wave it through" or "Make these promises". */
  actLabel: string;
  /** The plain sentence describing what is being signed. */
  prompt: string;
  /** Called with the signer's name + role when they confirm. */
  onSign: (signer: { name: string; role: string }) => void;
  /** Disable the whole block (e.g. nothing accepted yet). */
  disabled?: boolean;
  /** A hint shown under the confirm when disabled. */
  disabledHint?: string;
  /** Danger styling for a destructive act (e.g. "Send back"). */
  tone?: "primary" | "danger" | "plain";
  /** Signing in flight. */
  busy?: boolean;
}

export function SigningBlock({
  actLabel,
  prompt,
  onSign,
  disabled = false,
  disabledHint,
  tone = "primary",
  busy = false,
}: SigningBlockProps) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const ready = name.trim().length > 0 && !disabled && !busy;

  return (
    <div className="signing-block" data-tone={tone}>
      <div className="signing-prompt">{prompt}</div>
      <div className="signing-fields">
        <input
          className="signing-input"
          type="text"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={disabled || busy}
          aria-label="Your name"
          autoComplete="name"
        />
        <input
          className="signing-input signing-role"
          type="text"
          placeholder="Role (optional) — e.g. CEO"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          disabled={disabled || busy}
          aria-label="Your role"
        />
      </div>
      <button
        className={`ink-btn signing-confirm ${tone === "danger" ? "danger" : "primary"}`}
        disabled={!ready}
        onClick={() => ready && onSign({ name: name.trim(), role: role.trim() })}
      >
        {busy ? "Signing…" : `Sign — ${actLabel.toLowerCase()}`}
      </button>
      {disabled && disabledHint ? (
        <div className="signing-hint">{disabledHint}</div>
      ) : (
        <div className="signing-hint signing-hint--quiet">
          A signature has a name. Machines proposed; you decide.
        </div>
      )}
    </div>
  );
}
