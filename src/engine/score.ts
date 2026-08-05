import type { AuditResult, Category, Finding, Severity } from '../types.js';

/**
 * How much a single finding costs its category, out of 100.
 *
 * Calibrated so that one critical finding alone cannot be shrugged off — a project
 * shipping a live secret should not be able to score in the 90s because everything
 * else is tidy — while a handful of low findings stays cosmetic.
 */
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 50,
  high: 22,
  medium: 9,
  low: 3,
};

/**
 * How much each category counts toward the overall score.
 *
 * Secrets and auth dominate because they are the categories where a mistake is
 * unrecoverable: you can add tests next sprint, but a leaked production key is already
 * public and a missing authorisation check may already have been exploited.
 */
export const CATEGORY_WEIGHT: Record<Category, number> = {
  secrets: 1.3,
  auth: 1.3,
  payments: 1.1,
  data: 1.1,
  testing: 0.7,
  operations: 0.7,
};

const clamp = (n: number) => Math.max(0, Math.min(100, n));

export function scoreCategory(findings: Finding[]): number {
  const penalty = findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0);
  return Math.round(clamp(100 - penalty));
}

export function gradeFor(score: number): AuditResult['grade'] {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

export function verdictFor(grade: AuditResult['grade'], counts: Record<Severity, number>): string {
  if (counts.critical > 0) {
    const s = counts.critical === 1 ? '' : 's';
    return `Not safe to ship. ${counts.critical} critical issue${s} would be exploitable in production and should be fixed before this goes anywhere near real users or real money.`;
  }

  switch (grade) {
    case 'A':
      return 'Production-ready. The fundamentals are in place — remaining items are refinements rather than risks.';
    case 'B':
      return 'Close to production-ready. No critical exposure, but there are real gaps worth closing before you take on meaningful traffic.';
    case 'C':
      return 'Prototype quality. It works, but the hardening that keeps it working under real users, real data and real load has not been done yet.';
    case 'D':
      return 'Early prototype. Substantial work is needed across security, data and operational readiness before this can be trusted in production.';
    default:
      return 'Not production-ready. This is a working demo rather than a deployable product, and needs systematic hardening across most areas.';
  }
}

/**
 * Weighted mean across categories that actually apply.
 *
 * Categories with no applicable rules are excluded rather than scored 100. Crediting a
 * project for payment security it does not implement would inflate every score and make
 * the number meaningless for comparison.
 */
export function overallScore(
  categories: Array<{ category: Category; score: number; applicable: boolean }>,
): number {
  const applicable = categories.filter((c) => c.applicable);
  if (applicable.length === 0) return 100;

  let weighted = 0;
  let totalWeight = 0;
  for (const c of applicable) {
    const weight = CATEGORY_WEIGHT[c.category];
    weighted += c.score * weight;
    totalWeight += weight;
  }

  return Math.round(weighted / totalWeight);
}
