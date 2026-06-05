interface ScaffoldTopic {
  name: string;
  summary: string;
  insights: Array<{ category: string; statement: string }>;
  patterns: Array<{ type: string; statement: string; frequency: number }>;
  skills: Array<{
    name: string;
    status: string;
    steps: Array<{ order: number; instruction: string; files: string[] }>;
    pitfalls: string[];
    files: string[];
  }>;
  files: Array<{ path: string; role: string }>;
}

interface ScaffoldInput {
  projectName: string;
  topics: ScaffoldTopic[];
}

function collectInsights(topics: ScaffoldTopic[], ...categories: string[]) {
  return topics.flatMap((t) => t.insights.filter((i) => categories.includes(i.category)));
}

function collectPatterns(topics: ScaffoldTopic[], type: string) {
  return topics.flatMap((t) => t.patterns.filter((p) => p.type === type));
}

function section(lines: string[], title: string, items: string[]): void {
  if (!items.length) return;
  lines.push(`## ${title}`);
  lines.push("");
  lines.push(...items);
  lines.push("");
}

export function generateAgentsMd(input: ScaffoldInput): string {
  const lines: string[] = [];
  const { topics } = input;

  lines.push(`# ${input.projectName}`);
  lines.push("");

  // Overview — always present
  lines.push("## Overview");
  lines.push("");
  for (const t of topics) {
    lines.push(`**${t.name}:** ${t.summary}`);
  }
  lines.push("");

  // Architecture — from structure insights
  const structureInsights = collectInsights(topics, "structure");
  section(lines, "Architecture", structureInsights.map((i) => `- ${i.statement}`));

  // Key Files — from topic file accumulation
  const fileLines: string[] = [];
  for (const t of topics) {
    for (const f of t.files) {
      fileLines.push(`- \`${f.path}\` — ${f.role} (${t.name})`);
    }
  }
  section(lines, "Key Files", fileLines);

  // Conventions — from constraint + behavior insights
  const conventions = collectInsights(topics, "constraint", "behavior");
  section(lines, "Conventions", conventions.map((i) => `- ${i.statement}`));

  // Common Workflows — from approved/validated skills
  const approvedSkills = topics.flatMap((t) =>
    t.skills.filter((s) => s.status === "approved" || s.status === "validated"),
  );
  if (approvedSkills.length) {
    lines.push("## Common Workflows");
    lines.push("");
    for (const skill of approvedSkills) {
      lines.push(`### ${skill.name}`);
      lines.push("");
      for (const step of skill.steps) {
        lines.push(`${step.order}. ${step.instruction}`);
      }
      if (skill.pitfalls.length) {
        lines.push("");
        lines.push("**Watch out:**");
        for (const p of skill.pitfalls) lines.push(`- ${p}`);
      }
      lines.push("");
    }
  }

  // Domain Rules — from decision insights
  const decisions = collectInsights(topics, "decision");
  section(lines, "Domain Rules", decisions.map((i) => `- ${i.statement}`));

  // Watch Out For — pitfall + risk insights + struggle patterns
  const pitfalls = collectInsights(topics, "pitfall", "risk");
  const struggles = collectPatterns(topics, "struggle");
  const watchItems = [
    ...pitfalls.map((i) => `- ${i.statement}`),
    ...struggles.map((s) => `- ${s.statement} (seen in ${s.frequency} sessions)`),
  ];
  section(lines, "Watch Out For", watchItems);

  // Navigation Guide — navigation insights + request patterns
  const navInsights = collectInsights(topics, "navigation");
  const requests = collectPatterns(topics, "request");
  const navItems = [
    ...navInsights.map((i) => `- ${i.statement}`),
    ...requests.map((r) => `- Common question: "${r.statement}" (asked in ${r.frequency} sessions)`),
  ];
  section(lines, "Navigation Guide", navItems);

  return lines.join("\n");
}
