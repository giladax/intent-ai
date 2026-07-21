import { z } from "zod";

// ── Zod Schemas ───────────────────────────────────────────────────────

export const VerifyVerdictSchema = z.object({
  momentId: z.string(),
  verdict: z.enum(["supported", "contradicted", "unverified"]),
  note: z.string().optional().default(""),
});

export const VerifyOutputSchema = z.object({
  verdicts: z.array(VerifyVerdictSchema),
});

// ── Prompt Builder ─────────────────────────────────────────────────────

/**
 * Build the system + user prompt for the verify stage.
 *
 * The model receives claim moments and their associated tool event windows,
 * and outputs verdicts (supported / contradicted / unverified) for each.
 */
export function buildVerifyPrompt(input: {
  claims: { momentId: string; statement: string; type: string }[];
  windows: Map<string, string>;
}): { system: string; user: string } {
  const { claims, windows } = input;

  const system = `You are auditing claims from a coding-session digest against what the tools actually did.
For each claim you get the tool activity (commands, edits, results) from the same part of the session.
- "supported": tool events directly show the claimed thing happened (the test run passed, the commit exists, the command succeeded)
- "contradicted": tool events show the opposite (the test still failed after the claimed fix, the command errored)
- "unverified": the window contains no tool evidence either way
Judge ONLY from the provided events. An assistant SAYING it did something is not tool evidence.

## Output format

Return ONLY a JSON object:
{
  "verdicts": [
    {
      "momentId": "moment-0",
      "verdict": "supported" | "contradicted" | "unverified",
      "note": "brief rationale (optional)"
    }
  ]
}`;

  const claimBlocks = claims.map((claim) => {
    const window = windows.get(claim.momentId) ?? "(no tool events found)";
    return [
      `### Claim: ${claim.momentId}`,
      `Type: ${claim.type}`,
      `Statement: ${claim.statement}`,
      ``,
      `Tool events:`,
      window,
    ].join("\n");
  });

  const user = [
    `## Claims to verify (${claims.length} total)`,
    ``,
    claimBlocks.join("\n\n---\n\n"),
    ``,
    `Return verdicts for all ${claims.length} claims. Return JSON only.`,
  ].join("\n");

  return { system, user };
}
