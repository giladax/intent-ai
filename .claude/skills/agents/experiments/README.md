# Experiments

Track chromosome evolution phases, evaluation runs, crossover breeding, and promotion decisions.

## Process

1. **One variable at a time** — lock all chromosomes except one, vary that one
2. **Phase order**: Data (Chr 4) -> Synthesis (Chr 3) -> Format (Chr 2) -> Instructions (Chr 1)
3. **Evaluate with LLM-as-judge** (5-dimension scoring) + programmatic fitness
4. **Read actual outputs** before deciding — scores alone are insufficient
5. **Crossover when needed** — if variants tie or excel on different dimensions, breed offspring
6. **Validate winners on all fixture scopes** before promoting

## Completed Phases

| Phase | Winner | Score | Key Finding |
|-------|--------|-------|-------------|
| 1 (Data) | 4a | 4.35/5 | Conversation-only tied with conversation+actions |
| 2 (Synthesis) | 3c | 4.80/5 | Full pre-computation won (after regex removal) |
| 3 (Format) | 2a/2c tied | ~4.8/5 | Pre-computation made format less critical |
| 4 (Instructions) | 1a/1b tied | ~4.8/5 | Pre-computation made instructions almost irrelevant |

## Critical Lessons

- **Bad pre-computation is worse than none** — regex labels poisoned 3c until replaced with Haiku structured output
- **Pre-computation dominance** — once Chr 3 is good, Chr 1 (instructions) barely matters
- **Programmatic scoring is blind to quality** — use LLM-as-judge for nuance
