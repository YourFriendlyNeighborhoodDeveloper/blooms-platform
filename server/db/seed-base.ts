import type { Db } from './client.js';
import { PERMISSIONS, SYSTEM_ROLES } from '../auth/permissions.js';
import { DEFAULT_RULES, staffRolesFor, TEMPLATES } from '../modules/notifications/catalog.js';
import { SETTINGS_GROUPS, defaultsFor } from '../modules/settings/schema.js';

const DIVISIONS = [
  { code: 'floral', name: 'Floral', description: 'Arrangements, bouquets and occasion flowers', sort_order: 1 },
  { code: 'boutique', name: 'Boutique', description: 'Clothing, gifts and home décor', sort_order: 2 },
  { code: 'events', name: 'Weddings & Events', description: 'Wedding florals, event décor and rentals', sort_order: 3 },
];

const STAGES = [
  ['new_inquiry', 'New inquiry', 'open'],
  ['consultation_scheduled', 'Consultation scheduled', 'open'],
  ['planning', 'Planning', 'open'],
  ['quote_sent', 'Quote sent', 'open'],
  ['awaiting_deposit', 'Awaiting deposit', 'open'],
  ['confirmed', 'Confirmed', 'won'],
  ['in_preparation', 'In preparation', 'won'],
  ['event_scheduled', 'Event scheduled', 'won'],
  ['completed', 'Completed', 'won'],
  ['closed', 'Closed', 'lost'],
] as const;

const SERVICE_CATEGORIES = [
  ['bridal-party', 'Bridal party flowers'],
  ['ceremony', 'Ceremony'],
  ['reception', 'Reception'],
  ['installations', 'Installations & arches'],
  ['logistics', 'Delivery, setup & teardown'],
] as const;

const PROJECT_TASKS = [
  ['project.review_details', 'Review the plan and confirm details with the customer', -60, null, true, 'Final design review'],
  ['project.order_materials', 'Order flowers and materials', -21, 'production', false, null],
  ['project.confirm_timeline', 'Confirm day-of timeline and venue access', -14, 'event_crew', true, 'Timeline confirmed'],
  ['project.final_count', 'Confirm final counts', -14, null, true, 'Final counts due'],
  ['project.check_rentals', 'Check, clean and pack rental items', -3, 'event_crew', false, null],
  ['project.prepare_flowers', 'Process flowers and build arrangements', -2, 'production', false, null],
  ['project.load_out', 'Load vehicles and confirm crew', -1, 'event_crew', false, null],
  ['project.setup', 'Deliver and set up', 0, 'event_crew', false, null],
  ['project.teardown', 'Tear down and collect rentals', 0, 'event_crew', false, null],
  ['project.return_rentals', 'Inspect and put away returned rentals', 1, 'event_crew', false, null],
] as const;

/**
 * Idempotent structural seed, safe on every deploy. It creates what the software needs to run and
 * none of what only the business can decide: no products, prices, zones, staff or approvals.
 * ON CONFLICT DO NOTHING means owner edits are never overwritten.
 */
export async function seedBase(db: Db) {
  for (const d of DIVISIONS) {
    await db.insertInto('business_divisions').values(d).onConflict((oc) => oc.column('code').doNothing()).execute();
  }
  for (const [code, [category, description]] of Object.entries(PERMISSIONS)) {
    await db
      .insertInto('permissions')
      .values({ code, category, description })
      .onConflict((oc) => oc.column('code').doUpdateSet({ category, description }))
      .execute();
  }
  for (const role of SYSTEM_ROLES) {
    const existing = await db.selectFrom('roles').select('id').where('code', '=', role.code).executeTakeFirst();
    if (!existing) {
      const created = await db
        .insertInto('roles')
        .values({ code: role.code, name: role.name, description: role.description, system: true })
        .returning('id')
        .executeTakeFirstOrThrow();
      await db
        .insertInto('role_permissions')
        .values(role.permissions.map((permission_code) => ({ role_id: created.id, permission_code })))
        .execute();
    } else if (role.code === 'owner') {
      // The owner always holds every permission, including ones added by later releases.
      await db
        .insertInto('role_permissions')
        .values(role.permissions.map((permission_code) => ({ role_id: existing.id, permission_code })))
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
  }
  for (const group of SETTINGS_GROUPS) {
    await db
      .insertInto('business_settings')
      .values({ key: group, value: JSON.stringify(defaultsFor(group)) })
      .onConflict((oc) => oc.column('key').doNothing())
      .execute();
  }
  for (const [i, [code, name, kind]] of STAGES.entries()) {
    await db
      .insertInto('pipeline_stages')
      .values({ code, name, kind, sort_order: i, system: true })
      .onConflict((oc) => oc.column('code').doNothing())
      .execute();
  }
  const events = await db.selectFrom('business_divisions').select('id').where('code', '=', 'events').executeTakeFirst();
  for (const [i, [slug, name]] of SERVICE_CATEGORIES.entries()) {
    await db
      .insertInto('service_categories')
      .values({ slug, name, division_id: events?.id ?? null, sort_order: i })
      .onConflict((oc) => oc.column('slug').doNothing())
      .execute();
  }
  for (const t of TEMPLATES) {
    await db
      .insertInto('notification_templates')
      .values({
        code: t.code,
        channel: 'email',
        audience: t.audience,
        category: t.category ?? 'transactional',
        name: t.name,
        subject: t.subject,
        body: t.body,
      })
      .onConflict((oc) => oc.columns(['code', 'channel']).doNothing())
      .execute();
    if (t.sms) {
      await db
        .insertInto('notification_templates')
        .values({ code: t.code, channel: 'sms', audience: t.audience, category: t.category ?? 'transactional', name: `${t.name} (text)`, body: t.sms })
        .onConflict((oc) => oc.columns(['code', 'channel']).doNothing())
        .execute();
    }
  }
  for (const [i, r] of DEFAULT_RULES.entries()) {
    const marketing = TEMPLATES.find((t) => t.code === r.template)?.category === 'marketing';
    await db
      .insertInto('automation_rules')
      .values({
        event_type: r.event,
        action: r.action,
        config: JSON.stringify({ template: r.template, ...(r.action === 'notify_staff' ? { roles: r.roles ?? staffRolesFor(r.template) } : {}) }),
        system: true,
        enabled: !marketing,
        sort_order: i,
        source_key: `${r.event}:${r.action}:${r.template}`,
      })
      .onConflict((oc) => oc.column('source_key').doNothing())
      .execute();
  }
  for (const [i, [code, title, offset, capability, milestone, milestoneTitle]] of PROJECT_TASKS.entries()) {
    await db
      .insertInto('task_templates')
      .values({
        scope: 'wedding_project',
        code,
        title,
        description: milestone ? milestoneTitle : null,
        offset_days: offset,
        required_capability: capability,
        customer_visible_milestone: milestone,
        sort_order: i,
      })
      .onConflict((oc) => oc.column('code').doNothing())
      .execute();
  }
  await db
    .insertInto('inventory_locations')
    .values({ name: 'Shop', is_default: true })
    .onConflict((oc) => oc.column('name').doNothing())
    .execute();
  for (const provider of ['stripe', 'email', 'twilio', 'facebook', 'google_calendar']) {
    await db.insertInto('integration_settings').values({ provider }).onConflict((oc) => oc.column('provider').doNothing()).execute();
  }
}
