# Evaluation Framework
> **spec** · child of Pipeline Orchestration
> The Evaluation Framework is a first-class architectural component of the intent-ai pipeline, not a testing afterthought bolted on after the fact. It exists to provide measurable quality gates for the LLM pipeline passes — ensuring that moment detection, shape classification, and transition writing meet defined quality thresholds before output is trusted. The framework is designed around three pillars: curated fixtures (known-good JSONL inputs with expected outputs), adversarial inputs (edge cases that stress-test LLM robustness, such as malformed sessions or ambiguous context shifts), and quantitative quality gates (pass/fail thresholds on precision/recall for moment detection). Because the pipeline uses probabilistic LLM outputs, deterministic unit tests are insufficient — evals provide the feedback loop that tells developers whether a prompt change improved or regressed quality. The framework is scoped to v1, meaning it ships alongside the core pipeline rather than being deferred to a later iteration.
> [decision] Evals are a v1 deliverable, not a future iteration — this... · [behavior] Adversarial inputs are an explicit part of the eval suite... · [risk] Without the eval framework, prompt changes to the Haiku c... · [constraint] Quality gates must be quantitative and measurable — vague... · [structure] The eval framework is a peer component to the pipeline or...

The Evaluation Framework is a first-class architectural component of the intent-ai pipeline, not a testing afterthought bolted on after the fact. It exists to provide measurable quality gates for the LLM pipeline passes — ensuring that moment detection, shape classification, and transition writing meet defined quality thresholds before output is trusted. The framework is designed around three pillars: curated fixtures (known-good JSONL inputs with expected outputs), adversarial inputs (edge cases that stress-test LLM robustness, such as malformed sessions or ambiguous context shifts), and quantitative quality gates (pass/fail thresholds on precision/recall for moment detection). Because the pipeline uses probabilistic LLM outputs, deterministic unit tests are insufficient — evals provide the feedback loop that tells developers whether a prompt change improved or regressed quality. The framework is scoped to v1, meaning it ships alongside the core pipeline rather than being deferred to a later iteration.

## structure

- The eval framework is a peer component to the pipeline orchestrator — it consumes the same pipeline passes (structural and semantic) but drives them with fixture inputs rather than live JSONL files, comparing outputs against expected results.

## constraint

- Quality gates must be quantitative and measurable — vague subjective assessments of output quality are insufficient. The framework requires defined thresholds (e.g., precision/recall on moment detection) that can be checked programmatically.

## decision

- Evals are a v1 deliverable, not a future iteration — this means eval infrastructure (fixtures, runners, quality gates) must be built in parallel with the pipeline itself, not after it stabilizes.

## behavior

- Adversarial inputs are an explicit part of the eval suite — the framework must include edge-case JSONL fixtures (e.g., sessions with no clear moments, extremely long sessions, malformed tool calls) to validate pipeline robustness beyond happy-path scenarios.

## risk

- Without the eval framework, prompt changes to the Haiku classification pass or Sonnet moment detection pass have no safety net — a regression in LLM output quality would be invisible until a developer manually inspects output. This is the primary risk the framework mitigates.

## Files

- `docs/superpowers/specs/2026-05-21-execution-memory-design.md` — Design spec that establishes the eval framework as a v1 architectural component, including fixtures, adversarial inputs, and quality gates as named pillars.

## Evidence

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)
