/**
 * Programmatic API.
 *
 * The CLI is the primary interface, but the audit is exposed as a library so it can be
 * embedded — a CI reporter, a dashboard, or a hosted version of the report.
 */
export { audit, type AuditOptions } from './engine/run.js';
export {
  CATEGORY_WEIGHT,
  SEVERITY_WEIGHT,
  gradeFor,
  overallScore,
  scoreCategory,
  verdictFor,
} from './engine/score.js';
export { allRules } from './rules/index.js';
export { createContext } from './scan/context.js';
export { renderHtml, type HtmlOptions } from './report/html.js';
export { renderTerminal, type TerminalOptions } from './report/terminal.js';
export { CATEGORIES, CATEGORY_LABELS, SEVERITIES } from './types.js';
export type {
  AuditResult,
  Category,
  CategoryScore,
  Evidence,
  Finding,
  Rule,
  RuleHit,
  ScanContext,
  Severity,
  StackProfile,
} from './types.js';
