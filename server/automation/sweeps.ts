import type { AppContext } from '../context.js';
import { addHours, addMinutes } from '../lib/time.js';
import { emit, raiseAlert } from './events.js';
import { checkIntegrity } from '../modules/system/integrity.js';
import { completeFulfilledOrders, expireStaleOrders } from '../modules/orders/actions.js';
import { reconcileOpenPayments } from '../modules/payments/service.js';
import { getSetting } from '../modules/settings/service.js';
import { checkLowStock } from '../modules/inventory/service.js';
import { LIFECYCLE_SWEEPS } from './lifecycle.js';
import { CONCIERGE_SWEEPS } from '../modules/concierge/sweeps.js';

export type Sweep = { name: string; everyMinutes: number; run: (ctx: AppContext) => Promise<unknown> };

export const COMMERCE_SWEEPS: Sweep[] = [
  { name: 'orders.expire_holds', everyMinutes: 1, run: (ctx) => expireStaleOrders(ctx) },
  { name: 'payments.reconcile', everyMinutes: 5, run: (ctx) => reconcileOpenPayments(ctx) },
  { name: 'orders.complete', everyMinutes: 15, run: (ctx) => completeFulfilledOrders(ctx) },
  {
    name: 'orders.overdue',
    everyMinutes: 10,
    run: async (ctx) => {
      const { overdue_after_minutes } = await getSetting(ctx.db, 'ordering');
      const cutoff = addMinutes(ctx.clock.now(), -overdue_after_minutes);
      const rows = await ctx.db
        .selectFrom('fulfillments as f')
        .innerJoin('orders as o', 'o.id', 'f.order_id')
        .select(['o.id'])
        .distinct()
        .where('f.window_end', '<', cutoff)
        .where('f.status', 'not in', ['fulfilled', 'cancelled', 'returned', 'shipped'])
        .where('o.status', 'in', ['accepted', 'preparing', 'ready', 'partially_fulfilled', 'out_for_delivery', 'rescheduling'])
        .limit(100)
        .execute();
      for (const r of rows) await emit(ctx.db, 'order.overdue', { type: 'order', id: r.id }, {}, `order-overdue:${r.id}`);
    },
  },
  {
    name: 'deliveries.unassigned',
    everyMinutes: 30,
    run: async (ctx) => {
      const horizon = addHours(ctx.clock.now(), 24);
      const rows = await ctx.db
        .selectFrom('deliveries as d')
        .innerJoin('fulfillments as f', 'f.id', 'd.fulfillment_id')
        .innerJoin('orders as o', 'o.id', 'f.order_id')
        .select(['o.id', 'd.id as delivery_id'])
        .where('d.driver_staff_id', 'is', null)
        .where('d.status', '=', 'scheduled')
        .where('f.window_start', '<', horizon)
        .where('o.status', 'in', ['accepted', 'preparing', 'ready', 'partially_fulfilled'])
        .limit(100)
        .execute();
      for (const r of rows) await emit(ctx.db, 'delivery.unassigned', { type: 'order', id: r.id }, {}, `delivery-unassigned:${r.delivery_id}`);
    },
  },
  {
    name: 'inventory.low_stock',
    everyMinutes: 60,
    run: async (ctx) => {
      const items = await ctx.db.selectFrom('inventory_items').select('id').where('active', '=', true).where('low_stock_threshold', 'is not', null).execute();
      for (const i of items) await checkLowStock(ctx.db, i.id);
    },
  },
  {
    name: 'carts.expire',
    everyMinutes: 60,
    run: async (ctx) => {
      await ctx.db.updateTable('carts').set({ status: 'abandoned' }).where('status', 'in', ['active', 'pending_payment']).where('expires_at', '<', ctx.clock.now()).execute();
    },
  },
  {
    name: 'system.cleanup',
    everyMinutes: 60 * 6,
    run: async (ctx) => {
      const now = ctx.clock.now();
      await ctx.db.deleteFrom('rate_limits').where('window_start', '<', addHours(now, -48)).execute();
      await ctx.db.deleteFrom('access_tokens').where('expires_at', '<', addHours(now, -24 * 30)).execute();
      await ctx.db.deleteFrom('sessions').where('expires_at', '<', addHours(now, -24 * 30)).execute();
      await ctx.db.deleteFrom('automation_jobs').where('status', '=', 'succeeded').where('finished_at', '<', addHours(now, -24 * 30)).execute();
      await ctx.db.deleteFrom('worker_heartbeats').where('last_seen_at', '<', addHours(now, -24 * 7)).execute();
    },
  },
];

const SYSTEM_SWEEPS: Sweep[] = [
  {
    name: 'system.integrity',
    everyMinutes: 360,
    run: async (ctx) => {
      const report = await checkIntegrity(ctx.db);
      const failed = report.checks.filter((c) => c.violations > 0);
      if (failed.length) {
        await raiseAlert(ctx.db, {
          code: 'data_integrity',
          severity: 'critical',
          title: 'Some records disagree with each other',
          detail: failed.map((c) => `${c.title} (${c.violations})`).join('; '),
          link: '/admin/system',
          dedupeKey: 'data_integrity',
        });
      }
    },
  },
];

export const SWEEPS: Sweep[] = [...COMMERCE_SWEEPS, ...LIFECYCLE_SWEEPS, ...SYSTEM_SWEEPS, ...CONCIERGE_SWEEPS];
