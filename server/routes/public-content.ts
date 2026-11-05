import { Hono } from 'hono';
import type { AppEnv } from '../http/types.js';
import { loadSettings } from '../modules/settings/service.js';
import { formatPhone } from '../lib/phone.js';

export const publicContentRoutes = new Hono<AppEnv>();

publicContentRoutes.get('/videos', async (c) => {
  const ctx = c.get('ctx');
  const rows = await ctx.db.selectFrom('facebook_videos').select(['id', 'url', 'title', 'caption', 'kind', 'featured', 'cta_label', 'cta_url']).where('enabled', '=', true).orderBy('featured', 'desc').orderBy('sort_order').orderBy('created_at', 'desc').limit(30).execute();
  const settings = await loadSettings(ctx.db);
  return c.json({ videos: rows, facebook_url: settings.contact.facebook_url });
});

publicContentRoutes.get('/content/:slot', async (c) => {
  const ctx = c.get('ctx');
  const now = ctx.clock.now();
  const rows = await ctx.db
    .selectFrom('content_blocks')
    .select(['id', 'title', 'body', 'image_url', 'link_label', 'link_url'])
    .where('slot', '=', c.req.param('slot'))
    .where('active', '=', true)
    .where((eb) => eb.or([eb('starts_at', 'is', null), eb('starts_at', '<=', now)]))
    .where((eb) => eb.or([eb('ends_at', 'is', null), eb('ends_at', '>', now)]))
    .orderBy('sort_order')
    .limit(10)
    .execute();
  return c.json({ blocks: rows });
});

publicContentRoutes.get('/policies', async (c) => {
  const settings = await loadSettings(c.get('ctx').db);
  return c.json({ privacy: settings.privacy.policy_text, terms: settings.privacy.terms_text, refunds: settings.refunds.policy_text, cancellation: settings.events.cancellation_policy, contact: { name: settings.contact.business_name, email: settings.contact.public_email } });
});

/** What the site needs at startup. Shows whether the shop is open, and never exposes a secret. */
publicContentRoutes.get('/config', async (c) => {
  const ctx = c.get('ctx');
  const settings = await loadSettings(ctx.db);
  const products = await ctx.db.selectFrom('products').select('id').where('status', '=', 'active').limit(1).execute();
  const services = await ctx.db.selectFrom('wedding_services').select('id').where('active', '=', true).limit(1).execute();
  const hours = await ctx.db.selectFrom('business_hours').select(['weekday', 'opens_at', 'closes_at', 'closed']).where('division_id', 'is', null).orderBy('weekday').execute();
  const paymentsReady = ctx.payments.name !== 'disabled';
  return c.json({
    shop: {
      has_products: products.length > 0,
      accepting_orders: settings.general.shop_open && products.length > 0 && paymentsReady,
      payments: ctx.payments.name === 'disabled' ? 'disabled' : ctx.payments.livemode ? 'live' : 'test',
      guest_checkout: settings.general.guest_checkout_enabled,
      notice: settings.general.notice_banner,
    },
    planner: { has_services: services.length > 0, consultations: settings.consultations.enabled },
    contact: {
      business_name: settings.contact.business_name,
      phone: formatPhone(settings.contact.phone_e164),
      phone_e164: settings.contact.phone_e164,
      email: settings.contact.public_email,
      address: settings.contact.address_line,
      facebook_url: settings.contact.facebook_url,
      hours_note: settings.contact.hours_note,
    },
    hours: { rows: hours, confirmed: hours.length > 0 },
    sms_enabled: ctx.sms.enabled,
    timezone: settings.general.timezone,
  });
});
