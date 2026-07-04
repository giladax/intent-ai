import type { SessionMoment, SessionChunk } from "../../adapters/types.js";
import { callSonnet } from "../../llm/client.js";
import {
  buildVerifyPrompt,
  VerifyOutputSchema,
} from "../../llm/prompts/understand/verify.js";

// ── Claim types ───────────────────────────────────────────────────────

/** Moment types that carry outcome claims needing verification */
const CLAIM_TYPES = new Set<SessionMoment["type"]>([
  "confirmation",
  "breakthrough",
  "execution",
]);

// ── selectClaims ──────────────────────────────────────────────────────

/**
 * Pure: return only moments whose type is confirmation, breakthrough, or execution.
 * Non-claim moments are never sent to the verifier.
 */
export function selectClaims(moments: SessionMoment[]): SessionMoment[] {
  return moments.filter((m) => CLAIM_TYPES.has(m.type));
}

// ── buildClaimWindow ──────────────────────────────────────────────────

const WINDOW_CHAR_LIMIT = 4000;
const TRUNCATION_MARKER = "— window truncated";

/**
 * Pure: render the action + result events from the moment's chunk as a
 * causal-order-prefixed string, capped at 4000 chars.
 *
 * Includes ALL results (success and failure) — a passing test is what
 * "supported" looks like to the verifier.
 *
 * Truncates whole events from the end, keeping a truncation marker.
 */
export function buildClaimWindow(
  moment: SessionMoment,
  chunks: SessionChunk[],
): string {
  const chunk = chunks.find((c) => c.id === moment.chunkId);
  if (!chunk) return "(chunk not found)";

  // Filter to action and result events only
  const events = chunk.events.filter(
    (e) => e.category === "action" || e.category === "result",
  );

  if (events.length === 0) return "(no action or result events in chunk)";

  // Render each event as a line
  const lines = events.map((e) => {
    const detail = e.content.detail.slice(0, 500);
    return `[${e.causalOrder}] ${e.category.toUpperCase()}(${e.actor}): ${detail}`;
  });

  // Build the window, truncating whole events from the end if needed
  const fullText = lines.join("\n");
  if (fullText.length <= WINDOW_CHAR_LIMIT) return fullText;

  // Truncate whole events from the end until we fit
  for (let end = lines.length - 1; end >= 1; end--) {
    const candidate = lines.slice(0, end).join("\n") + "\n" + TRUNCATION_MARKER;
    if (candidate.length <= WINDOW_CHAR_LIMIT) return candidate;
  }

  // Fallback: just the marker (shouldn't happen for reasonable events)
  return TRUNCATION_MARKER;
}

// ── applyVerdicts ─────────────────────────────────────────────────────

/**
 * Pure: apply LLM verdicts to moments, returning updated SessionMoment[].
 *
 * Rules:
 * - Non-claim moments: verification stays null (untouched)
 * - Claim moment with a verdict: sets verification
 *   - "contradicted" also forces confidence to "low" (calibration)
 *   - "supported" with null confidence: leaves confidence as-is
 * - Claim moment with no verdict returned: set to "unverified"
 * - Unknown momentId in verdicts: ignored
 */
export function applyVerdicts(
  moments: SessionMoment[],
  verdicts: {
    momentId: string;
    verdict: "supported" | "contradicted" | "unverified";
  }[],
): SessionMoment[] {
  // Build verdict lookup by momentId
  const verdictById = new Map(verdicts.map((v) => [v.momentId, v.verdict]));

  // Collect claim ids for easy lookup
  const claimIds = new Set(selectClaims(moments).map((m) => m.id));

  return moments.map((moment) => {
    if (!claimIds.has(moment.id)) {
      // Non-claim: leave untouched (verification stays null)
      return moment;
    }

    const verdict = verdictById.get(moment.id);

    if (verdict === undefined) {
      // Claim sent but no verdict returned: mark unverified
      return { ...moment, verification: "unverified" };
    }

    if (verdict === "contradicted") {
      // Code-enforced calibration: contradicted → confidence demoted to "low"
      return { ...moment, verification: "contradicted", confidence: "low" };
    }

    // supported or unverified: set verification, leave confidence unchanged
    return { ...moment, verification: verdict };
  });
}

// ── verifyMoments ─────────────────────────────────────────────────────

/**
 * Verify stage: check outcome claims against tool events.
 *
 * Fail-open: on LLM failure, logs to stderr and returns moments unchanged.
 * If there are zero claim moments, returns immediately without calling the LLM.
 */
export async function verifyMoments(
  moments: SessionMoment[],
  chunks: SessionChunk[],
): Promise<SessionMoment[]> {
  const claims = selectClaims(moments);

  if (claims.length === 0) {
    return moments;
  }

  // Build claim windows
  const windows = new Map<string, string>(
    claims.map((m) => [m.id, buildClaimWindow(m, chunks)]),
  );

  // Build prompt
  const claimInputs = claims.map((m) => ({
    momentId: m.id,
    statement: m.statement,
    type: m.type,
  }));

  const { system, user } = buildVerifyPrompt({ claims: claimInputs, windows });

  try {
    const output = await callSonnet(system, user, VerifyOutputSchema);
    return applyVerdicts(moments, output.verdicts);
  } catch (err) {
    process.stderr.write(
      `[verify] LLM call failed — returning moments unchanged. Error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return moments;
  }
}
