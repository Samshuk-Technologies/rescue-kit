# 0001 — Static analysis rather than an LLM

**Status:** Accepted
**Date:** 2026-08-05

## Context

Rescue Kit audits codebases for production-readiness. The obvious implementation in 2026
is to send files to a language model and ask what's wrong with them. Models are good at
this, and would catch classes of problem that pattern matching never will — an
authorisation check that exists but is applied to the wrong resource, for instance.

The tool's purpose constrains the choice, though. It is aimed at developers who have just
been told their codebase might be insecure, and its first job is to be trusted enough to
run.

## Decision

Implement detection as deterministic static analysis: regex and structural checks over the
filesystem, with no network access and no model calls.

## Consequences

### What this buys

**It can be run on code that cannot leave the building.** The audience most in need of
this — someone with a prototype handling real payments — is often least able to upload
that source to a third party. A tool that transmits nothing has no such conversation to
have. This is the deciding argument.

**Results are reproducible.** The same input always produces the same score. That matters
for the `--fail-on` CI gate, which would be unusable if the threshold drifted between
runs, and it matters for the report's credibility: two people running it must see the
same thing.

**It is free and instant.** No API key, no per-run cost, no rate limit. `npx rescuekit`
works on the first try, for anyone, which is the entire distribution strategy.

**Findings are auditable.** Every finding traces to a rule that a reader can open and
verify. A sceptical developer can check whether we are right, which they cannot easily do
with a model's assertion.

### What it costs

**Real false positives.** Textual matching cannot follow a call graph. A route protected
by a wrapper three frames up looks unprotected. This is documented in the README rather
than hidden, and rules are tuned to skip endpoints that are public by design.

**Real false negatives.** Logic flaws — a correct-looking check against the wrong
resource, a race in payment fulfilment — are invisible to this approach. The README states
that a clean report is not a security audit.

**Rules must be written by hand.** Coverage grows linearly with effort, and every new
framework needs its own patterns.

## Alternatives considered

**LLM analysis.** Rejected as the default for the reasons above, primarily the privacy
constraint. Not rejected permanently: an opt-in `--deep` mode that sends findings — not
source — to a model for triage would preserve the offline default while adding reasoning
where it helps. Worth revisiting once the deterministic ruleset is mature.

**Wrapping existing tools** (Semgrep, gitleaks, npm audit). Rejected because it makes
installation heavy and the output fragmented across four tools' conventions. The value
here is the unified score and one coherent report, which is precisely what an aggregator
struggles to produce. Individual rules can still borrow from published Semgrep patterns.

**AST parsing rather than regex.** Genuinely better for the auth and payment rules, and a
plausible future direction. Rejected for v1 because it requires a parser dependency per
language, which conflicts with [ADR 0002](./0002-zero-runtime-dependencies.md), and
because it would have delayed a working tool considerably. Revisit if false-positive rates
prove to be the main barrier to adoption.
