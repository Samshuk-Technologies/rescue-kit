# 0002 — Zero runtime dependencies

**Status:** Accepted
**Date:** 2026-08-05

## Context

The obvious dependencies for a CLI like this are a glob library, an argument parser, and
a terminal colour library. All three are small, well-maintained, and would each save
somewhere between twenty and sixty lines of code.

Two things argue against taking them. Rescue Kit is distributed as `npx rescuekit`, so
every dependency is downloaded before the tool runs and directly lengthens the gap
between someone deciding to try it and seeing output. And a tool whose job is to tell you
your supply chain is risky is in an awkward position if installing it pulls forty
transitive packages.

## Decision

Ship with no runtime dependencies. Use Node's standard library, and write the small
amount of code the three libraries would have provided:

- Directory traversal — `src/scan/walk.ts`, roughly 60 lines over `node:fs`
- Argument parsing — `src/cli.ts`, a `switch` over `argv`
- Terminal colour — `src/report/terminal.ts`, a map of ANSI codes

Development dependencies are unconstrained: TypeScript and Vitest do not ship to users.

## Consequences

### What this buys

`npx rescuekit` is a single small download. Nothing to audit, no transitive supply-chain
surface, and no version conflicts with whatever the host project already has installed.
The claim "no runtime dependencies" also does real work in the README — for this
particular tool, it is evidence of the judgement being sold.

### What it costs

Roughly 150 lines of code we own and must maintain, and correspondingly more tests. The
gitignore matching in `secrets/committed-env` is deliberately simplified rather than
fully spec-compliant, which is a real accuracy cost — full gitignore semantics are
genuinely intricate, and a dedicated library would handle negation and directory scoping
correctly. The limitation is documented in the README rather than papered over.

We also forgo the ecosystem's edge-case handling. `walk.ts` does not deal with symlink
cycles as thoroughly as a mature glob library would; it skips anything that is not a
regular file, which is sufficient here but is a narrower guarantee.

## Revisit if

Adding a dependency becomes clearly worth it — most likely a parser, if
[ADR 0001](./0001-static-analysis-over-llm.md) is revisited in favour of AST-based rules.
At that point the claim in the README changes with it, honestly, rather than the
dependency being added quietly.
