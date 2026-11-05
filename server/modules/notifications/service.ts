import { DateTime } from 'luxon';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/client.js';
import { enqueue } from '../../automation/queue.js';
import { raiseAlert } from '../../automation/events.js';
import { escapeHtml, renderTemplate } from '../../lib/template.js';
import { PermanentSendError } from '../../integrations/email/provider.js';
import { SmsPermanentError } from '../../integrations/sms/provider.js';
import { loadSettings, type SettingsState } from '../settings/service.js';
import { buildVariables } from './vars.js';

const SAFE_URL = /(https?:\/\/[^\s<]+)/g;

/** Shown on every message tied to test data, so nobody mistakes a demonstration for a real order. */
export const TEST_MESSAGE_NOTE = 'TEST MESSAGE: sent by a demonstration or test system. No real order was placed and no money moved.';

export function renderEmailHtml(bodyText: string, businessName: string, opts: { test?: boolean } = {}): string {
  const escaped = escapeHtml(bodyText)
    .replace(SAFE_URL, (u) => `<a href="${u}" style="color:#8e5664">${u}</a>`)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<!doctype html><html><body style="margin:0;background:#f6f0e9;padding:24px;font-family:Georgia,'Times New Roman',serif;color:#342f2c;font-size:16px;line-height:1.55"><div style="max-width:560px;margin:0 auto;background:#fffdf9;border-radius:16px;padding:32px"><p style="margin:0 0 24px;font-size:20px">${escapeHtml(businessName)}</p>${opts.test ? `<p style="margin:0 0 24px;padding:12px 14px;border-radius:10px;background:#f3e3b8;font-family:Arial,sans-serif;font-size:14px;color:#342f2c"><strong>Test message.</strong> Sent by a demonstration or test system. No real order was placed and no money moved.</p>` : ''}${escaped}</div></body></html>`;
}

/** Newest consent record wins, so opting out after opting in is always respected. */
export async function hasConsent(db: Db, customerId: string, channel: 'email' | 'sms', purpose: 'transactional' | 'marketing'): Promise<{ granted: boolean; phone: string | null }> {
  const row = await db
    .selectFrom('customer_consents')
    .select(['granted', 'phone_e164'])
    .where('customer_id', '=', customerId)
    .where('channel', '=', channel)
    .where('purpose', '=', purpose)
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  return { granted: row?.granted ?? false, phone: row?.phone_e164 ?? null };
}

export const isSuppressed = async (db: Db, phone: string) =>
  Boolean(await db.selectFrom('sms_suppressions').select('phone_e164').where('phone_e164', '=', phone).executeTakeFirst());

/** The next moment outside quiet hours in the business timezone, or null if it is fine to send now. */
export function nextAllowedTime(now: Date, tz: string, quietStart: string, quietEnd: string): Date | null {
  const local = DateTime.fromJSDate(now, { zone: tz });
  const hhmm = local.toFormat('HH:mm');
  const inQuiet = quietStart <= quietEnd ? hhmm >= quietStart && hhmm < quietEnd : hhmm >= quietStart || hhmm < quietEnd;
  if (!inQuiet) return null;
  const [h, m] = quietEnd.split(':').map(Number);
  let at = local.set({ hour: h, minute: m, second: 0, millisecond: 0 });
  if (at <= local) at = at.plus({ days: 1 });
  return at.toJSDate();
}

type QueueInput = {
  template: string;
  audience: 'customer' | 'staff';
  dedupe: string;
  vars: Record<string, unknown>;
  customerId?: string | null;
  staffUserId?: string | null;
  recipientEmail?: string | null;
  subject?: { type: string | null; id: string | null } | null;
};

/**
 * Renders a message and queues delivery. Dedupe keys make this safe to call repeatedly: a retried
 * event produces no second email. A Twilio outage or an SMS opt-out never affects the email.
 */
export async function queueNotification(ctx: AppContext, settings: SettingsState, input: QueueInput) {
  const templates = await ctx.db.selectFrom('notification_templates').selectAll().where('code', '=', input.template).where('enabled', '=', true).execute();
  const email = templates.find((t) => t.channel === 'email');
  const sms = templates.find((t) => t.channel === 'sms');
  const isTest = !ctx.payments.livemode;

  if (email) {
    let recipient = input.recipientEmail ?? null;
    let status: 'queued' | 'suppressed' = 'queued';
    let reason: string | null = null;
    if (!recipient && input.customerId) {
      const c = await ctx.db.selectFrom('customers').select(['email', 'anonymized_at']).where('id', '=', input.customerId).executeTakeFirst();
      recipient = c?.anonymized_at ? null : (c?.email ?? null);
    }
    if (email.category === 'marketing' && input.customerId) {
      const consent = await hasConsent(ctx.db, input.customerId, 'email', 'marketing');
      if (!consent.granted) {
        status = 'suppressed';
        reason = 'No marketing consent';
      }
    }
    if (recipient) {
      const subject = renderTemplate(email.subject ?? '', input.vars);
      const body = renderTemplate(email.body, input.vars);
      const created = await ctx.db
        .insertInto('notifications')
        .values({
          template_code: input.template,
          channel: 'email',
          audience: input.audience,
          category: email.category,
          customer_id: input.customerId ?? null,
          staff_user_id: input.staffUserId ?? null,
          recipient,
          subject,
          body,
          status,
          status_reason: reason,
          dedupe_key: `${input.dedupe}:email`,
          subject_type: input.subject?.type ?? null,
          subject_id: input.subject?.id ?? null,
          is_test: isTest,
        })
        .onConflict((oc) => oc.column('dedupe_key').doNothing())
        .returning('id')
        .executeTakeFirst();
      if (created && status === 'queued') {
        await enqueue(ctx.db, { kind: 'notification.deliver', payload: { id: created.id }, dedupeKey: `deliver:${created.id}` });
      }
    }
  }

  // Text messages go only to a customer who opted in, whose number has not sent STOP, and only for
  // messages the owner turned on. If SMS is disabled this whole branch is skipped.
  if (sms && input.audience === 'customer' && input.customerId && ctx.sms.enabled && settings.sms.enabled_templates.includes(input.template)) {
    const purpose = sms.category === 'marketing' ? 'marketing' : 'transactional';
    const consent = await hasConsent(ctx.db, input.customerId, 'sms', purpose);
    const phone = consent.phone;
    if (consent.granted && phone) {
      const suppressed = await isSuppressed(ctx.db, phone);
      const body = renderTemplate(sms.body, input.vars);
      const after = nextAllowedTime(ctx.clock.now(), settings.general.timezone, settings.notifications.quiet_start, settings.notifications.quiet_end);
      const created = await ctx.db
        .insertInto('notifications')
        .values({
          template_code: input.template,
          channel: 'sms',
          audience: 'customer',
          category: sms.category,
          customer_id: input.customerId,
          recipient: phone,
          body,
          status: suppressed ? 'suppressed' : after ? 'deferred' : 'queued',
          status_reason: suppressed ? 'Recipient opted out' : after ? 'Waiting for quiet hours to end' : null,
          send_after: after,
          dedupe_key: `${input.dedupe}:sms`,
          subject_type: input.subject?.type ?? null,
          subject_id: input.subject?.id ?? null,
          is_test: isTest,
        })
        .onConflict((oc) => oc.column('dedupe_key').doNothing())
        .returning('id')
        .executeTakeFirst();
      if (created && !suppressed) {
        await enqueue(ctx.db, { kind: 'notification.deliver', payload: { id: created.id }, runAt: after ?? undefined, dedupeKey: `deliver:${created.id}` });
      }
    }
  }
}

export type DeliverOutcome = 'sent' | 'skipped' | 'suppressed' | 'gone';

/** One delivery attempt. Throws on a temporary failure so the queue retries with backoff. */
export async function deliverNotification(ctx: AppContext, id: string, attempt: number): Promise<DeliverOutcome> {
  const n = await ctx.db.selectFrom('notifications').selectAll().where('id', '=', id).executeTakeFirst();
  if (!n) return 'gone';
  if (['sent', 'delivered', 'suppressed', 'skipped'].includes(n.status)) return 'sent';
  const settings = await loadSettings(ctx.db);
  const log = async (provider: string, status: string, fields: { provider_message_id?: string | null; error_code?: string | null; error_message?: string | null } = {}) =>
    ctx.db.insertInto('notification_deliveries').values({ notification_id: id, provider, status, attempt, ...fields }).execute();

  try {
    if (n.channel === 'email') {
      const result = await ctx.email.send({
        to: n.recipient,
        subject: n.is_test ? `[Test] ${n.subject ?? ''}` : (n.subject ?? ''),
        text: n.is_test ? `${TEST_MESSAGE_NOTE}\n\n${n.body}` : n.body,
        html: renderEmailHtml(n.body, settings.contact.business_name, { test: n.is_test }),
        reply_to: settings.contact.public_email,
        from_name: settings.notifications.from_name,
        idempotency_key: n.dedupe_key,
      });
      await log(result.provider, result.status, { provider_message_id: result.message_id, error_message: result.reason ?? null });
      await markResult(ctx, n, result.status, result.reason ?? null);
      return result.status;
    }
    // A STOP may have arrived while this text was waiting.
    if (await isSuppressed(ctx.db, n.recipient)) {
      await ctx.db.updateTable('notifications').set({ status: 'suppressed', status_reason: 'Recipient opted out' }).where('id', '=', id).execute();
      return 'suppressed';
    }
    const result = await ctx.sms.send({ to: n.recipient, body: n.is_test ? `[Test] ${n.body}` : n.body, status_callback: `${ctx.env.PUBLIC_BASE_URL}/api/webhooks/twilio/status` });
    await log(result.provider, result.status, { provider_message_id: result.message_id, error_message: result.reason ?? null });
    await markResult(ctx, n, result.status, result.reason ?? null);
    return result.status;
  } catch (err) {
    const permanent = err instanceof PermanentSendError || err instanceof SmsPermanentError;
    await log(n.channel === 'email' ? ctx.email.name : ctx.sms.name, 'failed', {
      error_code: err instanceof SmsPermanentError ? String(err.code) : null,
      error_message: (err as Error).message.slice(0, 500),
    });
    if (err instanceof SmsPermanentError && err.code === 21610) {
      await ctx.db.insertInto('sms_suppressions').values({ phone_e164: n.recipient, reason: 'carrier' }).onConflict((oc) => oc.column('phone_e164').doNothing()).execute();
    }
    if (permanent) {
      await ctx.db.updateTable('notifications').set({ status: 'failed', status_reason: (err as Error).message.slice(0, 500) }).where('id', '=', id).execute();
      await raiseAlert(ctx.db, {
        code: 'notification_failed',
        title: `A ${n.channel} message could not be delivered`,
        detail: `${n.template_code}: ${(err as Error).message.slice(0, 300)}`,
        subject: n.customer_id ? { type: 'customer', id: n.customer_id } : null,
        dedupeKey: `notification-failed:${id}`,
      });
      return 'skipped';
    }
    throw err;
  }
}

async function markResult(ctx: AppContext, n: { id: string; customer_id: string | null; channel: string; subject: string | null; body: string; subject_type: string | null; subject_id: string | null; audience: string }, status: 'sent' | 'skipped', reason: string | null) {
  await ctx.db.updateTable('notifications').set({ status, status_reason: reason, sent_at: status === 'sent' ? ctx.clock.now() : null }).where('id', '=', n.id).execute();
  if (status === 'sent' && n.customer_id && n.audience === 'customer') {
    await ctx.db
      .insertInto('customer_communications')
      .values({
        customer_id: n.customer_id,
        direction: 'outbound',
        channel: n.channel === 'sms' ? 'sms' : 'email',
        subject: n.subject,
        body: n.body,
        notification_id: n.id,
        subject_type: n.subject_type,
        subject_id: n.subject_id,
      })
      .execute();
  }
}

/** Sends a message built outside the event system: sign-in links, invitations, test sends. */
export async function sendDirect(ctx: AppContext, input: { template: string; to: string; vars: Record<string, unknown>; dedupe: string; customerId?: string | null; staffUserId?: string | null; audience?: 'customer' | 'staff' }) {
  const settings = await loadSettings(ctx.db);
  const contact = settings.contact;
  const vars = {
    business: { name: contact.business_name, phone: contact.phone_e164 ? contact.phone_e164.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3') : '', address: contact.address_line ?? '', email: contact.public_email ?? '' },
    ...input.vars,
  };
  await queueNotification(ctx, settings, {
    template: input.template,
    audience: input.audience ?? 'customer',
    dedupe: input.dedupe,
    vars,
    customerId: input.customerId ?? null,
    staffUserId: input.staffUserId ?? null,
    recipientEmail: input.to,
  });
}

export { buildVariables };
