import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Directories never worth reading. Anything vendored, generated, or enormous. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.parcel-cache',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.terraform',
  '.vercel',
  '.netlify',
  'Pods',
  '.gradle',
  'DerivedData',
]);

/** Extensions we are willing to grep. Everything else is metadata or binary. */
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
  '.vue', '.svelte', '.astro',
  '.py', '.go', '.rb', '.php', '.java', '.kt', '.swift', '.rs',
  '.sql', '.prisma', '.graphql', '.gql',
  '.json', '.yml', '.yaml', '.toml', '.env', '.sh', '.tf', '.hcl',
  '.html', '.css', '.scss', '.md',
]);

/** Skip files this large — they are generated, and grepping them is wasted time. */
const MAX_FILE_BYTES = 512 * 1024;

/**
 * Files that are not production code.
 *
 * Vulnerability rules must skip these. A test asserting that `req.body.isAdmin` is
 * rejected necessarily contains the string `req.body.isAdmin`, and flagging it is the
 * fastest way to teach someone that the scanner cries wolf. Every project with a decent
 * test suite has deliberately-vulnerable code sitting in fixtures.
 */
export const NON_PRODUCTION_PATH =
  /(^|\/)(__tests__|__mocks__|__fixtures__|tests?|spec|e2e|cypress|playwright|fixtures?|examples?|mocks?|stories|benchmarks?)\/|\.(test|spec|stories|bench)\.[cm]?[jt]sx?$/;

export interface WalkResult {
  files: string[];
  sourceFiles: string[];
  truncated: boolean;
}

export function isSourceFile(relPath: string): boolean {
  const base = relPath.slice(relPath.lastIndexOf('/') + 1);
  // Dotfiles like `.env.local` have no conventional extension; match on prefix.
  if (base.startsWith('.env')) return true;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return false;
  return SOURCE_EXTENSIONS.has(base.slice(dot).toLowerCase());
}

/**
 * Walk a project directory, returning paths relative to `root` with forward slashes.
 *
 * Deliberately synchronous: audits are one-shot CLI runs where the added complexity of
 * async traversal buys nothing, and sync code keeps the rule API synchronous too.
 */
export function walk(root: string, maxFiles = 20_000): WalkResult {
  const files: string[] = [];
  const sourceFiles: string[] = [];
  let truncated = false;

  const queue: string[] = [root];

  while (queue.length > 0) {
    const dir = queue.pop()!;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // Unreadable directory (permissions, broken symlink) — not our problem.
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        return { files, sourceFiles, truncated };
      }

      const full = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        queue.push(full);
        continue;
      }

      if (!entry.isFile()) continue; // Symlinks, sockets, devices.

      try {
        if (statSync(full).size > MAX_FILE_BYTES) continue;
      } catch {
        continue;
      }

      const rel = relative(root, full).split(sep).join('/');
      files.push(rel);
      if (isSourceFile(rel)) sourceFiles.push(rel);
    }
  }

  return { files, sourceFiles, truncated };
}
