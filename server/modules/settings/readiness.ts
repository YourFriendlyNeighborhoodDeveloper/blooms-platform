import { sql } from 'kysely';
import type { AppContext } from '../../context.js';
import { addMinutes } from '../../lib/time.js';
import { googleConfigured } from '../calendar/sync.js';
import { loadSettings } from './service.js';

export type Check = { id: string; group: string; title: string; status: 'ok' | 'todo' | 'blocker' | 'optional'; detail: string; link?: string };

/**
 * The launch checklist. Blockers mean real customers should not be accepted yet. Nothing here flips
 * a switch by itself: going live stays a deliberate decision by a person, recorded in configuration.
 */
export async function readinessChecks(ctx: AppContext): Promise<{ checks: Check[]; ready_for_live: boolean; warnings: string[] }> {
  const { db, env } = ctx;
  const settings = await loadSettings(db);
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  const count = async (table: 'products' | 'delivery_zones' | 'delivery_windows' | 'business_hours' | 'wedding_services' | 'rental_items' | 'resources', where?: (q: any) => any) => {
    let q = db.selectFrom(table as 'products').select((eb) => eb.fn.countAll<number>().as('n'));
    if (where) q = where(q);
    return Number((await q.executeTakeFirstOrThrow()).n);
  };

  const live = ctx.payments.livemode;
  add({ id: 'payments', group: 'Payments', title: 'Stripe account connected', status: ctx.payments.name === 'stripe' ? (live ? 'ok' : 'todo') : 'blocker', detail: ctx.payments.name === 'stripe' ? (live ? 'Live payments are on.' : 'Test mode. No real money moves.') : ctx.payments.name === 'mock' ? 'Using the simulated gateway. Connect the owner’s own Stripe account.' : 'Payments are off. Connect the owner’s own Stripe account.' });
  add({ id: 'webhook', group: 'Payments', title: 'Stripe webhook secret set', status: ctx.payments.name === 'stripe' && env.STRIPE_WEBHOOK_SECRET ? 'ok' : 'blocker', detail: 'Orders are only marked paid by signed webhooks.' });
  const stripeCheck = await db.selectFrom('integration_settings').select(['last_verified_at', 'config']).where('provider', '=', 'stripe').executeTakeFirst();
  add({
    id: 'stripe_verified',
    group: 'Payments',
    title: 'Stripe connection tested',
    status: stripeCheck?.last_verified_at ? 'ok' : 'blocker',
    detail: stripeCheck?.last_verified_at
      ? `Checked with npm run verify:stripe on ${stripeCheck.last_verified_at.toISOString().slice(0, 10)}. Also make a full test payment by hand before going live.`
      : 'Run npm run verify:stripe with a test key from the business\'s own account, then make a full test payment. See docs/integrations.md.',
  });
  const taxOk = settings.tax.rates_bps.standard !== undefined;
  add({ id: 'tax', group: 'Payments', title: 'Sales tax confirmed', status: taxOk && settings.approved.tax ? 'ok' : 'blocker', detail: taxOk ? (settings.approved.tax ? 'Rate set and approved.' : 'A rate is set but not yet approved by the owner.') : 'No rate is set. Checkout stays closed until the owner or their accountant confirms one.', link: '/admin/settings' });
  add({ id: 'refund_policy', group: 'Payments', title: 'Refund policy written', status: settings.refunds.policy_text ? 'ok' : 'blocker', detail: 'Customers need to see this before they pay.', link: '/admin/settings' });

  add({ id: 'email', group: 'Messages', title: 'Email provider connected', status: ctx.email.deliversForReal ? 'ok' : 'blocker', detail: ctx.email.deliversForReal ? `Sending through ${ctx.email.name}.` : 'Messages are recorded but not delivered.' });
  add({ id: 'sender', group: 'Messages', title: 'Verified business sender', status: env.EMAIL_FROM ? 'ok' : 'blocker', detail: env.EMAIL_FROM ? `Sending as ${env.EMAIL_FROM}. Confirm the domain is verified with the provider.` : 'Set EMAIL_FROM to an address on a domain the business owns.' });
  add({ id: 'sms', group: 'Messages', title: 'Text messages (optional)', status: ctx.sms.enabled ? 'ok' : 'optional', detail: ctx.sms.enabled ? 'Twilio is on.' : 'Off. The system runs on email alone. Enabling requires A2P 10DLC registration, which requires a privacy policy and terms page.' });

  const hours = await count('business_hours');
  add({ id: 'hours', group: 'Rules', title: 'Shop hours confirmed', status: hours === 7 ? 'ok' : 'blocker', detail: hours === 7 ? 'All seven days are set.' : 'Set hours for each day. Preparation time depends on them.', link: '/admin/settings' });
  add({ id: 'ordering_policy', group: 'Rules', title: 'Ordering rules approved', status: settings.approved.ordering ? 'ok' : 'blocker', detail: settings.approved.ordering ? 'Approved.' : 'Until approved, every order waits for manual review.', link: '/admin/settings' });
  add({ id: 'capacity', group: 'Rules', title: 'Daily capacity set', status: settings.ordering.daily_order_limit !== null || settings.ordering.daily_points_limit !== null ? 'ok' : 'blocker', detail: 'Without a limit, the system cannot tell when the shop is full.', link: '/admin/settings' });
  add({ id: 'delivery_policy', group: 'Rules', title: 'Delivery rules approved', status: settings.approved.delivery ? 'ok' : 'blocker', detail: settings.approved.delivery ? 'Approved.' : 'Until approved, delivery orders wait for manual review.', link: '/admin/settings' });
  const zones = await count('delivery_zones', (q) => q.where('active', '=', true));
  const windows = await count('delivery_windows', (q) => q.where('active', '=', true));
  add({ id: 'windows', group: 'Rules', title: 'Pickup and delivery times set', status: windows > 0 ? 'ok' : 'blocker', detail: windows > 0 ? `${windows} active windows, ${zones} delivery zones.` : 'With no windows, nothing can be ordered online.', link: '/admin/deliveries' });

  const staff = await sql<{ production: number; delivery: number; consultation: number; event_crew: number; scheduled: number }>`
    SELECT count(*) FILTER (WHERE 'production' = ANY(capabilities))::int AS production,
      count(*) FILTER (WHERE 'delivery' = ANY(capabilities))::int AS delivery,
      count(*) FILTER (WHERE 'consultation' = ANY(capabilities))::int AS consultation,
      count(*) FILTER (WHERE 'event_crew' = ANY(capabilities))::int AS event_crew,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM staff_availability a WHERE a.staff_id = s.id))::int AS scheduled
    FROM staff_profiles s WHERE active
  `.execute(db);
  const st = staff.rows[0];
  add({ id: 'staff', group: 'Team', title: 'Team and schedules entered', status: st.production > 0 && st.scheduled > 0 ? 'ok' : 'blocker', detail: `${st.production} production, ${st.delivery} delivery, ${st.consultation} consultation and ${st.event_crew} event staff. ${st.scheduled} with schedules.`, link: '/admin/team' });

  const products = await count('products', (q) => q.where('status', '=', 'active'));
  const demoProducts = await count('products', (q) => q.where('is_demo', '=', true).where('status', '=', 'active'));
  add({ id: 'catalog', group: 'Catalog', title: 'Real products published', status: products > 0 && demoProducts === 0 ? 'ok' : 'blocker', detail: demoProducts > 0 ? `${demoProducts} fictional demo products are still active. Remove them.` : products > 0 ? `${products} products are live.` : 'No products are published yet.', link: '/admin/products' });
  const noMethod = await count('products', (q) => q.where('status', '=', 'active').where('allow_pickup', '=', false).where('allow_delivery', '=', false).where('allow_shipping', '=', false));
  if (noMethod) add({ id: 'unbuyable', group: 'Catalog', title: 'Every product can be received', status: 'blocker', detail: `${noMethod} active products have no pickup, delivery or shipping option, so customers cannot buy them.`, link: '/admin/products' });
  const crews = await count('resources', (q) => q.where('kind', '=', 'crew').where('active', '=', true));
  const services = await count('wedding_services', (q) => q.where('active', '=', true).where('is_demo', '=', false));
  add({ id: 'events', group: 'Weddings', title: 'Services and crews set up', status: services > 0 && crews > 0 ? 'ok' : 'todo', detail: `${services} services and ${crews} crews. Inquiries still work without these, and go to manual review.`, link: '/admin/services' });
  add({ id: 'event_policy', group: 'Weddings', title: 'Booking and cancellation policies written', status: settings.events.cancellation_policy ? 'ok' : 'todo', detail: 'Shown with every quote. A lawyer should review the contract and cancellation wording.', link: '/admin/settings' });

  add({ id: 'privacy', group: 'Legal', title: 'Privacy policy published', status: settings.privacy.policy_text ? 'ok' : 'blocker', detail: 'Required before collecting customer data, and for Twilio registration.', link: '/admin/settings' });
  add({ id: 'terms', group: 'Legal', title: 'Terms published', status: settings.privacy.terms_text ? 'ok' : 'blocker', detail: 'Required before selling online.', link: '/admin/settings' });

  const beat = await db.selectFrom('worker_heartbeats').select('last_seen_at').where('last_seen_at', '>', addMinutes(ctx.clock.now(), -5)).limit(1).executeTakeFirst();
  add({ id: 'worker', group: 'System', title: 'Background worker running', status: beat || env.WORKER_EMBEDDED ? 'ok' : 'blocker', detail: beat ? 'Checked in within the last 5 minutes.' : 'Without it, no emails go out and holds never expire.' });
  add({ id: 'storage', group: 'System', title: 'File storage is durable', status: env.STORAGE_PROVIDER === 's3' ? 'ok' : env.isProduction ? 'todo' : 'optional', detail: env.STORAGE_PROVIDER === 's3' ? 'Using object storage.' : 'Using local disk. Make sure it is a persistent volume and is backed up.' });
  const backupCheck = await db.selectFrom('integration_settings').select('last_verified_at').where('provider', '=', 'backups').executeTakeFirst();
  const backupAge = backupCheck?.last_verified_at ? (ctx.clock.now().getTime() - backupCheck.last_verified_at.getTime()) / 86_400_000 : null;
  add({
    id: 'backups',
    group: 'System',
    title: 'Database backups tested',
    status: backupAge !== null && backupAge <= 90 ? 'ok' : env.isProduction ? 'blocker' : 'todo',
    detail: backupAge === null ? 'Confirm scheduled backups exist and that a restore has been tested, then record it here. See docs/operations.md.' : backupAge <= 90 ? `Restore test recorded on ${backupCheck?.last_verified_at?.toISOString().slice(0, 10)}. Repeat at least every 90 days.` : 'The last recorded restore test is more than 90 days old. Please test again.',
  });
  add({ id: 'launch', group: 'System', title: 'Site approved to go public', status: process.env.SITE_MODE === 'production' ? 'ok' : 'blocker', detail: process.env.SITE_MODE === 'production' ? 'The concept notice and noindex have been removed.' : 'The site is marked as an unlaunched concept and is hidden from search engines. Remove this only with the owner’s approval.' });
  add({ id: 'facebook', group: 'Marketing', title: 'Facebook videos (optional)', status: 'optional', detail: 'Paste public video links under Marketing. No Meta app or review is needed for this.', link: '/admin/marketing' });
  add({ id: 'calendar', group: 'Marketing', title: 'Google Calendar push (optional)', status: googleConfigured(env) ? 'ok' : 'optional', detail: googleConfigured(env) ? 'Pushing to Google Calendar, one way.' : 'Off. Staff can subscribe to the private calendar feed instead.' });

  const warnings: string[] = [...env.warnings];
  if (settings.general.shop_open && windows === 0) warnings.push('The shop is marked open, but there are no pickup or delivery times, so nothing can be purchased.');
  if (settings.ordering.same_day_enabled && !settings.ordering.same_day_cutoff) warnings.push('Same-day orders are on with no cutoff time. Orders could arrive right up to each window’s own cutoff.');
  if (noMethod) warnings.push(`${noMethod} active products cannot be purchased because they have no fulfilment option.`);

  return { checks, ready_for_live: !checks.some((c) => c.status === 'blocker'), warnings };
}
