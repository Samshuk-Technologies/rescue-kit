import { afterAll, describe, expect, it } from 'vitest';
import { audit } from '../src/engine/run.js';
import { allRules } from '../src/rules/index.js';
import type { Finding } from '../src/types.js';
import {
  cleanupProjects,
  createProject,
  fakeSecrets,
  nextAppFiles,
  packageJson,
} from './helpers/project.js';

afterAll(cleanupProjects);

/** Run one rule in isolation so a finding cannot be attributed to the wrong check. */
function check(ruleId: string, files: Record<string, string>): Finding[] {
  const rule = allRules.find((r) => r.id === ruleId);
  if (!rule) throw new Error(`no such rule: ${ruleId}`);
  return audit(createProject(files), { rules: [rule] }).findings;
}

describe('ruleset integrity', () => {
  it('has unique rule ids', () => {
    const ids = allRules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every rule remediation guidance and an effort estimate', () => {
    for (const rule of allRules) {
      expect(rule.remediation.length, `${rule.id} remediation`).toBeGreaterThan(40);
      expect(rule.effortHours, `${rule.id} effort`).toBeGreaterThan(0);
    }
  });

  it('namespaces every rule id by category', () => {
    for (const rule of allRules) {
      expect(rule.id, rule.id).toMatch(/^[a-z]+\/[a-z-]+$/);
    }
  });
});

describe('secrets', () => {
  it('flags an env file not covered by .gitignore', () => {
    const findings = check('secrets/committed-env', {
      '.env': 'DATABASE_URL=postgres://localhost/app',
      '.gitignore': 'node_modules\ndist\n',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('critical');
  });

  it('accepts an env file that .gitignore covers', () => {
    expect(
      check('secrets/committed-env', {
        '.env': 'DATABASE_URL=postgres://localhost/app',
        '.gitignore': 'node_modules\n.env*\n',
      }),
    ).toHaveLength(0);
  });

  it('ignores .env.example, which is meant to be committed', () => {
    expect(
      check('secrets/committed-env', {
        '.env.example': 'DATABASE_URL=',
        '.gitignore': 'node_modules\n',
      }),
    ).toHaveLength(0);
  });

  it('finds hardcoded credentials of several shapes', () => {
    const findings = check('secrets/hardcoded-credential', {
      'src/stripe.ts': `export const key = "${fakeSecrets.stripe}";`,
      'src/aws.ts': `const id = "${fakeSecrets.aws}";`,
      'src/db.ts': `const url = "${fakeSecrets.postgresUrl}";`,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence?.length).toBeGreaterThanOrEqual(3);
  });

  it('never echoes the credential it found', () => {
    const findings = check('secrets/hardcoded-credential', {
      'src/config.ts': `const key = "${fakeSecrets.github}";`,
    });

    const serialised = JSON.stringify(findings);
    expect(serialised).not.toContain(fakeSecrets.github);
  });

  it('does not flag placeholder values in .env.example', () => {
    expect(
      check('secrets/hardcoded-credential', {
        '.env.example': `STRIPE_KEY=${fakeSecrets.stripe}`,
      }),
    ).toHaveLength(0);
  });

  it('flags secrets exposed through a public env prefix', () => {
    const findings = check('secrets/public-env-secret', {
      ...nextAppFiles(),
      'src/client.ts': 'const k = process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY;',
    });
    expect(findings).toHaveLength(1);
  });

  it('accepts legitimately public env vars', () => {
    expect(
      check('secrets/public-env-secret', {
        ...nextAppFiles(),
        'src/client.ts': 'const url = process.env.NEXT_PUBLIC_SITE_URL;',
      }),
    ).toHaveLength(0);
  });

  it('asks for a .env.example only when env vars are actually read', () => {
    expect(
      check('secrets/no-env-example', {
        'src/app.ts': 'const port = process.env.PORT;',
      }),
    ).toHaveLength(1);

    expect(
      check('secrets/no-env-example', { 'src/app.ts': 'const port = 3000;' }),
    ).toHaveLength(0);
  });
});

describe('auth', () => {
  it('flags route handlers with no identity check', () => {
    const findings = check('auth/unprotected-route-handlers', {
      ...nextAppFiles(),
      'app/api/users/route.ts': 'export async function DELETE() { await db.user.deleteMany(); }',
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.detail).toContain('writes');
  });

  it('accepts a handler that establishes the caller', () => {
    expect(
      check('auth/unprotected-route-handlers', {
        ...nextAppFiles(),
        'app/api/users/route.ts':
          'export async function GET() { const session = await getServerSession(); if (!session) return new Response(null, { status: 401 }); }',
      }),
    ).toHaveLength(0);
  });

  it('does not flag endpoints that are public by design', () => {
    expect(
      check('auth/unprotected-route-handlers', {
        ...nextAppFiles(),
        'app/api/health/route.ts': 'export function GET() { return Response.json({ ok: true }); }',
        'app/api/webhooks/stripe/route.ts': 'export async function POST() {}',
      }),
    ).toHaveLength(0);
  });

  it('flags privilege decided by client-supplied data', () => {
    const findings = check('auth/trusts-client-supplied-role', {
      'src/api.ts': 'if (req.body.isAdmin) { grantEverything(); }',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('critical');
  });

  it('flags a JWT decoded without verification on the server', () => {
    expect(
      check('auth/jwt-decoded-without-verification', {
        'app/api/me/route.ts': 'const claims = jwt.decode(token);',
      }),
    ).toHaveLength(1);
  });

  it('tolerates client-side decoding for display purposes', () => {
    expect(
      check('auth/jwt-decoded-without-verification', {
        'src/components/Avatar.tsx': 'const claims = jwtDecode(token);',
      }),
    ).toHaveLength(0);
  });

  it('does not require middleware when no auth provider is configured', () => {
    expect(
      check('auth/no-central-route-protection', nextAppFiles()),
    ).toHaveLength(0);
  });

  it('requires middleware once an auth provider exists', () => {
    expect(
      check('auth/no-central-route-protection', {
        'package.json': packageJson({
          dependencies: { next: '^15.0.0', 'next-auth': '^5.0.0' },
        }),
      }),
    ).toHaveLength(1);
  });
});

describe('payments', () => {
  it('flags a webhook with no signature verification', () => {
    const findings = check('payments/unverified-webhook', {
      ...nextAppFiles(),
      'app/api/webhooks/stripe/route.ts':
        'export async function POST(req) { const event = await req.json(); await fulfil(event); }',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('critical');
  });

  it('accepts a webhook that verifies the signature', () => {
    expect(
      check('payments/unverified-webhook', {
        ...nextAppFiles(),
        'app/api/webhooks/stripe/route.ts':
          'const event = stripe.webhooks.constructEvent(body, sig, secret);',
      }),
    ).toHaveLength(0);
  });

  it('flags a charge amount taken from the request', () => {
    expect(
      check('payments/client-supplied-amount', {
        ...nextAppFiles(),
        'app/api/checkout/route.ts':
          'const session = await stripe.checkout.sessions.create({ amount: body.amount });',
      }),
    ).toHaveLength(1);
  });

  it('skips payment rules entirely when there is no payment provider', () => {
    const root = createProject({
      'package.json': packageJson({ dependencies: { next: '^15.0.0' } }),
    });
    const result = audit(root);
    const payments = result.categories.find((c) => c.category === 'payments');

    expect(payments?.applicable).toBe(false);
    expect(payments?.findings).toHaveLength(0);
  });
});

describe('data', () => {
  it('flags SQL built by interpolation', () => {
    const findings = check('data/sql-string-interpolation', {
      'src/db.ts': 'const rows = await db.query(`SELECT * FROM users WHERE id = ${userId}`);',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('critical');
  });

  it('does not flag deliberately vulnerable code in a test fixture', () => {
    expect(
      check('data/sql-string-interpolation', {
        'test/fixtures/vulnerable.ts': 'db.query(`SELECT * FROM users WHERE id = ${id}`);',
        'src/db.test.ts': 'expect(() => query(`DELETE FROM t WHERE x = ${y}`)).toThrow();',
      }),
    ).toHaveLength(0);
  });

  it('accepts parameterised queries', () => {
    expect(
      check('data/sql-string-interpolation', {
        'src/db.ts': 'const rows = await db.query("SELECT * FROM users WHERE id = $1", [userId]);',
      }),
    ).toHaveLength(0);
  });

  it('flags missing row-level security on Supabase', () => {
    expect(check('data/rls-not-configured', nextAppFiles())).toHaveLength(1);
  });

  it('accepts a project that defines policies', () => {
    expect(
      check('data/rls-not-configured', {
        ...nextAppFiles(),
        'supabase/migrations/0001_rls.sql':
          'ALTER TABLE posts ENABLE ROW LEVEL SECURITY;\nCREATE POLICY own_posts ON posts FOR SELECT USING (auth.uid() = user_id);',
      }),
    ).toHaveLength(0);
  });

  it('flags unindexed foreign keys in a Prisma schema', () => {
    const findings = check('data/unindexed-foreign-keys', {
      'package.json': packageJson({ dependencies: { '@prisma/client': '^5.0.0' } }),
      'prisma/schema.prisma': `
model Post {
  id       String @id
  authorId String
  author   User   @relation(fields: [authorId], references: [id])
}`,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence?.[0]?.excerpt).toBe('Post.authorId');
  });

  it('accepts foreign keys that are indexed', () => {
    expect(
      check('data/unindexed-foreign-keys', {
        'package.json': packageJson({ dependencies: { '@prisma/client': '^5.0.0' } }),
        'prisma/schema.prisma': `
model Post {
  id       String @id
  authorId String
  author   User   @relation(fields: [authorId], references: [id])

  @@index([authorId])
}`,
      }),
    ).toHaveLength(0);
  });

  it('flags unvalidated request bodies', () => {
    expect(
      check('data/no-input-validation', {
        ...nextAppFiles(),
        'app/api/posts/route.ts': 'export async function POST(req) { const body = await req.json(); await db.post.create({ data: body }); }',
      }),
    ).toHaveLength(1);
  });

  it('accepts a project using a validation library', () => {
    expect(
      check('data/no-input-validation', {
        'package.json': packageJson({ dependencies: { next: '^15.0.0', zod: '^3.23.0' } }),
        'app/api/posts/route.ts': 'const body = schema.parse(await req.json());',
      }),
    ).toHaveLength(0);
  });
});

describe('testing', () => {
  it('flags a project with no tests', () => {
    const files: Record<string, string> = { ...nextAppFiles() };
    for (let i = 0; i < 8; i++) files[`src/module${i}.ts`] = 'export const x = 1;';

    expect(check('testing/no-tests', files)).toHaveLength(1);
  });

  it('stays quiet on a project too small for the finding to mean anything', () => {
    expect(check('testing/no-tests', { 'index.ts': 'console.log(1);' })).toHaveLength(0);
  });

  it('flags the scaffold placeholder test script', () => {
    expect(
      check('testing/no-test-script', {
        'package.json': packageJson({
          scripts: { test: 'echo "Error: no test specified" && exit 1' },
        }),
      }),
    ).toHaveLength(1);
  });

  it('accepts a real test script', () => {
    expect(
      check('testing/no-test-script', {
        'package.json': packageJson({ scripts: { test: 'vitest run' } }),
      }),
    ).toHaveLength(0);
  });

  it('flags a build configured to ignore type errors', () => {
    expect(
      check('testing/build-ignores-errors', {
        ...nextAppFiles(),
        'next.config.js': 'module.exports = { typescript: { ignoreBuildErrors: true } };',
      }),
    ).toHaveLength(1);
  });

  it('flags a missing CI configuration and accepts a present one', () => {
    expect(check('testing/no-ci', { 'src/a.ts': 'x' })).toHaveLength(1);
    expect(
      check('testing/no-ci', {
        'src/a.ts': 'x',
        '.github/workflows/ci.yml': 'name: CI',
      }),
    ).toHaveLength(0);
  });
});

describe('operations', () => {
  it('flags a missing lockfile', () => {
    expect(
      check('ops/no-lockfile', { 'package.json': packageJson() }),
    ).toHaveLength(1);
  });

  it('accepts any supported lockfile', () => {
    expect(
      check('ops/no-lockfile', {
        'package.json': packageJson(),
        'pnpm-lock.yaml': 'lockfileVersion: 9',
      }),
    ).toHaveLength(0);
  });

  it('notes when unrate-limited endpoints call a metered API', () => {
    const findings = check('ops/no-rate-limiting', {
      ...nextAppFiles(),
      'app/api/chat/route.ts': 'const res = await openai.chat.completions.create({});',
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.detail).toContain('cost');
  });

  it('accepts a project with rate limiting installed', () => {
    expect(
      check('ops/no-rate-limiting', {
        'package.json': packageJson({
          dependencies: { next: '^15.0.0', '@upstash/ratelimit': '^2.0.0' },
        }),
        'app/api/chat/route.ts': 'export async function POST() {}',
      }),
    ).toHaveLength(0);
  });

  it('does not ask a CLI or library for error tracking', () => {
    expect(
      check('ops/no-error-tracking', {
        'package.json': packageJson({ bin: { mytool: './dist/cli.js' } }),
        'src/cli.ts': 'console.log("hi");',
      }),
    ).toHaveLength(0);
  });

  it('does ask a deployed app for error tracking', () => {
    expect(check('ops/no-error-tracking', nextAppFiles())).toHaveLength(1);
  });

  it('flags a missing README', () => {
    expect(check('ops/no-readme', { 'src/a.ts': 'x' })).toHaveLength(1);
    expect(check('ops/no-readme', { 'README.md': '# App' })).toHaveLength(0);
  });
});

describe('full audit', () => {
  it('scores a deliberately broken app as unshippable', () => {
    const root = createProject({
      ...nextAppFiles(),
      '.env': `STRIPE_SECRET_KEY=${fakeSecrets.stripe}`,
      '.gitignore': 'node_modules\n',
      'app/api/admin/route.ts': 'export async function DELETE() { await db.dropEverything(); }',
      'app/api/webhooks/stripe/route.ts': 'export async function POST(req) { await fulfil(await req.json()); }',
      'src/db.ts': 'db.query(`SELECT * FROM users WHERE id = ${id}`);',
    });

    const result = audit(root);

    expect(result.counts.critical).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(50);
    expect(result.grade).toMatch(/[DF]/);
    expect(result.verdict).toContain('Not safe to ship');
    expect(result.effortHours).toBeGreaterThan(0);
  });

  it('scores a well-built app highly', () => {
    const root = createProject({
      'package.json': packageJson({
        description: 'A properly built service',
        engines: { node: '>=20' },
        scripts: { test: 'vitest run' },
        dependencies: { express: '^4.19.0', zod: '^3.23.0', helmet: '^8.0.0' },
        devDependencies: { vitest: '^2.0.0', typescript: '^5.6.0', '@sentry/node': '^8.0.0' },
      }),
      'package-lock.json': '{}',
      '.gitignore': '.env*\nnode_modules\n',
      '.env.example': 'DATABASE_URL=',
      'README.md': '# Service',
      '.github/workflows/ci.yml': 'name: CI\njobs:\n  test:\n    steps:\n      - run: npm test\n      - run: tsc --noEmit\n',
      'src/server.ts': 'export const app = express();',
      'src/server.test.ts': 'test("boots", () => {});',
    });

    const result = audit(root);

    expect(result.counts.critical).toBe(0);
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.grade).toMatch(/[AB]/);
  });

  it('excludes inapplicable categories from the score rather than crediting them', () => {
    const root = createProject({ 'package.json': packageJson(), 'README.md': '# x' });
    const result = audit(root);

    const payments = result.categories.find((c) => c.category === 'payments');
    expect(payments?.applicable).toBe(false);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('sorts findings by severity, worst first', () => {
    const root = createProject({
      ...nextAppFiles(),
      '.env': 'SECRET=x',
      '.gitignore': '',
      'src/a.ts': 'export const x = 1;',
    });
    const { findings } = audit(root);

    const ranks = { critical: 0, high: 1, medium: 2, low: 3 };
    for (let i = 1; i < findings.length; i++) {
      expect(ranks[findings[i]!.severity]).toBeGreaterThanOrEqual(ranks[findings[i - 1]!.severity]);
    }
  });

  it('does not throw on an empty directory', () => {
    const result = audit(createProject({}));
    expect(result.score).toBeGreaterThan(0);
    expect(result.findings.every((f) => f.category !== 'payments')).toBe(true);
  });
});
