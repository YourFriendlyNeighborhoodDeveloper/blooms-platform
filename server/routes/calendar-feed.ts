import { Hono } from 'hono';
import type { AppEnv } from '../http/types.js';
import { resolveAccessToken } from '../lib/tokens.js';
import { addDays, localDate } from '../lib/time.js';
import { calendarRange, toIcs } from '../modules/calendar/feed.js';
import { businessTimezone } from '../modules/settings/service.js';

export const calendarFeedRoutes = new Hono<AppEnv>();

/** A private, read-only .ics subscription for one staff member. It carries no customer contact details. */
calendarFeedRoutes.get('/feed/:file', async (c) => {
  const ctx = c.get('ctx');
  const token = c.req.param('file').replace(/\.ics$/, '');
  const row = await resolveAccessToken(ctx.db, ctx.clock, token, ['calendar_feed']);
  if (!row) return c.text('Not found', 404);
  const tz = await businessTimezone(ctx.db);
  const today = localDate(ctx.clock.now(), tz);
  const { items } = await calendarRange(ctx.db, {
    from: addDays(today, -14, tz),
    to: addDays(today, 180, tz),
    kinds: ['consultation', 'event', 'setup', 'teardown', 'delivery', 'pickup', 'task', 'blackout', 'custom'],
    staff_id: row.subject_id,
  });
  c.header('Content-Type', 'text/calendar; charset=utf-8');
  return c.body(toIcs('Blooms', items, ctx.clock.now()));
});
