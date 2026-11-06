import { sql } from 'kysely';
import type { AppContext } from '../../context.js';
import { audit, SYSTEM_ACTOR, type Actor } from '../../lib/audit.js';
import { formatPhone } from '../../lib/phone.js';
import { generateReference } from '../../lib/tokens.js';
import { addMinutes, formatDateTime } from '../../lib/time.js';
import { staffRecipients } from '../../automation/rules.js';
import { queueNotification } from '../notifications/service.js';
import { loadSettings, type SettingsState } from '../settings/service.js';
import type { Conversation } from './conversations.js';

export const TICKET_CATEGORIES = ['wedding', 'order', 'delivery', 'general', 'complaint'] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
export type Urgency = 'routine' | 'soon' | 'urgent';

const PRIORITY: Record<Urgency, 'normal' | 'high' | 'urgent'> = { routine: 'normal', soon: 'high', urgent: 'urgent' };
const PRIORITY_LABEL: Record<string, string> = { urgent: 'Urgent: ', high: 'Soon: ', normal: '', low: '' };

const ticketVars = (ctx: AppContext, settings: SettingsState, t: { id: string; reference: string; topic: string; name: string; email: string | null; phone_e164: string | null; message: string; priority: string; created_at: Date }) => ({
  ticket: {
    reference: t.reference,
    topic: t.topic,
    name: t.name,
    message: t.message,
    priority: t.priority,
    priority_label: PRIORITY_LABEL[t.priority] ?? '',
    contact: [t.phone_e164 ? formatPhone(t.phone_e164) : null, t.email].filter(Boolean).join(' · ') || 'none given',
    created_at: formatDateTime(t.created_at, settings.general.timezone),
    admin_url: `${ctx.env.PUBLIC_BASE_URL}/admin/messages?ticket=${t.id}`,
  },
  business: { name: settings.contact.business_name },
});

/**
 * A request that needs a person. It goes only to the roles the owner chose for its category, and
 * only urgent or time-sensitive requests escalate. Demonstration requests stay in the sandbox and
 * alert nobody.
 */
export async function createTicket(
  ctx: AppContext,
  conversation: Conversation,
  input: { category: TicketCategory; urgency: Urgency; topic: string; message: string; name: string; email: string | null; phone: string | null; orderId?: string | null },
) {
  const settings = await loadSettings(ctx.db);
  const c = settings.concierge;
  const priority = PRIORITY[input.urgency];
  const sandbox = conversation.mode === 'demo';
  const now = ctx.clock.now();
  const dueAt = priority === 'urgent' ? addMinutes(now, c.escalate_urgent_minutes) : priority === 'high' ? addMinutes(now, c.escalate_high_minutes) : null;
  const row = await ctx.db
    .insertInto('support_requests')
    .values({
      reference: generateReference('REQ'),
      topic: input.topic.slice(0, 40),
      name: input.name.slice(0, 120),
      email: input.email,
      phone_e164: input.phone,
      message: input.message.slice(0, 2000),
      order_id: input.orderId ?? null,
      source: `flora_${conversation.channel}`,
      priority,
      category: input.category,
      conversation_id: conversation.id,
      due_at: dueAt,
      sandbox,
    })
    .returning(['id', 'reference', 'topic', 'name', 'email', 'phone_e164', 'message', 'priority', 'created_at'])
    .executeTakeFirstOrThrow();
  await audit(ctx.db, { type: 'system', label: `flora:${conversation.reference}` }, 'concierge.ticket', { type: 'support', id: row.id }, { category: input.category, priority, sandbox });

  let routedTo: string[] = [];
  if (!sandbox) {
    routedTo = [...new Set([...(c.routing[input.category] ?? c.routing.general ?? ['administrator']), ...(priority === 'urgent' ? c.escalation_roles : [])])];
    const recipients = await staffRecipients(ctx, routedTo);
    const vars = ticketVars(ctx, settings, row);
    for (const staff of recipients) {
      await queueNotification(ctx, settings, { template: 'staff_concierge_ticket', audience: 'staff', dedupe: `ticket:${row.id}:user:${staff.id}`, vars, staffUserId: staff.id, recipientEmail: staff.email, subject: { type: 'support', id: row.id } });
    }
  }
  return { reference: row.reference, priority, sandbox, routed_to_roles: routedTo };
}

export async function acknowledgeTicket(ctx: AppContext, id: string, actor: Actor) {
  const res = await ctx.db
    .updateTable('support_requests')
    .set({ acknowledged_at: sql`coalesce(acknowledged_at, now())`, acknowledged_by: sql`coalesce(acknowledged_by, ${actor.id ?? null}::uuid)`, status: sql`CASE WHEN status = 'new' THEN 'open' ELSE status END`, updated_at: sql`now()` })
    .where('id', '=', id)
    .executeTakeFirst();
  if (Number(res.numUpdatedRows)) await audit(ctx.db, actor, 'support.acknowledge', { type: 'support', id });
  return Number(res.numUpdatedRows) === 1;
}

/** Urgent and time-sensitive requests nobody has acknowledged go to the escalation roles, once. */
export async function escalateOverdueTickets(ctx: AppContext) {
  const settings = await loadSettings(ctx.db);
  const overdue = await ctx.db
    .selectFrom('support_requests')
    .select(['id', 'reference', 'topic', 'name', 'email', 'phone_e164', 'message', 'priority', 'created_at'])
    .where('status', '<>', 'closed')
    .where('acknowledged_at', 'is', null)
    .where('escalated_at', 'is', null)
    .where('sandbox', '=', false)
    .where('due_at', '<=', ctx.clock.now())
    .limit(50)
    .execute();
  for (const t of overdue) {
    const claimed = await ctx.db.updateTable('support_requests').set({ escalated_at: sql`now()`, updated_at: sql`now()` }).where('id', '=', t.id).where('escalated_at', 'is', null).executeTakeFirst();
    if (Number(claimed.numUpdatedRows) !== 1) continue;
    const recipients = await staffRecipients(ctx, settings.concierge.escalation_roles);
    const vars = ticketVars(ctx, settings, t);
    for (const staff of recipients) {
      await queueNotification(ctx, settings, { template: 'staff_concierge_escalation', audience: 'staff', dedupe: `ticket-escalation:${t.id}:user:${staff.id}`, vars, staffUserId: staff.id, recipientEmail: staff.email, subject: { type: 'support', id: t.id } });
    }
    await audit(ctx.db, SYSTEM_ACTOR, 'support.escalate', { type: 'support', id: t.id }, { priority: t.priority });
  }
  return overdue.length;
}
