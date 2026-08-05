import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const created: string[] = [];

/**
 * Materialise a throwaway project from a path → contents map.
 *
 * Rules are tested against real directories rather than a mocked filesystem, because
 * roughly half of what they check *is* filesystem shape — which files exist, what the
 * lockfile is, whether .gitignore covers .env. Mocking that away would test the mock.
 */
export function createProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'rescuekit-test-'));
  created.push(root);

  for (const [relPath, contents] of Object.entries(files)) {
    const full = join(root, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }

  return root;
}

export function cleanupProjects(): void {
  for (const root of created.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Credential-shaped strings, assembled at runtime.
 *
 * Deliberately not written as literals: a committed string matching a real provider's
 * token format trips GitHub push protection and every secret scanner a contributor runs.
 * Assembling them here keeps the repo clean while still exercising the patterns.
 */
export const fakeSecrets = {
  stripe: `sk_${'test'}_${'a1b2c3d4e5f6g7h8i9j0k1l2'}`,
  aws: `AKIA${'ABCDEFGHIJKLMNOP'}`,
  github: `ghp_${'a'.repeat(36)}`,
  jwt: `eyJ${'hbGciOiJIUzI1NiJ9'}.eyJ${'zdWIiOiIxMjM0NTY3ODkwIn0'}.${'signature'}`,
  postgresUrl: 'postgresql://admin:hunter2supersecret@db.example.com:5432/app',
};

/** A minimal package.json, with overrides merged in. */
export function packageJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify(
    {
      name: 'test-app',
      version: '1.0.0',
      ...overrides,
    },
    null,
    2,
  );
}

/** A Next.js + Supabase + Stripe app, the archetypal AI-builder output. */
export function nextAppFiles(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'package.json': packageJson({
      dependencies: {
        next: '^15.0.0',
        react: '^19.0.0',
        '@supabase/supabase-js': '^2.45.0',
        stripe: '^17.0.0',
      },
      devDependencies: { typescript: '^5.6.0' },
    }),
    'package-lock.json': '{}',
    'tsconfig.json': '{}',
    ...overrides,
  };
}
