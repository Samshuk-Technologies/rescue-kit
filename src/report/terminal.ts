import {
  CATEGORY_LABELS,
  SEVERITIES,
  type AuditResult,
  type Finding,
  type Severity,
} from '../types.js';

const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  magenta: '\u001b[35m',
  cyan: '\u001b[36m',
  grey: '\u001b[90m',
} as const;

type Colour = keyof typeof ANSI;

export interface TerminalOptions {
  colour?: boolean;
  /** Hide findings below this severity. */
  minSeverity?: Severity;
}

const SEVERITY_COLOUR: Record<Severity, Colour> = {
  critical: 'red',
  high: 'magenta',
  medium: 'yellow',
  low: 'grey',
};

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function makePaint(enabled: boolean) {
  return (text: string, ...colours: Colour[]): string => {
    if (!enabled) return text;
    return colours.map((c) => ANSI[c]).join('') + text + ANSI.reset;
  };
}

function scoreColour(score: number): Colour {
  if (score >= 75) return 'green';
  if (score >= 50) return 'yellow';
  return 'red';
}

function bar(score: number, width = 20): string {
  const filled = Math.round((score / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/** Wrap to a width, preserving whole words, with each line indented. */
function wrap(text: string, width: number, indent: string): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    if (line.length + word.length + 1 > width && line.length > 0) {
      lines.push(indent + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(indent + line);
  return lines;
}

function formatEffort(hours: number): string {
  if (hours === 0) return 'none';
  const days = Math.round((hours / 8) * 10) / 10;
  return `${hours} engineer-hours (~${days} days)`;
}

export function renderTerminal(result: AuditResult, options: TerminalOptions = {}): string {
  const paint = makePaint(options.colour ?? true);
  const width = Math.min(process.stdout.columns || 80, 100);
  const minRank = SEVERITY_RANK[options.minSeverity ?? 'low'];

  const out: string[] = [''];

  // ── Header ────────────────────────────────────────────────────────────────
  out.push(
    `  ${paint('Rescue Kit', 'bold', 'cyan')} ${paint('·', 'grey')} ${paint(result.project.name, 'bold')}`,
  );
  out.push('');

  const sc = scoreColour(result.score);
  out.push(
    `  ${paint(bar(result.score, 24), sc)}  ${paint(`${result.score}/100`, 'bold', sc)}  ${paint(`Grade ${result.grade}`, 'bold')}`,
  );
  out.push('');
  out.push(...wrap(result.verdict, width - 4, '  '));
  out.push('');

  // ── Stack ─────────────────────────────────────────────────────────────────
  const stackParts = [
    result.stack.framework !== 'unknown' ? result.stack.framework : null,
    result.stack.typescript ? 'typescript' : null,
    result.stack.orm,
    result.stack.database,
    result.stack.authProvider,
    result.stack.paymentProvider,
  ].filter(Boolean);

  out.push(
    paint(
      `  ${result.project.filesScanned} files · ${result.rulesRun} rules run, ${result.rulesSkipped} not applicable`,
      'grey',
    ),
  );
  if (stackParts.length > 0) {
    out.push(paint(`  Stack: ${stackParts.join(', ')}`, 'grey'));
  }
  if (result.stack.aiGenerated.likely) {
    out.push(paint('  Looks AI-generated: ' + result.stack.aiGenerated.signals[0], 'grey'));
  }
  out.push('');

  // ── Category scores ───────────────────────────────────────────────────────
  const labelWidth = Math.max(...Object.values(CATEGORY_LABELS).map((l) => l.length));
  for (const category of result.categories) {
    const label = CATEGORY_LABELS[category.category].padEnd(labelWidth);

    if (!category.applicable) {
      out.push(`  ${paint(label, 'grey')}  ${paint('not applicable', 'grey')}`);
      continue;
    }

    const count = category.findings.length;
    const suffix = count === 0 ? paint('clean', 'green') : paint(`${count} issue${count === 1 ? '' : 's'}`, 'grey');
    out.push(
      `  ${label}  ${paint(bar(category.score, 12), scoreColour(category.score))} ${String(category.score).padStart(3)}  ${suffix}`,
    );
  }
  out.push('');

  // ── Findings ──────────────────────────────────────────────────────────────
  const visible = result.findings.filter((f) => SEVERITY_RANK[f.severity] <= minRank);

  if (visible.length === 0) {
    out.push(`  ${paint('No findings at this severity threshold.', 'green')}`);
    out.push('');
    return out.join('\n');
  }

  for (const severity of SEVERITIES) {
    const group = visible.filter((f) => f.severity === severity);
    if (group.length === 0) continue;

    const colour = SEVERITY_COLOUR[severity];
    out.push(`  ${paint(`${severity.toUpperCase()} (${group.length})`, 'bold', colour)}`);
    out.push(paint('  ' + '─'.repeat(width - 4), 'grey'));
    out.push('');

    for (const finding of group) {
      out.push(`  ${paint('●', colour)} ${paint(finding.title, 'bold')}  ${paint(finding.ruleId, 'grey')}`);
      out.push(...wrap(finding.detail, width - 8, '    '));

      for (const item of (finding.evidence ?? []).slice(0, 4)) {
        const location = item.line ? `${item.file}:${item.line}` : item.file;
        out.push(`    ${paint('→', 'grey')} ${paint(location, 'cyan')}`);
        if (item.excerpt) {
          out.push(`      ${paint(item.excerpt.slice(0, width - 10), 'grey')}`);
        }
      }

      const remaining = (finding.evidence?.length ?? 0) - 4;
      if (remaining > 0) {
        out.push(paint(`    → and ${remaining} more`, 'grey'));
      }

      out.push(...wrap(`Fix: ${finding.remediation}`, width - 8, '    ').map((l) => paint(l, 'dim')));
      out.push('');
    }
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  const counts = SEVERITIES.filter((s) => result.counts[s] > 0)
    .map((s) => paint(`${result.counts[s]} ${s}`, SEVERITY_COLOUR[s]))
    .join(paint(' · ', 'grey'));

  out.push(paint('  ' + '─'.repeat(width - 4), 'grey'));
  out.push(`  ${counts}`);
  out.push(`  ${paint('Estimated remediation:', 'grey')} ${paint(formatEffort(result.effortHours), 'bold')}`);
  out.push('');
  out.push(paint('  Share the full report:  rescuekit --html report.html', 'grey'));
  out.push('');

  return out.join('\n');
}

/** Findings the `--fail-on` gate should consider. Exported for testing. */
export function findingsAtOrAbove(findings: Finding[], severity: Severity): Finding[] {
  return findings.filter((f) => SEVERITY_RANK[f.severity] <= SEVERITY_RANK[severity]);
}
