# Topology: Evaluator → Optimizer

## Purpose
Use Evaluator → Optimizer when the system should generate, score, and improve candidates based on an explicit evaluation rubric.

This topology is stronger than simple reflection because the evaluator has a separate contract and can compare candidate quality over iterations.

## Shape

```text
START -> generator -> evaluator
                     -> optimizer -> evaluator
                     -> finalizer -> END
```

## Use when
- Quality is subjective but rubric-driven.
- You need iterative improvement, not just contract repair.
- You can score candidates with stable criteria.
- You want to compare prompt/model/graph mutations in LangSmith experiments.

## Do not use when
- The success criterion is deterministic.
- The evaluator is not trusted or calibrated.
- The optimizer makes broad changes without evidence.
- The cost of multiple iterations exceeds the value of quality lift.

## State contract

```ts
type State = {
  input: UserInput;
  candidates: CandidateOutput[];
  evaluations: EvaluationResult[];
  bestCandidate?: CandidateOutput;
  iteration: number;
  final?: FinalOutput;
};
```

## Evaluator contract

```text
Score candidate against rubric.
Return numeric scores, pass/fail gates, evidence, and priority improvement areas.
```

## Optimizer contract

```text
Generate a better candidate using evaluator feedback.
Do not optimize for style at the expense of required constraints.
```

## Routing contract

```text
if score >= threshold -> finalizer
if iteration < maxIterations -> optimizer
else -> finalizer(bestCandidate)
```

## Evaluation signals
Track:
- score improvement per iteration
- evaluator consistency
- candidate diversity
- best-candidate selection accuracy
- cost per quality point
- regression against holdout examples

## Common mutations
- Add pairwise comparison instead of independent scoring.
- Use separate evaluators for correctness, usefulness, and constraint adherence.
- Stop early when improvement plateaus.
- Promote winning candidates into examples or datasets.
