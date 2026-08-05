# Usage

## Installation

None required:

```bash
npx rescuekit ./my-app
```

Rescue Kit has no runtime dependencies, so this is a single small download. Install it
globally if you audit often:

```bash
npm install -g rescuekit
rescuekit ./my-app
```

Requires Node 20 or later.

## Command line

```
rescuekit [path] [options]
```

`path` defaults to the current directory.

| Option | Effect |
| --- | --- |
| `--html <file>` | Write a shareable, self-contained HTML report |
| `--json [file]` | Write JSON. With no filename, prints to stdout instead of the terminal report |
| `--min-severity <level>` | Hide findings below this level in terminal output |
| `--fail-on <level>` | Exit 1 if any finding at or above this level exists |
| `--no-cta` | Omit the Samshuk call-to-action from the HTML report |
| `--no-color` | Disable coloured output |
| `-h`, `--help` | Help |
| `-v`, `--version` | Version |

Levels are `critical`, `high`, `medium`, `low`.

### Examples

```bash
# Audit the current directory
rescuekit

# Audit a path and write a report you can send to someone
rescuekit ./my-app --html report.html

# Only show what actually matters
rescuekit --min-severity high

# Report for a client, without our branding on it
rescuekit ./their-app --html audit.html --no-cta
```

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Audit completed. **Findings do not cause a non-zero exit unless `--fail-on` is given.** |
| `1` | `--fail-on` threshold was met |
| `2` | Bad usage — unknown flag, missing argument |

The default is deliberate: a tool that exits non-zero merely for having found something
breaks any script that runs it without expecting that.

## In CI

Gate on criticals only, so the build fails for exploitable problems and not for a missing
README:

```yaml
- name: Production-readiness audit
  run: npx rescuekit . --fail-on critical
```

Tighten the threshold as the project improves — `--fail-on high` once criticals are clear
is a reasonable second step, and it ratchets: nothing can regress past the level you've
reached.

To keep a report as a build artifact:

```yaml
- run: npx rescuekit . --html audit.html --fail-on critical
  continue-on-error: true

- uses: actions/upload-artifact@v4
  with:
    name: readiness-report
    path: audit.html
```

### GitLab CI

```yaml
readiness:
  image: node:22
  script:
    - npx rescuekit . --fail-on critical
```

### Pre-commit

Auditing on every commit is too slow to be useful. Run it on a schedule instead — a
weekly workflow that opens an issue when the score drops is more effective and far less
irritating.

## JSON output

```bash
rescuekit ./my-app --json report.json
```

The shape:

```jsonc
{
  "score": 17,                   // 0–100, weighted across applicable categories
  "grade": "F",                  // A–F
  "verdict": "Not safe to ship…", // plain-language summary
  "counts": { "critical": 8, "high": 5, "medium": 4, "low": 2 },
  "effortHours": 114,            // total remediation estimate
  "findings": [
    {
      "ruleId": "payments/client-supplied-amount",
      "title": "Charge amount taken from the client",
      "category": "payments",
      "severity": "critical",
      "detail": "The charge amount is read from the incoming request…",
      "remediation": "Send only a product or price identifier…",
      "effortHours": 8,
      "evidence": [
        {
          "file": "app/api/checkout/route.ts",
          "line": 3,
          "excerpt": "const session = await stripe.checkout.sessions.create({ amount: body.amount })"
        }
      ]
    }
  ],
  "categories": [
    { "category": "payments", "score": 0, "applicable": true, "findings": [] }
  ],
  "stack": { "framework": "next", "database": "supabase", "paymentProvider": "stripe" },
  "project": { "name": "my-app", "root": "/…", "filesScanned": 7 },
  "rulesRun": 27,
  "rulesSkipped": 7,
  "generatedAt": "2026-08-05T12:00:00.000Z"
}
```

Note `rulesSkipped`: rules that could not apply. Their categories are excluded from the
score rather than passed — see [scoring](./scoring.md).

### Useful queries

```bash
# Just the score
rescuekit --json | jq .score

# Critical findings and where they are
rescuekit --json | jq '.findings[] | select(.severity=="critical") | {ruleId, evidence}'

# Track the score over time
echo "$(date +%F),$(rescuekit --json | jq .score)" >> readiness.csv
```

## The HTML report

```bash
rescuekit ./my-app --html report.html
```

A single self-contained file — no external stylesheets, scripts, fonts or images — so it
can be emailed, committed, or dropped on any static host. It follows the reader's light
or dark theme.

**Credentials are redacted before they reach it.** Evidence is masked at the point of
capture rather than at render time, so the report is safe to share. See
[architecture](./architecture.md#redaction).

Use `--no-cta` to drop the Samshuk footer when sending it to a client under your own name.

## Programmatic API

```ts
import { audit, renderHtml, renderTerminal, allRules } from 'rescuekit';

const result = audit('./my-app');

console.log(result.score, result.grade);
console.log(result.findings.filter((f) => f.severity === 'critical'));

writeFileSync('report.html', renderHtml(result, { cta: false }));
```

### Running a subset of rules

```ts
import { audit, allRules } from 'rescuekit';

const paymentsOnly = allRules.filter((r) => r.category === 'payments');
const result = audit('./my-app', { rules: paymentsOnly });
```

### Adding a project-specific rule

```ts
import { audit, allRules, type Rule } from 'rescuekit';

const noFetchInComponents: Rule = {
  id: 'custom/no-fetch-in-components',
  title: 'Direct fetch in a component',
  category: 'operations',
  severity: 'medium',
  effortHours: 2,
  remediation: 'Call through the generated API client so retries and auth are consistent.',
  run: (ctx) => {
    const hits = ctx.search(/\bfetch\(/, { include: /components\// });
    return hits.length ? { detail: `${hits.length} direct fetch calls.`, evidence: hits } : null;
  },
};

audit('./my-app', { rules: [...allRules, noFetchInComponents] });
```

See [architecture](./architecture.md#the-scancontext) for everything `ctx` provides.

## Performance

Roughly 200ms for a typical prototype, low single-digit seconds for a large monorepo.
File contents are cached per run, files over 512 KB are skipped, and `node_modules`,
`dist`, `.next`, `coverage` and similar are never traversed.

Very large repositories are capped at 20,000 files. Point Rescue Kit at the specific
package instead of the workspace root if you hit that.

## Limitations

- **Heuristic detection.** It reads code without executing it, so it cannot tell that a
  wrapper three call frames up does protect a route. Expect false positives — and
  [report them](https://github.com/Samshuk-Technologies/rescue-kit/issues), they're
  treated as bugs.
- **A clean report is not a security audit.**
- **JavaScript and TypeScript first.** Next.js, Vite, Remix, Express and similar are well
  covered. Python, Go and Ruby projects produce far fewer findings.
- **Simplified `.gitignore` matching.** Negation, nesting and directory scoping are not
  fully implemented.
- **Test files and fixtures are skipped** by the vulnerability rules. Deliberately
  vulnerable fixture code is not a vulnerability.
