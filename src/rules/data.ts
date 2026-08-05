import type { Evidence, Rule, ScanContext } from '../types.js';

const ROUTE_FILE = /(^|\/)(app\/.*\/route\.[tj]sx?|pages\/api\/.*\.[tj]sx?)$/;

const VALIDATION_LIBRARIES = [
  'zod', 'yup', 'joi', 'valibot', 'superstruct', 'ajv',
  'class-validator', '@sinclair/typebox', 'arktype',
];

function migrationFiles(ctx: ScanContext): string[] {
  return ctx.files.filter((f) =>
    /(^|\/)(migrations|migrate)\//.test(f) && /\.(sql|ts|js)$/.test(f),
  );
}

/** Extract `model X { ... }` blocks from a Prisma schema. */
function prismaModels(schema: string): Array<{ name: string; body: string }> {
  const models: Array<{ name: string; body: string }> = [];
  const re = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(schema)) !== null) {
    models.push({ name: match[1]!, body: match[2]! });
  }
  return models;
}

export const dataRules: Rule[] = [
  {
    id: 'data/no-migrations',
    title: 'No database migrations',
    category: 'data',
    severity: 'high',
    effortHours: 8,
    remediation:
      'Generate an initial migration from the current schema and commit it, then make migrations the only way schema changes reach an environment. Without them there is no repeatable way to stand up a new environment and no way to roll a bad change back.',
    appliesTo: (ctx) => ctx.stack.orm !== null,
    run(ctx) {
      if (migrationFiles(ctx).length > 0) return null;
      // `prisma db push` is the schema-sync escape hatch that skips migrations entirely.
      const pushOnly = ctx.search(/db\s+push|drizzle-kit\s+push/, { limit: 2 });

      return {
        detail: `${ctx.stack.orm} is configured but no migration files exist${pushOnly.length > 0 ? ', and the schema is being synced with a push command that leaves no history' : ''}. Schema changes cannot be reviewed, replayed, or rolled back.`,
        evidence: pushOnly,
      };
    },
  },

  {
    id: 'data/rls-not-configured',
    title: 'Row-level security not configured',
    category: 'data',
    severity: 'critical',
    effortHours: 16,
    remediation:
      'Enable RLS on every table holding user data and write policies covering select, insert, update and delete. Supabase exposes the database directly to the browser through PostgREST — without policies, the anon key is a full database client.',
    appliesTo: (ctx) => ctx.stack.database === 'supabase',
    run(ctx) {
      const hasPolicies = ctx.search(/ENABLE\s+ROW\s+LEVEL\s+SECURITY|CREATE\s+POLICY/i, { limit: 1 });
      if (hasPolicies.length > 0) return null;

      return {
        detail:
          'No `ENABLE ROW LEVEL SECURITY` or `CREATE POLICY` statement was found anywhere in the project. If RLS has not been enabled in the dashboard either, every table is readable and writable by anyone holding the anon key — which ships in the browser bundle by design.',
      };
    },
  },

  {
    id: 'data/sql-string-interpolation',
    title: 'SQL built by string interpolation',
    category: 'data',
    severity: 'critical',
    effortHours: 8,
    remediation:
      'Use parameterised queries or the ORM\'s query builder. Prisma\'s `$queryRaw` tagged template and Drizzle\'s `sql` helper parameterise automatically — the danger is `$queryRawUnsafe` and manual string concatenation.',
    run(ctx) {
      const hits = [
        // Require an actual call. Prose naming the method — including this rule's own
        // remediation text, which quotes it in backticks — is not a use of it.
        ...ctx.search(/\$(?:query|execute)RawUnsafe\s*\(/, { limit: 4, skipComments: true }),
        ...ctx.search(/(?:query|execute)\s*\(\s*[`'"](?:[^`'"]*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^`'"]*)\$\{/i, { limit: 4, skipComments: true }),
        ...ctx.search(/\b(?:SELECT|INSERT INTO|UPDATE|DELETE FROM)\b[^`;]*\$\{/i, { limit: 4, skipComments: true }),
      ];
      if (hits.length === 0) return null;

      // Deduplicate: the patterns overlap on the same lines.
      const seen = new Set<string>();
      const evidence: Evidence[] = [];
      for (const hit of hits) {
        const key = `${hit.file}:${hit.line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        evidence.push(hit);
      }

      return {
        detail:
          'User input appears to be interpolated directly into SQL. This is SQL injection: a crafted input can read every table, modify records, or drop them.',
        evidence: evidence.slice(0, 6),
      };
    },
  },

  {
    id: 'data/no-input-validation',
    title: 'Request bodies used without validation',
    category: 'data',
    severity: 'high',
    effortHours: 12,
    remediation:
      'Parse every request body through a schema at the boundary and reject what does not match. Beyond preventing malformed data reaching the database, it gives you correct types for free instead of assertions that lie.',
    appliesTo: (ctx) => ctx.files.some((f) => ROUTE_FILE.test(f)),
    run(ctx) {
      if (ctx.anyDependency(VALIDATION_LIBRARIES)) return null;

      const bodyReads = ctx.search(/await\s+(?:req|request)\.json\(\)|(?:req|request)\.body\b/, {
        include: ROUTE_FILE,
        limit: 6,
      });
      if (bodyReads.length === 0) return null;

      return {
        detail:
          'Route handlers read request bodies but no validation library is installed. Whatever the caller sends is passed straight through to application logic and the database.',
        evidence: bodyReads.slice(0, 5),
      };
    },
  },

  {
    id: 'data/unindexed-foreign-keys',
    title: 'Foreign keys without indexes',
    category: 'data',
    severity: 'medium',
    effortHours: 3,
    remediation:
      'Add `@@index([foreignKeyField])` for each relation scalar. Postgres does not index foreign keys automatically, so these become sequential scans — invisible on seed data, then suddenly the reason the app is slow at ten thousand rows.',
    appliesTo: (ctx) => ctx.stack.orm === 'prisma',
    run(ctx) {
      const schemaFile = ctx.files.find((f) => f.endsWith('schema.prisma'));
      if (!schemaFile) return null;

      const schema = ctx.read(schemaFile);
      const missing: Evidence[] = [];

      for (const model of prismaModels(schema)) {
        const relationFields = [...model.body.matchAll(/@relation\([^)]*fields:\s*\[([^\]]+)\]/g)]
          .flatMap((m) => m[1]!.split(',').map((s) => s.trim()));

        for (const field of relationFields) {
          if (!field) continue;
          const indexed =
            new RegExp(`@@index\\(\\[[^\\]]*\\b${field}\\b`).test(model.body) ||
            new RegExp(`@@unique\\(\\[[^\\]]*\\b${field}\\b`).test(model.body) ||
            new RegExp(`^\\s*${field}\\s+\\S+.*@unique`, 'm').test(model.body);

          if (!indexed) {
            missing.push({ file: schemaFile, excerpt: `${model.name}.${field}` });
          }
        }
      }

      if (missing.length === 0) return null;

      return {
        detail: `${missing.length} foreign key field${missing.length === 1 ? '' : 's'} in the Prisma schema have no supporting index. Queries filtering or joining on them will do full table scans.`,
        evidence: missing.slice(0, 8),
      };
    },
  },
];
