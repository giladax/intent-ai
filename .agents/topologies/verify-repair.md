# Topology: Verify → Repair

## Purpose
Use Verify → Repair when outputs are often close but fail a known contract: schema validity, factual grounding, business rules, safety constraints, node contract compliance, or formatting.

This topology is not general reflection. The verifier must check explicit criteria, and the repair node must fix only the identified failures.

## Shape

```text
START -> generator -> verifier
verifier -> END              # pass
verifier -> repair -> verifier # fail, within budget
verifier -> failure_finalizer  # fail, budget exhausted
```

## Use when
- Failures are detectable.
- Most bad outputs can be repaired locally.
- You can state verification criteria clearly.
- You want better reliability without changing the whole graph.

## Do not use when
- There is no objective verification signal.
- The repair node routinely rewrites the entire answer.
- The verifier becomes another vague judge.
- The root cause is missing context or wrong topology.

## State contract

```ts
type State = {
  input: UserInput;
  candidate: CandidateOutput;
  verification?: VerificationResult;
  repairAttempts: number;
  final?: FinalOutput;
};
```

## Verifier contract

```text
Check candidate against named criteria.
Return pass/fail, failed criteria, evidence, and minimal repair instructions.
Do not rewrite the output.
```

## Repair contract

```text
Modify only what is necessary to satisfy failed criteria.
Preserve correct parts of the candidate.
Return a new candidate and a repair summary.
```

## Routing contract

```text
if verification.pass -> END
if !pass and repairAttempts < maxRepairAttempts -> repair
if !pass and budget exhausted -> failure_finalizer
```

## Evaluation signals
Track:
- initial pass rate
- repaired pass rate
- repair attempts per run
- verifier false positives / false negatives
- output degradation after repair
- cost added per successful repair

## Common mutations
- Replace model verifier with deterministic validator where possible.
- Split verifier into schema validator and semantic judge.
- Add failure taxonomy to repair prompts.
- Use `evaluator-optimizer.md` if repair requires comparing alternatives.
