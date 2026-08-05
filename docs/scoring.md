# The scoring model

The score is the part most people read, so it needs to mean something specific and be
hard to game. This page documents exactly how it is computed.

The design rationale — why these numbers rather than others — is in
[ADR 0003](./decisions/0003-category-weighted-scoring.md).

## In one paragraph

Each of the six categories starts at 100 and loses points per finding according to
severity. The overall score is a weighted mean of the categories that **apply** to your
project; categories with no applicable rules are excluded entirely rather than counted as
a pass. The grade is a band of the overall score, and the verdict is driven by the
critical count rather than the score.

## Step 1 — Category scores

Each category begins at 100. Every finding subtracts:

| Severity | Penalty |
| --- | --- |
| Critical | 50 |
| High | 22 |
| Medium | 9 |
| Low | 3 |

Floored at 0. So one critical halves a category; two floor it.

```
Secrets: 100 − 50 (committed .env) − 50 (hardcoded key) − 3 (no .env.example) = 0
```

The calibration is the point: a category containing a live credential leak cannot reach a
respectable number no matter how clean the rest of it is.

## Step 2 — Applicability

A rule may declare that it cannot apply. Payment rules do not run without a payment
provider; row-level-security rules do not run without Supabase.

If **no** rule in a category applied, that category is marked `applicable: false` and
**excluded from the overall score** — not scored 100.

This is the subtle decision and it matters. Crediting a static site for the payment
security it doesn't implement would let it outscore a careful e-commerce app carrying one
medium payment finding. The score should read as *"out of what applies to you"*.

The consequence: scores are only loosely comparable between very different projects,
because they are computed over different category sets. That is preferable to
comparable-but-meaningless.

## Step 3 — Weighted mean

Applicable categories are combined by weight:

| Category | Weight |
| --- | --- |
| Secrets & configuration | 1.3 |
| Authentication & access | 1.3 |
| Payments | 1.1 |
| Data & schema | 1.1 |
| Testing & CI | 0.7 |
| Operations & scaling | 0.7 |

```
score = Σ(categoryScore × weight) / Σ(weight)      over applicable categories only
```

**The weights encode recoverability, not importance.** Testing and operations are lowest
not because they matter less over a project's life, but because they are fixable next
sprint with no lasting harm. A leaked production credential is already public; a missing
authorisation check may already have been exploited.

The score answers *how much danger are you in*. The effort estimate answers *how much
work is outstanding* — they are deliberately separate numbers.

## Step 4 — Grade

| Score | Grade |
| --- | --- |
| 90–100 | A |
| 75–89 | B |
| 60–74 | C |
| 40–59 | D |
| 0–39 | F |

Calibrated so a typical AI-generated prototype lands at D or F, and a project that has
had real hardening work lands at B.

## Step 5 — Verdict

**Any critical finding overrides the grade.** A project with one critical and otherwise
excellent scores still reads *"Not safe to ship"*, because that is the honest summary — a
B grade next to an exploitable payment endpoint would be actively misleading.

With no criticals, the verdict follows the grade, from "Production-ready" at A down to
"Not production-ready" at F.

## The effort estimate

Every rule carries an `effortHours` figure. The report totals them and converts to days
at 8 hours.

**Treat it as indicative, not as a quote.** It assumes an engineer familiar with the
stack, it does not account for interactions between fixes (adding auth makes several
other findings cheaper), and it does not include the discovery work a real remediation
needs. It exists to convert an abstract score into something a non-technical stakeholder
can reason about.

The report says as much in its footer.

## Worked example

A Next.js + Supabase + Stripe prototype:

| Category | Findings | Score | Applies |
| --- | --- | --- | --- |
| Secrets | 2 critical, 1 low | 0 | yes |
| Auth | 1 critical, 1 high | 28 | yes |
| Payments | 2 critical, 1 medium | 0 | yes |
| Data | 2 critical, 1 high | 0 | yes |
| Testing | 1 high, 1 medium | 69 | yes |
| Operations | 2 high, 2 medium, 2 low | 32 | yes |

```
weighted = 0(1.3) + 28(1.3) + 0(1.1) + 0(1.1) + 69(0.7) + 32(0.7)
         = 0 + 36.4 + 0 + 0 + 48.3 + 22.4 = 107.1
weights  = 1.3 + 1.3 + 1.1 + 1.1 + 0.7 + 0.7 = 6.2

score = 107.1 / 6.2 ≈ 17     → Grade F
```

Note how the two best categories — testing at 69 and operations at 32 — barely lift the
result, because they carry the lowest weights and the security categories are floored.
That is the model working as intended.

## Changing the weights

They are exported and covered by tests that assert the calibration properties directly:

```ts
import { SEVERITY_WEIGHT, CATEGORY_WEIGHT } from 'rescuekit';
```

A change fails loudly rather than silently shifting everyone's score. If real-world use
ever shows every project clustering at F, the weights need revisiting — a scale where
everyone gets the worst grade conveys nothing.
