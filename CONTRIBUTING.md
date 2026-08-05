# Contributing

New rules are the most valuable contribution, and they're small — a data object, a
`run` function, and a test.

## Setup

```bash
npm install
npm test
```

`npm run dev -- ./some-project` runs the CLI straight from TypeScript, no build step.

## Adding a rule

Rules live in `src/rules/<category>.ts`. A rule is plain data plus a synchronous `run`
that returns a hit or `null`:

```ts
{
  id: 'payments/unverified-webhook',      // category/kebab-case
  title: 'Payment webhook accepts unverified requests',
  category: 'payments',
  severity: 'critical',
  effortHours: 6,
  remediation: 'Verify the signature header against the raw request body …',

  // Optional. Skip when the rule cannot apply — the category is then excluded
  // from scoring rather than passed.
  appliesTo: (ctx) => ctx.stack.paymentProvider !== null,

  run(ctx) {
    const hits = ctx.search(/…/);
    if (hits.length === 0) return null;
    return { detail: 'What is wrong in this project specifically.', evidence: hits };
  },
}
```

Then export it from `src/rules/index.ts` and add tests to `test/rules.test.ts`.

### What makes a good rule

**Detect a problem that actually breaks things.** The bar is "this causes an outage, a
breach, or a refund", not "this is not how I would write it". Style opinions belong in a
linter.

**Write `detail` about *this* project, not the category.** "3 route handlers run without
establishing who the caller is" is useful. "Authorisation is important" is not. The title
already says what the rule checks — `detail` says what it found.

**Write `remediation` for the developer who has to do the work.** Name the specific fix.
Where there's a trap worth knowing about, say so — that webhook verification needs the
*raw* body is the difference between a fix that works and an afternoon of confusion.

**Set `severity` by consequence, not by how annoying it is.** Critical means exploitable
in production right now. See
[ADR 0003](./docs/decisions/0003-category-weighted-scoring.md) for how much each level
moves the score.

**Use `appliesTo` rather than returning `null` for irrelevance.** They produce different
scores: `appliesTo` excludes the category from the mean, whereas returning `null` counts
as a pass. Crediting a project for payment security it does not implement is wrong.

**Skip what's public by design.** Health checks, webhooks, sitemaps and OG image routes
are meant to be unauthenticated. A rule that flags them trains people to ignore reports.

### Every rule needs two tests

One proving it fires on the problem, one proving it stays quiet on correct code. The
second matters more — false positives are what make people uninstall a scanner.

```ts
it('flags a webhook with no signature verification', () => { … });
it('accepts a webhook that verifies the signature', () => { … });
```

Build fixtures with `createProject({ 'path/file.ts': 'contents' })` from
`test/helpers/project.ts`. It writes a real temporary directory, because roughly half of
what rules check *is* filesystem shape.

### Never commit credential-shaped strings

Even fake ones. They trip GitHub push protection and every secret scanner your
contributors run. Assemble them at runtime — see `fakeSecrets` in
`test/helpers/project.ts`.

## Constraints

**No runtime dependencies.** Dev dependencies are fine. See
[ADR 0002](./docs/decisions/0002-zero-runtime-dependencies.md) — if a rule genuinely
needs a parser, open an issue and let's discuss it rather than adding one quietly.

**Rules must be synchronous and must not touch the network.** Determinism and offline
operation are the point. See
[ADR 0001](./docs/decisions/0001-static-analysis-over-llm.md).

**Redaction is not optional.** Evidence is redacted in `ScanContext.search`. If you add
another path that captures source text, redact it there — reports get shared.

## Commits and pull requests

Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

Before opening a PR: `npm run typecheck && npm test && npm run build`.

Tell us which rule you added and why the problem is worth flagging. If it's a rule with a
plausible false-positive case, say what you did about it.

## Reporting a false positive

Genuinely useful — please open an issue with the smallest code sample that triggers it.
False positives are treated as bugs, not as the cost of doing business.
