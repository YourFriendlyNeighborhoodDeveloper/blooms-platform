import { createHash } from 'node:crypto';
import type { AppContext } from '../../context.js';
import { enqueue } from '../../automation/queue.js';

/**
 * Optional one-way push to Google Calendar. The platform owns the data: changes made in Google are
 * never read back, so an external edit can never silently override a confirmed booking. Without
 * credentials this does nothing. The iCal feed needs no credentials and is the simpler option.
 */
export const googleConfigured = (env: AppContext['env']) => Boolean(env.GOOGLE_CALENDAR_ID && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN);

const SYNCED_EVENTS = new Set(['consultation.booked', 'consultation.cancelled', 'consultation.rescheduled', 'booking.confirmed', 'booking.modified', 'booking.cancelled']);

/** Queues a one-way push when an event changes a consultation or booking. Does nothing unless Google is configured. */
export async function queueCalendarPush(ctx: AppContext, eventId: string) {
  if (!googleConfigured(ctx.env)) return false;
  const event = await ctx.db.selectFrom('automation_events').select(['type', 'subject_type', 'subject_id']).where('id', '=', eventId).executeTakeFirst();
  if (!event?.subject_id || !event.subject_type || !SYNCED_EVENTS.has(event.type)) return false;
  await enqueue(ctx.db, { kind: 'calendar.push', payload: { source_type: event.subject_type, source_id: event.subject_id }, dedupeKey: `calendar:${eventId}` });
  return true;
}

async function accessToken(env: AppContext['env']): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID as string, client_secret: env.GOOGLE_CLIENT_SECRET as string, refresh_token: env.GOOGLE_REFRESH_TOKEN as string, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Google token request failed with status ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function describe(ctx: AppContext, sourceType: string, sourceId: string) {
  if (sourceType === 'consultation') {
    const c = await ctx.db.selectFrom('consultations as c').innerJoin('customers as u', 'u.id', 'c.customer_id').select(['c.starts_at', 'c.ends_at', 'c.status', 'c.format', 'u.name']).where('c.id', '=', sourceId).executeTakeFirst();
    if (!c) return null;
    return { summary: `Consultation: ${c.name}`, description: c.format, start: c.starts_at, end: c.ends_at, active: c.status === 'booked' };
  }
  if (sourceType === 'booking') {
    const b = await ctx.db.selectFrom('event_bookings as b').innerJoin('wedding_inquiries as i', 'i.id', 'b.inquiry_id').innerJoin('customers as u', 'u.id', 'i.customer_id').select(['b.event_start', 'b.event_end', 'b.status', 'i.venue_name', 'i.event_type', 'u.name']).where('b.id', '=', sourceId).executeTakeFirst();
    if (!b) return null;
    return { summary: `${b.event_type}: ${b.name}`, description: b.venue_name ?? '', start: b.event_start, end: b.event_end, active: ['confirmed', 'approved', 'hold'].includes(b.status) };
  }
  return null;
}

export async function pushCalendarEntry(ctx: AppContext, input: { source_type: string; source_id: string }) {
  if (!googleConfigured(ctx.env)) return;
  const entry = await describe(ctx, input.source_type, input.source_id);
  const link = await ctx.db.selectFrom('calendar_sync_links').selectAll().where('source_type', '=', input.source_type).where('source_id', '=', input.source_id).where('provider', '=', 'google').executeTakeFirst();
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(ctx.env.GOOGLE_CALENDAR_ID as string)}/events`;
  const token = await accessToken(ctx.env);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  if (!entry || !entry.active) {
    if (link) {
      const res = await fetch(`${base}/${link.external_id}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(15_000) });
      if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`Google delete failed with status ${res.status}`);
      await ctx.db.deleteFrom('calendar_sync_links').where('source_type', '=', input.source_type).where('source_id', '=', input.source_id).where('provider', '=', 'google').execute();
    }
    return;
  }
  const body = JSON.stringify({ summary: entry.summary, description: entry.description, start: { dateTime: entry.start.toISOString() }, end: { dateTime: entry.end.toISOString() } });
  const hash = createHash('sha256').update(body).digest('hex');
  if (link?.content_hash === hash) return;
  const res = await fetch(link ? `${base}/${link.external_id}` : base, { method: link ? 'PUT' : 'POST', headers, body, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Google calendar write failed with status ${res.status}`);
  const saved = (await res.json()) as { id: string };
  await ctx.db
    .insertInto('calendar_sync_links')
    .values({ source_type: input.source_type, source_id: input.source_id, provider: 'google', external_id: saved.id, content_hash: hash, last_synced_at: ctx.clock.now() })
    .onConflict((oc) => oc.columns(['source_type', 'source_id', 'provider']).doUpdateSet({ external_id: saved.id, content_hash: hash, last_synced_at: ctx.clock.now() }))
    .execute();
}
