import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Evidence,
  PackageJson,
  ScanContext,
  SearchOptions,
} from '../types.js';
import { detectStack } from './stack.js';
import { NON_PRODUCTION_PATH, walk } from './walk.js';

/** Anything long and high-entropy enough to plausibly be a credential. */
const SECRET_SHAPED = /\b([A-Za-z0-9_\-]{4})[A-Za-z0-9_\-+/=]{16,}\b/g;

/**
 * Redact anything credential-shaped before it reaches a report.
 *
 * Reports get shared — pasted into Slack, emailed to a client, committed to a repo.
 * A security audit that leaks the secrets it found would be worse than useless, so
 * redaction happens at the point evidence is captured rather than at render time,
 * where a new output format could forget to apply it.
 */
export function redact(line: string): string {
  return line.replace(SECRET_SHAPED, (_match, prefix: string) => `${prefix}${'•'.repeat(8)}`);
}

/** Line comments across the languages we scan. Block-comment bodies start with `*`. */
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|#|--)/;

/** Regexes are reused across files; strip `g` so `test` doesn't carry `lastIndex`. */
function stateless(pattern: RegExp): RegExp {
  return pattern.global ? new RegExp(pattern.source, pattern.flags.replace('g', '')) : pattern;
}

function parsePackageJson(raw: string): PackageJson | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as PackageJson) : null;
  } catch {
    // A malformed package.json is itself a finding, raised by the operations ruleset.
    return null;
  }
}

export interface CreateContextOptions {
  maxFiles?: number;
}

export function createContext(root: string, options: CreateContextOptions = {}): ScanContext {
  const { files, sourceFiles } = walk(root, options.maxFiles);
  const fileSet = new Set(files);
  const cache = new Map<string, string>();

  function read(relPath: string): string {
    const cached = cache.get(relPath);
    if (cached !== undefined) return cached;

    let content = '';
    try {
      content = readFileSync(join(root, relPath), 'utf8');
    } catch {
      content = '';
    }
    cache.set(relPath, content);
    return content;
  }

  const pkg = parsePackageJson(fileSet.has('package.json') ? read('package.json') : '');
  const stack = detectStack(files, pkg);

  const allDeps: Record<string, string> = {
    ...pkg?.dependencies,
    ...pkg?.devDependencies,
    ...pkg?.peerDependencies,
  };

  return {
    root,
    files,
    sourceFiles,
    stack,
    pkg,

    read,

    has(relPath) {
      return fileSet.has(relPath);
    },

    match(pattern) {
      const re = stateless(pattern);
      return files.filter((f) => re.test(f));
    },

    search(pattern, options: SearchOptions = {}) {
      const { include, exclude, limit = 5, includeTests = false, skipComments = false } = options;
      const re = stateless(pattern);
      const includeRe = include ? stateless(include) : null;
      const excludeRe = exclude ? stateless(exclude) : null;

      const hits: Evidence[] = [];

      for (const file of sourceFiles) {
        if (!includeTests && NON_PRODUCTION_PATH.test(file)) continue;
        if (includeRe && !includeRe.test(file)) continue;
        if (excludeRe && excludeRe.test(file)) continue;

        const content = read(file);
        if (!content) continue;
        // Cheap whole-file reject before paying for the line split.
        if (!re.test(content)) continue;

        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!re.test(lines[i]!)) continue;
          if (skipComments && COMMENT_LINE.test(lines[i]!)) continue;

          hits.push({
            file,
            line: i + 1,
            excerpt: redact(lines[i]!.trim()).slice(0, 200),
          });

          if (hits.length >= limit) return hits;
        }
      }

      return hits;
    },

    dependency(name) {
      return allDeps[name];
    },

    anyDependency(names) {
      return names.some((name) => allDeps[name] !== undefined);
    },
  };
}
