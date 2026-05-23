# Scout bot router architecture

Scout is a Telegram group intelligence bot built around a lightweight router agent that classifies incoming messages, selects actions, and dictates context fetching. The router drives a pipeline of digestion, briefing, and alert nodes rather than a monolithic agent handling everything. Key architectural decisions include decoupling digestion from the router's per-message decision, using Zod enums for intent and clarity, and composing prompts dynamically based on router output.

## structure

- Every message enters handlers.ts and takes one of two paths: command-driven (briefing/research/ask) or background digestion — with specific model assignments: Sonnet for quality-critical pipeline steps, Haiku for cheaper classification.

## decision

- The router is a lightweight agent that controls both action selection and context fetching — it is not a monolithic agent. Digestion always runs when its trigger fires, regardless of what the router decides about the current message.
- ResponseIntent and ClarityScore are structured Zod enums in RouterDecision — not ad-hoc prompt strings. Both flow into the prompt composer to produce proportional, honest responses.
- The router is a lightweight agent that controls both action selection and context fetching — it is not a monolithic agent. Digestion always runs when its trigger fires, regardless of what the router decides about the current message.
- The 'insufficient context' clarity state was removed by setting the threshold to 0 — this was an architectural change made under demo pressure without explicit developer instruction. Worst case is slightly hedged responses with ambiguous context.
- ResponseIntent and ClarityScore are structured Zod enums in RouterDecision — not ad-hoc prompt strings. Both flow into the prompt composer to produce proportional, honest responses.

## behavior

- The clarity threshold logic counts messages since the last digestion cursor — msgCount < 5 and factCount === 0 triggers an 'insufficient context' response. This threshold was lowered to 0 (removing the insufficient state entirely) under live demo conditions.
- Eval results: 67/76 cases passed (88%), avg score 0.89. Known failure patterns: router contextNeeds matching (4 failures), digest multi-party extraction (1 failure), alert false positive on 2-week deadlines (1 failure).

## Files

- `/Users/giladkoch/dev/telegram-tmp/telegram/src/digestion/graph.ts` — Digestion pipeline graph — runs independently of router decisions
- `/Users/giladkoch/dev/telegram-tmp/telegram/src/digestion/trigger.ts` — Digestion trigger logic — contains the clarity threshold that was lowered to 0
- `/Users/giladkoch/dev/telegram-tmp/telegram/src/pipeline/composePrompt.ts` — Composes prompts dynamically based on router output
- `/Users/giladkoch/dev/telegram-tmp/telegram/src/pipeline/process.ts` — Pipeline processing — updated to remove insufficient context state
- `/Users/giladkoch/dev/telegram-tmp/telegram/src/router/route.ts` — Router agent — classifies intent and selects action
- `/Users/giladkoch/dev/telegram-tmp/telegram/src/telegram/handlers.ts` — Entry point for all incoming messages; routes to command or digestion path

## Evidence

- May 19: The developer set out to build a Telegram group intelligence bot called Scout — a router-driven a... (61 moments)
- May 19: The developer onboarded to a Telegram BD conversation tracker called Scout by reviewing architect... (27 moments)

## Related

- [digestion pipeline](digestion-pipeline.md)
- [eval-driven development](eval-driven-development.md)
