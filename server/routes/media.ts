import { Hono } from 'hono';
import type { AppEnv } from '../http/types.js';

export const mediaRoutes = new Hono<AppEnv>();

/** Public catalog images only. Customer uploads live under a different prefix, behind authorization. */
mediaRoutes.get('/media/catalog/:file', async (c) => {
  const ctx = c.get('ctx');
  const file = c.req.param('file');
  if (!/^[\w-]+\.(webp|jpg|png)$/.test(file)) return c.notFound();
  const object = await ctx.storage.get(`catalog/${file}`);
  if (!object) return c.notFound();
  c.header('Content-Type', object.contentType ?? 'application/octet-stream');
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
  c.header('X-Content-Type-Options', 'nosniff');
  return c.body(new Uint8Array(object.body));
});
