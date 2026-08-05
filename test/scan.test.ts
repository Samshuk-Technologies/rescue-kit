import { afterAll, describe, expect, it } from 'vitest';
import { createContext, redact } from '../src/scan/context.js';
import { isSourceFile, walk } from '../src/scan/walk.js';
import { cleanupProjects, createProject, fakeSecrets, packageJson } from './helpers/project.js';

afterAll(cleanupProjects);

describe('walk', () => {
  it('skips vendored and generated directories', () => {
    const root = createProject({
      'src/app.ts': 'export const a = 1;',
      'node_modules/left-pad/index.js': 'module.exports = 1;',
      'dist/app.js': 'var a = 1;',
      '.next/build.js': 'var b = 2;',
      'coverage/lcov.info': 'TN:',
    });

    const { files } = walk(root);

    expect(files).toContain('src/app.ts');
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
    expect(files.some((f) => f.startsWith('dist/'))).toBe(false);
    expect(files.some((f) => f.startsWith('.next/'))).toBe(false);
  });

  it('uses forward slashes regardless of platform', () => {
    const root = createProject({ 'app/api/users/route.ts': 'export function GET() {}' });
    const { files } = walk(root);
    expect(files).toContain('app/api/users/route.ts');
  });

  it('separates source files from other files', () => {
    const root = createProject({
      'src/app.ts': 'x',
      'logo.png': 'binary',
      '.env.local': 'KEY=value',
    });

    const { sourceFiles } = walk(root);

    expect(sourceFiles).toContain('src/app.ts');
    expect(sourceFiles).toContain('.env.local');
    expect(sourceFiles).not.toContain('logo.png');
  });

  it('respects the file cap', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 50; i++) files[`src/file${i}.ts`] = 'x';

    const { files: found, truncated } = walk(createProject(files), 10);

    expect(found.length).toBe(10);
    expect(truncated).toBe(true);
  });
});

describe('isSourceFile', () => {
  it('recognises env files, which have no conventional extension', () => {
    expect(isSourceFile('.env')).toBe(true);
    expect(isSourceFile('.env.production')).toBe(true);
    expect(isSourceFile('config/.env.local')).toBe(true);
  });

  it('rejects binaries', () => {
    expect(isSourceFile('logo.png')).toBe(false);
    expect(isSourceFile('font.woff2')).toBe(false);
    expect(isSourceFile('LICENSE')).toBe(false);
  });
});

describe('redact', () => {
  it('masks credential-shaped strings but keeps a recognisable prefix', () => {
    const redacted = redact(`const key = "${fakeSecrets.stripe}"`);

    expect(redacted).not.toContain(fakeSecrets.stripe);
    expect(redacted).toContain('•');
  });

  it('leaves ordinary code untouched', () => {
    const line = 'const total = price * quantity;';
    expect(redact(line)).toBe(line);
  });
});

describe('createContext', () => {
  it('parses package.json and exposes dependencies', () => {
    const root = createProject({
      'package.json': packageJson({ dependencies: { next: '^15.0.0' } }),
    });
    const ctx = createContext(root);

    expect(ctx.pkg?.name).toBe('test-app');
    expect(ctx.dependency('next')).toBe('^15.0.0');
    expect(ctx.anyDependency(['nuxt', 'next'])).toBe(true);
    expect(ctx.anyDependency(['nuxt'])).toBe(false);
  });

  it('survives a malformed package.json instead of throwing', () => {
    const root = createProject({ 'package.json': '{ this is not json' });
    const ctx = createContext(root);

    expect(ctx.pkg).toBeNull();
  });

  it('redacts secrets in search evidence', () => {
    const root = createProject({
      'src/config.ts': `export const key = "${fakeSecrets.stripe}";`,
    });
    const ctx = createContext(root);

    const hits = ctx.search(/sk_(?:live|test)_[A-Za-z0-9]{16,}/);

    expect(hits).toHaveLength(1);
    expect(hits[0]?.line).toBe(1);
    expect(hits[0]?.excerpt).not.toContain(fakeSecrets.stripe);
  });

  it('reuses global regexes across files without dropping matches', () => {
    const root = createProject({
      'a.ts': 'const secret = 1;',
      'b.ts': 'const secret = 2;',
      'c.ts': 'const secret = 3;',
    });
    const ctx = createContext(root);

    // A global regex carries lastIndex between calls; the context must neutralise it.
    expect(ctx.search(/secret/g, { limit: 10 })).toHaveLength(3);
  });

  it('honours include, exclude and limit', () => {
    const root = createProject({
      'app/api/a/route.ts': 'req.body',
      'app/api/b/route.ts': 'req.body',
      'src/client.ts': 'req.body',
    });
    const ctx = createContext(root);

    expect(ctx.search(/req\.body/, { include: /route\.ts$/ })).toHaveLength(2);
    expect(ctx.search(/req\.body/, { exclude: /route\.ts$/ })).toHaveLength(1);
    expect(ctx.search(/req\.body/, { limit: 1 })).toHaveLength(1);
  });

  it('skips test files and fixtures by default', () => {
    const root = createProject({
      'src/api.ts': 'if (req.body.isAdmin) grant();',
      'src/api.test.ts': 'expect(reject({ isAdmin: true })).toBe(false);',
      'test/fixtures/bad-app.ts': 'if (req.body.isAdmin) grant();',
      'examples/insecure/demo.ts': 'if (req.body.isAdmin) grant();',
    });
    const ctx = createContext(root);

    const production = ctx.search(/isAdmin/, { limit: 10 });
    expect(production).toHaveLength(1);
    expect(production[0]?.file).toBe('src/api.ts');
  });

  it('searches test files when explicitly asked to', () => {
    const root = createProject({
      'src/api.ts': 'if (req.body.isAdmin) grant();',
      'src/api.test.ts': 'expect(reject({ isAdmin: true })).toBe(false);',
    });
    const ctx = createContext(root);

    expect(ctx.search(/isAdmin/, { limit: 10, includeTests: true })).toHaveLength(2);
  });

  it('skips comment lines when asked, but reads them by default', () => {
    const root = createProject({
      'src/notes.ts': [
        '// dangerous: db.query(`SELECT * FROM t WHERE id = ${x}`)',
        ' * also describes db.query(`SELECT * FROM t WHERE id = ${x}`)',
        'db.query(`SELECT * FROM t WHERE id = ${x}`);',
      ].join('\n'),
    });
    const ctx = createContext(root);

    expect(ctx.search(/SELECT/, { limit: 10 })).toHaveLength(3);

    const codeOnly = ctx.search(/SELECT/, { limit: 10, skipComments: true });
    expect(codeOnly).toHaveLength(1);
    expect(codeOnly[0]?.line).toBe(3);
  });

  it('still finds credentials that were merely commented out', () => {
    const root = createProject({
      'src/old.ts': `// const key = "${fakeSecrets.stripe}";`,
    });
    const ctx = createContext(root);

    // A commented-out credential is still committed, so the secrets rules must see it.
    expect(ctx.search(/sk_(?:live|test)_[A-Za-z0-9]{16,}/)).toHaveLength(1);
  });

  it('returns an empty string for files that do not exist', () => {
    const ctx = createContext(createProject({ 'a.ts': 'x' }));
    expect(ctx.read('nope.ts')).toBe('');
  });
});

describe('stack detection', () => {
  it('identifies a Next.js + Supabase + Stripe project', () => {
    const root = createProject({
      'package.json': packageJson({
        dependencies: {
          next: '^15.0.0',
          '@supabase/supabase-js': '^2.45.0',
          stripe: '^17.0.0',
        },
        devDependencies: { typescript: '^5.6.0', vitest: '^2.0.0' },
      }),
      'pnpm-lock.yaml': 'lockfileVersion: 9',
    });
    const { stack } = createContext(root);

    expect(stack.framework).toBe('next');
    expect(stack.database).toBe('supabase');
    expect(stack.paymentProvider).toBe('stripe');
    expect(stack.testRunner).toBe('vitest');
    expect(stack.packageManager).toBe('pnpm');
    expect(stack.typescript).toBe(true);
    expect(stack.hasClientBundle).toBe(true);
  });

  it('prefers the meta-framework over the bundler it wraps', () => {
    const root = createProject({
      'package.json': packageJson({ dependencies: { next: '^15.0.0', vite: '^5.0.0' } }),
    });
    expect(createContext(root).stack.framework).toBe('next');
  });

  it('does not claim a client bundle for a plain API server', () => {
    const root = createProject({
      'package.json': packageJson({ dependencies: { express: '^4.19.0' } }),
    });
    const { stack } = createContext(root);

    expect(stack.framework).toBe('express');
    expect(stack.hasClientBundle).toBe(false);
  });

  it('flags likely AI-generated projects from multiple signals', () => {
    const root = createProject({
      'package.json': packageJson({
        dependencies: { vite: '^5.0.0', react: '^18.0.0' },
        devDependencies: { 'lovable-tagger': '^1.0.0' },
      }),
      'src/components/ui/button.tsx': 'export const Button = () => null;',
    });
    const { aiGenerated } = createContext(root).stack;

    expect(aiGenerated.likely).toBe(true);
    expect(aiGenerated.signals.length).toBeGreaterThanOrEqual(2);
  });

  it('does not flag a conventional project as AI-generated', () => {
    const root = createProject({
      'package.json': packageJson({
        description: 'A hand-written service',
        scripts: { test: 'vitest run' },
        dependencies: { express: '^4.19.0' },
      }),
      'src/server.ts': 'export const x = 1;',
      'src/server.test.ts': 'test("x", () => {});',
    });
    expect(createContext(root).stack.aiGenerated.likely).toBe(false);
  });
});
