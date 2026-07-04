// The taxonomy block (9 types) — used by extract prompt and digest agent system prompt
export const MOMENT_TYPES_TAXONOMY = `## Moment Types

- **proposal** — Someone (developer or AI) suggests an approach, architecture, or solution. Use the proposer's actual words.
- **discovery** — New information surfaces that changes understanding. "Oh, this API doesn't support streaming" or "The tests are actually passing, it was a caching issue."
- **pivot** — Direction changes. The developer was doing X, now they're doing Y. Must cite what triggered the pivot.
- **confirmation** — A tentative approach becomes accepted. "Yeah, that looks right" or running tests that pass.
- **rejection** — An approach is explicitly rejected. "Actually let's not mock the database" or reverting a change.
- **commitment** — A firm decision that shapes subsequent work. Different from confirmation — this is choosing a path, not validating one.
- **struggle** — Repeated failed attempts, confusion, or difficulty. Cycles of edit-fail-edit on the same problem.
- **breakthrough** — A struggle resolves. The thing that wasn't working now works, or the confusion clears.
- **execution** — Sustained implementation of an already-decided approach. Only flag this for significant scope, not every edit.`;

// Confidence rubric — shared between extract prompt and digest agent
export const CONFIDENCE_RUBRIC = `## Confidence Rubric

- **high** — direct quote or tool result in provided events explicitly supports the moment
- **medium** — inferred from multiple events, never explicitly stated
- **low** — weak or indirect support
- **omit / null** — if the moment is undecidable, omit confidence or set it to null`;

// Agency rubric — shared between extract prompt and digest agent
export const AGENCY_RUBRIC = `## Agency Rubric

Agency is about who SET THE DIRECTION, not who typed. Executing tools is NOT agency.
- **developer** — the developer initiated or drove this moment
- **ai** — the AI proposed it and the developer passively accepted (went along without meaningful engagement)
- **collaborative** — genuine back-and-forth shaped the outcome`;
