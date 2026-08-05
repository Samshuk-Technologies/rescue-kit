# Security policy

## Reporting a vulnerability

Email **security@samshuk.com**, or use GitHub's
[private vulnerability reporting](https://github.com/Samshuk-Technologies/rescue-kit/security/advisories/new).

Please don't open a public issue for a vulnerability.

We'll acknowledge within 3 working days and aim to have a fix or a clear plan within 14.
We're happy to credit you in the advisory unless you'd rather we didn't.

## What counts as a vulnerability here

Rescue Kit reads source code and writes a report. The things that would genuinely matter:

- **A credential reaching the report unredacted.** Redaction happens in
  `ScanContext.search`. Any path that captures source text and bypasses it is a real
  vulnerability — reports get shared in Slack, by email, and sometimes committed.
- **Code execution from a scanned project.** Rescue Kit must never execute, import, or
  evaluate anything in the directory it audits. It only reads files.
- **Path traversal out of the audited directory**, or writing anywhere other than the
  output file that was explicitly requested.
- **HTML injection in the report.** Everything derived from a scanned project is escaped
  before rendering. An escape bypass is stored XSS in a file people open in a browser.

## What doesn't count

**False negatives are not vulnerabilities.** Rescue Kit is a heuristic scanner. A clean
report means the common prototype failures weren't detected — not that the application is
secure. Missed findings are bugs worth reporting as ordinary issues, and we want to hear
about them, but they aren't security reports.

False positives likewise: please open a normal issue.

## Supported versions

The latest published version. This project is pre-1.0 and fixes go to `main`.
