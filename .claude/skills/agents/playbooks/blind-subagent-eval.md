# Blind-Subagent Evaluation

How to evaluate understanding machinery (analysis agents, the mind
sweep, the story layer, proposers) without overfitting it: the agent
under eval never sees the questions; the ground truth lives only in the
judges; controls catch judges that reward mentioning anything.

Proven on: the alignment MVP's EDD loops (69→99/99 without prompt-
gaming), the repo-cognition suite (`backend/evals/repo_cognition.py` —
the canonical implementation of this playbook), and the seed-quality
suite (`backend/evals/seed_quality.py`).

## The invariant

**Contamination is the failure mode.** The moment the evaluated agent's
prompt, corpus selection, or call shape encodes what you hope it finds,
the eval measures your hint, not the machinery. Every step below exists
to keep the two sides blind to each other.

## Procedure

1. **Write ground truths from what you KNOW, not what you hope.**
   The best eval cases come from lived history the corpus contains but
   never labels: "the project changed names four times", "two documents
   simultaneously claim to be source of truth", "a doctrine was declared
   absolute and later reversed". Each case is a judge-facing description
   of a PHENOMENON — never a keyword list.

2. **Add must-NOT-flag controls.** Two or three phenomena that never
   happened (a database migration, a security incident). A judge that
   "finds" them is broken; an agent that invents them is worse. Without
   controls, lenient judging silently inflates every score.

3. **Invoke the subagent BLIND.** It receives:
   - the raw corpus, assembled MECHANICALLY (a glob, a git log — never
     hand-picked files that happen to contain the answers; if you must
     cap document length, cap uniformly);
   - the SAME generic prompt the production path uses ("think about
     this organization", "analyze this change") — zero task hints;
   - no access to the cases, the judges, or this playbook.
   Dispatch as a subagent (Agent tool / a Fake-swappable production
   entry point) so its context is genuinely isolated. If the production
   path is two-phase (free thinking → structure extraction), eval the
   same two-phase path — never a special eval-only shape.

4. **To "assume what the analysis should be" for a NEW target** (a repo
   with no lived history), run a second blind subagent as the reference
   analyst: give it the same raw corpus and ask for its independent
   expert analysis — findings with evidence. Its output becomes
   candidate ground truth ONLY after a human confirms each item. Two
   independent blind reads that agree, plus a human signature, is a
   ground-truth case; one machine's opinion is not.

5. **Judge with the truth on the judge's side only.** One call per
   case: "does any output SUBSTANTIVELY identify this specific
   phenomenon — a related but different phenomenon does not count?"
   Judges are understanding instruments: use a strong model (tier
   dogma caused real misses here), keep judge phrasing independent of
   any production mechanism it grades, and give every judge a
   calibration set — at least one must-flag precedent and one
   must-clear counterexample, re-run before and after ANY criteria
   change.

6. **Run the baseline BEFORE fixing anything (EDD).** Misses are
   findings about the machinery, not embarrassments — the first
   repo-cognition baseline (5/8) exposed a silent truncation bug worth
   more than the passing cases. A case that cannot fail is decoration:
   delete it (the standing eval bar in
   `backend/docs/evals-sweep-2026-07-19.md` governs — every eval must
   demonstrably be able to fail, trace to an observed defect or lived
   truth, and name its removal condition at birth).

7. **Fix GENERALLY, re-run, and sweep.** A fix may touch the machinery
   (prompts, budgets, validators) — never the eval's corpus selection
   toward an answer. Corpus changes must be defensibly uniform (raising
   a cap for all documents: fine; adding the one file with the answer:
   contamination). After the loop, remove any eval that has become
   redundant — a suite that only accumulates dies.

## Smells

- The sweep prompt mentions anything a case looks for → contaminated.
- A judge passes a case via a node "about" something adjacent → add the
  specificity clause and a must-clear example.
- Scores hit 100% on the first run → the cases are too easy or leaked.
- The same output satisfies three different must-flags → judge leniency.
- An eval that recomputes the product's own formula and checks equality
  → passes by construction; delete it.
