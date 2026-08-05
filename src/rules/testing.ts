import type { Rule, ScanContext } from '../types.js';

const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(__tests__|tests?|e2e|cypress|playwright)\/)/;
const APP_SOURCE = /\.[cm]?[jt]sx?$/;
const PLACEHOLDER_TEST_SCRIPT = /no test specified|echo\s+["']?Error/i;

function testFiles(ctx: ScanContext): string[] {
  return ctx.sourceFiles.filter((f) => TEST_FILE.test(f));
}

function appSourceFiles(ctx: ScanContext): string[] {
  return ctx.sourceFiles.filter(
    (f) => APP_SOURCE.test(f) && !TEST_FILE.test(f) && !/\.config\.[cm]?[jt]s$/.test(f),
  );
}

function ciWorkflows(ctx: ScanContext): string[] {
  return ctx.files.filter(
    (f) =>
      /^\.github\/workflows\/.+\.ya?ml$/.test(f) ||
      /^\.gitlab-ci\.ya?ml$/.test(f) ||
      /^\.circleci\/config\.ya?ml$/.test(f) ||
      /^(azure-pipelines|bitbucket-pipelines)\.ya?ml$/.test(f),
  );
}

export const testingRules: Rule[] = [
  {
    id: 'testing/no-tests',
    title: 'No automated tests',
    category: 'testing',
    severity: 'high',
    effortHours: 24,
    remediation:
      'Start with the paths where a defect costs money — auth, checkout, anything writing to the database — rather than chasing a coverage percentage. A dozen tests on critical flows are worth more than a hundred on presentational components.',
    run(ctx) {
      if (testFiles(ctx).length > 0) return null;
      if (appSourceFiles(ctx).length < 5) return null; // Too small for the finding to mean anything.

      return {
        detail: `No test files were found across ${appSourceFiles(ctx).length} source files. Every change is verified by hand, so regressions are found by users rather than by CI.`,
      };
    },
  },

  {
    id: 'testing/thin-coverage',
    title: 'Very few tests relative to the codebase',
    category: 'testing',
    severity: 'medium',
    effortHours: 16,
    remediation:
      'Identify the flows a failure would actually hurt and cover those first. Add a regression test with every bug fix — that habit builds a suite shaped by real failures rather than by guesswork.',
    appliesTo: (ctx) => testFiles(ctx).length > 0,
    run(ctx) {
      const tests = testFiles(ctx).length;
      const source = appSourceFiles(ctx).length;
      if (source < 20) return null;

      const ratio = tests / source;
      if (ratio >= 0.1) return null;

      return {
        detail: `${tests} test file${tests === 1 ? '' : 's'} for ${source} source files (${Math.round(ratio * 100)}%). Most of the codebase has no automated verification at all.`,
      };
    },
  },

  {
    id: 'testing/no-test-script',
    title: 'No usable test command',
    category: 'testing',
    severity: 'medium',
    effortHours: 2,
    remediation:
      'Add a real `test` script to package.json. Contributors and CI both look there first, and a placeholder that exits non-zero means nobody can run the suite without reading the config.',
    appliesTo: (ctx) => ctx.pkg !== null,
    run(ctx) {
      const script = ctx.pkg?.scripts?.test;
      if (script && !PLACEHOLDER_TEST_SCRIPT.test(script)) return null;

      return {
        detail: script
          ? 'The `test` script is still the scaffold placeholder that exits with an error.'
          : 'package.json defines no `test` script.',
      };
    },
  },

  {
    id: 'testing/no-ci',
    title: 'No continuous integration',
    category: 'testing',
    severity: 'high',
    effortHours: 4,
    remediation:
      'Add a workflow running install, typecheck, lint and test on every push and pull request. Tests that only run when someone remembers are tests that stop passing without anyone noticing.',
    run(ctx) {
      if (ciWorkflows(ctx).length > 0) return null;

      return {
        detail:
          'No CI configuration was found. Nothing verifies a change before it reaches the default branch — or production, if deploys are automatic.',
      };
    },
  },

  {
    id: 'testing/no-typecheck-in-ci',
    title: 'CI does not typecheck',
    category: 'testing',
    severity: 'low',
    effortHours: 1,
    remediation:
      'Add `tsc --noEmit` as a CI step. Next.js and Vite builds skip type errors by default, so a type error can reach production without anything failing.',
    appliesTo: (ctx) => ctx.stack.typescript && ciWorkflows(ctx).length > 0,
    run(ctx) {
      const workflows = ciWorkflows(ctx).map((f) => ctx.read(f)).join('\n');
      if (/tsc|typecheck|type-check|astro check|vue-tsc|svelte-check/i.test(workflows)) return null;

      return {
        detail:
          'CI is configured but never runs the type checker, so type errors are only caught in an editor — if anyone has the file open.',
      };
    },
  },

  {
    id: 'testing/build-ignores-errors',
    title: 'Build configured to ignore type and lint errors',
    category: 'testing',
    severity: 'high',
    effortHours: 8,
    remediation:
      'Remove `ignoreBuildErrors` and `ignoreDuringBuilds`, then fix what surfaces. These flags are usually added to unblock one deploy and never removed, after which the type system stops providing any guarantee at all.',
    appliesTo: (ctx) => ctx.stack.framework === 'next',
    run(ctx) {
      const hits = ctx.search(/ignoreBuildErrors\s*:\s*true|ignoreDuringBuilds\s*:\s*true/, {
        limit: 4,
        skipComments: true,
      });
      if (hits.length === 0) return null;

      return {
        detail:
          'The Next.js config tells the build to proceed despite TypeScript or ESLint errors. Broken code can be deployed with a green build.',
        evidence: hits,
      };
    },
  },
];
