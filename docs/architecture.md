# Architecture

Rescue Kit is a small pipeline: walk the project, build a context, run rules against it,
score the findings, render. Roughly 1,500 lines with no runtime dependencies.

```
  path
   │
   ▼
┌──────────────┐   files, sourceFiles
│  scan/walk   │──────────────────────┐
└──────────────┘                      │
                                      ▼
┌──────────────┐  package.json  ┌──────────────┐
│ scan/stack   │◀───────────────│ scan/context │  read · search · match · dependency
└──────────────┘   StackProfile └──────────────┘
                                      │ ScanContext
                                      ▼
                              ┌──────────────┐
                              │    rules/    │  34 rules across 6 categories
                              └──────────────┘
                                      │ Finding[]
                                      ▼
                              ┌──────────────┐
                              │ engine/score │  category scores → weighted mean → grade
                              └──────────────┘
                                      │ AuditResult
                          ┌───────────┴───────────┐
                          ▼                       ▼
                   report/terminal          report/html
```

## Module map

| Path | Responsibility |
| --- | --- |
| `src/types.ts` | Every shared type. The `Rule` interface is the load-bearing one |
| `src/scan/walk.ts` | Directory traversal, skip lists, source-file classification |
| `src/scan/stack.ts` | Framework, ORM, database, auth, payments and AI-origin detection |
| `src/scan/context.ts` | The `ScanContext` rules receive — file access, search, redaction |
| `src/rules/*.ts` | One module per category |
| `src/engine/run.ts` | Runs rules, assembles findings, builds the result |
| `src/engine/score.ts` | Scoring, grading, verdict |
| `src/report/terminal.ts` | ANSI terminal output |
| `src/report/html.ts` | Self-contained HTML report |
| `src/cli.ts` | Argument parsing and orchestration |
| `src/index.ts` | Public API |

## The `Rule` interface

A rule is plain data plus a synchronous function:

```ts
interface Rule {
  id: string;              // 'category/kebab-case'
  title: string;
  category: Category;
  severity: Severity;
  remediation: string;
  effortHours: number;
  appliesTo?(ctx: ScanContext): boolean;
  run(ctx: ScanContext): RuleHit | RuleHit[] | null;
}
```

`run` returns `null` for a pass, or a hit with a `detail` written about *this* project and
optional `evidence`.

Three properties follow from this shape, and all three were the reason for choosing it:

**Rules are trivially testable.** No mocking, no setup — construct a temp project, run one
rule, assert. `test/rules.test.ts` runs each rule in isolation via
`audit(root, { rules: [rule] })`, so a finding can never be attributed to the wrong check.

**Rules are trivially contributable.** A new rule is one object and two tests. There is no
plugin lifecycle to learn.

**Rules are synchronous.** This is a constraint, not an oversight: it forbids network
access at the type level, which is what makes the offline guarantee in
[ADR 0001](./decisions/0001-static-analysis-over-llm.md) structural rather than a promise.

### `appliesTo` versus returning `null`

These produce different scores and the distinction matters:

- `appliesTo` returning `false` → the rule is skipped, and if **no** rule in the category
  applied, the whole category is excluded from the score.
- `run` returning `null` → the rule ran and passed, contributing 100 to its category.

Use `appliesTo` for "this cannot apply here" (no payment provider installed). Use `null`
for "checked, and it's fine".

## The `ScanContext`

Everything a rule can see:

```ts
interface ScanContext {
  root: string;
  files: string[];        // all scanned paths, relative, forward slashes
  sourceFiles: string[];  // greppable subset
  stack: StackProfile;
  pkg: PackageJson | null;

  read(relPath): string;               // cached; '' if missing
  has(relPath): boolean;
  match(pattern: RegExp): string[];    // paths matching
  search(pattern, options?): Evidence[];
  dependency(name): string | undefined;
  anyDependency(names): boolean;
}
```

### `search` options

| Option | Default | Purpose |
| --- | --- | --- |
| `include` | — | Only files whose path matches |
| `exclude` | — | Skip files whose path matches |
| `limit` | `5` | Cap evidence. Reports should point, not exhaust |
| `includeTests` | `false` | Search test files and fixtures too |
| `skipComments` | `false` | Ignore matches on comment lines |

The last two defaults are the ones that took real-world tuning:

**`includeTests: false`** — a test asserting that `req.body.isAdmin` is *rejected*
necessarily contains that string. Flagging it is the fastest way to teach a user that the
scanner cries wolf. Every project with a decent test suite has deliberately vulnerable
code in its fixtures.

**`skipComments: false`** — off by default because the secrets rules must read comments: a
commented-out credential is still committed. The code-pattern rules opt in, because a
comment describing SQL injection is not SQL injection. Rescue Kit's own self-audit went
from 60/100 to 96/100 when these two were introduced, and every finding they removed was
a false positive.

### Redaction

`search` redacts credential-shaped substrings before returning evidence:

```ts
const SECRET_SHAPED = /\b([A-Za-z0-9_\-]{4})[A-Za-z0-9_\-+/=]{16,}\b/g;
// a Stripe key "sk_test_" + 24 characters  →  "sk_t••••••••"
```

The first four characters survive so a reader can tell *which* credential was found and
go rotate the right one, while the value itself is destroyed.

(The example above is written as a concatenation on purpose. A literal credential-shaped
string in the documentation would be flagged by Rescue Kit's own secret rule — as it was,
on the first run of this file.)

**This happens at capture, not at render.** Any new output format inherits it, and there
is no path by which a reporter can forget. Reports get shared — pasted into Slack,
emailed to clients, occasionally committed — and a security tool that leaked the secrets
it found would be worse than no tool at all. It is listed as a vulnerability class in
[SECURITY.md](../SECURITY.md).

## Detection patterns

Credential patterns are written so they never match their own source:

```ts
[/\bsk_(?:live|test)_[A-Za-z0-9]{16,}/, 'Stripe secret key'],
```

The alternation means the literal string `sk_live_` never appears in the file, so scanning
Rescue Kit with Rescue Kit does not flag its own ruleset. Every pattern follows this
convention — keep it when adding one.

## Error handling

A rule that throws is a bug in Rescue Kit, not a finding about the project. `engine/run.ts`
catches, emits a process warning, and continues. One malformed file cannot abort an audit.

Similarly, unreadable files and directories are skipped rather than fatal, and a malformed
`package.json` yields `pkg: null` rather than an exception — that case is itself covered by
a rule.

## Testing strategy

101 tests across four suites:

| Suite | Covers |
| --- | --- |
| `scan.test.ts` | Traversal, skip lists, caching, redaction, search options, stack detection |
| `rules.test.ts` | Every rule fires on the problem **and** stays quiet on correct code |
| `score.test.ts` | Scoring arithmetic and calibration properties |
| `report.test.ts` | Output escaping, self-containment, severity filtering, argument parsing |

Fixtures are built with `createProject({ 'path/file.ts': 'contents' })`, which writes a
real temporary directory. Roughly half of what rules check *is* filesystem shape — which
files exist, what the lockfile is, whether `.gitignore` covers `.env` — so mocking the
filesystem would mean testing the mock.

**Every rule has a negative test.** False positives are what make people uninstall a
scanner, so the test proving a rule stays quiet matters more than the one proving it
fires.

Credential-shaped strings are assembled at runtime in `test/helpers/project.ts` rather
than written as literals — committed fake credentials trip GitHub push protection and
every secret scanner a contributor runs.

## Documentation generation

`docs/rules.md` is generated from the ruleset by `scripts/generate-rules-doc.mjs`. CI runs
it with `--check` and fails if the committed copy differs, so the rule reference cannot
drift from the code. A security tool whose documentation disagrees with its behaviour is
worse than one with no documentation.

```bash
npm run docs:rules    # regenerate
npm run docs:check    # verify (CI)
```

## Extension points

**A new rule** — add to `src/rules/<category>.ts`, export from `index.ts`, write two tests,
regenerate the docs. See [CONTRIBUTING](../CONTRIBUTING.md).

**A new category** — add to `Category` and `CATEGORIES` in `types.ts`, give it a label and
a weight in `engine/score.ts`, and an intro in the doc generator.

**A new output format** — take an `AuditResult` and render it. Evidence arrives already
redacted, so a new reporter cannot leak.

**A new language** — extend `SOURCE_EXTENSIONS` in `walk.ts` and add rules. Note that
current coverage is JavaScript/TypeScript-shaped; meaningful Python or Go support would
want an AST, which conflicts with
[ADR 0002](./decisions/0002-zero-runtime-dependencies.md) and should be discussed first.
