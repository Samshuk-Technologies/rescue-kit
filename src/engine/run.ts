import { basename } from 'node:path';
import { allRules } from '../rules/index.js';
import { createContext } from '../scan/context.js';
import {
  CATEGORIES,
  SEVERITIES,
  type AuditResult,
  type CategoryScore,
  type Finding,
  type Rule,
  type ScanContext,
  type Severity,
} from '../types.js';
import { gradeFor, overallScore, scoreCategory, verdictFor } from './score.js';

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export interface AuditOptions {
  /** Override the ruleset. Used by tests to run a rule in isolation. */
  rules?: Rule[];
  maxFiles?: number;
}

function toFindings(rule: Rule, ctx: ScanContext): Finding[] {
  let result;
  try {
    result = rule.run(ctx);
  } catch (error) {
    // One malformed file must not abort the whole audit. A rule that throws is a bug
    // in Rescue Kit, not a finding about the project, so it is reported as neither.
    process.emitWarning(
      `rule ${rule.id} threw: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }

  if (result === null) return [];
  const hits = Array.isArray(result) ? result : [result];

  return hits.map((hit) => ({
    ...hit,
    ruleId: rule.id,
    title: rule.title,
    category: rule.category,
    severity: rule.severity,
    remediation: rule.remediation,
    effortHours: rule.effortHours,
  }));
}

export function audit(root: string, options: AuditOptions = {}): AuditResult {
  const ctx = createContext(root, { maxFiles: options.maxFiles });
  const rules = options.rules ?? allRules;

  const findings: Finding[] = [];
  const applicableCategories = new Set<string>();
  let rulesRun = 0;
  let rulesSkipped = 0;

  for (const rule of rules) {
    if (rule.appliesTo && !rule.appliesTo(ctx)) {
      rulesSkipped++;
      continue;
    }
    rulesRun++;
    applicableCategories.add(rule.category);
    findings.push(...toFindings(rule, ctx));
  }

  findings.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.category.localeCompare(b.category) ||
      a.ruleId.localeCompare(b.ruleId),
  );

  const categories: CategoryScore[] = CATEGORIES.map((category) => {
    const categoryFindings = findings.filter((f) => f.category === category);
    return {
      category,
      applicable: applicableCategories.has(category),
      score: scoreCategory(categoryFindings),
      findings: categoryFindings,
    };
  });

  const counts = Object.fromEntries(
    SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length]),
  ) as Record<Severity, number>;

  const score = overallScore(categories);
  const grade = gradeFor(score);

  return {
    score,
    grade,
    verdict: verdictFor(grade, counts),
    findings,
    categories,
    counts,
    effortHours: findings.reduce((sum, f) => sum + f.effortHours, 0),
    stack: ctx.stack,
    project: {
      name: ctx.pkg?.name ?? basename(root) ?? 'project',
      root,
      filesScanned: ctx.files.length,
    },
    rulesRun,
    rulesSkipped,
    generatedAt: new Date().toISOString(),
  };
}
