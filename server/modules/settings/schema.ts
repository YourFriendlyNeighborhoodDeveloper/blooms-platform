import { z } from 'zod';
import { business } from '../../../src/data/business.ts';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time such as 14:30');
const cents = z.number().int().min(0);
const count = z.number().int().min(0);

/**
 * Business rules the owner controls. Every default is deliberately cautious, because none of these
 * numbers has been confirmed by the business yet: same-day is off, nothing has a capacity, and
 * unapproved groups send every order to manual review instead of committing the shop.
 */
export const settingsSchemas = {
  general: z.object({
    timezone: z.string().default('America/Detroit'),
    guest_checkout_enabled: z.boolean().default(true),
    shop_open: z.boolean().default(false),
    notice_banner: z.string().max(300).nullable().default(null),
  }),
  contact: z.object({
    business_name: z.string().min(1).default(business.name),
    phone_e164: z.string().nullable().default(business.phone.e164),
    public_email: z.string().email().nullable().default(business.email),
    address_line: z.string().nullable().default(`${business.address.street}, ${business.address.city}, ${business.address.region} ${business.address.postalCode}`),
    facebook_url: z.string().url().nullable().default(business.profiles[0].href),
    hours_note: z.string().nullable().default(null),
  }),
  ordering: z.object({
    same_day_enabled: z.boolean().default(false),
    same_day_cutoff: hhmm.nullable().default(null),
    min_lead_hours: count.default(48),
    daily_order_limit: count.nullable().default(null),
    daily_points_limit: count.nullable().default(null),
    custom_requires_approval: z.boolean().default(true),
    out_of_stock_behavior: z.enum(['reject', 'review', 'backorder']).default('reject'),
    review_timing: z.enum(['approve_first', 'pay_first']).default('approve_first'),
    review_hold_hours: z.number().int().min(1).max(336).default(48),
    payment_hold_minutes: z.number().int().min(35).max(1440).default(35),
    complete_after_hours: count.default(24),
    slot_horizon_days: z.number().int().min(1).max(90).default(21),
    overdue_after_minutes: count.default(60),
  }),
  delivery: z.object({
    buffer_minutes: count.default(60),
    max_stops_per_driver_window: count.nullable().default(null),
    require_driver_on_duty: z.boolean().default(true),
    proof_of_delivery_required: z.boolean().default(false),
    shipping_enabled: z.boolean().default(false),
    shipping_flat_cents: cents.nullable().default(null),
    shipping_free_over_cents: cents.nullable().default(null),
    shipping_allowed_states: z.array(z.string().length(2)).default([]),
    public_policy: z.string().max(2000).nullable().default(null),
  }),
  events: z.object({
    min_notice_days: count.default(90),
    max_events_per_day: count.nullable().default(null),
    default_event_hours: z.number().int().min(1).max(24).default(6),
    default_start_time: hhmm.default('15:00'),
    setup_minutes: count.default(180),
    teardown_minutes: count.default(120),
    travel_minutes: count.default(60),
    buffer_minutes: count.default(30),
    prep_days: count.default(2),
    crews_per_event: count.default(1),
    staff_per_crew: count.nullable().default(null),
    points_per_prep_day: count.nullable().default(null),
    deposit_percent: z.number().int().min(0).max(100).nullable().default(null),
    balance_due_days_before: count.default(14),
    quote_valid_days: z.number().int().min(1).max(180).default(14),
    hold_days_after_acceptance: z.number().int().min(1).max(60).default(7),
    follow_up_hours: z.number().int().min(1).max(720).default(48),
    reminder_days_before: z.array(count).default([30, 7, 1]),
    requires_contract: z.boolean().default(false),
    cancellation_policy: z.string().max(4000).nullable().default(null),
    alternatives_to_offer: z.number().int().min(0).max(10).default(4),
    event_types: z.array(z.string()).default(['Wedding', 'Engagement', 'Rehearsal dinner', 'Shower', 'Graduation party', 'Birthday', 'Anniversary', 'Another celebration']),
    budget_ranges: z.array(z.string()).default(['Under $1,000', '$1,000 – $2,500', '$2,500 – $5,000', '$5,000 – $10,000', '$10,000+', 'Not sure yet']),
    style_options: z.array(z.string()).default(['Garden', 'Romantic', 'Modern', 'Rustic', 'Boho', 'Classic', 'Whimsical']),
  }),
  consultations: z.object({
    enabled: z.boolean().default(true),
    duration_minutes: z.number().int().min(10).max(480).default(45),
    buffer_minutes: count.default(15),
    min_notice_hours: count.default(48),
    horizon_days: z.number().int().min(1).max(180).default(45),
    step_minutes: z.number().int().min(5).max(120).default(30),
    formats: z.array(z.string().min(1)).default(['In the shop', 'Phone call', 'Video call']),
    reminder_hours_before: count.default(24),
  }),
  tax: z.object({
    label: z.string().default('Sales tax'),
    // Basis points per tax category: 600 = 6%. Null means not configured; checkout stays closed.
    rates_bps: z.record(z.string(), z.number().int().min(0).max(3000)).default({}),
    delivery_taxable: z.boolean().default(false),
    shipping_taxable: z.boolean().default(false),
    notes: z.string().nullable().default(null),
  }),
  refunds: z.object({
    policy_text: z.string().max(4000).nullable().default(null),
    staff_limit_cents: cents.nullable().default(null),
  }),
  notifications: z.object({
    from_name: z.string().default(business.name),
    staff_inbox: z.string().email().nullable().default(null),
    quiet_start: hhmm.default('20:00'),
    quiet_end: hhmm.default('09:00'),
    routes: z.record(z.string(), z.array(z.string())).default({}),
  }),
  sms: z.object({
    enabled_templates: z.array(z.string()).default([]),
    sender_label: z.string().max(40).default('Blooms Boutique & Floral'),
    help_reply: z.string().max(320).default(`${business.name}: for help call ${business.phone.display}. Msg & data rates may apply. Reply STOP to opt out.`),
    stop_reply: z.string().max(320).default(`${business.name}: you are unsubscribed and will receive no more texts. Reply START to re-subscribe.`),
    start_reply: z.string().max(320).default(`${business.name}: you are re-subscribed to text updates. Reply HELP for help, STOP to opt out.`),
    consent_text_transactional: z
      .string()
      .default(`Text me updates about this order or appointment from ${business.name}. Message frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to cancel. Consent is not a condition of purchase.`),
    consent_text_marketing: z
      .string()
      .default(`Send me promotional texts from ${business.name}. Message frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to cancel. Consent is not a condition of purchase.`),
  }),
  followups: z.object({
    enabled: z.boolean().default(false),
    days_after_fulfillment: z.number().int().min(1).max(365).default(7),
    abandoned_cart_enabled: z.boolean().default(false),
    abandoned_cart_hours: z.number().int().min(1).max(168).default(4),
  }),
  concierge: z.object({
    // Off until the owner turns each channel on and sets a monthly budget.
    chat_enabled: z.boolean().default(false),
    voice_enabled: z.boolean().default(false),
    assistant_name: z.string().trim().min(1).max(40).default('Flora'),
    assistant_title: z.string().trim().max(80).default(`${business.shortName}' AI Concierge`),
    chat_greeting: z
      .string()
      .max(500)
      .default(`Hi! I'm Flora, the virtual assistant at ${business.name}. I'm an automated assistant, not a member of the team. I can help you find flowers, plan a wedding or event, or check on an order.`),
    voice_greeting: z
      .string()
      .max(500)
      .default(`Hi, thanks for calling ${business.name}. I'm Flora, the shop's automated assistant. This call is transcribed so the team can follow up. How can I help?`),
    // demo: fictional sandbox records, no access to real customers. customer: the real business.
    chat_mode: z.enum(['demo', 'customer']).default('demo'),
    voice_mode: z.enum(['demo', 'customer']).default('demo'),
    chat_model: z.string().trim().min(1).max(80).default('gpt-5.4-mini'),
    voice_model: z.string().trim().min(1).max(80).default('gpt-realtime-2.1'),
    voice: z.string().trim().min(1).max(40).default('marin'),
    transcription_model: z.string().trim().min(1).max(80).default('gpt-4o-transcribe'),
    // Estimated provider spend per calendar month, in cents. Zero keeps Flora off.
    monthly_budget_cents: cents.default(0),
    max_call_minutes: z.number().int().min(1).max(30).default(8),
    max_calls_per_number_per_day: z.number().int().min(1).max(50).default(3),
    max_concurrent_calls: z.number().int().min(1).max(10).default(2),
    max_messages_per_chat: z.number().int().min(4).max(200).default(40),
    max_chats_per_visitor_per_hour: z.number().int().min(1).max(100).default(6),
    texts_per_conversation: z.number().int().min(0).max(3).default(1),
    store_transcripts: z.boolean().default(true),
    transcript_retention_days: z.number().int().min(1).max(730).default(90),
    // Which team roles hear about each kind of request. Only requests that need a person are sent.
    routing: z.record(z.string(), z.array(z.string())).default({ wedding: ['sales'], order: ['administrator'], delivery: ['administrator'], general: ['administrator'], complaint: ['owner'] }),
    escalate_urgent_minutes: z.number().int().min(5).max(1440).default(30),
    escalate_high_minutes: z.number().int().min(5).max(2880).default(120),
    escalation_roles: z.array(z.string()).default(['owner']),
  }),
  privacy: z.object({
    policy_text: z.string().max(20_000).nullable().default(null),
    terms_text: z.string().max(20_000).nullable().default(null),
    retain_abandoned_cart_days: z.number().int().min(1).max(365).default(30),
    retain_draft_upload_days: z.number().int().min(1).max(90).default(7),
    retain_notification_body_days: z.number().int().min(30).max(3650).default(730),
  }),
} as const;

export type SettingsGroup = keyof typeof settingsSchemas;
export type Settings = { [K in SettingsGroup]: z.output<(typeof settingsSchemas)[K]> };
export const SETTINGS_GROUPS = Object.keys(settingsSchemas) as SettingsGroup[];

/** Groups the owner must explicitly confirm before orders can be accepted automatically. */
export const POLICY_GROUPS: SettingsGroup[] = ['ordering', 'delivery', 'tax', 'refunds'];

export function defaultsFor<K extends SettingsGroup>(group: K): Settings[K] {
  return settingsSchemas[group].parse({}) as Settings[K];
}
