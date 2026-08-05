#!/usr/bin/env node
import { realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit } from './engine/run.js';
import { renderHtml } from './report/html.js';
import { findingsAtOrAbove, renderTerminal } from './report/terminal.js';
import { SEVERITIES, type Severity } from './types.js';

const VERSION = '0.1.0';

const HELP = `
  Rescue Kit ${VERSION}
  Production-readiness audit for AI-generated codebases.

  Usage
    rescuekit [path] [options]

  Options
    --html <file>          Write a shareable HTML report
    --json [file]          Write JSON (stdout when no file given)
    --min-severity <level> Hide findings below this level        (default: low)
    --fail-on <level>      Exit 1 if findings at or above this level exist
    --no-cta               Omit the Samshuk call-to-action from the HTML report
    --no-color             Disable coloured terminal output
    -h, --help             Show this help
    -v, --version          Show version

  Levels: ${SEVERITIES.join(', ')}

  Examples
    rescuekit                              Audit the current directory
    rescuekit ./my-app --html report.html  Audit and write a shareable report
    rescuekit --fail-on critical           Use as a CI gate
`;

interface Options {
  path: string;
  html: string | null;
  json: string | null | undefined; // undefined = not requested, null = stdout
  minSeverity: Severity;
  failOn: Severity | null;
  colour: boolean;
  cta: boolean;
}

function isSeverity(value: string): value is Severity {
  return (SEVERITIES as readonly string[]).includes(value);
}

function fail(message: string): never {
  process.stderr.write(`rescuekit: ${message}\n`);
  process.exit(2);
}

export function parseArgs(argv: string[]): Options | 'help' | 'version' {
  const options: Options = {
    path: '.',
    html: null,
    json: undefined,
    minSeverity: 'low',
    failOn: null,
    // Respect NO_COLOR, and don't emit escape codes when piped to a file.
    colour: !process.env.NO_COLOR && process.stdout.isTTY === true,
    cta: true,
  };

  let seenPath = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    switch (arg) {
      case '-h':
      case '--help':
        return 'help';

      case '-v':
      case '--version':
        return 'version';

      case '--html': {
        const value = argv[++i];
        if (!value || value.startsWith('-')) fail('--html requires a file path');
        options.html = value;
        break;
      }

      case '--json': {
        const next = argv[i + 1];
        if (next && !next.startsWith('-')) {
          options.json = next;
          i++;
        } else {
          options.json = null; // stdout
        }
        break;
      }

      case '--min-severity': {
        const value = argv[++i];
        if (!value || !isSeverity(value)) fail(`--min-severity must be one of: ${SEVERITIES.join(', ')}`);
        options.minSeverity = value;
        break;
      }

      case '--fail-on': {
        const value = argv[++i];
        if (!value || !isSeverity(value)) fail(`--fail-on must be one of: ${SEVERITIES.join(', ')}`);
        options.failOn = value;
        break;
      }

      case '--no-color':
      case '--no-colour':
        options.colour = false;
        break;

      case '--no-cta':
        options.cta = false;
        break;

      default:
        if (arg.startsWith('-')) fail(`unknown option: ${arg}`);
        if (seenPath) fail('only one path may be given');
        options.path = arg;
        seenPath = true;
    }
  }

  return options;
}

function main(): void {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed === 'help') {
    process.stdout.write(HELP);
    return;
  }
  if (parsed === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const root = resolve(parsed.path);
  const result = audit(root);

  // JSON to stdout is machine-readable output: nothing else may go there.
  if (parsed.json === null) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    if (parsed.json !== undefined) {
      writeFileSync(parsed.json, `${JSON.stringify(result, null, 2)}\n`);
    }
    process.stdout.write(
      renderTerminal(result, { colour: parsed.colour, minSeverity: parsed.minSeverity }),
    );
  }

  if (parsed.html) {
    writeFileSync(parsed.html, renderHtml(result, { cta: parsed.cta }));
    if (parsed.json !== null) {
      process.stdout.write(`  Report written to ${parsed.html}\n\n`);
    }
  }

  if (parsed.failOn && findingsAtOrAbove(result.findings, parsed.failOn).length > 0) {
    process.exit(1);
  }
}

/**
 * Only run when invoked as a command, not when imported.
 *
 * `parseArgs` is exported for testing, and a bare `main()` here would audit the test
 * runner's own working directory — and potentially call process.exit — on import.
 */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectRun()) main();
