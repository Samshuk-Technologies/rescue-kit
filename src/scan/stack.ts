import type { PackageJson, StackProfile } from '../types.js';

type Lookup = (name: string) => string | undefined;

/** First match wins, so order matters: meta-frameworks before the libraries they wrap. */
const FRAMEWORKS: Array<[string, string[]]> = [
  ['next', ['next']],
  ['remix', ['@remix-run/react', '@remix-run/node']],
  ['nuxt', ['nuxt', 'nuxt3']],
  ['sveltekit', ['@sveltejs/kit']],
  ['astro', ['astro']],
  ['expo', ['expo']],
  ['react-native', ['react-native']],
  ['vite', ['vite']],
  ['create-react-app', ['react-scripts']],
  ['nest', ['@nestjs/core']],
  ['express', ['express']],
  ['fastify', ['fastify']],
];

const CLIENT_BUNDLE_FRAMEWORKS = new Set([
  'next', 'remix', 'nuxt', 'sveltekit', 'astro', 'vite', 'create-react-app',
  'expo', 'react-native',
]);

const ORMS: Array<[string, string[]]> = [
  ['prisma', ['prisma', '@prisma/client']],
  ['drizzle', ['drizzle-orm']],
  ['typeorm', ['typeorm']],
  ['sequelize', ['sequelize']],
  ['mongoose', ['mongoose']],
  ['kysely', ['kysely']],
];

const DATABASES: Array<[string, string[]]> = [
  ['supabase', ['@supabase/supabase-js', '@supabase/ssr', '@supabase/auth-helpers-nextjs']],
  ['firebase', ['firebase', 'firebase-admin']],
  ['postgres', ['pg', 'postgres', '@neondatabase/serverless', '@vercel/postgres']],
  ['mysql', ['mysql', 'mysql2']],
  ['mongodb', ['mongodb']],
  ['sqlite', ['better-sqlite3', 'sqlite3']],
  ['planetscale', ['@planetscale/database']],
];

const AUTH_PROVIDERS: Array<[string, string[]]> = [
  ['next-auth', ['next-auth', '@auth/core', '@auth/prisma-adapter']],
  ['clerk', ['@clerk/nextjs', '@clerk/clerk-react', '@clerk/backend']],
  ['supabase-auth', ['@supabase/auth-helpers-nextjs', '@supabase/ssr']],
  ['auth0', ['@auth0/nextjs-auth0', 'auth0']],
  ['firebase-auth', ['firebase-admin']],
  ['lucia', ['lucia']],
  ['better-auth', ['better-auth']],
  ['passport', ['passport']],
];

const PAYMENT_PROVIDERS: Array<[string, string[]]> = [
  ['stripe', ['stripe', '@stripe/stripe-js', '@stripe/react-stripe-js']],
  ['paddle', ['@paddle/paddle-js', '@paddle/paddle-node-sdk']],
  ['lemonsqueezy', ['@lemonsqueezy/lemonsqueezy.js']],
  ['razorpay', ['razorpay']],
  ['paypal', ['@paypal/react-paypal-js', '@paypal/checkout-server-sdk']],
];

const ERROR_TRACKING: Array<[string, string[]]> = [
  ['sentry', ['@sentry/nextjs', '@sentry/node', '@sentry/react', '@sentry/browser']],
  ['bugsnag', ['@bugsnag/js', '@bugsnag/node']],
  ['rollbar', ['rollbar']],
  ['datadog', ['dd-trace', '@datadog/browser-rum']],
  ['highlight', ['@highlight-run/next', 'highlight.run']],
];

const TEST_RUNNERS: Array<[string, string[]]> = [
  ['vitest', ['vitest']],
  ['jest', ['jest', 'ts-jest']],
  ['playwright', ['@playwright/test', 'playwright']],
  ['cypress', ['cypress']],
  ['mocha', ['mocha']],
  ['node:test', []], // Detected from scripts rather than dependencies.
];

function firstMatch(table: Array<[string, string[]]>, has: Lookup): string | null {
  for (const [name, packages] of table) {
    if (packages.some((p) => has(p) !== undefined)) return name;
  }
  return null;
}

function detectPackageManager(files: Set<string>): string {
  if (files.has('pnpm-lock.yaml')) return 'pnpm';
  if (files.has('yarn.lock')) return 'yarn';
  if (files.has('bun.lockb') || files.has('bun.lock')) return 'bun';
  if (files.has('package-lock.json')) return 'npm';
  return 'unknown';
}

/**
 * Heuristics for "this came out of an AI app builder".
 *
 * Not used to mark a project down — it only shapes the report's framing, since a
 * prototype straight out of a builder deserves different advice from a hand-written
 * codebase that has drifted.
 */
function detectAiGenerated(files: string[], pkg: PackageJson | null): StackProfile['aiGenerated'] {
  const signals: string[] = [];
  const fileSet = new Set(files);

  const markers: Array<[string, string]> = [
    ['.lovable', 'Lovable project marker'],
    ['lovable-tagger.config.ts', 'Lovable tagger config'],
    ['.bolt', 'Bolt.new project marker'],
    ['.v0', 'v0 project marker'],
    ['.replit', 'Replit project marker'],
    ['replit.nix', 'Replit environment file'],
  ];
  for (const [file, why] of markers) {
    if (fileSet.has(file)) signals.push(why);
  }

  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  if (deps['lovable-tagger']) signals.push('lovable-tagger dependency');

  // App builders overwhelmingly scaffold shadcn/ui on Vite + React with no test runner.
  const hasShadcn = files.some((f) => f.includes('components/ui/') && f.endsWith('.tsx'));
  const hasTests = files.some((f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f));
  if (hasShadcn && !hasTests) {
    signals.push('shadcn/ui component set with no tests alongside it');
  }

  if (pkg && !pkg.description && !pkg.scripts?.test && fileSet.has('package.json')) {
    signals.push('package.json left at scaffold defaults');
  }

  return { likely: signals.length >= 2, signals };
}

export function detectStack(files: string[], pkg: PackageJson | null): StackProfile {
  const allDeps: Record<string, string> = {
    ...pkg?.dependencies,
    ...pkg?.devDependencies,
    ...pkg?.peerDependencies,
  };
  const has: Lookup = (name) => allDeps[name];
  const fileSet = new Set(files);

  const framework = firstMatch(FRAMEWORKS, has) ?? 'unknown';

  let testRunner = firstMatch(TEST_RUNNERS, has);
  if (!testRunner && /node\s+--test|node:test/.test(pkg?.scripts?.test ?? '')) {
    testRunner = 'node:test';
  }

  return {
    framework,
    hasClientBundle: CLIENT_BUNDLE_FRAMEWORKS.has(framework),
    orm: firstMatch(ORMS, has),
    database: firstMatch(DATABASES, has),
    authProvider: firstMatch(AUTH_PROVIDERS, has),
    paymentProvider: firstMatch(PAYMENT_PROVIDERS, has),
    errorTracking: firstMatch(ERROR_TRACKING, has),
    testRunner,
    packageManager: detectPackageManager(fileSet),
    typescript: has('typescript') !== undefined || fileSet.has('tsconfig.json'),
    aiGenerated: detectAiGenerated(files, pkg),
  };
}
