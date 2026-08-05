# Rescue Kit documentation

| | |
| --- | --- |
| **[Usage](./usage.md)** | Every CLI flag, CI integration, and the programmatic API |
| **[Rule reference](./rules.md)** | All 34 rules — what each detects and how to fix it |
| **[Scoring model](./scoring.md)** | How findings become a score, a grade and an effort estimate |
| **[Architecture](./architecture.md)** | How it works internally, and how to extend it |
| **[Decisions](./decisions/)** | Architecture decision records — why it is built this way |
| **[Contributing](../CONTRIBUTING.md)** | Adding a rule |
| **[Security policy](../SECURITY.md)** | Reporting a vulnerability in Rescue Kit itself |

## Start here

New to the tool:

```bash
npx rescuekit ./my-app
```

Trying to understand a specific finding: look the rule id up in the
[rule reference](./rules.md) — every finding in the report carries one, e.g.
`payments/unverified-webhook`.

Wondering whether the score is fair: [the scoring model](./scoring.md) explains exactly
how it is computed, including why some categories are excluded entirely.

Wanting to add a check: [architecture](./architecture.md) for how rules fit together,
then [CONTRIBUTING](../CONTRIBUTING.md) for the conventions.

## What Rescue Kit is not

Worth being direct about, since a security tool that overstates its coverage is more
dangerous than none:

- It is **not a security audit**. It detects the failures that recur in prototypes. A
  clean report means those specific failures were not found.
- It is **not a linter**. It does not have opinions about formatting or naming.
- It **does not execute your code**, follow a call graph, or reason about logic. It reads
  files. That buys determinism and privacy, and it costs accuracy — see
  [ADR 0001](./decisions/0001-static-analysis-over-llm.md).
