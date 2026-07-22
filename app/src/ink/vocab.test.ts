import { describe, it, expect } from "vitest";
import { verdictOf, inkForVerdict, INK_VARS, type VocabPayload } from "./vocab";

/** A vocab payload shaped exactly like /api/vocab (quire/vocab.py). This is the
 *  frontend guarantee that the ruled plain labels survive translation and that
 *  no shell surface re-invents wording. */
const VOCAB: VocabPayload = {
  verdicts: {
    OFF_INTENT:        { label: "Breaks a promise",      verb: "broke a promise",               ink: "red",   severity: "critical" },
    PARTIAL:           { label: "Partly kept",           verb: "partly kept a promise",          ink: "amber", severity: "high"     },
    POSSIBLE_DRIFT:    { label: "May be drifting",       verb: "may be drifting from a promise", ink: "amber", severity: "high"     },
    UNGOVERNED:        { label: "No promise covers it",  verb: "no promise covers it",           ink: "blue",  severity: "medium"   },
    UNKNOWN:           { label: "Needs your review",     verb: "needs your review",              ink: "gray",  severity: "medium"   },
    NO_MATERIAL_IMPACT:{ label: "No product impact",     verb: "no product impact",              ink: "gray",  severity: "info"     },
    ALIGNED:           { label: "Keeps its promises",    verb: "kept its promises",              ink: "green", severity: "info"     },
  },
  unknown: { label: "Needs your review", verb: "needs your review", ink: "gray", severity: "medium" },
  severityRank: { critical: 0, high: 1, medium: 2, info: 3 },
};

describe("verdict vocabulary — the ruled plain language", () => {
  it("translates OFF_INTENT to 'Breaks a promise', painted red", () => {
    const v = verdictOf(VOCAB, "OFF_INTENT");
    expect(v.label).toBe("Breaks a promise");
    expect(v.ink).toBe("red");
  });

  it("translates UNGOVERNED to 'No promise covers it', painted blue", () => {
    expect(verdictOf(VOCAB, "UNGOVERNED").label).toBe("No promise covers it");
    expect(inkForVerdict(VOCAB, "UNGOVERNED")).toBe("blue");
  });

  it("translates PARTIAL and POSSIBLE_DRIFT (amber) and NO_MATERIAL_IMPACT and ALIGNED", () => {
    expect(verdictOf(VOCAB, "PARTIAL").label).toBe("Partly kept");
    expect(inkForVerdict(VOCAB, "PARTIAL")).toBe("amber");
    expect(verdictOf(VOCAB, "POSSIBLE_DRIFT").label).toBe("May be drifting");
    expect(inkForVerdict(VOCAB, "POSSIBLE_DRIFT")).toBe("amber");
    expect(verdictOf(VOCAB, "NO_MATERIAL_IMPACT").label).toBe("No product impact");
    expect(inkForVerdict(VOCAB, "NO_MATERIAL_IMPACT")).toBe("gray");
    expect(verdictOf(VOCAB, "ALIGNED").label).toBe("Keeps its promises");
    expect(inkForVerdict(VOCAB, "ALIGNED")).toBe("green");
  });

  it("keeps uncertainty gray — never colourful", () => {
    expect(inkForVerdict(VOCAB, "UNKNOWN")).toBe("gray");
    expect(inkForVerdict(VOCAB, null)).toBe("gray");
    expect(inkForVerdict(VOCAB, "SOME_FUTURE_ENUM")).toBe("gray");
  });

  it("banishes enum jargon from every human label", () => {
    for (const row of Object.values(VOCAB.verdicts)) {
      expect(row.label).not.toMatch(/CONTRADICTS|UNGOVERNED|OFF_INTENT|_/);
      expect(row.label).not.toMatch(/[A-Z]{4,}/); // no SHOUTING enum tokens
    }
  });

  it("maps every ink to a CSS variable pair", () => {
    for (const ink of ["red", "amber", "blue", "green", "gray"] as const) {
      expect(INK_VARS[ink].fg).toMatch(/^var\(--/);
      expect(INK_VARS[ink].bg).toMatch(/^var\(--/);
    }
  });
});
