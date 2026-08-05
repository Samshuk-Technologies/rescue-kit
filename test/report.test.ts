import { afterAll, describe, expect, it } from 'vitest';
import { audit } from '../src/engine/run.js';
import { renderHtml } from '../src/report/html.js';
import { findingsAtOrAbove, renderTerminal } from '../src/report/terminal.js';
import { parseArgs } from '../src/cli.js';
import type { AuditResult } from '../src/types.js';
import { cleanupProjects, createProject, nextAppFiles, packageJson } from './helpers/project.js';

afterAll(cleanupProjects);

function brokenResult(): AuditResult {
  return audit(
    createProject({
      ...nextAppFiles(),
      '.env': 'SECRET=value',
      '.gitignore': '',
      'app/api/admin/route.ts': 'export async function DELETE() {}',
    }),
  );
}

describe('terminal report', () => {
  it('renders without colour codes when colour is off', () => {
    const output = renderTerminal(brokenResult(), { colour: false });
    expect(output).not.toMatch(/\u001b\[/);
  });

  it('includes colour codes when colour is on', () => {
    const output = renderTerminal(brokenResult(), { colour: true });
    expect(output).toMatch(/\u001b\[/);
  });

  it('shows the score, grade and effort estimate', () => {
    const result = brokenResult();
    const output = renderTerminal(result, { colour: false });

    expect(output).toContain(`${result.score}/100`);
    expect(output).toContain(`Grade ${result.grade}`);
    expect(output).toContain('Estimated remediation');
  });

  it('respects the minimum severity filter', () => {
    const result = brokenResult();
    const full = renderTerminal(result, { colour: false });
    const criticalOnly = renderTerminal(result, { colour: false, minSeverity: 'critical' });

    expect(full).toContain('LOW');
    expect(criticalOnly).not.toContain('LOW');
  });

  it('marks inapplicable categories rather than scoring them', () => {
    const result = audit(createProject({ 'package.json': packageJson() }));
    expect(renderTerminal(result, { colour: false })).toContain('not applicable');
  });
});

describe('html report', () => {
  it('produces a self-contained document with no external requests', () => {
    const html = renderHtml(brokenResult());

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/<script\s+src=/i);
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(html).not.toMatch(/https?:\/\/(?!samshuk\.com|github\.com)/);
  });

  it('escapes content taken from the scanned project', () => {
    const result = audit(
      createProject({
        'package.json': packageJson({ name: '<img src=x onerror=alert(1)>' }),
        'src/evil.ts': 'const x = "</script><script>alert(1)</script>";',
      }),
    );

    const html = renderHtml(result);

    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('includes the call to action by default and omits it on request', () => {
    expect(renderHtml(brokenResult())).toContain('samshuk.com');
    expect(renderHtml(brokenResult(), { cta: false })).not.toContain('Want these fixed?');
  });

  it('renders a clean state when there are no findings', () => {
    const result = brokenResult();
    const clean: AuditResult = { ...result, findings: [], counts: { critical: 0, high: 0, medium: 0, low: 0 } };

    expect(renderHtml(clean)).toContain('No findings');
  });

  it('supports both colour schemes', () => {
    expect(renderHtml(brokenResult())).toContain('prefers-color-scheme: dark');
  });
});

describe('findingsAtOrAbove', () => {
  it('includes the named severity and everything worse', () => {
    const result = brokenResult();

    const high = findingsAtOrAbove(result.findings, 'high');
    expect(high.every((f) => f.severity === 'critical' || f.severity === 'high')).toBe(true);

    expect(findingsAtOrAbove(result.findings, 'low').length).toBe(result.findings.length);
  });
});

describe('parseArgs', () => {
  it('defaults to the current directory', () => {
    const options = parseArgs([]);
    expect(options).not.toBe('help');
    if (options === 'help' || options === 'version') throw new Error('unexpected');
    expect(options.path).toBe('.');
    expect(options.minSeverity).toBe('low');
    expect(options.failOn).toBeNull();
  });

  it('recognises help and version', () => {
    expect(parseArgs(['--help'])).toBe('help');
    expect(parseArgs(['-h'])).toBe('help');
    expect(parseArgs(['--version'])).toBe('version');
    expect(parseArgs(['-v'])).toBe('version');
  });

  it('parses a path with options in any order', () => {
    const options = parseArgs(['--html', 'out.html', './app', '--fail-on', 'critical']);
    if (options === 'help' || options === 'version') throw new Error('unexpected');

    expect(options.path).toBe('./app');
    expect(options.html).toBe('out.html');
    expect(options.failOn).toBe('critical');
  });

  it('treats --json without a value as stdout', () => {
    const stdout = parseArgs(['--json']);
    if (stdout === 'help' || stdout === 'version') throw new Error('unexpected');
    expect(stdout.json).toBeNull();

    const toFile = parseArgs(['--json', 'out.json']);
    if (toFile === 'help' || toFile === 'version') throw new Error('unexpected');
    expect(toFile.json).toBe('out.json');
  });

  it('turns colour off on request', () => {
    const options = parseArgs(['--no-color']);
    if (options === 'help' || options === 'version') throw new Error('unexpected');
    expect(options.colour).toBe(false);
  });
});
