import type { MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { randomUUID } from 'node:crypto';
import type { AppContext } from '../context.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { loadStaffPrincipal } from '../auth/staff.js';
import { resolveSession } from '../auth/sessions.js';
import { cookieNames, readCookie } from './helpers.js';
import type { AppEnv } from './types.js';

export const withContext = (ctx: AppContext): MiddlewareHandler<AppEnv> => async (c, next) => {
  c.set('ctx', ctx);
  c.set('requestId', randomUUID());
  let ip = 'unknown';
  if (ctx.env.TRUST_PROXY === 'cloudflare') {
    ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  } else if (ctx.env.TRUST_PROXY) {
    // Clients can send any X-Forwarded-For they like. Only the last entry, added by our own proxy, can be believed.
    ip = c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim() ?? 'unknown';
  } else {
    try {
      ip = getConnInfo(c).remote.address ?? 'unknown';
    } catch {
      ip = 'local';
    }
  }
  c.set('ip', ip);
  const started = Date.now();
  await next();
  const path = c.req.path;
  if (path.startsWith('/api/') && !ctx.env.APP_ENV.startsWith('test')) {
    ctx.log.info('request', { method: c.req.method, path, status: c.res.status, ms: Date.now() - started, request_id: c.get('requestId') });
  }
};

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defense: cookies are SameSite=Lax, and state-changing API requests must come from our own
 * origin. Webhooks are exempt because they authenticate by signature and send no cookies.
 */
export const originGuard = (allowed: string[]): MiddlewareHandler<AppEnv> => async (c, next) => {
  if (SAFE.has(c.req.method) || c.req.path.startsWith('/api/webhooks/') || c.req.path.startsWith('/api/dev/')) return next();
  const origin = c.req.header('origin');
  if (origin) {
    if (!allowed.includes(origin)) throw forbidden('Cross-site request blocked.');
    return next();
  }
  // Browsers always send Origin on these requests. A missing header means a non-browser client
  // with no ambient cookies, so it gets no more than an anonymous visitor would.
  const fetchSite = c.req.header('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') throw forbidden('Cross-site request blocked.');
  return next();
};

export const requireStaff: MiddlewareHandler<AppEnv> = async (c, next) => {
  const ctx = c.get('ctx');
  const session = await resolveSession(ctx.db, ctx.clock, readCookie(c, cookieNames(ctx.env).staff));
  if (!session?.user_id) throw unauthorized();
  const principal = await loadStaffPrincipal(ctx.db, session.user_id, session.id);
  if (!principal) throw unauthorized();
  c.set('staff', principal);
  return next();
};

export const requireCustomer: MiddlewareHandler<AppEnv> = async (c, next) => {
  const ctx = c.get('ctx');
  const session = await resolveSession(ctx.db, ctx.clock, readCookie(c, cookieNames(ctx.env).customer));
  if (!session?.customer_id) throw unauthorized();
  const customer = await ctx.db.selectFrom('customers').select(['id', 'email', 'name', 'anonymized_at']).where('id', '=', session.customer_id).executeTakeFirst();
  if (!customer || customer.anonymized_at) throw unauthorized();
  c.set('customer', { type: 'customer', customerId: customer.id, sessionId: session.id, email: customer.email, name: customer.name });
  return next();
};
