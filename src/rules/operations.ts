import type { Rule } from '../types.js';

const ROUTE_FILE = /(^|\/)(app\/.*\/route\.[tj]sx?|pages\/api\/.*\.[tj]sx?)$/;

const RATE_LIMIT_PACKAGES = [
  '@upstash/ratelimit', 'express-rate-limit', 'rate-limiter-flexible',
  '@fastify/rate-limit', 'limiter', 'next-rate-limit',
];

const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock'];

export const operationsRules: Rule[] = [
  {
    id: 'ops/no-error-tracking',
    title: 'No error tracking',
    category: 'operations',
    severity: 'high',
    effortHours: 3,
    remediation:
      'Wire up Sentry or an equivalent on both server and client, with release tagging and source maps uploaded. Without it, production errors are only visible when a user takes the trouble to report one — and most will simply leave.',
    // Only for things that get deployed and serve users. A CLI or a library has no
    // production to track errors in, and marking every package down for it is noise.
    appliesTo: (ctx) =>
      ctx.stack.framework !== 'unknown' || ctx.files.some((f) => ROUTE_FILE.test(f)),
    run(ctx) {
      if (ctx.stack.errorTracking) return null;

      return {
        detail:
          'No error tracking service is installed. Exceptions in production go into a log nobody reads, if they are recorded at all — you will not know the app is broken until someone tells you.',
      };
    },
  },

  {
    id: 'ops/no-rate-limiting',
    title: 'Public endpoints with no rate limiting',
    category: 'operations',
    severity: 'high',
    effortHours: 6,
    remediation:
      'Rate limit by IP and by account on anything unauthenticated, and especially on endpoints that send email, reset passwords, or call a paid API. Without it, one script turns your endpoints into someone else\'s free resource and your bill into their problem.',
    appliesTo: (ctx) => ctx.files.some((f) => ROUTE_FILE.test(f)),
    run(ctx) {
      if (ctx.anyDependency(RATE_LIMIT_PACKAGES)) return null;
      if (ctx.search(/rateLimit|rate_limit|ratelimit/i, { limit: 1 }).length > 0) return null;

      const routes = ctx.files.filter((f) => ROUTE_FILE.test(f));
      const aiCalls = ctx.search(/openai|anthropic|@ai-sdk|replicate/i, { limit: 1 });
      const costly =
        aiCalls.length > 0
          ? ' At least one endpoint calls a metered AI API, so abuse translates directly into cost.'
          : '';

      return {
        detail: `${routes.length} public endpoint${routes.length === 1 ? '' : 's'} with no rate limiting anywhere in the project.${costly}`,
      };
    },
  },

  {
    id: 'ops/no-lockfile',
    title: 'No dependency lockfile',
    category: 'operations',
    severity: 'medium',
    effortHours: 1,
    remediation:
      'Commit the lockfile your package manager generates. Without one, two installs a week apart resolve different versions, which is how "works on my machine" becomes a production incident nobody can reproduce.',
    appliesTo: (ctx) => ctx.pkg !== null,
    run(ctx) {
      if (LOCKFILES.some((f) => ctx.has(f))) return null;

      return {
        detail:
          'No lockfile is committed, so dependency versions are resolved fresh on every install. Builds are not reproducible and a transitive update can break production without any change to your code.',
      };
    },
  },

  {
    id: 'ops/no-security-headers',
    title: 'No security headers configured',
    category: 'operations',
    severity: 'medium',
    effortHours: 4,
    remediation:
      'Set Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options and Referrer-Policy — in `next.config` headers for Next.js, or via helmet for Express. CSP is the meaningful one and takes the most tuning, so start it in report-only mode.',
    appliesTo: (ctx) => ctx.stack.hasClientBundle || ctx.stack.framework === 'express',
    run(ctx) {
      if (ctx.anyDependency(['helmet', '@fastify/helmet'])) return null;
      const configured = ctx.search(
        /Content-Security-Policy|Strict-Transport-Security|X-Content-Type-Options|async\s+headers\s*\(/i,
        { limit: 1 },
      );
      if (configured.length > 0) return null;

      return {
        detail:
          'No security headers are configured. The app has no defence-in-depth against clickjacking, MIME sniffing, or script injection that gets past input handling.',
      };
    },
  },

  {
    id: 'ops/no-node-version-pinned',
    title: 'Node version not pinned',
    category: 'operations',
    severity: 'low',
    effortHours: 1,
    remediation:
      'Add an `engines.node` field and a `.nvmrc`. Hosting platforms otherwise pick a default that changes without warning, and the resulting failure appears at deploy time with no related code change to blame.',
    appliesTo: (ctx) => ctx.pkg !== null,
    run(ctx) {
      if (ctx.pkg?.engines?.node) return null;
      if (ctx.has('.nvmrc') || ctx.has('.node-version')) return null;

      return {
        detail: 'Neither `engines.node` nor an `.nvmrc` is present, so the runtime version is whatever each environment happens to default to.',
      };
    },
  },

  {
    id: 'ops/debug-logging-left-in',
    title: 'Debug logging left in application code',
    category: 'operations',
    severity: 'low',
    effortHours: 3,
    remediation:
      'Replace with a structured logger that has levels and can be turned down in production. Beyond the noise, console statements routinely log request bodies and tokens straight into whatever aggregates your output.',
    run(ctx) {
      const hits = ctx.search(/console\.(?:log|debug)\s*\(/, {
        exclude: /(scripts?\/|\.config\.|seed|bin\/|test|spec)/,
        limit: 40,
      });
      if (hits.length < 15) return null;

      return {
        detail: `${hits.length}+ console statements across application code. Some log request or response objects, which is a common route for tokens and personal data to end up in log aggregation.`,
        evidence: hits.slice(0, 5),
      };
    },
  },

  {
    id: 'ops/no-readme',
    title: 'No README',
    category: 'operations',
    severity: 'low',
    effortHours: 2,
    remediation:
      'Document what the project is, how to run it locally, what configuration it needs, and how it deploys. Four short sections is enough, and it is the difference between a day and a week for whoever inherits this.',
    run(ctx) {
      const hasReadme = ctx.files.some((f) => /^readme(\.md|\.txt)?$/i.test(f));
      if (hasReadme) return null;

      return { detail: 'No README. There is no written record of how to run, configure, or deploy this project.' };
    },
  },
];
