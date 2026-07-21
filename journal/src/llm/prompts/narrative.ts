import { z } from "zod";
import type { Pass2Moment } from "../../adapters/types.js";
import type { IntentTransition, AcceptedOutcome } from "./transitions.js";
import type { SessionShape } from "./classify.js";
import type { Sitting } from "../../adapters/types.js";

// ── Zod Schemas ──────────────────────────────────────────────────────

const NarrativeArcSchema = z.object({
  arcId: z.string(),
  title: z.string(),
  summary: z.string(),
  resolution: z.enum(["completed", "abandoned", "ongoing", "merged"]),
  momentIds: z.array(z.number()),
});

export const SessionNarrativeSchema = z.object({
  sessionShape: z.string(),
  summary: z.string(),
  arcs: z.array(NarrativeArcSchema),
  progression: z.array(z.string()),
  discoveries: z.array(z.string()),
  stabilizedDirections: z.array(z.string()),
  abandonedDirections: z.array(z.string()),
});

export type NarrativeArc = z.infer<typeof NarrativeArcSchema>;
export type SessionNarrative = z.infer<typeof SessionNarrativeSchema>;

// ── Prompt Input ─────────────────────────────────────────────────────

export interface NarrativeInput {
  moments: Pass2Moment[];
  transitions: IntentTransition[];
  outcomes: AcceptedOutcome[];
  sessionShape: SessionShape;
  sittings?: Sitting[];
}

// ── Prompt Builder ───────────────────────────────────────────────────

// ── Sitting Rendering Helper ─────────────────────────────────────────

function renderGap(prevEndedAt: string, nextStartedAt: string): string {
  const gapMs = new Date(nextStartedAt).getTime() - new Date(prevEndedAt).getTime();
  const gapHours = gapMs / (1000 * 60 * 60);
  if (gapHours >= 24) {
    const days = gapHours / 24;
    return `after a ${days.toFixed(1)}-day gap`;
  }
  return `after a ${gapHours.toFixed(1)}-hour gap`;
}

export function buildNarrativePrompt(input: NarrativeInput): {
  system: string;
  user: string;
} {
  const { moments, transitions, outcomes, sessionShape, sittings = [] } = input;

  const sittingInstruction = sittings.length > 1
    ? `\nThis session happened in the sittings listed above. Progression entries must respect sitting boundaries — never narrate work from different sittings as one continuous flow; name the break ("after a two-day gap, ...").\n`
    : "";

  const system = `You are a technical narrator for developer coding sessions. You synthesize moments, transitions, and outcomes into a concise narrative that captures what actually happened.
${sittingInstruction}
## Tone

- **Observational** — You report what happened, not what should have happened. You're a historian, not a coach.
- **Evidence-backed** — Every claim maps to specific moments. Don't editorialize.
- **Developer's language** — Use the same terms the developer used. If they called it "the auth thing," don't upgrade it to "authentication module."
- **Never recommend** — Don't say "consider using X" or "it might be better to Y." You are recording, not advising.

## What to produce

### summary
A 2-4 sentence narrative of the session. What did the developer set out to do? What actually happened? How did it end? Use past tense.

### arcs
Each narrative arc represents a coherent thread of activity. Give each arc:
- **title** — Short, descriptive, in the developer's language
- **summary** — 1-2 sentences about what happened in this arc
- **resolution** — "completed" (the arc reached its goal), "abandoned" (developer gave up or moved on), "ongoing" (still in progress when session ended), "merged" (got absorbed into another arc)
- **momentIds** — Indices into the moments array that belong to this arc

### progression
An ordered list of 3-8 statements describing how the session unfolded chronologically. Each statement should be a single sentence. Think of this as a timeline.

### discoveries
Key things the developer learned or uncovered during the session. Only include genuine insights, not trivial observations. Can be empty.

### stabilizedDirections
Decisions or approaches that became established during this session — things that started uncertain but are now settled. Can be empty.

### abandonedDirections
Approaches that were tried and rejected, or directions that were considered but not pursued. Can be empty.

Respond with ONLY a JSON object matching the schema above.`;

  // Build sittings section
  const sittingsSection = sittings.length > 0
    ? `## Sittings (${sittings.length}):\n${sittings.map((s, idx) => {
        const gapNote = idx > 0 ? `, ${renderGap(sittings[idx - 1].endedAt, s.startedAt)}` : "";
        const start = s.startedAt.slice(0, 16).replace("T", " ");
        const end = s.endedAt.slice(0, 16).replace("T", " ");
        return `Sitting ${idx + 1}: ${start} → ${end} (events ${s.eventRange[0]}–${s.eventRange[1]})${gapNote}`;
      }).join("\n")}\n\n`
    : "";

  const user = `## Session Shape: ${sessionShape.shape}

${sittingsSection}## Moments (${moments.length}):
${moments
  .map(
    (m, i) => {
      const topEvidence = m.evidence.slice(0, 2).map(e => `"${e.quote.slice(0, 100)}"`).join("; ");
      const timeNote = m.occurredAt ? ` at ${m.occurredAt.slice(0, 16).replace("T", " ")}` : "";
      return `${i}. [${m.type}] (arc: ${m.arcId}, ${m.arcRole}) agency=${m.agency}${timeNote}
   ${m.statement}
   significance: ${m.significance}${topEvidence ? `\n   evidence: ${topEvidence}` : ""}`;
    },
  )
  .join("\n")}

## Intent Transitions (${transitions.length}):
${transitions.length === 0 ? "(none — developer maintained consistent intent)" : transitions
  .map(
    (t, i) => `${i}. "${t.fromStatement}" → "${t.toStatement}"
   reason: ${t.reason} (arc: ${t.arcId})`,
  )
  .join("\n")}

## Accepted Outcomes (${outcomes.length}):
${outcomes.length === 0 ? "(none — session was exploratory or incomplete)" : outcomes
  .map(
    (o, i) => `${i}. ${o.statement}
   files: ${o.filesAffected.slice(0, 10).join(", ")}`,
  )
  .join("\n")}

Generate the session narrative. Return JSON only.`;

  return { system, user };
}
