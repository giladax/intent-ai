import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const UI_COMPONENTS = [
  "src/web/ui/src/App.tsx",
  "src/web/ui/src/components/LensChatMain.tsx",
  "src/web/ui/src/components/LensRail.tsx",
  "src/web/ui/src/components/ReviewQueue.tsx",
  "src/web/ui/src/components/JournalPage.tsx",
  "src/web/ui/src/components/ChatDock.tsx",
  "src/web/ui/src/components/FeaturesPage.tsx",
  "src/web/ui/src/components/FeedStream.tsx",
];

// User-facing "brain"/"Brain" patterns that must have been replaced.
// Excludes CSS class names, variable names, MCP tool identifiers, comments.
const FORBIDDEN = /(?<![a-z_-])brain(?![_-])(?!'s)|The Brain/gi;

describe("Quire copy rename", () => {
  for (const file of UI_COMPONENTS) {
    it(`${file} has no user-facing 'brain'/'Brain'`, () => {
      let content: string;
      try {
        content = readFileSync(join(process.cwd(), file), "utf-8");
      } catch {
        // File may not exist yet (FeedStream created later in the plan); skip.
        return;
      }
      // Strip JSX class names and variable names before checking
      const stripped = content
        .replace(/className[^"]*"[^"]*brain[^"]*"/g, "") // className="... brain ..."
        .replace(/\/\/[^\n]*/g, "")                      // line comments
        .replace(/lc-turn-brain|lc-brainline|brain_|brainCards|brainVersions/g, "")
        .replace(/\/api\/brain\//g, "");                 // API route paths (identifiers)
      const matches = stripped.match(FORBIDDEN);
      expect(matches, `Found user-facing brain references: ${matches?.join(", ")}`).toBeNull();
    });
  }
});
