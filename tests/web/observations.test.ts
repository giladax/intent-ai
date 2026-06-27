import { describe, it, expect } from "vitest";
import {
  composeCurrentUnderstanding,
  containsLine,
  normalizeGlob,
  isObservationCategory,
  observationKind,
} from "../../src/web/observations.js";

describe("composeCurrentUnderstanding", () => {
  it("appends an observation as a bullet when understanding is empty", () => {
    expect(composeCurrentUnderstanding(null, "uses denormalized events")).toBe(
      "- uses denormalized events",
    );
    expect(composeCurrentUnderstanding("", "uses denormalized events")).toBe(
      "- uses denormalized events",
    );
  });

  it("appends after existing text on a new line", () => {
    const out = composeCurrentUnderstanding("Existing summary.", "new fact");
    expect(out).toBe("Existing summary.\n- new fact");
  });

  it("is idempotent — does not duplicate an existing line", () => {
    const base = "- already known fact";
    expect(composeCurrentUnderstanding(base, "already known fact")).toBe(base);
    expect(composeCurrentUnderstanding(base, "  Already   Known FACT ")).toBe(base);
  });

  it("does not double the bullet prefix when the observation already has one", () => {
    expect(composeCurrentUnderstanding("", "- pre-bulleted")).toBe("- pre-bulleted");
  });

  it("returns trimmed base unchanged for empty observations", () => {
    expect(composeCurrentUnderstanding("  base  ", "   ")).toBe("base");
  });
});

describe("containsLine", () => {
  it("matches normalized lines ignoring bullets and case", () => {
    expect(containsLine("- Foo Bar", "foo bar")).toBe(true);
    expect(containsLine("* Foo Bar", "foo  bar")).toBe(true);
    expect(containsLine("Foo Bar", "different")).toBe(false);
  });
  it("returns false for empty candidate", () => {
    expect(containsLine("anything", "")).toBe(false);
  });
});

describe("normalizeGlob", () => {
  it("trims and preserves globs", () => {
    expect(normalizeGlob("  src/web/**  ")).toBe("src/web/**");
  });
  it("rejects empties", () => {
    expect(normalizeGlob("")).toBeNull();
    expect(normalizeGlob("   ")).toBeNull();
    expect(normalizeGlob(undefined)).toBeNull();
  });
});

describe("observation category helpers", () => {
  it("detects observation categories", () => {
    expect(isObservationCategory("observation:constraint")).toBe(true);
    expect(isObservationCategory("coding:struggle")).toBe(false);
    expect(isObservationCategory(null)).toBe(false);
  });
  it("extracts the kind", () => {
    expect(observationKind("observation:unknown")).toBe("unknown");
    expect(observationKind("observation:")).toBe("");
    expect(observationKind("coding:struggle")).toBe("");
  });
});
