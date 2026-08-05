import type { Rule, ScanContext } from '../types.js';

const WEBHOOK_FILE = /webhook/i;

/** Provider-specific signature verification calls. */
const SIGNATURE_VERIFICATION =
  /constructEvent|constructEventAsync|verifyWebhookSignature|verifySignature|unmarshal|Webhook\.verify|validateWebhook|createHmac/;

function paymentFiles(ctx: ScanContext): string[] {
  return ctx.files.filter(
    (f) => WEBHOOK_FILE.test(f) && /\.[tj]sx?$/.test(f),
  );
}

export const paymentsRules: Rule[] = [
  {
    id: 'payments/unverified-webhook',
    title: 'Payment webhook accepts unverified requests',
    category: 'payments',
    severity: 'critical',
    effortHours: 6,
    remediation:
      'Verify the signature header against the raw request body using the provider\'s SDK before trusting any part of the payload, and reject anything that fails. Note that the check needs the *raw* body — frameworks that parse JSON automatically will break verification silently.',
    appliesTo: (ctx) => ctx.stack.paymentProvider !== null && paymentFiles(ctx).length > 0,
    run(ctx) {
      const unverified = paymentFiles(ctx).filter((file) => {
        const content = ctx.read(file);
        return content && !SIGNATURE_VERIFICATION.test(content);
      });

      if (unverified.length === 0) return null;

      return {
        detail:
          'A webhook endpoint processes payment events without verifying the provider signature. Anyone who finds the URL can POST a fake "payment succeeded" event and be granted whatever it unlocks — paid plans, credits, or shipped goods.',
        evidence: unverified.map((file) => ({ file })),
      };
    },
  },

  {
    id: 'payments/no-webhook-handler',
    title: 'No payment webhook handler',
    category: 'payments',
    severity: 'high',
    effortHours: 10,
    remediation:
      'Fulfil orders from the webhook, not from the post-checkout redirect. Users close the tab, lose signal, and get redirected before the callback runs; asynchronous payment methods settle minutes later. Without a webhook those customers pay and receive nothing.',
    appliesTo: (ctx) => ctx.stack.paymentProvider !== null,
    run(ctx) {
      if (paymentFiles(ctx).length > 0) return null;
      if (ctx.search(SIGNATURE_VERIFICATION, { limit: 1 }).length > 0) return null;

      return {
        detail: `${ctx.stack.paymentProvider} is integrated but no webhook handler was found. Fulfilment appears to depend on the browser returning from checkout, which is unreliable and silently loses paid orders.`,
      };
    },
  },

  {
    id: 'payments/client-supplied-amount',
    title: 'Charge amount taken from the client',
    category: 'payments',
    severity: 'critical',
    effortHours: 8,
    remediation:
      'Send only a product or price identifier from the client, then look the real amount up server-side from your own database or the provider\'s price objects. The client may choose *what* to buy, never *what it costs*.',
    appliesTo: (ctx) => ctx.stack.paymentProvider !== null,
    run(ctx) {
      const hits = [
        ...ctx.search(/(?:amount|unit_amount|price|total)\s*:\s*(?:body|req\.body|request\.body|params|searchParams|data)\b/i, { limit: 4, skipComments: true }),
        ...ctx.search(/const\s*\{[^}]*\b(?:amount|price|total)\b[^}]*\}\s*=\s*await\s*(?:req|request)\.json\(\)/i, { limit: 4, skipComments: true }),
      ];
      if (hits.length === 0) return null;

      return {
        detail:
          'The charge amount is read from the incoming request. A customer can intercept that call and set the price to zero — this is the single most common payment flaw in prototype code.',
        evidence: hits.slice(0, 6),
      };
    },
  },

  {
    id: 'payments/no-idempotency-key',
    title: 'Payment writes without idempotency keys',
    category: 'payments',
    severity: 'medium',
    effortHours: 4,
    remediation:
      'Pass an idempotency key derived from your own order identifier on every charge-creating call. Networks retry, users double-click, and webhooks are delivered more than once by design — without a key, each of those becomes a duplicate charge.',
    appliesTo: (ctx) => ctx.stack.paymentProvider === 'stripe',
    run(ctx) {
      const creates = ctx.search(
        /(?:paymentIntents|charges|subscriptions|checkout\.sessions)\.create\s*\(/,
        { limit: 6, skipComments: true },
      );
      if (creates.length === 0) return null;
      if (ctx.search(/idempotencyKey|Idempotency-Key/i, { limit: 1 }).length > 0) return null;

      return {
        detail:
          'Charge-creating calls were found with no idempotency key anywhere in the codebase. Retries and duplicate webhook deliveries will produce duplicate charges, and refunding those manually is both costly and reputationally expensive.',
        evidence: creates.slice(0, 4),
      };
    },
  },
];
