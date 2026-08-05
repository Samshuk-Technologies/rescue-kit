import type { Evidence, Rule, ScanContext } from '../types.js';

/** Real env files, excluding the templates that are meant to be committed. */
const ENV_FILE = /(^|\/)\.env(\.|$)/;
const ENV_TEMPLATE = /\.(example|sample|template|dist)$/;

/**
 * Credential patterns, written so they never match their own source.
 *
 * Every pattern here uses an alternation or a quantified class immediately after its
 * literal prefix, so scanning Rescue Kit with Rescue Kit does not flag this file.
 */
const CREDENTIAL_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk_(?:live|test)_[A-Za-z0-9]{16,}/, 'Stripe secret key'],
  [/\brk_(?:live|test)_[A-Za-z0-9]{16,}/, 'Stripe restricted key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key ID'],
  [/\bAIza[0-9A-Za-z_\-]{35}\b/, 'Google API key'],
  [/\bghp_[A-Za-z0-9]{36}\b/, 'GitHub personal access token'],
  [/\bgithub_pat_[A-Za-z0-9_]{60,}/, 'GitHub fine-grained token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\bSG\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}/, 'SendGrid API key'],
  [/\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\./, 'signed JWT (possibly a service key)'],
  [/-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, 'private key block'],
  [/\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?):\/\/[^\s:@/]+:[^\s@]{6,}@/, 'database URL with an inline password'],
];

/**
 * Env var names that must never reach a browser bundle.
 *
 * The public prefixes are the trap: framework authors chose them to make exposure
 * explicit, but an AI-generated app will happily add one to make a build error go away.
 */
const PUBLIC_PREFIX = /\b(?:NEXT_PUBLIC|VITE|PUBLIC|EXPO_PUBLIC|REACT_APP|NUXT_PUBLIC)_[A-Z0-9_]*(?:SECRET|PRIVATE|SERVICE_ROLE|PASSWORD|CREDENTIAL)[A-Z0-9_]*/;
/** `_KEY` and `_TOKEN` need a second look: publishable keys legitimately use them. */
const PUBLIC_PREFIX_SOFT = /\b(?:NEXT_PUBLIC|VITE|PUBLIC|EXPO_PUBLIC|REACT_APP|NUXT_PUBLIC)_[A-Z0-9_]*(?:API_KEY|SECRET_KEY|ACCESS_TOKEN|AUTH_TOKEN)[A-Z0-9_]*/;

function envFiles(ctx: ScanContext): string[] {
  return ctx.files.filter((f) => ENV_FILE.test(f) && !ENV_TEMPLATE.test(f));
}

function gitignoreCovers(ctx: ScanContext, file: string): boolean {
  const gitignore = ctx.read('.gitignore');
  if (!gitignore) return false;

  const base = file.slice(file.lastIndexOf('/') + 1);
  return gitignore
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .some((pattern) => {
      const normalised = pattern.replace(/^\//, '').replace(/\/$/, '');
      if (normalised === file || normalised === base) return true;
      // `.env*` and `.env.*` are the idiomatic catch-alls.
      if (normalised.startsWith('.env') && normalised.includes('*')) return true;
      return false;
    });
}

export const secretsRules: Rule[] = [
  {
    id: 'secrets/committed-env',
    title: 'Environment file is not excluded from version control',
    category: 'secrets',
    severity: 'critical',
    effortHours: 2,
    remediation:
      'Add `.env*` to .gitignore (keeping `!.env.example`), then rotate every credential the file contains — git history keeps them recoverable even after deletion. Use `git filter-repo` to purge them from history if the repo is public.',
    appliesTo: (ctx) => envFiles(ctx).length > 0,
    run(ctx) {
      const exposed = envFiles(ctx).filter((f) => !gitignoreCovers(ctx, f));
      if (exposed.length === 0) return null;

      return {
        detail: `${exposed.length} environment file${exposed.length === 1 ? '' : 's'} (${exposed.join(', ')}) ${exposed.length === 1 ? 'is' : 'are'} present and not covered by .gitignore, so ${exposed.length === 1 ? 'it is' : 'they are'} almost certainly committed. Assume every value inside is compromised.`,
        evidence: exposed.map((file) => ({ file })),
      };
    },
  },

  {
    id: 'secrets/hardcoded-credential',
    title: 'Credentials hardcoded in source',
    category: 'secrets',
    severity: 'critical',
    effortHours: 4,
    remediation:
      'Move each value to an environment variable read at runtime, rotate the exposed credential at the provider, and purge it from git history. Add a pre-commit secret scanner so this cannot recur.',
    run(ctx) {
      const evidence: Evidence[] = [];
      const kinds = new Set<string>();

      for (const [pattern, label] of CREDENTIAL_PATTERNS) {
        const hits = ctx.search(pattern, {
          // Template env files and lockfiles produce noise, not findings.
          exclude: /(\.example$|\.sample$|\.template$|lock\.json$|\.lock$|CHANGELOG)/,
          limit: 3,
        });
        if (hits.length > 0) {
          kinds.add(label);
          evidence.push(...hits);
        }
      }

      if (evidence.length === 0) return null;

      return {
        detail: `Found ${evidence.length} hardcoded credential${evidence.length === 1 ? '' : 's'} in source: ${[...kinds].join(', ')}. These ship with the code — anyone with repository access, or with the browser bundle if the file is client-side, has them.`,
        evidence: evidence.slice(0, 8),
      };
    },
  },

  {
    id: 'secrets/public-env-secret',
    title: 'Secret exposed through a public environment variable',
    category: 'secrets',
    severity: 'critical',
    effortHours: 3,
    remediation:
      'Rename the variable to drop the public prefix and move every use of it to server-side code — an API route, server action, or backend service. Then rotate it: the current value is in the browser bundle and must be treated as public.',
    appliesTo: (ctx) => ctx.stack.hasClientBundle,
    run(ctx) {
      const hard = ctx.search(PUBLIC_PREFIX, { limit: 5 });
      const soft = ctx.search(PUBLIC_PREFIX_SOFT, { limit: 5 });

      const evidence = [...hard, ...soft];
      if (evidence.length === 0) return null;

      return {
        detail:
          'Environment variables with a public prefix are inlined into the browser bundle at build time and are readable by any visitor. The names here suggest secret material.',
        evidence: evidence.slice(0, 6),
      };
    },
  },

  {
    id: 'secrets/service-role-client-side',
    title: 'Privileged database key used outside server code',
    category: 'secrets',
    severity: 'critical',
    effortHours: 6,
    remediation:
      'Service-role keys bypass row-level security entirely. Use the anon/publishable key in client code and move every privileged operation behind a server route that checks the caller\'s identity first.',
    appliesTo: (ctx) => ctx.stack.database === 'supabase',
    run(ctx) {
      const hits = ctx.search(/SERVICE_ROLE|service_role/, {
        // Anything under a client directory, or explicitly marked as a client component.
        include: /(components|app|pages|src)\//,
        exclude: /(api|server|actions|middleware|\.server\.|route\.[tj]s)/,
        limit: 5,
      });
      if (hits.length === 0) return null;

      return {
        detail:
          'A Supabase service-role key is referenced outside server-only code. That key bypasses row-level security, so exposing it grants full read and write access to every table regardless of policy.',
        evidence: hits,
      };
    },
  },

  {
    id: 'secrets/no-env-example',
    title: 'No .env.example documenting required configuration',
    category: 'secrets',
    severity: 'low',
    effortHours: 1,
    remediation:
      'Commit a `.env.example` listing every variable the app reads, with placeholder values and a one-line comment each. It is the fastest onboarding win available and it prevents production outages caused by a missing variable.',
    appliesTo: (ctx) => ctx.search(/process\.env\.|import\.meta\.env\./, { limit: 1 }).length > 0,
    run(ctx) {
      const hasTemplate = ctx.files.some((f) => ENV_FILE.test(f) && ENV_TEMPLATE.test(f));
      if (hasTemplate) return null;

      return {
        detail:
          'The app reads environment variables but ships no template describing them. A new developer — or a deployment — has no way to know what configuration is required until something fails at runtime.',
      };
    },
  },
];
