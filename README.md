# Rescue Kit

**Find out what's wrong with your AI-generated app before your users do.**

Point it at a codebase from Lovable, v0, Bolt, Cursor — or any prototype that grew up
faster than it hardened — and get a scored, severity-ranked report on the six things
that actually break in production.

```bash
npx rescuekit ./my-app
```

```
  Rescue Kit · quickship-store

  ████░░░░░░░░░░░░░░░░░░░░  17/100  Grade F

  Not safe to ship. 8 critical issues would be exploitable in production and
  should be fixed before this goes anywhere near real users or real money.

  Secrets & configuration  ░░░░░░░░░░░░   0  3 issues
  Authentication & access  ███░░░░░░░░░  28  2 issues
  Payments                 ░░░░░░░░░░░░   0  3 issues
  Data & schema            ░░░░░░░░░░░░   0  3 issues
  Testing & CI             ████████░░░░  69  2 issues
  Operations & scaling     ████░░░░░░░░  32  6 issues

  ● Charge amount taken from the client  payments/client-supplied-amount
    The charge amount is read from the incoming request. A customer can
    intercept that call and set the price to zero — this is the single most
    common payment flaw in prototype code.
    → app/api/checkout/route.ts:3
```

Add `--html report.html` for a shareable report you can send to a client or a
co-founder.

## Why this exists

AI coding tools are genuinely good at producing something that works. They are much less
good at producing something that survives contact with real users, real money and real
data. The gap is consistent and predictable: webhook signatures never verified, charge
amounts trusted from the client, row-level security never enabled, `.env` committed,
zero tests.

Rescue Kit checks for exactly those things. It is deliberately opinionated about what
matters — a leaked production key outranks a missing README, and the score reflects that.

## What it checks

| Category | Examples |
| --- | --- |
| **Secrets & configuration** | Committed `.env`, hardcoded credentials, secrets behind public env prefixes, service-role keys in client code |
| **Authentication & access** | Unprotected route handlers, privilege from client-supplied data, unverified JWTs, plaintext or weakly-hashed passwords |
| **Payments** | Unverified webhooks, client-supplied charge amounts, missing idempotency keys, fulfilment that depends on a redirect |
| **Data & schema** | Missing row-level security, SQL string interpolation, no migrations, unvalidated request bodies, unindexed foreign keys |
| **Testing & CI** | No tests, no CI, placeholder test scripts, builds configured to ignore type errors |
| **Operations & scaling** | No error tracking, no rate limiting, no lockfile, missing security headers |

34 rules in total — the [full reference](./docs/rules.md) lists every one. Each finding
comes with the specific evidence, a remediation, and an effort estimate.
**Credentials are redacted before they reach the report** — you can share it safely.

## Usage

```bash
npx rescuekit                              # audit the current directory
npx rescuekit ./my-app                     # audit a path
npx rescuekit --html report.html           # shareable HTML report
npx rescuekit --json report.json           # machine-readable output
npx rescuekit --min-severity high          # hide the noise
npx rescuekit --fail-on critical           # CI gate: exit 1 on criticals
```

### In CI

```yaml
- run: npx rescuekit . --fail-on critical
```

### As a library

```ts
import { audit, renderHtml } from 'rescuekit';

const result = audit('./my-app');
console.log(result.score, result.grade, result.counts.critical);
```

## Documentation

| | |
| --- | --- |
| [Usage](./docs/usage.md) | Every flag, CI integration, JSON schema, programmatic API |
| [Rule reference](./docs/rules.md) | All 34 rules — generated from the ruleset, so it never drifts |
| [Scoring model](./docs/scoring.md) | Exactly how findings become a score and a grade |
| [Architecture](./docs/architecture.md) | How it works inside, and how to extend it |
| [Decisions](./docs/decisions/) | ADRs — why it is built this way |

## Design notes

**No runtime dependencies.** Rescue Kit installs nothing beyond itself. A tool that
audits your supply chain should not enlarge it.

**Static analysis, not an LLM.** Results are deterministic, run offline, and never
transmit your source anywhere. See
[ADR 0001](./docs/decisions/0001-static-analysis-over-llm.md).

**Categories that don't apply are excluded, not passed.** A project with no payment
provider is not scored on payment security — crediting it would make every score
meaningless. See [ADR 0003](./docs/decisions/0003-category-weighted-scoring.md).

## Limitations

Worth stating plainly, because a security tool that overstates its coverage is worse
than none:

- **Detection is heuristic.** It reads code without executing it, so it cannot know that
  an auth check three call frames away does protect that route. Expect false positives.
- **A clean report is not a security audit.** It means the common prototype failures
  aren't present. It does not mean the application is secure.
- **JavaScript and TypeScript first.** Next.js, Vite, Remix, Express and similar are
  well covered. Python, Go and Ruby projects will produce far fewer findings.
- **`.gitignore` matching is simplified.** Full gitignore semantics — negation, nested
  files, directory scoping — are not implemented.

## Contributing

New rules are the most useful contribution, and they are small: a `Rule` object with a
`run` function and a test. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Who made this

[Samshuk Technologies](https://samshuk.com) — we do this work for a living. If the report
is alarming and you'd rather not fix it yourself, that's the service.

MIT licensed.
