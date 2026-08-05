import type { Evidence, Rule, ScanContext } from '../types.js';

/** Next.js App Router handlers and Pages Router API routes. */
const ROUTE_FILE = /(^|\/)(app\/.*\/route\.[tj]sx?|pages\/api\/.*\.[tj]sx?)$/;

/** Anything that plausibly establishes who the caller is. Deliberately generous. */
const AUTH_CHECK =
  /getServerSession|getSession|getUser\(|currentUser|requireAuth|withAuth|isAuthenticated|verifyToken|jwt\.verify|jwtVerify|getToken\(|auth\(\)|clerkClient|createRouteHandlerClient|createServerClient|supabase\.auth|session\??\.\w*user|req\.user|ctx\.user|authorize|checkPermission|can\(/;

/** Handlers that change state — an unauthenticated read is bad, an unauthenticated write is worse. */
const MUTATING = /export\s+(?:async\s+)?function\s+(POST|PUT|PATCH|DELETE)|req\.method\s*===?\s*['"](POST|PUT|PATCH|DELETE)['"]/;

const HASHING_LIBRARIES = [
  'bcrypt', 'bcryptjs', '@node-rs/bcrypt',
  'argon2', '@node-rs/argon2',
  'oslo', '@oslojs/crypto',
];

function routeHandlers(ctx: ScanContext): string[] {
  return ctx.files.filter((f) => ROUTE_FILE.test(f));
}

function handlesOwnCredentials(ctx: ScanContext): boolean {
  return (
    ctx.search(/password/i, { include: ROUTE_FILE, limit: 1 }).length > 0 ||
    ctx.search(/\b(?:signUp|signup|register|createUser)\b/, { limit: 1 }).length > 0
  );
}

export const authRules: Rule[] = [
  {
    id: 'auth/no-authentication',
    title: 'No authentication mechanism detected',
    category: 'auth',
    severity: 'high',
    effortHours: 16,
    remediation:
      'Adopt a maintained auth provider rather than hand-rolling sessions — Auth.js, Clerk, Supabase Auth and Better Auth all handle session rotation, CSRF and password reset correctly. Hand-written auth is where most prototype security bugs originate.',
    appliesTo: (ctx) => routeHandlers(ctx).length > 0 || ctx.stack.database !== null,
    run(ctx) {
      if (ctx.stack.authProvider) return null;
      if (ctx.search(AUTH_CHECK, { limit: 1 }).length > 0) return null;

      return {
        detail:
          'The project exposes server routes or a database but no authentication library or session check was found anywhere in the source. Every endpoint is reachable by anyone who knows the URL.',
      };
    },
  },

  {
    id: 'auth/unprotected-route-handlers',
    title: 'API routes with no authorisation check',
    category: 'auth',
    severity: 'critical',
    effortHours: 12,
    remediation:
      'Establish the caller\'s identity at the top of every handler and fail closed. Better still, enforce it centrally in middleware so a new route is protected by default rather than protected by whoever remembers — the default should be denial.',
    appliesTo: (ctx) => routeHandlers(ctx).length > 0,
    run(ctx) {
      const unprotected: Evidence[] = [];
      let mutatingCount = 0;

      for (const file of routeHandlers(ctx)) {
        const content = ctx.read(file);
        if (!content) continue;
        // Public-by-design endpoints; flagging them trains people to ignore the report.
        if (/webhook|health|status|robots|sitemap|og-image|revalidate/i.test(file)) continue;
        if (AUTH_CHECK.test(content)) continue;

        const mutates = MUTATING.test(content);
        if (mutates) mutatingCount++;
        unprotected.push({
          file,
          excerpt: mutates ? 'handles writes with no identity check' : 'no identity check',
        });
      }

      if (unprotected.length === 0) return null;

      const writes =
        mutatingCount > 0
          ? ` ${mutatingCount} of them accept writes, so an anonymous caller can modify or delete data.`
          : '';

      return {
        detail: `${unprotected.length} route handler${unprotected.length === 1 ? '' : 's'} run without establishing who the caller is.${writes}`,
        evidence: unprotected.slice(0, 8),
      };
    },
  },

  {
    id: 'auth/trusts-client-supplied-role',
    title: 'Privilege decided by client-supplied data',
    category: 'auth',
    severity: 'critical',
    effortHours: 8,
    remediation:
      'Read roles and permissions from the server-side session or from the database record for the authenticated user — never from the request body, query string, headers or local storage, all of which the caller controls.',
    run(ctx) {
      const hits = [
        ...ctx.search(/(?:req|request)\.(?:body|query|headers)\??\.\w*(?:isAdmin|is_admin|role|isPro|plan|tier)\b/i, { limit: 4, skipComments: true }),
        ...ctx.search(/localStorage\.(?:get|set)Item\(\s*['"](?:role|isAdmin|is_admin|user_role|permissions)['"]/i, { limit: 4, skipComments: true }),
      ];
      if (hits.length === 0) return null;

      return {
        detail:
          'Authorisation decisions are being made from values the client controls. Anyone can change a request body or a local-storage entry, which makes this a straightforward privilege escalation.',
        evidence: hits.slice(0, 6),
      };
    },
  },

  {
    id: 'auth/plaintext-password-storage',
    title: 'Passwords handled without a hashing library',
    category: 'auth',
    severity: 'critical',
    effortHours: 8,
    remediation:
      'Hash with argon2id or bcrypt before storage, and never log or return the field. If passwords have already been stored in plain text, force a reset for every account — the existing values cannot be made safe retroactively.',
    appliesTo: (ctx) => handlesOwnCredentials(ctx) && ctx.stack.authProvider === null,
    run(ctx) {
      if (ctx.anyDependency(HASHING_LIBRARIES)) return null;
      if (ctx.search(/scryptSync|createHash\(\s*['"]sha(?:256|512)['"]/, { limit: 1 }).length > 0) {
        return null;
      }

      const hits = ctx.search(/password/i, { limit: 4 });
      return {
        detail:
          'The app accepts passwords but no password-hashing library is installed and no hashing call was found. Passwords are most likely being compared or stored in plain text.',
        evidence: hits,
      };
    },
  },

  {
    id: 'auth/weak-password-hashing',
    title: 'Passwords hashed with an unsuitable algorithm',
    category: 'auth',
    severity: 'critical',
    effortHours: 6,
    remediation:
      'Replace with argon2id or bcrypt. MD5, SHA-1 and bare SHA-256 are fast by design, which is exactly wrong for passwords — a commodity GPU tries billions of candidates per second against them.',
    run(ctx) {
      const hits = ctx.search(/createHash\(\s*['"](?:md5|sha1)['"]\s*\)/i, {
        limit: 4,
        skipComments: true,
      });
      if (hits.length === 0) return null;

      const passwordContext = hits.filter((h) => /password|credential|login|auth/i.test(ctx.read(h.file)));
      if (passwordContext.length === 0) return null;

      return {
        detail:
          'MD5 or SHA-1 is being used in code that also handles passwords. These are unsalted, fast, and have precomputed rainbow tables freely available.',
        evidence: passwordContext,
      };
    },
  },

  {
    id: 'auth/jwt-decoded-without-verification',
    title: 'JWT decoded without verifying its signature',
    category: 'auth',
    severity: 'high',
    effortHours: 4,
    remediation:
      'Use `jwt.verify` (or `jwtVerify` from jose) with the signing key. Decoding without verification is equivalent to trusting whatever the caller pasted in, because the payload is only base64 — anyone can forge one.',
    run(ctx) {
      const hits = ctx.search(/\bjwt(?:_)?[Dd]ecode\s*\(|\bjwt\.decode\s*\(/, {
        limit: 4,
        skipComments: true,
      });
      if (hits.length === 0) return null;

      // Decoding on the client to read a display name is fine; on the server it is not.
      const serverSide = hits.filter((h) => /api|server|middleware|route\.|lib\/auth/i.test(h.file));
      if (serverSide.length === 0) return null;

      return {
        detail:
          'Server-side code reads a JWT payload without checking the signature. A forged token with any claims will be accepted.',
        evidence: serverSide,
      };
    },
  },

  {
    id: 'auth/no-central-route-protection',
    title: 'No middleware enforcing authentication centrally',
    category: 'auth',
    severity: 'medium',
    effortHours: 4,
    remediation:
      'Add a `middleware.ts` matching your protected path prefixes so access control is applied by default. Per-route checks work until someone adds a route and forgets — and that failure is silent.',
    appliesTo: (ctx) => ctx.stack.framework === 'next' && ctx.stack.authProvider !== null,
    run(ctx) {
      const hasMiddleware = ctx.files.some((f) => /^(src\/)?middleware\.[tj]s$/.test(f));
      if (hasMiddleware) return null;

      return {
        detail:
          'An auth provider is configured but there is no middleware file, so protection depends on each route remembering to check for itself. New routes will default to public.',
      };
    },
  },
];
