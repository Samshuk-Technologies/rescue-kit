# 0003 — Category-weighted scoring, with inapplicable categories excluded

**Status:** Accepted
**Date:** 2026-08-05

## Context

The score is the product. Most people will read the number, the grade and the verdict,
and never scroll to the individual findings. So the number has to mean something specific
and defensible, and it has to be hard to game.

Three problems had to be solved:

1. **Not all findings are equal.** A committed production key and a missing README are
   not the same kind of problem, and a flat count treats them as though they were.
2. **Not all categories apply.** A project with no payment provider cannot be scored on
   payment security.
3. **A single catastrophic finding must dominate.** A codebase leaking a live secret
   should not score well because everything else is tidy.

## Decision

Score each category out of 100 by subtracting a severity weight per finding:

| Severity | Penalty |
| --- | --- |
| Critical | 50 |
| High | 22 |
| Medium | 9 |
| Low | 3 |

Combine categories as a weighted mean, weighted by how unrecoverable a mistake in each
is:

| Category | Weight |
| --- | --- |
| Secrets, Auth | 1.3 |
| Payments, Data | 1.1 |
| Testing, Operations | 0.7 |

**Categories with no applicable rules are excluded from the mean entirely** — not scored
100, not scored 0.

## Rationale

**The severity weights are calibrated so one critical finding costs half a category.**
Two criticals in one category floor it. This makes the third requirement structural
rather than a special case bolted on afterwards: a project with a leaked key cannot reach
a good grade regardless of how clean the rest is.

**The category weights encode recoverability, not effort.** Testing and operations are
weighted lowest not because they matter less in the long run, but because they are
fixable next sprint with no lasting harm. A leaked production credential is already
public; a missing authorisation check may already have been exploited. The score answers
"how much danger are you in", not "how much work is outstanding" — the effort estimate
answers the latter separately.

**Exclusion rather than a free 100 is the subtle one.** Crediting a project for security
it does not implement inflates every score and destroys comparability: a static site with
no payments would outscore a careful e-commerce app with one medium payment finding.
Excluding the category means the score always reads as "out of what applies to you".

## Consequences

Scores are comparable only in a loose sense between very different projects, since they
are computed over different category sets. This is acknowledged and preferable to the
alternative, which is comparable-but-meaningless.

Grade boundaries (A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 40) are calibrated so that a typical
AI-generated prototype lands at D or F, and a project that has had genuine hardening work
lands at B. If real-world usage shows everything clustering at F, the weights need
revisiting — a scale where every project gets the worst grade conveys nothing.

The weights are exported from `src/engine/score.ts` and covered by tests that assert the
calibration properties directly, so a change to them fails loudly rather than silently
shifting everyone's score.
