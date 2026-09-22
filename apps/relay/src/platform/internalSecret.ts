/**
 * RELAY's `/internal/*` endpoints are how the orchestrator asks it to send
 * mail: consent requests, reminders, a candidate's profile to a vendor. They
 * had no check at all, and RELAY is reachable through node-api's port, so
 * anyone on the network could send mail from the recruiter's own mailbox.
 *
 * Same shared secret, same two-worlds rule as node-api's
 * `middleware/internalSecret.js`: with `INTERNAL_API_SECRET` unset nothing
 * changes and the process says so at boot; set it on both sides and the door
 * closes.
 */
import crypto from 'node:crypto';

function configured(): string | null {
  const raw = process.env.INTERNAL_API_SECRET;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function sameSecret(a: string, b: string): boolean {
  const ah = crypto.createHash('sha256').update(a).digest();
  const bh = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ah, bh);
}

/** Headers for RELAY's own calls to another service's internal endpoints. */
export function internalHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const secret = configured();
  return {
    'Content-Type': 'application/json',
    ...(secret ? { 'x-internal-secret': secret } : {}),
    ...extra,
  };
}

/**
 * Guard every `/internal/*` route on this app. Registered as one hook rather
 * than per route, so a route added later is covered by default.
 */
export function registerInternalSecret(app: {
  addHook: (name: 'onRequest', fn: (req: any, reply: any) => Promise<void>) => void;
  log?: { info: (m: string) => void; warn: (m: string) => void };
}): void {
  const expected = configured();
  const say = app.log ?? console;
  if (expected) {
    say.info('[relay] /internal/* requires x-internal-secret');
  } else {
    say.warn(
      '[relay] INTERNAL_API_SECRET is not set — /internal/* is open to anyone who ' +
        'can reach this port, including the routes that send mail.',
    );
  }

  app.addHook('onRequest', async (req, reply) => {
    const url: string = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/internal/')) return;
    if (!expected) return;
    const provided = req.headers['x-internal-secret'];
    if (typeof provided !== 'string' || !provided || !sameSecret(provided, expected)) {
      return reply
        .code(401)
        .send({ error: 'internal_unauthorized', message: 'This endpoint is for platform services.' });
    }
  });
}
