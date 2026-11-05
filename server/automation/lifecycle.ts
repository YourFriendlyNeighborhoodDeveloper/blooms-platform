import { sql } from 'kysely';
import { addDays, addHours, addMinutes, localDate } from '../lib/time.js';
import { emit, raiseAlert } from './events.js';
import { getSetting, loadSettings } from '../modules/settings/service.js';
import { expireBookingHolds } from '../modules/weddings/billing.js';
import type { Sweep } from './sweeps.js';

/** Scheduled customer and staff reminders. Each dedupe key means a reminder goes out once, however often this runs. */
export const LIFECYCLE_SWEEPS: Sweep[] = [
  { name: 'bookings.expire_holds', everyMinutes: 5, run: (ctx) => expireBookingHolds(ctx) },
  {
    name: 'quotes.expire',
    everyMinutes: 60,
    run: async (ctx) => {
      const tz = (await getSetting(ctx.db, 'general')).timezone;
      await ctx.db.updateTable('quotes').set({ status: 'expired' }).where('status', '=', 'sent').where('valid_until', '<', localDate(ctx.clock.now(), tz)).execute();
    },
  },
  {
    name: 'consultations.remind',
    everyMinutes: 15,
    run: async (ctx) => {
      const { reminder_hours_before } = await getSetting(ctx.db, 'consultations');
      const now = ctx.clock.now();
      const rows = await ctx.db.selectFrom('consultations').select(['id', 'customer_id']).where('status', '=', 'booked').where('starts_at', '>', now).where('starts_at', '<=', addHours(now, reminder_hours_before)).execute();
      for (const r of rows) await emit(ctx.db, 'consultation.reminder', { type: 'consultation', id: r.id }, { customer_id: r.customer_id }, `consultation-reminder:${r.id}`);
    },
  },
  {
    name: 'inquiries.follow_up',
    everyMinutes: 60,
    run: async (ctx) => {
      const { follow_up_hours } = await getSetting(ctx.db, 'events');
      const cutoff = addHours(ctx.clock.now(), -follow_up_hours);
      const rows = await ctx.db
        .selectFrom('wedding_inquiries as i')
        .innerJoin('pipeline_stages as s', 's.id', 'i.stage_id')
        .select('i.id')
        .where('s.code', '=', 'new_inquiry')
        .where('i.status', '=', 'new')
        .where('i.created_at', '<', cutoff)
        .limit(100)
        .execute();
      for (const r of rows) await emit(ctx.db, 'inquiry.follow_up', { type: 'inquiry', id: r.id }, {}, `inquiry-follow-up:${r.id}`);
    },
  },
  {
    name: 'events.upcoming',
    everyMinutes: 60,
    run: async (ctx) => {
      const settings = await loadSettings(ctx.db);
      const tz = settings.general.timezone;
      const today = localDate(ctx.clock.now(), tz);
      for (const days of settings.events.reminder_days_before) {
        const date = addDays(today, days, tz);
        const rows = await ctx.db.selectFrom('event_bookings').select(['id']).where('status', '=', 'confirmed').where('event_date', '=', date).execute();
        for (const r of rows) await emit(ctx.db, 'event.upcoming', { type: 'booking', id: r.id }, { days_until: days }, `event-upcoming:${r.id}:${days}`);
      }
    },
  },
  {
    name: 'milestones.remind',
    everyMinutes: 60,
    run: async (ctx) => {
      const tz = (await getSetting(ctx.db, 'general')).timezone;
      const today = localDate(ctx.clock.now(), tz);
      const rows = await ctx.db
        .selectFrom('project_milestones as m')
        .innerJoin('wedding_projects as p', 'p.id', 'm.project_id')
        .select(['m.id', 'p.customer_id'])
        .where('m.status', '=', 'upcoming')
        .where('m.customer_visible', '=', true)
        .where('m.due_on', '>=', today)
        .where('m.due_on', '<=', addDays(today, 7, tz))
        .where('p.status', 'in', ['confirmed', 'in_preparation', 'event_scheduled'])
        .execute();
      for (const r of rows) await emit(ctx.db, 'milestone.upcoming', { type: 'milestone', id: r.id }, { customer_id: r.customer_id }, `milestone:${r.id}`);
    },
  },
  {
    name: 'invoices.remind',
    everyMinutes: 60,
    run: async (ctx) => {
      const tz = (await getSetting(ctx.db, 'general')).timezone;
      const today = localDate(ctx.clock.now(), tz);
      const dueSoon = await ctx.db.selectFrom('invoices').select(['id']).where('status', 'in', ['sent', 'partially_paid']).where('kind', '=', 'balance').where('due_on', '>=', today).where('due_on', '<=', addDays(today, 14, tz)).execute();
      for (const r of dueSoon) await emit(ctx.db, 'invoice.sent', { type: 'invoice', id: r.id }, {}, `invoice-reminder:${r.id}`);
      const overdue = await ctx.db.selectFrom('invoices').select(['id', 'due_on']).where('status', 'in', ['sent', 'partially_paid']).where('due_on', '<', today).where('overdue_notified_at', 'is', null).execute();
      for (const r of overdue) {
        await ctx.db.transaction().execute(async (trx) => {
          await trx.updateTable('invoices').set({ overdue_notified_at: ctx.clock.now() }).where('id', '=', r.id).execute();
          await emit(trx, 'invoice.overdue', { type: 'invoice', id: r.id }, {}, `invoice-overdue:${r.id}`);
        });
      }
    },
  },
  {
    name: 'rentals.return_due',
    everyMinutes: 60,
    run: async (ctx) => {
      const now = ctx.clock.now();
      const rows = await ctx.db.selectFrom('rental_reservations').select('id').where('status', 'in', ['out', 'confirmed']).where('ends_at', '<=', addHours(now, 24)).where('ends_at', '>', addHours(now, -72)).execute();
      for (const r of rows) await emit(ctx.db, 'rental.return_due', { type: 'rental_reservation', id: r.id }, {}, `rental-return:${r.id}`);
    },
  },
  {
    name: 'inventory.expiring_lots',
    everyMinutes: 360,
    run: async (ctx) => {
      const tz = (await getSetting(ctx.db, 'general')).timezone;
      const soon = addDays(localDate(ctx.clock.now(), tz), 2, tz);
      const rows = await ctx.db.selectFrom('inventory_lots as l').innerJoin('inventory_items as i', 'i.id', 'l.item_id').select(['l.id', 'l.quantity_remaining', 'l.best_by', 'i.name', 'i.id as item_id']).where('l.quantity_remaining', '>', 0).where('l.best_by', '<=', soon).execute();
      for (const r of rows) {
        await raiseAlert(ctx.db, { code: 'lot_expiring', title: `${r.name} past its best soon`, detail: `${r.quantity_remaining} remaining, best by ${r.best_by}.`, subject: { type: 'inventory_item', id: r.item_id }, link: `/admin/inventory/items/${r.item_id}`, dedupeKey: `lot-expiring:${r.id}` });
      }
    },
  },
  {
    name: 'customers.follow_up',
    everyMinutes: 60,
    run: async (ctx) => {
      const f = await getSetting(ctx.db, 'followups');
      if (!f.enabled) return;
      const now = ctx.clock.now();
      const rows = await ctx.db.selectFrom('orders').select(['id', 'customer_id']).where('status', 'in', ['fulfilled', 'completed']).where('fulfilled_at', '<', addHours(now, -24 * f.days_after_fulfillment)).where('fulfilled_at', '>', addHours(now, -24 * (f.days_after_fulfillment + 3))).limit(100).execute();
      for (const r of rows) await emit(ctx.db, 'customer.follow_up', { type: 'customer', id: r.customer_id }, { order_id: r.id }, `follow-up:${r.id}`);
    },
  },
  {
    name: 'carts.abandoned',
    everyMinutes: 30,
    run: async (ctx) => {
      const f = await getSetting(ctx.db, 'followups');
      if (!f.abandoned_cart_enabled) return;
      const now = ctx.clock.now();
      const rows = await sql<{ id: string; customer_id: string }>`
        SELECT c.id, c.customer_id FROM carts c
        WHERE c.customer_id IS NOT NULL AND c.status IN ('active', 'pending_payment')
          AND c.updated_at < ${addHours(now, -f.abandoned_cart_hours)} AND c.updated_at > ${addHours(now, -(f.abandoned_cart_hours + 24))}
          AND EXISTS (SELECT 1 FROM cart_items i WHERE i.cart_id = c.id)
        LIMIT 100
      `.execute(ctx.db);
      for (const r of rows.rows) await emit(ctx.db, 'cart.abandoned', { type: 'cart', id: r.id }, { customer_id: r.customer_id }, `cart-abandoned:${r.id}`);
    },
  },
  {
    name: 'retention.purge',
    everyMinutes: 60 * 24,
    run: async (ctx) => {
      const p = await getSetting(ctx.db, 'privacy');
      const now = ctx.clock.now();
      await ctx.db.deleteFrom('carts').where('status', 'in', ['abandoned', 'active']).where('updated_at', '<', addHours(now, -24 * p.retain_abandoned_cart_days)).execute();
      const stale = await ctx.db.selectFrom('wedding_documents').select(['id', 'storage_key']).where('inquiry_id', 'is', null).where('project_id', 'is', null).where('created_at', '<', addHours(now, -24 * p.retain_draft_upload_days)).limit(200).execute();
      for (const d of stale) {
        await ctx.db.deleteFrom('wedding_documents').where('id', '=', d.id).execute();
        await ctx.storage.delete(d.storage_key).catch(() => {});
      }
      await ctx.db.updateTable('notifications').set({ body: '[removed after retention period]' }).where('audience', '=', 'customer').where('created_at', '<', addHours(now, -24 * p.retain_notification_body_days)).where('body', '!=', '[removed after retention period]').execute();
    },
  },
  {
    name: 'system.watch_failures',
    everyMinutes: 15,
    run: async (ctx) => {
      const old = await ctx.db.selectFrom('automation_events').select((eb) => eb.fn.countAll<number>().as('n')).where('status', '=', 'pending').where('created_at', '<', addMinutes(ctx.clock.now(), -30)).executeTakeFirstOrThrow();
      if (Number(old.n) > 0) await raiseAlert(ctx.db, { code: 'events_stuck', severity: 'critical', title: 'Automation is falling behind', detail: `${old.n} events have been waiting over 30 minutes.`, link: '/admin/system/jobs', dedupeKey: 'events-stuck' });
      const failed = await ctx.db.selectFrom('webhook_events').select((eb) => eb.fn.countAll<number>().as('n')).where('status', '=', 'failed').where('received_at', '>', addHours(ctx.clock.now(), -24)).executeTakeFirstOrThrow();
      if (Number(failed.n) > 0) await raiseAlert(ctx.db, { code: 'webhooks_failing', severity: 'critical', title: 'Payment webhooks are failing', detail: `${failed.n} failed in the last day. Payments may not be recording.`, link: '/admin/system/webhooks', dedupeKey: 'webhooks-failing' });
    },
  },
];

