// I4 — voice banned-word scan for user-facing string literals in UI components.
//
// Scans all files in src/web/ui/src/components/ for banned voice words
// appearing in JSX text content and user-facing JSX props (title, placeholder,
// aria-label, alt).
//
// Goal: catch copy regressions (e.g. "the river runs empty") — not static
// analysis perfection. Excluded:
//   - CSS class/className attribute values
//   - CSS variable strings (var(--lc-ink))
//   - Variable/identifier names in code (sitting, sittings)
//   - Comments (line and block)
//   - import paths, function names, object key-value pairs
//
// Approach: specifically extract JSX bare text + named user-facing props.
// Avoids stripping heuristics that produce false positives.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const COMPONENTS_DIR = "src/web/ui/src/components";

// The banned voice words (whole-word, case-insensitive).
const BANNED_WORDS = ["river", "sittings", "sitting", "ink", "correspondence", "edition", "unfolded"];

function buildBannedRegex(): RegExp {
  const pattern = BANNED_WORDS.join("|");
  return new RegExp(`\\b(${pattern})\\b`, "i");
}

/**
 * Extract candidate user-facing strings from a TSX/TS source file.
 *
 * Returns only:
 *   1. JSX text node content: text that appears between > and < in JSX
 *      (i.e. literal string content, not expressions)
 *   2. String values of explicitly user-facing props: title, placeholder,
 *      aria-label, alt — extracted with targeted regex
 *
 * Excludes:
 *   - Block and line comments
 *   - CSS variable strings (var(--...))
 *   - Any string value starting with -- (CSS variable)
 *   - className, style, and all other prop values
 *   - Code lines (variable declarations, object literals, JSX expressions)
 */
function extractUserFacingStrings(source: string): Array<{ lineNo: number; text: string }> {
  // Remove block comments (preserves line numbers via newline placeholders)
  let s = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  // Remove line comments
  s = s.replace(/\/\/[^\n]*/g, "");

  const results: Array<{ lineNo: number; text: string }> = [];

  // ── Pass 1: User-facing prop string values ──────────────────────────────
  // Extract title="...", placeholder="...", aria-label="...", alt="..." values
  // across the whole file. We track line number by counting newlines up to match.
  const USER_PROP_RE = /(?:title|placeholder|aria-label|alt)\s*=\s*"([^"]*)"/g;
  let pm: RegExpExecArray | null;
  while ((pm = USER_PROP_RE.exec(s)) !== null) {
    const val = pm[1].trim();
    if (!val) continue;
    if (val.includes("var(--")) continue; // CSS variable — not user-facing
    const lineNo = s.slice(0, pm.index).split("\n").length;
    results.push({ lineNo, text: val });
  }

  // ── Pass 2: JSX bare text nodes ─────────────────────────────────────────
  // A JSX text node is text that appears between a closing > of a tag and an
  // opening < of the next tag, contains only literal text (no { expressions).
  // Pattern: >\s*(text with word chars)\s*<  where text has no { or }
  const JSX_TEXT_RE = />\s*([^<>{}\n]+?)\s*</g;
  let tm: RegExpExecArray | null;
  while ((tm = JSX_TEXT_RE.exec(s)) !== null) {
    const raw = tm[1].trim();
    if (!raw) continue;
    // Must have at least one alphabetic word (2+ chars) to be considered copy
    if (!/[a-zA-Z]{2,}/.test(raw)) continue;
    // Skip if it looks like a CSS variable value
    if (raw.includes("var(--")) continue;
    // Skip HTML entities standing alone
    if (/^&[a-zA-Z]+;$/.test(raw)) continue;
    const lineNo = s.slice(0, tm.index).split("\n").length;
    results.push({ lineNo, text: raw });
  }

  return results;
}

describe("voice-word banned-word scan", () => {
  let files: string[];
  try {
    files = readdirSync(join(process.cwd(), COMPONENTS_DIR))
      .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
      // Exclude ui/ shadcn primitives — not product copy
      .filter((f) => !f.startsWith("ui/"))
      .map((f) => join(COMPONENTS_DIR, f));
  } catch {
    files = [];
  }

  it("component directory is non-empty (sanity)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} has no user-facing banned voice words`, () => {
      let source: string;
      try {
        source = readFileSync(join(process.cwd(), file), "utf-8");
      } catch {
        return; // file vanished — skip
      }

      const candidates = extractUserFacingStrings(source);
      const bannedRe = buildBannedRegex();
      const violations: string[] = [];

      for (const { lineNo, text } of candidates) {
        const match = bannedRe.exec(text);
        if (match) {
          violations.push(`  line ~${lineNo}: ${text} (word: "${match[1]}")`);
        }
      }

      expect(
        violations,
        `${file} contains banned voice word(s) in user-facing content:\n${violations.join("\n")}`,
      ).toHaveLength(0);
    });
  }
});
