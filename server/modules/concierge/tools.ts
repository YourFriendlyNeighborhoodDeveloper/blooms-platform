import { sql } from 'kysely';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { AppError } from '../../lib/errors.js';
import { formatCents } from '../../lib/money.js';
import { formatPhone, toE164 } from '../../lib/phone.js';
import { addDays, formatDate, formatDateTime, formatTimeRange, localDate } from '../../lib/time.js';
import { mintAccessToken } from '../../lib/tokens.js';
import { sendDirect } from '../notifications/service.js';
import type { SettingsState } from '../settings/service.js';
import { getProduct, listProducts } from '../catalog/public.js';
import { loadVariants } from '../cart/lines.js';
import { findZone, listSlots, loadPolicyContext, type DemandLine } from '../availability/engine.js';
import { plannerOptions, submitPlan } from '../weddings/planner.js';
import { checkEventAvailability } from '../weddings/availability.js';
import { consultationSlots } from '../weddings/consultations.js';
import { publicOrderView } from '../orders/views.js';
import type { ToolSpec } from '../../integrations/ai/provider.js';
import { appendMessage, addUsage, type Channel, type Conversation, type Mode } from './conversations.js';
import { businessFacts } from './prompt.js';
import { searchKnowledge } from './knowledge.js';
import { draftForConversation, draftLink, issueContinueCode, saveDraftDetails, draftPatchSchema } from './drafts.js';
import { createTicket, TICKET_CATEGORIES } from './tickets.js';
import { confirmIdentityCode, hasPendingCheck, hasVerifiedOrder, startIdentityCheck, verifiedOrder } from './verification.js';

/** Something the visitor can act on, shown as a button in the chat rather than typed out by the model. */
export type Action = { label: string; url: string };

export type ToolContext = {
  ctx: AppContext;
  settings: SettingsState;
  conversation: Conversation;
  /** Buttons to show the visitor with this reply. */
  actions: Action[];
  /** The customer's most recent words, for checks that must not rely on the model's account. */
  lastCustomerText: () => string;
  /** Voice: asks the phone bridge to hang up once Flora finishes speaking. */
  requestHangup?: () => void;
};

type ToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  args: z.ZodType;
  channels?: Channel[];
  modes?: Mode[];
  /** Whether to offer the tool right now. The server checks again when it runs. */
  offer?: (tc: ToolContext) => Promise<boolean>;
  run: (tc: ToolContext, args: never) => Promise<unknown>;
};

// Strict JSON schemas: every property is listed as required, and optional ones accept null.
const obj = (props: Record<string, unknown>) => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false });
const str = (description: string) => ({ type: 'string', description });
const nstr = (description: string) => ({ type: ['string', 'null'], description });
const nint = (description: string) => ({ type: ['integer', 'null'], description });
const nnum = (description: string) => ({ type: ['number', 'null'], description });
const bool = (description: string) => ({ type: 'boolean', description });
const nullish = <T extends z.ZodTypeAny>(t: T) => t.nullable().optional().transform((v) => v ?? undefined);

const priceText = (cents: number | null | undefined) => (cents == null ? null : formatCents(cents));

const AFFIRMATIVE = /\b(yes|yeah|yep|yup|sure|please|ok|okay|go ahead|send it|text me|that works|sounds good|absolutely|definitely|of course|correct|right)\b/i;

const TOOLS: ToolDef[] = [
  {
    name: 'get_business_info',
    description: 'The shop\'s name, address, phone, email, confirmed opening hours and policies. The only source of business facts besides other tool results.',
    parameters: obj({}),
    args: z.object({}),
    run: async ({ ctx, settings }) => ({
      ...(await businessFacts(ctx.db, settings)),
      delivery_policy: settings.delivery.public_policy,
      refund_policy: settings.refunds.policy_text?.slice(0, 1500) ?? null,
      event_cancellation_policy: settings.events.cancellation_policy?.slice(0, 1500) ?? null,
      online_shop_open: settings.general.shop_open,
    }),
  },
  {
    name: 'search_knowledge',
    description: 'Answers the owner has written for common questions. Search here before saying you do not know.',
    parameters: obj({ query: str('The question, in a few words') }),
    args: z.object({ query: z.string().trim().min(2).max(200) }),
    run: async ({ ctx, conversation }, a: { query: string }) => {
      const results = await searchKnowledge(ctx.db, a.query, conversation.mode);
      return results.length ? { results } : { results: [], note: 'No approved answer. Do not guess: offer to pass the question to the team.' };
    },
  },
  {
    name: 'search_products',
    description: 'Search the online shop. Returns real products with their current prices and whether they can be ordered.',
    parameters: obj({ query: nstr('Words to search for, such as "roses" or "sympathy"'), max_price_dollars: nnum('Only show products from this price or less') }),
    args: z.object({ query: nullish(z.string().trim().max(100)), max_price_dollars: nullish(z.number().min(0).max(100_000)) }),
    run: async ({ ctx, actions }, a: { query?: string; max_price_dollars?: number }) => {
      const rows = await listProducts(ctx.db, { q: a.query || undefined, limit: 12 });
      const filtered = rows.filter((r) => a.max_price_dollars === undefined || r.from_price_cents <= a.max_price_dollars * 100).slice(0, 5);
      for (const r of filtered.slice(0, 3)) actions.push({ label: r.name, url: `${ctx.env.PUBLIC_BASE_URL}/shop/${r.slug}` });
      return {
        products: filtered.map((r) => ({
          name: r.name,
          slug: r.slug,
          price: `${r.has_price_range ? 'from ' : ''}${formatCents(r.from_price_cents)}`,
          on_sale: r.on_sale,
          can_be_ordered: !r.sold_out,
          ways_to_get_it: Object.entries(r.fulfillment).filter(([, v]) => v).map(([k]) => k),
          description: r.short_description,
        })),
        note: filtered.length ? 'Prices are the shop\'s current prices. Final totals, tax and delivery fees are shown at checkout.' : 'Nothing matched. Offer to search for something else, or to pass a custom request to the team.',
      };
    },
  },
  {
    name: 'get_product_details',
    description: 'Full details of one product: sizes and prices, required choices, notice needed, and how it can be delivered or picked up.',
    parameters: obj({ slug: str('The product slug from search_products') }),
    args: z.object({ slug: z.string().trim().min(1).max(160) }),
    run: async ({ ctx, actions }, a: { slug: string }) => {
      const p = await getProduct(ctx.db, a.slug);
      actions.push({ label: `View ${p.name}`, url: `${ctx.env.PUBLIC_BASE_URL}/shop/${p.slug}` });
      return {
        name: p.name,
        description: (p.description ?? p.short_description ?? '').slice(0, 800),
        options_you_choose: p.variants.map((v) => ({
          name: v.name,
          price: priceText(v.sale_price_cents ?? v.price_cents),
          was: v.sale_price_cents ? priceText(v.price_cents) : null,
          in_stock: v.available_quantity === null ? 'made to order' : v.available_quantity > 0 ? 'yes' : p.out_of_stock_behavior === 'reject' ? 'sold out' : 'can be requested',
        })),
        required_details: p.options.filter((o) => o.required).map((o) => o.label),
        minimum_notice_hours: p.min_lead_hours,
        needs_shop_approval: Boolean(p.requires_approval || p.is_custom),
        ways_to_get_it: [p.allow_pickup && 'pickup', p.allow_delivery && 'local delivery', p.allow_shipping && 'shipping'].filter(Boolean),
      };
    },
  },
  {
    name: 'check_delivery_availability',
    description: 'Whether a product can be delivered to a ZIP code on a date, and which delivery windows are open. Uses the same rules as checkout.',
    parameters: obj({ product_slug: str('The product to deliver'), postal_code: str('Five-digit ZIP code'), date: str('YYYY-MM-DD') }),
    args: z.object({ product_slug: z.string().trim().min(1).max(160), postal_code: z.string().trim().regex(/^\d{5}$/), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    run: async ({ ctx, settings }, a: { product_slug: string; postal_code: string; date: string }) => {
      const tz = settings.general.timezone;
      const p = await getProduct(ctx.db, a.product_slug);
      if (!p.allow_delivery) return { deliverable: false, reason: 'This product is not offered for delivery.' };
      const [v] = await loadVariants(ctx.db, [p.variants[0].id]);
      const line: DemandLine = {
        product_id: v.product_id, name: v.name, quantity: 1, division_id: v.division_id, prep_minutes: v.variant_prep ?? v.prep_minutes, complexity_points: v.variant_points ?? v.complexity_points,
        min_lead_hours: v.min_lead_hours, allow_pickup: v.allow_pickup, allow_delivery: v.allow_delivery, allow_shipping: v.allow_shipping, restricted_zone_ids: v.restricted_zone_ids,
        season_start_md: v.season_start_md, season_end_md: v.season_end_md, available_from: v.available_from, available_until: v.available_until, requires_approval: v.requires_approval, is_custom: v.is_custom,
      };
      const today = localDate(ctx.clock.now(), tz);
      if (a.date < today) return { deliverable: false, reason: 'That date has passed.' };
      const policy = await loadPolicyContext(ctx.db, ctx.clock, addDays(a.date, -1, tz), addDays(a.date, 2, tz));
      const zone = findZone(policy, a.postal_code);
      if (!zone) return { deliverable: false, reason: 'That ZIP code is outside the delivery area.' };
      const slots = listSlots(policy, { lines: [line], subtotal_cents: v.price_cents }, 'delivery', zone, a.date, 1);
      return {
        date: formatDate(a.date, tz),
        delivery_fee: formatCents(zone.fee_cents),
        windows: slots.map((s) => ({ time: formatTimeRange(s.start, s.end, tz), status: s.status === 'open' ? 'available' : s.status === 'review' ? 'needs the shop to confirm' : 'not available', why_not: s.status === 'blocked' ? s.reasons.map((r) => r.message).slice(0, 2) : [] })),
        note: 'Times are confirmed only at checkout. Other items in the order can change what is possible.',
      };
    },
  },
  {
    name: 'get_wedding_services',
    description: 'What the shop offers for weddings and events, with ids and pricing: a published price, a published estimate range, or a custom quote. Also the budget ranges, styles and consultation formats to choose from.',
    parameters: obj({}),
    args: z.object({}),
    run: async ({ ctx }) => {
      const o = await plannerOptions(ctx.db, ctx.clock);
      return {
        services: o.categories.flatMap((c) =>
          c.services.map((s) => ({
            service_id: s.id,
            category: c.name,
            name: s.name,
            pricing: s.pricing_mode === 'package' ? `published price ${priceText(s.unit_price_cents)}${s.unit !== 'each' ? ` per ${s.unit}` : ''}` : s.pricing_mode === 'estimate' ? `estimate ${priceText(s.est_low_cents)} to ${priceText(s.est_high_cents)}${s.unit !== 'each' ? ` per ${s.unit}` : ''}` : 'custom quote from the team',
          })),
        ),
        rentals: o.rentals.map((r) => ({ rental_item_id: r.id, name: r.name, price: r.price_cents === null ? 'custom quote' : `${formatCents(r.price_cents)} each`, owned_quantity: r.max_quantity })),
        event_types: o.event_types,
        budget_ranges: o.budget_ranges,
        style_options: o.style_options,
        consultation_formats: o.consultation_formats,
        minimum_notice_days: o.min_notice_days,
      };
    },
  },
  {
    name: 'check_wedding_date',
    description: 'Checks a wedding or event date against the shop\'s real calendar, crews and rentals. It does not reserve anything.',
    parameters: obj({ event_date: str('YYYY-MM-DD'), ceremony_time: nstr('HH:MM, 24-hour, if known'), reception_time: nstr('HH:MM, 24-hour, if known') }),
    args: z.object({ event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), ceremony_time: nullish(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)), reception_time: nullish(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)) }),
    run: async ({ ctx, settings }, a: { event_date: string; ceremony_time?: string; reception_time?: string }) => {
      const today = localDate(ctx.clock.now(), settings.general.timezone);
      if (a.event_date <= today) return { status: 'unavailable', summary: 'That date is not in the future.' };
      const r = await checkEventAvailability(ctx.db, ctx.clock, { event_date: a.event_date, ceremony_time: a.ceremony_time ?? null, reception_time: a.reception_time ?? null, rentals: [] });
      return {
        date: formatDate(a.event_date, settings.general.timezone),
        status: r.status === 'available' ? 'looks available' : r.status === 'review' ? 'the team needs to review this date' : 'not available',
        summary: r.summary,
        reasons: r.reasons.map((x) => x.message),
        nearby_dates_that_may_work: r.alternatives.map((d) => formatDate(d, settings.general.timezone)),
        alternatives_iso: r.alternatives,
        note: 'This is not a reservation. Only the team can confirm a date, in a formal quote.',
      };
    },
  },
  {
    name: 'save_wedding_details',
    description: 'Saves wedding or event details to this conversation\'s plan as you learn them. Send only fields you have learned; leave the rest null. Selections use ids from get_wedding_services.',
    parameters: obj({
      contact_name: nstr('Their name'),
      contact_email: nstr('Their email address, confirmed with them'),
      event_type: nstr('One of the event types from get_wedding_services'),
      event_date: nstr('YYYY-MM-DD'),
      ceremony_time: nstr('HH:MM 24-hour'),
      reception_time: nstr('HH:MM 24-hour'),
      venue_name: nstr('Venue name'),
      venue_address: nstr('Venue address or town'),
      guest_count: nint('Approximate number of guests'),
      budget_range: nstr('Exactly one of the budget ranges from get_wedding_services'),
      consultation_format: nstr('Exactly one of the consultation formats'),
      colors: nstr('Colors they mentioned'),
      theme: nstr('Theme or feel'),
      floral_styles: { type: ['array', 'null'], items: { type: 'string' }, description: 'Styles from the style options' },
      preferences: nstr('What they are picturing, in their words'),
      must_haves: nstr('Anything they said they must have'),
      selections: {
        type: ['array', 'null'],
        description: 'The full list of chosen services and rentals. Replaces any earlier list.',
        items: obj({ service_id: nstr('A service_id'), rental_item_id: nstr('A rental_item_id'), quantity: { type: 'integer' }, notes: nstr('Notes for this item') }),
      },
    }),
    args: draftPatchSchema.transform((v) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && x !== undefined))),
    run: async ({ ctx, conversation }, a: z.output<typeof draftPatchSchema>) => saveDraftDetails(ctx, conversation, a),
  },
  {
    name: 'check_consultation_slots',
    description: 'Open consultation times with the team, from the real schedule.',
    parameters: obj({ from_date: nstr('YYYY-MM-DD to start from, or null for the soonest') }),
    args: z.object({ from_date: nullish(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)) }),
    run: async ({ ctx, settings }, a: { from_date?: string }) => {
      if (!settings.consultations.enabled) return { available: false, note: 'Online consultation booking is off. Offer a callback.' };
      const { slots } = await consultationSlots(ctx.db, ctx, a.from_date, 14);
      const tz = settings.general.timezone;
      return { slots: slots.slice(0, 6).map((s) => ({ starts_at: s.start.toISOString(), label: formatDateTime(s.start, tz) })), formats: settings.consultations.formats, length_minutes: settings.consultations.duration_minutes };
    },
  },
  {
    name: 'choose_consultation_time',
    description: 'Saves the consultation time the customer chose. It is booked when they send their plan on the website, if it is still free then.',
    parameters: obj({ starts_at: str('The starts_at value from check_consultation_slots') }),
    args: z.object({ starts_at: z.string().datetime({ offset: true }) }),
    offer: async ({ ctx, conversation }) => Boolean(await draftForConversation(ctx.db, conversation.id)),
    run: async ({ ctx, conversation, settings }, a: { starts_at: string }) => {
      const draft = await draftForConversation(ctx.db, conversation.id);
      if (!draft || draft.status !== 'draft') return { saved: false, note: 'Save the wedding details first.' };
      const at = new Date(a.starts_at);
      const { slots } = await consultationSlots(ctx.db, ctx, localDate(at, settings.general.timezone), 1);
      if (!slots.some((s) => s.start.getTime() === at.getTime())) return { saved: false, note: 'That time is not open. Check the slots again.' };
      await ctx.db.updateTable('concierge_drafts').set({ preferred_consultation_at: at, updated_at: sql`now()` }).where('id', '=', draft.id).execute();
      return { saved: true, time: formatDateTime(at, settings.general.timezone), note: 'It is booked when they send the plan on the website, if it is still free.' };
    },
  },
  {
    name: 'send_planning_link',
    description: 'Gives the customer a private link to review, edit and send their saved plan. In chat it appears as a button. On the phone it is texted to the caller\'s own number, only after they said yes.',
    parameters: obj({ consent_confirmed: bool('Phone only: true only if the caller just clearly agreed to receive a text') }),
    args: z.object({ consent_confirmed: z.boolean() }),
    offer: async ({ ctx, conversation }) => Boolean(await draftForConversation(ctx.db, conversation.id)),
    run: async (tc, a: { consent_confirmed: boolean }) => {
      const { ctx, conversation, settings } = tc;
      const draft = await draftForConversation(ctx.db, conversation.id);
      if (!draft) return { sent: false, note: 'Save the wedding details first.' };
      if (draft.status !== 'draft') return { sent: false, note: 'This plan was already sent.' };
      if (conversation.channel === 'chat') {
        tc.actions.push({ label: 'Review and send my plan', url: await draftLink(ctx, draft.id) });
        return { shown: true, note: 'The link is shown to the visitor as a button.' };
      }
      // The phone: only to the number that is calling, only after a yes the caller actually said.
      const phone = conversation.caller_phone_e164;
      if (!phone) return { sent: false, note: 'The caller\'s number is hidden, so nothing can be texted. Offer the website and the planner instead.' };
      if (!a.consent_confirmed || !AFFIRMATIVE.test(tc.lastCustomerText())) {
        return { sent: false, note: 'Ask clearly whether you may text a link to the number they are calling from, and wait for a yes.' };
      }
      await appendMessage(ctx.db, settings, conversation.id, { role: 'event', content: `Caller agreed to one text with a planning link. Their words: "${tc.lastCustomerText().slice(0, 200)}"` });
      if (conversation.texts_sent >= settings.concierge.texts_per_conversation) return { sent: false, note: 'A link was already sent on this call.' };
      if (ctx.sms.enabled) {
        const url = await draftLink(ctx, draft.id);
        const prefix = ctx.payments.livemode ? '' : '[Test] ';
        const body = `${prefix}${settings.contact.business_name}: here is the link to review and send your plan from your call with ${settings.concierge.assistant_name}: ${url} Reply STOP to opt out.`;
        const result = await ctx.sms.send({ to: phone, body });
        if (result.status === 'sent') {
          await ctx.db.updateTable('concierge_conversations').set({ texts_sent: sql`texts_sent + 1` }).where('id', '=', conversation.id).execute();
          await ctx.db.updateTable('concierge_drafts').set({ link_sent_at: sql`now()`, link_channel: 'sms' }).where('id', '=', draft.id).execute();
          conversation.texts_sent += 1;
          return { sent: true, note: 'The text is on its way. Delivery is not guaranteed; if it does not arrive, they can use the website.' };
        }
      }
      const code = await issueContinueCode(ctx, draft.id, phone);
      return {
        sent: false,
        reason: 'Texting is not available on this line.',
        continue_code: code.split('').join(' '),
        instructions: 'Read the six digits slowly. Tell them to open the Blooms website, choose "Continue a call", and enter the code with the last four digits of the phone they are calling from. The code works for 24 hours.',
      };
    },
  },
  {
    name: 'start_identity_check',
    description: 'Starts an order identity check: emails a one-time code to the email address already on the order. Needed before any order details can be shared.',
    parameters: obj({ order_reference: str('The order number, such as BL-AB12-CD34'), email: str('The email address the customer used for the order') }),
    args: z.object({ order_reference: z.string().trim().min(4).max(30), email: z.string().trim().toLowerCase().email() }),
    run: async ({ ctx, conversation }, a: { order_reference: string; email: string }) => startIdentityCheck(ctx, conversation, a),
  },
  {
    name: 'confirm_identity_code',
    description: 'Checks the six-digit code the customer received by email.',
    parameters: obj({ code: str('The six digits') }),
    args: z.object({ code: z.string().trim().regex(/^\d[\d\s-]{4,10}\d$/) }),
    offer: async ({ ctx, conversation }) => hasPendingCheck(ctx, conversation.id),
    run: async ({ ctx, conversation }, a: { code: string }) => confirmIdentityCode(ctx, conversation, a.code),
  },
  {
    name: 'get_order_status',
    description: 'The status of an order this conversation has verified with a code. Never available for any other order.',
    parameters: obj({ order_reference: str('The verified order number') }),
    args: z.object({ order_reference: z.string().trim().min(4).max(30) }),
    offer: async ({ ctx, conversation }) => hasVerifiedOrder(ctx, conversation.id),
    run: async ({ ctx, conversation, settings }, a: { order_reference: string }) => {
      const order = await verifiedOrder(ctx, conversation, a.order_reference);
      if (!order) return { error: 'not_verified', note: 'This order has not been verified in this conversation. Use start_identity_check first.' };
      const v = await publicOrderView(ctx.db, order.id);
      const tz = settings.general.timezone;
      return {
        reference: v.reference,
        status: v.status.replace(/_/g, ' '),
        paid: v.payment_status === 'paid' || v.payment_status === 'partially_refunded',
        items: v.items.map((i) => ({ name: i.name, quantity: i.quantity, status: i.status.replace(/_/g, ' ') })),
        fulfilment: v.fulfillments.map((f) => ({
          method: f.method,
          status: f.status.replace(/_/g, ' '),
          date: f.scheduled_date ? formatDate(f.scheduled_date, tz) : null,
          window: f.window_start && f.window_end ? formatTimeRange(new Date(f.window_start), new Date(f.window_end), tz) : null,
        })),
        note: 'Share only this order. Do not read out addresses or payment details.',
      };
    },
  },
  {
    name: 'send_tracking_link',
    description: 'Emails the private tracking link for an order to the address on the order. Says nothing about whether the details matched.',
    parameters: obj({ order_reference: str('The order number'), email: str('The email address on the order') }),
    args: z.object({ order_reference: z.string().trim().min(4).max(30), email: z.string().trim().toLowerCase().email() }),
    run: async ({ ctx, conversation }, a: { order_reference: string; email: string }) => {
      const order = await ctx.db
        .selectFrom('orders')
        .select(['id', 'reference', 'customer_id', 'contact_email', 'contact_name'])
        .where('reference', '=', a.order_reference.toUpperCase())
        .where('contact_email', '=', a.email)
        .where('is_test', 'in', conversation.mode === 'demo' ? [true] : [true, false])
        .executeTakeFirst();
      if (order) {
        const token = await mintAccessToken(ctx.db, ctx.clock, { purpose: 'order_access', subjectId: order.id, ttlMinutes: 60 * 24 * 7 });
        await sendDirect(ctx, {
          template: 'order_access_link',
          to: order.contact_email,
          customerId: order.customer_id,
          dedupe: `flora-order-link:${order.id}:${token.slice(0, 12)}`,
          vars: { order: { reference: order.reference, tracking_url: `${ctx.env.PUBLIC_BASE_URL}/track/${token}` }, customer: { first_name: (order.contact_name ?? '').split(' ')[0] } },
        });
      }
      return { status: 'sent_if_matched', note: 'If those details match an order, the tracking link is on its way to the email on the order.' };
    },
  },
  {
    name: 'request_order_change',
    description: 'Passes a requested change to a verified order to the team. Nothing changes until a person approves it.',
    parameters: obj({ order_reference: str('The verified order number'), change_requested: str('What the customer would like changed, in their words') }),
    args: z.object({ order_reference: z.string().trim().min(4).max(30), change_requested: z.string().trim().min(5).max(1000) }),
    offer: async ({ ctx, conversation }) => hasVerifiedOrder(ctx, conversation.id),
    run: async ({ ctx, conversation }, a: { order_reference: string; change_requested: string }) => {
      const order = await verifiedOrder(ctx, conversation, a.order_reference);
      if (!order) return { error: 'not_verified', note: 'Verify the order first with start_identity_check.' };
      const o = await ctx.db.selectFrom('orders').select(['contact_name', 'contact_email', 'contact_phone']).where('id', '=', order.id).executeTakeFirstOrThrow();
      const ticket = await createTicket(ctx, conversation, {
        category: 'order',
        urgency: 'soon',
        topic: `Change to ${order.reference}`,
        message: `Requested change (customer verified by emailed code): ${a.change_requested}`,
        name: o.contact_name ?? 'Customer',
        email: o.contact_email,
        phone: toE164(o.contact_phone),
        orderId: order.id,
      });
      return { ...ticket, note: 'A person will review it. Nothing has changed yet.' };
    },
  },
  {
    name: 'request_callback',
    description: 'Asks a person on the team to contact the customer. Use when they ask for a person, are upset, report a problem, have something urgent, or need what you cannot do.',
    parameters: obj({
      name: str('Their name'),
      phone: nstr('A number to call back. On the phone, null means the number they are calling from.'),
      email: nstr('An email address, if they prefer'),
      category: { type: 'string', enum: [...TICKET_CATEGORIES], description: 'What it is about' },
      urgency: { type: 'string', enum: ['routine', 'soon', 'urgent'], description: 'urgent: an event or delivery today or tomorrow, or a serious problem' },
      reason: str('What they need, in a sentence or two'),
      preferred_time: nstr('When they would like to be contacted, in their words'),
    }),
    args: z.object({
      name: z.string().trim().min(1).max(120),
      phone: nullish(z.string().trim().max(30)),
      email: nullish(z.string().trim().toLowerCase().email()),
      category: z.enum(TICKET_CATEGORIES),
      urgency: z.enum(['routine', 'soon', 'urgent']),
      reason: z.string().trim().min(5).max(1000),
      preferred_time: nullish(z.string().trim().max(120)),
    }),
    run: async ({ ctx, conversation }, a: { name: string; phone?: string; email?: string; category: (typeof TICKET_CATEGORIES)[number]; urgency: 'routine' | 'soon' | 'urgent'; reason: string; preferred_time?: string }) => {
      const phone = a.phone ? toE164(a.phone) : conversation.channel === 'voice' ? conversation.caller_phone_e164 : null;
      if (!phone && !a.email) return { created: false, note: 'Ask for a phone number or an email address so the team can reply.' };
      const t = await createTicket(ctx, conversation, {
        category: a.category,
        urgency: a.urgency,
        topic: 'Callback request',
        message: `${a.reason}${a.preferred_time ? `\nPreferred time: ${a.preferred_time}` : ''}${phone && conversation.channel === 'voice' && !a.phone ? '\n(Number from caller ID, not verified.)' : ''}`,
        name: a.name,
        email: a.email ?? null,
        phone,
      });
      return { created: true, ...t, callback_number: phone ? formatPhone(phone) : null, note: t.sandbox ? 'Demonstration: saved to the sandbox. Nobody at the shop is notified.' : 'A person will reply during business hours. Do not promise a time.' };
    },
  },
  {
    name: 'create_support_ticket',
    description: 'Records a question, feedback or complaint for the team when no callback is needed.',
    parameters: obj({ name: str('Their name'), email: nstr('Email for a reply'), phone: nstr('Phone for a reply'), category: { type: 'string', enum: [...TICKET_CATEGORIES] }, summary: str('The question or issue') }),
    args: z.object({ name: z.string().trim().min(1).max(120), email: nullish(z.string().trim().toLowerCase().email()), phone: nullish(z.string().trim().max(30)), category: z.enum(TICKET_CATEGORIES), summary: z.string().trim().min(5).max(1500) }),
    run: async ({ ctx, conversation }, a: { name: string; email?: string; phone?: string; category: (typeof TICKET_CATEGORIES)[number]; summary: string }) => {
      const phone = a.phone ? toE164(a.phone) : conversation.channel === 'voice' ? conversation.caller_phone_e164 : null;
      if (!phone && !a.email) return { created: false, note: 'Ask for an email address or phone number for the reply.' };
      const t = await createTicket(ctx, conversation, { category: a.category, urgency: a.category === 'complaint' ? 'soon' : 'routine', topic: a.category === 'complaint' ? 'Complaint' : 'Question', message: a.summary, name: a.name, email: a.email ?? null, phone });
      return { created: true, ...t };
    },
  },
  {
    name: 'convert_to_real_inquiry',
    description: 'Demonstration only. With the person\'s explicit permission, sends a real consultation request to the shop with only the contact details and event basics they confirmed. Nothing from the demonstration is copied.',
    parameters: obj({
      caller_gave_permission: bool('True only if they clearly asked you to pass a real request to the shop'),
      contact_details_read_back: bool('True only if you read their name, email and phone back and they confirmed'),
      name: str('Their name'),
      email: str('Their email, as confirmed'),
      phone: nstr('Their phone. On the phone, null means the number they are calling from'),
      event_type: str('Type of event'),
      event_date: str('YYYY-MM-DD, their real date'),
      notes: nstr('Anything they want the team to know, in their words'),
    }),
    args: z.object({
      caller_gave_permission: z.boolean(),
      contact_details_read_back: z.boolean(),
      name: z.string().trim().min(2).max(120),
      email: z.string().trim().toLowerCase().email(),
      phone: nullish(z.string().trim().max(30)),
      event_type: z.string().trim().min(1).max(80),
      event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      notes: nullish(z.string().trim().max(1500)),
    }),
    modes: ['demo'],
    run: async ({ ctx, conversation, settings }, a: { caller_gave_permission: boolean; contact_details_read_back: boolean; name: string; email: string; phone?: string; event_type: string; event_date: string; notes?: string }) => {
      if (!a.caller_gave_permission || !a.contact_details_read_back) return { created: false, note: 'Ask for permission and read the details back first.' };
      const phone = a.phone ? toE164(a.phone) : conversation.channel === 'voice' ? conversation.caller_phone_e164 : null;
      const eventType = settings.events.event_types.find((t) => t.toLowerCase() === a.event_type.toLowerCase()) ?? 'Another celebration';
      const result = await submitPlan(
        ctx,
        {
          idempotency_key: `flora-convert:${conversation.id}`,
          contact: { name: a.name, email: a.email, phone },
          event_type: eventType,
          event_date: a.event_date,
          style: { preferences: a.notes ?? null },
          selections: [],
          consents: { sms_transactional: false, sms_marketing: false, email_marketing: false },
          attribution: { via: 'flora_conversion', conversation: conversation.reference },
        },
        { type: 'customer', label: `flora:${conversation.reference}` },
        null,
        'flora_conversion',
      );
      await ctx.db.updateTable('concierge_conversations').set({ converted_inquiry_id: result.id, outcome: 'converted' }).where('id', '=', conversation.id).execute();
      return {
        created: true,
        reference: result.reference,
        note: `A real request is with the shop, with only the details they confirmed. A confirmation email goes to ${a.email}. Promotional texts are never switched on from a call: they can choose them on the website.${ctx.env.isProduction ? '' : ' This is a test environment, so the shop does not act on it yet.'}`,
      };
    },
  },
  {
    name: 'end_call',
    description: 'Hangs up after your goodbye has been heard. Use when the caller is finished.',
    parameters: obj({ reason: str('Why the call is ending, such as "caller finished"') }),
    args: z.object({ reason: z.string().trim().max(200) }),
    channels: ['voice'],
    run: async (tc, a: { reason: string }) => {
      tc.requestHangup?.();
      return { ending: true, reason: a.reason };
    },
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

const permitted = (t: ToolDef, conversation: Conversation) => (!t.channels || t.channels.includes(conversation.channel)) && (!t.modes || t.modes.includes(conversation.mode));

/** Every tool this channel and mode may use. The phone offers them all at once, and each still checks its own preconditions. */
export function permittedTools(conversation: Conversation): ToolSpec[] {
  return TOOLS.filter((t) => permitted(t, conversation)).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

/** The tools to offer the model right now, worked out from what has happened in the conversation. */
export async function availableTools(tc: ToolContext): Promise<ToolSpec[]> {
  const out: ToolSpec[] = [];
  for (const t of TOOLS) {
    if (!permitted(t, tc.conversation)) continue;
    if (t.offer && !(await t.offer(tc))) continue;
    out.push({ name: t.name, description: t.description, parameters: t.parameters });
  }
  return out;
}

/**
 * Runs one tool call from the model. The model's request is untrusted: the server checks the
 * channel, the mode and the arguments, and each tool checks its own preconditions again, so a
 * customer who talks the model into calling something gets a refusal, not a result.
 */
export async function executeTool(tc: ToolContext, call: { call_id: string; name: string; arguments: string }) {
  const { ctx, settings, conversation } = tc;
  const def = BY_NAME.get(call.name);
  let args: unknown = {};
  let result: unknown;
  let refused = false;
  try {
    args = JSON.parse(call.arguments || '{}');
  } catch {
    args = null;
  }
  if (!def || !permitted(def, conversation)) {
    refused = true;
    result = { error: 'not_available', note: 'That action is not available here.' };
  } else {
    const parsed = def.args.safeParse(args);
    if (!parsed.success) {
      refused = true;
      result = { error: 'invalid_arguments', details: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`) };
    } else {
      try {
        result = await def.run(tc, parsed.data as never);
      } catch (err) {
        if (err instanceof AppError) {
          result = { error: err.code, note: err.message };
        } else {
          ctx.log.error('concierge tool failed', { tool: call.name, error: err });
          result = { error: 'temporarily_unavailable', note: 'That check is not working right now. Offer the website or a callback.' };
        }
      }
    }
  }
  await appendMessage(ctx.db, settings, conversation.id, { role: 'tool', tool_name: call.name, tool_call_id: call.call_id, tool_args: args, tool_result: result, refused });
  await addUsage(ctx.db, conversation.id, { costMicros: 0, toolCalls: 1 });
  return result;
}

export const TOOL_NAMES = TOOLS.map((t) => t.name);
