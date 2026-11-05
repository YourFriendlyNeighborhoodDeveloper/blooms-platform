import type { AppContext } from '../context.js';
import { renderTemplate } from '../lib/template.js';
import { addMinutes } from '../lib/time.js';
import { loadSettings } from '../modules/settings/service.js';
import { buildVariables, queueNotification } from '../modules/notifications/service.js';

type RuleConfig = { template?: string; roles?: string[]; title?: string; description?: string; capability?: string; due_in_minutes?: number; priority?: string };

async function staffRecipients(ctx: AppContext, roles: string[]) {
  if (!roles.length) return [];
  return ctx.db
    .selectFrom('users')
    .innerJoin('user_roles', 'user_roles.user_id', 'users.id')
    .innerJoin('roles', 'roles.id', 'user_roles.role_id')
    .select(['users.id', 'users.email'])
    .distinct()
    .where('users.status', '=', 'active')
    .where('roles.code', 'in', roles)
    .execute();
}

/**
 * Runs the enabled rules for one event. Core business state already changed when the event was
 * written, so everything here is a follow-on action, and each one is safe to retry.
 */
export async function runEventRules(ctx: AppContext, eventId: string) {
  const event = await ctx.db.selectFrom('automation_events').selectAll().where('id', '=', eventId).executeTakeFirst();
  if (!event) return;
  const rules = await ctx.db
    .selectFrom('automation_rules')
    .select(['id', 'action', 'config'])
    .where('event_type', '=', event.type)
    .where('enabled', '=', true)
    .orderBy('sort_order')
    .execute();
  if (!rules.length) return;

  const settings = await loadSettings(ctx.db);
  const built = await buildVariables(ctx, settings, event);
  if (!built) return;
  const subject = { type: event.subject_type, id: event.subject_id };

  for (const rule of rules) {
    const config = (rule.config ?? {}) as RuleConfig;
    if (rule.action === 'notify_customer' && config.template) {
      if (!built.customer_id) continue;
      await queueNotification(ctx, settings, {
        template: config.template,
        audience: 'customer',
        dedupe: `event:${event.id}:rule:${rule.id}`,
        vars: built.vars,
        customerId: built.customer_id,
        subject,
      });
    } else if (rule.action === 'notify_staff' && config.template) {
      const recipients = await staffRecipients(ctx, settings.notifications.routes[config.template] ?? config.roles ?? ['owner', 'administrator']);
      for (const staff of recipients) {
        await queueNotification(ctx, settings, {
          template: config.template,
          audience: 'staff',
          dedupe: `event:${event.id}:rule:${rule.id}:user:${staff.id}`,
          vars: built.vars,
          staffUserId: staff.id,
          recipientEmail: staff.email,
          subject,
        });
      }
      if (settings.notifications.staff_inbox) {
        await queueNotification(ctx, settings, {
          template: config.template,
          audience: 'staff',
          dedupe: `event:${event.id}:rule:${rule.id}:inbox`,
          vars: built.vars,
          recipientEmail: settings.notifications.staff_inbox,
          subject,
        });
      }
    } else if (rule.action === 'create_task' && config.title) {
      await ctx.db
        .insertInto('staff_tasks')
        .values({
          title: renderTemplate(config.title, built.vars),
          description: config.description ? renderTemplate(config.description, built.vars) : null,
          required_capability: config.capability ?? null,
          priority: (config.priority as 'normal') ?? 'normal',
          due_at: config.due_in_minutes !== undefined ? addMinutes(ctx.clock.now(), config.due_in_minutes) : null,
          subject_type: event.subject_type,
          subject_id: event.subject_id,
          source_key: `event:${event.id}:rule:${rule.id}`,
        })
        .onConflict((oc) => oc.column('source_key').doNothing())
        .execute();
    }
  }
}
