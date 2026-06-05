import { describe, it, expect } from "vitest";
import { generateAgentsMd } from "../../src/brain/generate-scaffold.js";

describe("generateAgentsMd", () => {
  it("generates full scaffold from brain data", () => {
    const input = {
      projectName: "intent-ai",
      topics: [
        {
          name: "Core Pipeline",
          summary: "The processing pipeline for session digestion",
          insights: [
            { category: "structure", statement: "Pipeline uses Extract → Organize → Write three-node architecture" },
            { category: "navigation", statement: "Pipeline entry point is src/pipeline/orchestrator.ts" },
            { category: "pitfall", statement: "Always update types.ts when adding pipeline nodes" },
            { category: "constraint", statement: "TypeScript ESM with .js extensions in imports" },
            { category: "behavior", statement: "Sonnet for reasoning, Haiku for classification" },
            { category: "decision", statement: "Sequential processing to avoid API rate limits" },
            { category: "risk", statement: "Large sessions (1200+ events) can hit token limits" },
          ],
          patterns: [
            { type: "request", statement: "how to add a pipeline node", frequency: 4 },
            { type: "struggle", statement: "forgot to wire node into orchestrator.ts", frequency: 3 },
            { type: "file_access", statement: "types.ts and orchestrator.ts always modified together", frequency: 5 },
          ],
          skills: [
            {
              name: "Add Pipeline Node",
              status: "approved",
              steps: [
                { order: 1, instruction: "Create src/pipeline/<name>.ts — export a function", files: ["src/pipeline/"] },
                { order: 2, instruction: "Define types in src/adapters/types.ts", files: ["src/adapters/types.ts"] },
                { order: 3, instruction: "Wire into src/pipeline/orchestrator.ts", files: ["src/pipeline/orchestrator.ts"] },
              ],
              pitfalls: ["Don't forget to wire into orchestrator.ts"],
              files: ["src/pipeline/", "src/adapters/types.ts", "src/pipeline/orchestrator.ts"],
            },
          ],
          files: [
            { path: "src/pipeline/orchestrator.ts", role: "core" },
            { path: "src/adapters/types.ts", role: "types" },
          ],
        },
      ],
    };

    const md = generateAgentsMd(input);

    // All scaffold sections present
    expect(md).toContain("# intent-ai");
    expect(md).toContain("## Overview");
    expect(md).toContain("## Architecture");
    expect(md).toContain("Extract → Organize → Write");
    expect(md).toContain("## Key Files");
    expect(md).toContain("orchestrator.ts");
    expect(md).toContain("## Conventions");
    expect(md).toContain("ESM");
    expect(md).toContain("## Common Workflows");
    expect(md).toContain("Add Pipeline Node");
    expect(md).toContain("## Domain Rules");
    expect(md).toContain("Sequential processing");
    expect(md).toContain("## Watch Out For");
    expect(md).toContain("Always update types.ts");
    expect(md).toContain("## Navigation Guide");
    expect(md).toContain("Pipeline entry point");
  });

  it("omits sections with no data", () => {
    const input = {
      projectName: "minimal",
      topics: [{
        name: "App",
        summary: "A simple app",
        insights: [],
        patterns: [],
        skills: [],
        files: [],
      }],
    };
    const md = generateAgentsMd(input);
    expect(md).toContain("## Overview");
    expect(md).not.toContain("## Architecture");
    expect(md).not.toContain("## Common Workflows");
    expect(md).not.toContain("## Watch Out For");
  });

  it("only includes approved/validated skills, not drafts", () => {
    const input = {
      projectName: "test",
      topics: [{
        name: "App",
        summary: "test",
        insights: [],
        patterns: [],
        skills: [
          { name: "Draft Skill", status: "draft", steps: [], pitfalls: [], files: [] },
          { name: "Approved Skill", status: "approved", steps: [{ order: 1, instruction: "do thing", files: [] }], pitfalls: [], files: [] },
        ],
        files: [],
      }],
    };
    const md = generateAgentsMd(input);
    expect(md).not.toContain("Draft Skill");
    expect(md).toContain("Approved Skill");
  });
});
