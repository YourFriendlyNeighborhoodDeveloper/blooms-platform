import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { serveStatic } from '@hono/node-server/serve-static';
import fs from 'node:fs';
import path from 'node:path';
import type { AppContext } from './context.js';
import type { AppEnv } from './http/types.js';
import { AppError, mapDatabaseError } from './lib/errors.js';
import { originGuard, requireStaff, withContext } from './http/middleware.js';
import { publicRoutes } from './routes/public.js';
import { webhookRoutes } from './routes/webhooks.js';
import { conciergeRoutes, voiceWebhookRoutes } from './routes/concierge.js';
import { devRoutes } from './routes/dev.js';
import { adminAuthRoutes, adminSessionRoutes } from './routes/admin-auth.js';
import { adminOrderRoutes, adminFulfillmentRoutes } from './routes/admin-orders.js';
import { adminRoutes } from './routes/admin.js';
import { accountRoutes } from './routes/account.js';
import { mediaRoutes } from './routes/media.js';
import { healthRoutes } from './routes/health.js';
import { calendarFeedRoutes } from './routes/calendar-feed.js';

const CONTENT_SECURITY_POLICY = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", 'https://connect.facebook.net'],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
  fontSrc: ["'self'", 'data:'],
  connectSrc: ["'self'", 'https://www.facebook.com', 'https://connect.facebook.net'],
  frameSrc: ['https://www.facebook.com', 'https://web.facebook.com'],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'", 'https://checkout.stripe.com'],
  frameAncestors: ["'self'"],
};

export function createApp(ctx: AppContext) {
  const app = new Hono<AppEnv>();
  const baseOrigin = new URL(ctx.env.PUBLIC_BASE_URL).origin;
  const allowedOrigins = [baseOrigin, ...(ctx.env.isDeployed ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173', `http://localhost:${ctx.env.PORT}`, `http://127.0.0.1:${ctx.env.PORT}`])];

  app.use('*', withContext(ctx));
  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: CONTENT_SECURITY_POLICY,
      strictTransportSecurity: ctx.env.isDeployed ? 'max-age=31536000; includeSubDomains' : false,
      xFrameOptions: 'SAMEORIGIN',
      referrerPolicy: 'strict-origin-when-cross-origin',
      permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
      crossOriginResourcePolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
    }),
  );

  app.onError((err, c) => {
    const known = err instanceof AppError ? err : mapDatabaseError(err);
    if (known) return c.json({ error: { code: known.code, message: known.message, details: known.details } }, known.status as 400);
    ctx.log.error('unhandled error', { method: c.req.method, path: c.req.path, error: err, stack: err.stack, request_id: c.get('requestId') });
    return c.json({ error: { code: 'server_error', message: 'Something went wrong on our side. Please try again.' } }, 500);
  });

  app.route('/', healthRoutes);
  app.use('/api/*', originGuard(allowedOrigins));
  const jsonLimit = bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: { code: 'too_large', message: 'That request is too large.' } }, 413) });
  app.use('/api/*', async (c, next) => {
    if ((c.req.header('content-type') ?? '').startsWith('multipart/form-data')) return next();
    return jsonLimit(c, next);
  });
  app.use('/api/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  app.route('/api/webhooks/voice', voiceWebhookRoutes);
  app.route('/api/webhooks', webhookRoutes);
  app.route('/api/public/concierge', conciergeRoutes);
  app.route('/api/public', publicRoutes);
  app.route('/api/account', accountRoutes);
  app.route('/api/admin/auth', adminAuthRoutes);
  app.route('/api/calendar', calendarFeedRoutes);

  const staff = new Hono<AppEnv>();
  staff.use('*', requireStaff);
  staff.route('/auth', adminSessionRoutes);
  staff.route('/orders', adminOrderRoutes);
  staff.route('/fulfillments', adminFulfillmentRoutes);
  staff.route('/', adminRoutes);
  app.route('/api/admin', staff);

  if (ctx.env.PAYMENTS_MODE === 'mock') app.route('/api/dev', devRoutes);
  app.route('/', mediaRoutes);

  app.all('/api/*', (c) => c.json({ error: { code: 'not_found', message: 'Not found.' } }, 404));

  if (ctx.env.SERVE_STATIC) mountSpa(app, ctx);
  return app;
}

// Top-level app routes that have no HTML shell of their own. Everything else is a true 404.
const KNOWN_ROUTES = new Set(['', 'admin', 'cart', 'checkout', 'track', 'quote', 'pay', 'project', 'account', 'preferences', 'privacy', 'terms', 'shop', 'plan', 'live', 'flowers', 'weddings-events', 'rentals', 'boutique', 'about', 'contact', 'continue']);

/** Serves the built site, preferring each route's own HTML shell so link previews see the right tags. */
function mountSpa(app: Hono<AppEnv>, ctx: AppContext) {
  const root = path.resolve('dist');
  const indexable = process.env.SITE_MODE === 'production';
  const html = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

  app.use('/assets/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
  });
  app.use('/img/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'public, max-age=2592000');
  });
  const staticFiles = serveStatic({ root: 'dist', index: '' });
  app.use('/*', async (c, next) => {
    // Only real files go through the static handler, otherwise it answers for directories such as / and /assets/.
    const file = path.join(root, decodeURIComponent(c.req.path));
    const inside = file === root || file.startsWith(root + path.sep);
    if (!inside || c.req.path.endsWith('.html') || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) return next();
    return staticFiles(c, next);
  });
  app.get('*', (c) => {
    const clean = c.req.path.replace(/\/$/, '') || '/';
    const shell = clean === '/' ? 'index.html' : `${clean.slice(1)}.html`;
    const isShell = /^[\w-]+\.html$/.test(shell) && fs.existsSync(path.join(root, shell));
    const privatePage = /^\/(admin|account|track|checkout|cart|quote|pay|plan|project|preferences|continue)(\/|$)/.test(clean);
    if (!indexable || privatePage) c.header('X-Robots-Tag', 'noindex, nofollow');
    c.header('Cache-Control', 'no-cache');
    if (isShell) return c.html(html(shell));
    // Unknown addresses answer 404 for crawlers and monitors, while the app still shows its own page.
    const known = KNOWN_ROUTES.has(clean.split('/')[1] ?? '');
    return c.html(html(known ? 'index.html' : '404.html'), known ? 200 : 404);
  });
  void ctx;
}
