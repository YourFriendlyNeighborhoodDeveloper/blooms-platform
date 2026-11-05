import type { AppContext } from '../../context.js';
import { audit } from '../../lib/audit.js';
import { toE164 } from '../../lib/phone.js';
import { raiseAlert } from '../../automation/events.js';
import { PERMANENT_TWILIO_ERRORS } from '../../integrations/sms/provider.js';
import { getSetting } from '../settings/service.js';

// Twilio's default long-code keyword lists. Twilio also blocks at its own edge; this keeps our records in step.
const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT']);
const START_WORDS = new Set(['START', 'YES', 'UNSTOP']);
const HELP_WORDS = new Set(['HELP', 'INFO']);

/** Handles replies to our number. STOP takes effect for every customer who shares that phone. Returns text to reply with, or null. */
export async function handleInboundSms(ctx: AppContext, params: Record<string, string>): Promise<string | null> {
  const phone = toE164(params.From) ?? params.From;
  const body = (params.Body ?? '').trim();
  const keyword = body.split(/\s+/)[0]?.toUpperCase() ?? '';
  const settings = await getSetting(ctx.db, 'sms');
  const customers = await ctx.db.selectFrom('customers').select('id').where('phone_e164', '=', phone).execute();

  if (STOP_WORDS.has(keyword)) {
    await ctx.db
      .insertInto('sms_suppressions')
      .values({ phone_e164: phone, reason: 'stop', keyword })
      .onConflict((oc) => oc.column('phone_e164').doUpdateSet({ reason: 'stop', keyword }))
      .execute();
    for (const c of customers) {
      for (const purpose of ['transactional', 'marketing'] as const) {
        await ctx.db.insertInto('customer_consents').values({ customer_id: c.id, channel: 'sms', purpose, granted: false, source: `sms_keyword:${keyword}`, phone_e164: phone }).execute();
      }
    }
    await audit(ctx.db, { type: 'webhook', label: 'twilio' }, 'sms.opt_out', null, { keyword });
    await ctx.db.updateTable('notifications').set({ status: 'suppressed', status_reason: 'Recipient opted out' }).where('recipient', '=', phone).where('channel', '=', 'sms').where('status', 'in', ['queued', 'deferred']).execute();
    return settings.stop_reply;
  }
  if (START_WORDS.has(keyword)) {
    // Lifts the block only. Consent stays off until the customer opts in again on the site.
    await ctx.db.deleteFrom('sms_suppressions').where('phone_e164', '=', phone).execute();
    await audit(ctx.db, { type: 'webhook', label: 'twilio' }, 'sms.opt_in_keyword', null, { keyword });
    return settings.start_reply;
  }
  if (HELP_WORDS.has(keyword)) return settings.help_reply;

  for (const c of customers) {
    await ctx.db.insertInto('customer_communications').values({ customer_id: c.id, direction: 'inbound', channel: 'sms', body: body.slice(0, 1600) }).execute();
  }
  return null;
}

/** Delivery callbacks from Twilio. Statuses can arrive out of order, so "delivered" is never downgraded. */
export async function handleSmsStatus(ctx: AppContext, params: Record<string, string>) {
  const sid = params.MessageSid;
  const status = params.MessageStatus;
  if (!sid || !status) return;
  const delivery = await ctx.db.selectFrom('notification_deliveries').select(['id', 'notification_id']).where('provider', '=', 'twilio').where('provider_message_id', '=', sid).executeTakeFirst();
  if (!delivery) return;
  const code = params.ErrorCode ? Number(params.ErrorCode) : null;
  await ctx.db.updateTable('notification_deliveries').set({ status, error_code: code ? String(code) : null }).where('id', '=', delivery.id).execute();
  const current = await ctx.db.selectFrom('notifications').select(['status', 'recipient', 'template_code']).where('id', '=', delivery.notification_id).executeTakeFirstOrThrow();
  if (status === 'delivered') {
    await ctx.db.updateTable('notifications').set({ status: 'delivered', delivered_at: ctx.clock.now() }).where('id', '=', delivery.notification_id).execute();
  } else if ((status === 'failed' || status === 'undelivered') && current.status !== 'delivered') {
    await ctx.db.updateTable('notifications').set({ status: 'failed', status_reason: `Carrier reported ${status}${code ? ` (${code})` : ''}` }).where('id', '=', delivery.notification_id).execute();
    if (code === 21610 || code === 30006 || code === 30003) {
      await ctx.db.insertInto('sms_suppressions').values({ phone_e164: current.recipient, reason: 'carrier' }).onConflict((oc) => oc.column('phone_e164').doNothing()).execute();
    }
    if (code && PERMANENT_TWILIO_ERRORS.has(code)) {
      await raiseAlert(ctx.db, { code: 'sms_undeliverable', title: 'A text message could not be delivered', detail: `${current.template_code}, carrier code ${code}`, dedupeKey: `sms-undeliverable:${delivery.notification_id}` });
    }
  }
}
