/**
 * Core domain types for Rescue Kit.
 *
 * The shape of a `Rule` is the most important decision in this file: rules are plain
 * data plus a synchronous `run` function. That keeps them trivial to unit test and
 * trivial to contribute, which matters more than expressive power for a ruleset this
 * size. See docs/decisions/0001-static-analysis-over-llm.md.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type Category =
  | 'secrets'
  | 'auth'
  | 'payments'
  | 'data'
  | 'testing'
  | 'operations';

export const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low'];

export const CATEGORIES: readonly Category[] = [
  'secrets',
  'auth',
  'payments',
  'data',
  'testing',
  'operations',
];

export const CATEGORY_LABELS: Record<Category, string> = {
  secrets: 'Secrets & configuration',
  auth: 'Authentication & access',
  payments: 'Payments',
  data: 'Data & schema',
  testing: 'Testing & CI',
  operations: 'Operations & scaling',
};

/** A specific location backing up a finding. */
export interface Evidence {
  file: string;
  line?: number;
  /** Source line, trimmed and with anything secret-looking redacted. */
  excerpt?: string;
}

/** What a rule returns when it detects a problem. `null` means the check passed. */
export interface RuleHit {
  /** What is wrong in *this* project, specifically. Avoid restating the rule title. */
  detail: string;
  evidence?: Evidence[];
}

export interface Rule {
  id: string;
  title: string;
  category: Category;
  severity: Severity;
  /** How to fix it. Written for the developer who has to do the work. */
  remediation: string;
  /** Rough remediation estimate in engineer-hours, used for the effort total. */
  effortHours: number;
  /**
   * Skip the rule entirely when it cannot apply — a project with no payment provider
   * should not be marked down for missing webhook verification, nor credited for it.
   */
  appliesTo?(ctx: ScanContext): boolean;
  run(ctx: ScanContext): RuleHit | RuleHit[] | null;
}

export interface Finding extends RuleHit {
  ruleId: string;
  title: string;
  category: Category;
  severity: Severity;
  remediation: string;
  effortHours: number;
}

/** What we could work out about the project before running any rules. */
export interface StackProfile {
  /** e.g. 'next', 'vite', 'remix', 'astro', 'express', 'unknown' */
  framework: string;
  /** Frameworks that ship the front end to a browser bundle. */
  hasClientBundle: boolean;
  orm: string | null;
  database: string | null;
  authProvider: string | null;
  paymentProvider: string | null;
  errorTracking: string | null;
  testRunner: string | null;
  packageManager: string;
  typescript: boolean;
  /** Heuristic: does this look like it came out of an AI app builder? */
  aiGenerated: { likely: boolean; signals: string[] };
}

export interface PackageJson {
  name?: string;
  version?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  [key: string]: unknown;
}

export interface SearchOptions {
  /** Restrict to files whose path matches. */
  include?: RegExp;
  /** Skip files whose path matches. */
  exclude?: RegExp;
  /** Cap the evidence returned. Defaults to 5 — reports should point, not exhaust. */
  limit?: number;
  /**
   * Search test files, fixtures and examples too. Off by default: deliberately
   * vulnerable code in a test fixture is not a vulnerability, and reporting it is how a
   * scanner loses the reader's trust.
   */
  includeTests?: boolean;
  /**
   * Ignore matches on comment lines.
   *
   * For rules detecting a dangerous *code pattern*, a comment describing the pattern is
   * not an instance of it. Deliberately off by default, because the secrets rules must
   * keep reading comments — a commented-out credential is still committed.
   */
  skipComments?: boolean;
}

export interface ScanContext {
  /** Absolute path to the project root. */
  root: string;
  /** Every scanned file, as paths relative to root, using forward slashes. */
  files: string[];
  /** Source files only — the subset `search` looks at by default. */
  sourceFiles: string[];
  stack: StackProfile;
  pkg: PackageJson | null;

  /** Read a file relative to root. Returns '' if missing or unreadable. Cached. */
  read(relPath: string): string;
  /** Does this exact relative path exist? */
  has(relPath: string): boolean;
  /** Files whose relative path matches the pattern. */
  match(pattern: RegExp): string[];
  /** Grep across source files, returning redacted evidence with line numbers. */
  search(pattern: RegExp, options?: SearchOptions): Evidence[];
  /** Version range for a dependency in any dependency block, or undefined. */
  dependency(name: string): string | undefined;
  /** True if any of the named packages is a dependency. */
  anyDependency(names: string[]): boolean;
}

export interface CategoryScore {
  category: Category;
  /** 0–100. */
  score: number;
  /** False when no rule in the category applied to this project. */
  applicable: boolean;
  findings: Finding[];
}

export interface AuditResult {
  /** 0–100, weighted across applicable categories. */
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  /** Plain-language summary of what the score means. */
  verdict: string;
  findings: Finding[];
  categories: CategoryScore[];
  counts: Record<Severity, number>;
  /** Total remediation estimate in engineer-hours. */
  effortHours: number;
  stack: StackProfile;
  project: {
    name: string;
    root: string;
    filesScanned: number;
  };
  rulesRun: number;
  rulesSkipped: number;
  generatedAt: string;
}
