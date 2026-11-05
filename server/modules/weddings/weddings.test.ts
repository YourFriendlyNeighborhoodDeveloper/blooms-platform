import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createHarness, deliverWebhook, makeStaff, resetDb, sessionObject, signIn } from '../../test/helpers.js';
import { drain } from '../../automation/worker.js';
import { updateSetting, setApproval } from '../settings/service.js';
import { SYSTEM_ACTOR } from '../../lib/audit.js';
import { expireBookingHolds } from './billing.js';
import { peakRentalUse } from './availability.js';

const h = createHarness({ now: '2026-11-11T04:30:00Z' }); // 11:30 PM on Nov 10 in Saginaw
const { ctx } = h;
afterAll(() => ctx.db.destroy());

const EVENT_DATE = '2027-06-12';

async function configure(opts: { crews?: number; maxEvents?: number | null; minNotice?: number; approved?: boolean } = {}) {
  await updateSetting(ctx.db, 'events', { min_notice_days: opts.minNotice ?? 30, max_events_per_day: opts.maxEvents === undefined ? 5 : opts.maxEvents, setup_minutes: 120, teardown_minutes: 60, travel_minutes: 30, buffer_minutes: 30, default_event_hours: 5, balance_due_days_before: 14 }, SYSTEM_ACTOR);
  await updateSetting(ctx.db, 'tax', { rates_bps: { standard: 600 } }, SYSTEM_ACTOR);
  if (opts.approved !== false) await setApproval(ctx.db, 'ordering', true, SYSTEM_ACTOR);
  for (let i = 0; i < (opts.crews ?? 2); i++) await ctx.db.insertInto('resources').values({ kind: 'crew', name: `Crew ${i + 1}` }).execute();
  const owner = await makeStaff(ctx, { roles: ['owner'], email: 'owner@example.test', capabilities: ['consultation', 'event_crew'], name: 'Olive Owner' });
  for (let weekday = 0; weekday <= 6; weekday++) await ctx.db.insertInto('staff_availability').values({ staff_id: owner.staffId, weekday, starts_at: '09:00', ends_at: '17:00' }).execute();
  const category = await ctx.db.selectFrom('service_categories').select('id').where('slug', '=', 'bridal-party').executeTakeFirstOrThrow();
  const bouquet = await ctx.db.insertInto('wedding_services').values({ category_id: category.id, code: 'test-bouquet', name: 'Bridal Bouquet', pricing_mode: 'package', unit_price_cents: 20000 }).returning('id').executeTakeFirstOrThrow();
  const centerpiece = await ctx.db.insertInto('wedding_services').values({ category_id: category.id, code: 'test-center', name: 'Centerpiece', pricing_mode: 'estimate', est_low_cents: 5000, est_high_cents: 9000 }).returning('id').executeTakeFirstOrThrow();
  const install = await ctx.db.insertInto('wedding_services').values({ category_id: category.id, code: 'test-install', name: 'Floral Installation', pricing_mode: 'custom_quote' }).returning('id').executeTakeFirstOrThrow();
  const arch = await ctx.db.insertInto('rental_items').values({ name: 'Ceremony Arch', quantity: 1, cleaning_buffer_minutes: 600 }).returning('id').executeTakeFirstOrThrow();
  return { owner, bouquet: bouquet.id, centerpiece: centerpiece.id, install: install.id, arch: arch.id };
}

const plan = (overrides: Record<string, unknown> = {}) => ({
  idempotency_key: randomUUID(),
  contact: { name: 'Riley Example', email: `riley-${randomUUID().slice(0, 6)}@example.test`, phone: '(989) 555-0188' },
  event_type: 'Wedding',
  event_date: EVENT_DATE,
  ceremony_time: '15:00',
  reception_time: '17:00',
  venue_name: 'Fictional Barn',
  venue_address: '1 Example Rd, Saginaw, MI',
  guest_count: 120,
  budget_range: '$2,500 – $5,000',
  consultation_format: 'In the shop',
  style: { colors: 'Blush and sage', theme: 'Garden', floral_styles: ['Garden'], preferences: 'Soft and loose', must_haves: 'Peonies' },
  selections: [],
  ...overrides,
});

beforeEach(async () => {
  await resetDb(ctx);
  h.email.sent.length = 0;
  h.clock.set('2026-11-11T04:30:00Z');
});

describe('Scenario C: a wedding inquiry at 11:30 p.m.', () => {
  it('works from first click to confirmed project, with everyone asleep for the first part', async () => {
    const s = await configure();
    const customer = h.browser();

    const options = await customer.get('/api/public/planner/options');
    expect(options.json.categories[0].services.map((x: { name: string }) => x.name)).toContain('Bridal Bouquet');
    expect(options.json.rentals[0].name).toBe('Ceremony Arch');

    const selections = [
      { service_id: s.bouquet, quantity: 1 },
      { service_id: s.centerpiece, quantity: 10 },
      { service_id: s.install, quantity: 1 },
      { rental_item_id: s.arch, quantity: 1 },
    ];

    const estimate = await customer.post('/api/public/planner/estimate', { selections, guest_count: 120 });
    expect(estimate.json.published_total_cents).toBe(20000);
    expect(estimate.json.estimate_low_cents).toBe(50000);
    expect(estimate.json.estimate_high_cents).toBe(90000);
    expect(estimate.json.pending_quote_count).toBe(2); // the installation, and the arch, which has no price
    expect(estimate.json.is_guaranteed).toBe(false);

    const availability = await customer.post('/api/public/planner/availability', { event_date: EVENT_DATE, ceremony_time: '15:00', rentals: [{ rental_item_id: s.arch, quantity: 1 }] });
    expect(availability.json.status).toBe('available');

    const submitted = await customer.post('/api/public/planner/submit', plan({ selections, contact: { name: 'Riley Example', email: 'riley@example.test', phone: '(989) 555-0188' } }));
    expect(submitted.status, submitted.text).toBe(201);
    const portal = submitted.json.portal_token as string;

    // Nothing is reserved by an inquiry.
    const booking = await ctx.db.selectFrom('event_bookings').selectAll().executeTakeFirstOrThrow();
    expect(booking.status).toBe('inquiry');
    expect(await ctx.db.selectFrom('resource_reservations').select('id').execute()).toHaveLength(0);
    expect(await ctx.db.selectFrom('rental_reservations').select('id').execute()).toHaveLength(0);

    await drain(ctx);
    expect(h.email.to('riley@example.test').some((m) => m.subject.includes('We received your plan'))).toBe(true);
    expect(h.email.to(s.owner.email).some((m) => m.subject.includes('New inquiry'))).toBe(true);

    const slots = await customer.get(`/api/public/plan/${portal}/consultation-slots`);
    expect(slots.json.configured).toBe(true);
    expect(slots.json.slots.length).toBeGreaterThan(0);
    const booked = await customer.post(`/api/public/plan/${portal}/consultation`, { starts_at: slots.json.slots[0].start, format: 'In the shop' });
    expect(booked.status, booked.text).toBe(201);

    const staff = await signIn(h, s.owner.email);
    const board = (await staff.get('/api/admin/weddings/board')).json;
    const card = board.cards[0];
    const stage = board.stages.find((x: { id: string }) => x.id === card.stage_id);
    expect(stage.code).toBe('consultation_scheduled');

    const detail = (await staff.get(`/api/admin/weddings/${card.id}`)).json;
    expect(detail.answers.style.colors).toBe('Blush and sage');
    expect(detail.items).toHaveLength(4);
    expect((await staff.post(`/api/admin/weddings/${card.id}/accept`, {})).status).toBe(200);

    const quote = await staff.post(`/api/admin/weddings/${card.id}/quotes`, {
      lines: [
        { description: 'Bridal bouquet', quantity: 1, unit_price_cents: 20000, service_id: s.bouquet },
        { description: 'Centerpieces', quantity: 10, unit_price_cents: 7000, service_id: s.centerpiece },
        { description: 'Ceremony arch rental', quantity: 1, unit_price_cents: 15000, rental_item_id: s.arch, taxable: false },
      ],
      deposit_cents: 25000,
    });
    expect(quote.status, quote.text).toBe(201);
    // Subtotal 105000, tax 6% of the taxable 90000
    const quoteRow = await ctx.db.selectFrom('quotes').selectAll().where('id', '=', quote.json.id).executeTakeFirstOrThrow();
    expect(quoteRow.subtotal_cents).toBe(105000);
    expect(quoteRow.tax_cents).toBe(5400);
    expect(quoteRow.total_cents).toBe(110400);
    expect(quoteRow.status).toBe('draft');

    expect((await staff.post(`/api/admin/weddings/quotes/${quote.json.id}/send`, {})).status).toBe(200);
    await drain(ctx);
    const quoteMail = h.email.to('riley@example.test').find((m) => m.subject.includes('Your quote'));
    expect(quoteMail).toBeTruthy();
    const quoteToken = quoteMail!.text.match(/\/quote\/([\w-]+)/)![1];

    const publicQuote = (await customer.get(`/api/public/quotes/${quoteToken}`)).json;
    expect(publicQuote.can_accept).toBe(true);
    expect(publicQuote.internal_notes).toBeUndefined();

    expect((await customer.post(`/api/public/quotes/${quoteToken}/accept`, { name: 'Riley Example' })).status).toBe(400);
    const accepted = await customer.post(`/api/public/quotes/${quoteToken}/accept`, { name: 'Riley Example', agree: true });
    expect(accepted.status, accepted.text).toBe(200);
    expect(accepted.json.pay_token).toBeTruthy();

    // Accepted is not confirmed: the date is on hold, waiting on the deposit.
    let held = await ctx.db.selectFrom('event_bookings').selectAll().executeTakeFirstOrThrow();
    expect(held.status).toBe('hold');
    const project = await ctx.db.selectFrom('wedding_projects').selectAll().executeTakeFirstOrThrow();
    expect(project.status).toBe('pending');
    const holds = await ctx.db.selectFrom('resource_reservations').select(['status', 'phase']).execute();
    expect(holds.map((x) => x.phase).sort()).toEqual(['setup', 'teardown']);
    expect(holds.every((x) => x.status === 'hold')).toBe(true);
    expect((await ctx.db.selectFrom('rental_reservations').select('status').executeTakeFirstOrThrow()).status).toBe('hold');

    const pay = await customer.post(`/api/public/pay/${accepted.json.pay_token}`, {});
    expect(pay.status, pay.text).toBe(200);
    const payment = await ctx.db.selectFrom('payments').selectAll().where('kind', '=', 'deposit').executeTakeFirstOrThrow();
    expect(payment.amount_cents).toBe(25000);
    const session = await ctx.db.selectFrom('mock_gateway_sessions').selectAll().where('payment_id', '=', payment.id).executeTakeFirstOrThrow();
    const hook = await deliverWebhook(h, 'checkout.session.completed', sessionObject(session, 'complete', 'paid'));
    expect(hook.status).toBe(200);

    held = await ctx.db.selectFrom('event_bookings').selectAll().executeTakeFirstOrThrow();
    expect(held.status).toBe('confirmed');
    const confirmed = await ctx.db.selectFrom('wedding_projects').selectAll().executeTakeFirstOrThrow();
    expect(confirmed.status).toBe('confirmed');
    expect((await ctx.db.selectFrom('resource_reservations').select('status').execute()).every((x) => x.status === 'confirmed')).toBe(true);
    expect((await ctx.db.selectFrom('rental_reservations').select('status').executeTakeFirstOrThrow()).status).toBe('confirmed');

    const tasks = await ctx.db.selectFrom('staff_tasks').select('title').where('subject_id', '=', project.id).execute();
    expect(tasks.length).toBeGreaterThan(5);
    const milestones = await ctx.db.selectFrom('project_milestones').select('title').where('project_id', '=', project.id).execute();
    expect(milestones.length).toBeGreaterThan(1);
    const schedule = await ctx.db.selectFrom('payment_schedule_items').selectAll().where('project_id', '=', project.id).orderBy('sort_order').execute();
    expect(schedule.map((x) => [x.label, x.amount_cents, x.status])).toEqual([['Deposit', 25000, 'paid'], ['Balance', 85400, 'invoiced']]);

    await drain(ctx);
    const subjects = h.email.to('riley@example.test').map((m) => m.subject);
    expect(subjects).toEqual(expect.arrayContaining([expect.stringContaining('Deposit due'), expect.stringContaining('Deposit received'), expect.stringContaining('is confirmed')]));

    const projectMail = h.email.to('riley@example.test').find((m) => m.subject.includes('is confirmed'));
    const projectToken = projectMail!.text.match(/\/project\/([\w-]+)/)![1];
    const portalView = (await customer.get(`/api/public/project/${projectToken}`)).json;
    expect(portalView.status).toBe('confirmed');
    expect(portalView.invoices.find((i: { kind: string }) => i.kind === 'balance').amount_due_cents).toBe(85400);
    expect(portalView.milestones.length).toBeGreaterThan(0);
  });

  it('a resubmitted plan with the same key creates only one inquiry', async () => {
    await configure();
    const body = plan();
    const [a, b] = await Promise.all([h.browser().post('/api/public/planner/submit', body), h.browser().post('/api/public/planner/submit', body)]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.json.reference).toBe(b.json.reference);
    expect(await ctx.db.selectFrom('wedding_inquiries').select('id').execute()).toHaveLength(1);
  });

  it('checks every staff decision path', async () => {
    const s = await configure();
    const customer = h.browser();
    const email = 'decide@example.test';
    const staff = await signIn(h, s.owner.email);

    const a = await customer.post('/api/public/planner/submit', plan({ contact: { name: 'Decide Example', email } }));
    const inquiry = await ctx.db.selectFrom('wedding_inquiries').selectAll().where('reference', '=', a.json.reference).executeTakeFirstOrThrow();

    expect((await staff.post(`/api/admin/weddings/${inquiry.id}/request-clarification`, { question: 'Is the venue indoors?' })).status).toBe(200);
    expect((await staff.post(`/api/admin/weddings/${inquiry.id}/suggest-date`, { date: '2027-06-19' })).status).toBe(200);
    await drain(ctx);
    const subjects = h.email.to(email).map((m) => m.subject);
    expect(subjects).toEqual(expect.arrayContaining([expect.stringContaining('A question about your event'), expect.stringContaining('A date suggestion')]));

    expect((await staff.patch(`/api/admin/weddings/${inquiry.id}`, { event_date: '2027-06-19', guest_count: 80 })).status).toBe(200);
    const moved = await ctx.db.selectFrom('event_bookings').select('event_date').where('inquiry_id', '=', inquiry.id).executeTakeFirstOrThrow();
    expect(moved.event_date).toBe('2027-06-19');

    const declined = await staff.post(`/api/admin/weddings/${inquiry.id}/decline`, { reason: 'We are closed that week.' });
    expect(declined.status).toBe(200);
    await drain(ctx);
    expect(h.email.to(email).find((m) => m.subject.includes('About your event'))?.text).toContain('We are closed that week.');
    const portal = await customer.get(`/api/public/plan/${a.json.portal_token}`);
    expect(portal.json.status).toBe('declined');
  });
});

describe('Scenario D: a fully booked date', () => {
  async function bookEvent(_s: Awaited<ReturnType<typeof configure>>, staff: Awaited<ReturnType<typeof signIn>>, email: string, times: { ceremony_time: string; reception_time?: string } = { ceremony_time: '15:00', reception_time: '17:00' }) {
    const customer = h.browser();
    const res = await customer.post('/api/public/planner/submit', plan({ ...times, contact: { name: 'Booked Example', email } }));
    expect(res.status, res.text).toBe(201);
    const inquiry = await ctx.db.selectFrom('wedding_inquiries').select('id').where('reference', '=', res.json.reference).executeTakeFirstOrThrow();
    const q = await staff.post(`/api/admin/weddings/${inquiry.id}/quotes`, { lines: [{ description: 'Florals', quantity: 1, unit_price_cents: 100000 }], deposit_cents: 0 });
    expect(q.status, q.text).toBe(201);
    expect((await staff.post(`/api/admin/weddings/quotes/${q.json.id}/send`, {})).status).toBe(200);
    await drain(ctx);
    const token = h.email.to(email).find((m) => m.subject.includes('Your quote'))!.text.match(/\/quote\/([\w-]+)/)![1];
    return { customer, token, inquiryId: inquiry.id };
  }

  it('refuses a third overlapping event, offers alternatives, and protects the first two', async () => {
    const s = await configure({ crews: 2 });
    const staff = await signIn(h, s.owner.email);
    for (const email of ['first@example.test', 'second@example.test']) {
      const e = await bookEvent(s, staff, email);
      const ok = await e.customer.post(`/api/public/quotes/${e.token}/accept`, { name: 'Booked Example', agree: true });
      expect(ok.status, ok.text).toBe(200);
    }
    expect((await ctx.db.selectFrom('event_bookings').select('status').where('status', '=', 'confirmed').execute())).toHaveLength(2);

    const check = await h.browser().post('/api/public/planner/availability', { event_date: EVENT_DATE, ceremony_time: '15:00' });
    expect(check.json.status).toBe('unavailable');
    expect(check.json.reasons[0].code).toBe('capacity_crews');
    expect(check.json.alternatives.length).toBeGreaterThan(0);
    expect(check.json.alternatives).not.toContain(EVENT_DATE);

    // They may still ask. The inquiry is saved, but it can never claim the date on its own.
    const third = await bookEvent(s, staff, 'third@example.test');
    const refused = await third.customer.post(`/api/public/quotes/${third.token}/accept`, { name: 'Third Example', agree: true });
    expect(refused.status).toBe(409);
    expect(refused.json.error.code).toBe('date_unavailable');

    const bookings = await ctx.db.selectFrom('event_bookings').select('status').execute();
    expect(bookings.filter((b) => b.status === 'confirmed')).toHaveLength(2);
    expect(bookings.filter((b) => b.status === 'inquiry')).toHaveLength(1);
    expect((await ctx.db.selectFrom('quotes').select('status').where('inquiry_id', '=', third.inquiryId).executeTakeFirstOrThrow()).status).toBe('sent');
    await drain(ctx);
    expect(h.email.to(s.owner.email).some((m) => m.subject.includes('conflict'))).toBe(true);
  });

  it('two customers accepting at the same moment cannot both take the last crew', async () => {
    const s = await configure({ crews: 1 });
    const staff = await signIn(h, s.owner.email);
    const a = await bookEvent(s, staff, 'racer-a@example.test');
    const b = await bookEvent(s, staff, 'racer-b@example.test');
    const results = await Promise.all([
      a.customer.post(`/api/public/quotes/${a.token}/accept`, { name: 'Racer A', agree: true }),
      b.customer.post(`/api/public/quotes/${b.token}/accept`, { name: 'Racer B', agree: true }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const active = await ctx.db.selectFrom('resource_reservations').select('booking_id').where('status', '!=', 'released').execute();
    expect(new Set(active.map((x) => x.booking_id)).size).toBe(1);
  });

  it('one crew can serve two events when the setup and teardown times genuinely do not collide', async () => {
    const s = await configure({ crews: 1 });
    const staff = await signIn(h, s.owner.email);
    // Morning event ends before the evening event's crew is needed for setup.
    const morning = await bookEvent(s, staff, 'morning@example.test', { ceremony_time: '10:00' });
    expect((await morning.customer.post(`/api/public/quotes/${morning.token}/accept`, { name: 'Morning', agree: true })).status).toBe(200);
    // 10:00 event: setup 07:30-10:00, event 10:00-15:00, teardown 15:00-17:00. Evening setup from 17:30.
    const evening = await bookEvent(s, staff, 'evening@example.test', { ceremony_time: '20:00' });
    const ok = await evening.customer.post(`/api/public/quotes/${evening.token}/accept`, { name: 'Evening', agree: true });
    expect(ok.status, ok.text).toBe(200);
    // A 12:00 event would need the crew from 09:30, which collides with the morning setup.
    const clash = await bookEvent(s, staff, 'clash@example.test', { ceremony_time: '12:00' });
    expect((await clash.customer.post(`/api/public/quotes/${clash.token}/accept`, { name: 'Clash', agree: true })).status).toBe(409);
  });

  it('honors minimum notice, closures, and an event-per-day limit', async () => {
    const s = await configure({ crews: 5, minNotice: 60, maxEvents: 1 });
    void s;
    const tooSoon = await h.browser().post('/api/public/planner/availability', { event_date: '2026-11-20' });
    expect(tooSoon.json.status).toBe('unavailable');
    expect(tooSoon.json.reasons[0].code).toBe('min_notice');

    await ctx.db.insertInto('blackout_rules').values({ starts_on: '2027-07-01', ends_on: '2027-07-05', reason: 'holiday', public_message: 'Closed for the holiday.' }).execute();
    const closed = await h.browser().post('/api/public/planner/availability', { event_date: '2027-07-04' });
    expect(closed.json.status).toBe('unavailable');
    expect(closed.json.reasons[0].message).toBe('Closed for the holiday.');
    expect(closed.json.alternatives.every((d: string) => d < '2027-07-01' || d > '2027-07-05')).toBe(true);
    // The two prep days before an event also count.
    const prep = await h.browser().post('/api/public/planner/availability', { event_date: '2027-07-06' });
    expect(prep.json.reasons[0].code).toBe('prep_blocked');
  });

  it('with no crews or limits configured, a date is sent for human review, never promised', async () => {
    await updateSetting(ctx.db, 'events', { min_notice_days: 30 }, SYSTEM_ACTOR);
    const res = await h.browser().post('/api/public/planner/availability', { event_date: EVENT_DATE });
    expect(res.json.status).toBe('review');
    expect(res.json.summary).toContain('not reserved');
    const codes = res.json.reasons.map((r: { code: string }) => r.code);
    expect(codes).toEqual(expect.arrayContaining(['crews_not_configured', 'events_limit_not_configured', 'policy_unapproved']));
  });

  it('a hold that lapses without a deposit gives its resources back', async () => {
    const s = await configure({ crews: 1 });
    const staff = await signIn(h, s.owner.email);
    const e = await bookEvent(s, staff, 'lapse@example.test');
    const q = await ctx.db.selectFrom('quotes').selectAll().where('inquiry_id', '=', e.inquiryId).executeTakeFirstOrThrow();
    await ctx.db.updateTable('quotes').set({ deposit_cents: 10000 }).where('id', '=', q.id).execute();
    expect((await e.customer.post(`/api/public/quotes/${e.token}/accept`, { name: 'Lapse', agree: true })).status).toBe(200);
    expect((await ctx.db.selectFrom('event_bookings').select('status').executeTakeFirstOrThrow()).status).toBe('hold');

    h.clock.advanceHours(24 * 8);
    await expireBookingHolds(ctx);
    expect((await ctx.db.selectFrom('event_bookings').select('status').executeTakeFirstOrThrow()).status).toBe('inquiry');
    expect((await ctx.db.selectFrom('resource_reservations').select('status').execute()).every((r) => r.status === 'released')).toBe(true);

    // The deposit arrives late, and the date is still free: it is re-reserved and confirmed.
    const invoice = await ctx.db.selectFrom('invoices').select('id').where('kind', '=', 'deposit').executeTakeFirstOrThrow();
    const { mintAccessToken } = await import('../../lib/tokens.js');
    const token = await mintAccessToken(ctx.db, ctx.clock, { purpose: 'invoice_access', subjectId: invoice.id, ttlMinutes: 60 });
    expect((await e.customer.post(`/api/public/pay/${token}`, {})).status).toBe(200);
    const payment = await ctx.db.selectFrom('payments').selectAll().where('invoice_id', '=', invoice.id).executeTakeFirstOrThrow();
    const session = await ctx.db.selectFrom('mock_gateway_sessions').selectAll().where('payment_id', '=', payment.id).executeTakeFirstOrThrow();
    await deliverWebhook(h, 'checkout.session.completed', sessionObject(session, 'complete', 'paid'));
    expect((await ctx.db.selectFrom('event_bookings').select('status').executeTakeFirstOrThrow()).status).toBe('confirmed');
  });

  it('a contract, when required, holds confirmation until it is signed', async () => {
    const s = await configure();
    const staff = await signIn(h, s.owner.email);
    const e = await bookEvent(s, staff, 'contract@example.test');
    await ctx.db.updateTable('quotes').set({ requires_contract: true }).where('inquiry_id', '=', e.inquiryId).execute();
    expect((await e.customer.post(`/api/public/quotes/${e.token}/accept`, { name: 'Contract', agree: true })).status).toBe(200);
    const project = await ctx.db.selectFrom('wedding_projects').selectAll().executeTakeFirstOrThrow();
    expect(project.status).toBe('pending');
    expect(project.contract_status).toBe('pending');
    const signed = await staff.post(`/api/admin/weddings/projects/${project.id}/contract`, { status: 'signed' });
    expect(signed.json.result).toBe('confirmed');
    expect((await ctx.db.selectFrom('wedding_projects').select('status').executeTakeFirstOrThrow()).status).toBe('confirmed');
  });
});

describe('Consultations', () => {
  it('two customers cannot book the same person at the same time', async () => {
    const s = await configure();
    void s;
    const a = await h.browser().post('/api/public/planner/submit', plan());
    const b = await h.browser().post('/api/public/planner/submit', plan());
    const c = await h.browser().post('/api/public/planner/submit', plan());
    const slots = (await h.browser().get(`/api/public/plan/${a.json.portal_token}/consultation-slots`)).json.slots;
    const results = await Promise.all(
      [a, b, c].map((p) => h.browser().post(`/api/public/plan/${p.json.portal_token}/consultation`, { starts_at: slots[0].start, format: 'In the shop' })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect(await ctx.db.selectFrom('consultations').select('id').where('status', '=', 'booked').execute()).toHaveLength(1);
  });

  it('the database itself rejects a double booking, even if the application were wrong', async () => {
    const s = await configure();
    const res = await h.browser().post('/api/public/planner/submit', plan());
    const inquiry = await ctx.db.selectFrom('wedding_inquiries').select(['id', 'customer_id']).where('reference', '=', res.json.reference).executeTakeFirstOrThrow();
    const start = new Date('2027-01-05T15:00:00Z');
    const end = new Date('2027-01-05T16:00:00Z');
    await ctx.db.insertInto('consultations').values({ customer_id: inquiry.customer_id, staff_id: s.owner.staffId, format: 'Phone call', starts_at: start, ends_at: end }).execute();
    await expect(ctx.db.insertInto('consultations').values({ customer_id: inquiry.customer_id, staff_id: s.owner.staffId, format: 'Phone call', starts_at: new Date('2027-01-05T15:30:00Z'), ends_at: new Date('2027-01-05T16:30:00Z') }).execute()).rejects.toMatchObject({ code: '23P01' });
  });

  it('skips days off, respects notice, reschedules and cancels', async () => {
    const s = await configure();
    const res = await h.browser().post('/api/public/planner/submit', plan());
    const portal = res.json.portal_token;
    const before = (await h.browser().get(`/api/public/plan/${portal}/consultation-slots?days=30`)).json.slots as Array<{ start: string }>;
    const noticeEnd = h.clock.now().getTime() + 48 * 3600_000;
    expect(before.every((x) => new Date(x.start).getTime() >= noticeEnd)).toBe(true);

    await ctx.db.insertInto('staff_time_off').values({ staff_id: s.owner.staffId, starts_on: '2026-11-16', ends_on: '2026-11-16', kind: 'vacation' }).execute();
    const after = (await h.browser().get(`/api/public/plan/${portal}/consultation-slots?days=30`)).json.slots as Array<{ start: string }>;
    expect(after.some((x) => x.start.startsWith('2026-11-16'))).toBe(false);

    const b = h.browser();
    expect((await b.post(`/api/public/plan/${portal}/consultation`, { starts_at: after[0].start, format: 'Video call' })).status).toBe(201);
    const second = await b.post(`/api/public/plan/${portal}/consultation`, { starts_at: after[5].start, format: 'Video call' });
    expect(second.status).toBe(409);
    expect(second.json.error.code).toBe('already_booked');
    expect((await b.post(`/api/public/plan/${portal}/consultation`, { starts_at: after[5].start, format: 'Video call', reschedule: true })).status).toBe(201);
    const booked = await ctx.db.selectFrom('consultations').selectAll().where('status', '=', 'booked').execute();
    expect(booked).toHaveLength(1);
    expect(booked[0].starts_at.toISOString()).toBe(new Date(after[5].start).toISOString());
    expect((await b.delete(`/api/public/plan/${portal}/consultation`)).status).toBe(200);
    await drain(ctx);
  });
});

describe('Rental scheduling', () => {
  it('a return at 11 p.m. is not available the next morning when cleaning takes longer', async () => {
    const s = await configure({ crews: 5 });
    const start = new Date('2027-06-12T14:00:00Z');
    const end = new Date('2027-06-13T03:00:00Z'); // 11:00 PM local on June 12
    const booking = async () => {
      const r = await h.browser().post('/api/public/planner/submit', plan());
      const inquiry = await ctx.db.selectFrom('wedding_inquiries').select('id').where('reference', '=', r.json.reference).executeTakeFirstOrThrow();
      return ctx.db.selectFrom('event_bookings').select('id').where('inquiry_id', '=', inquiry.id).executeTakeFirstOrThrow();
    };
    const first = await booking();
    await ctx.db.insertInto('rental_reservations').values({ rental_item_id: s.arch, booking_id: first.id, quantity: 1, starts_at: start, ends_at: end, buffer_minutes: 600, blocked_until: end, status: 'confirmed' }).execute();
    const row = await ctx.db.selectFrom('rental_reservations').select(['blocked_until']).executeTakeFirstOrThrow();
    expect(row.blocked_until.toISOString()).toBe('2027-06-13T13:00:00.000Z'); // 9:00 AM after a 10 hour buffer

    const second = await booking();
    const insert = (startsAt: string, endsAt: string) => ctx.db.insertInto('rental_reservations').values({ rental_item_id: s.arch, booking_id: second.id, quantity: 1, starts_at: new Date(startsAt), ends_at: new Date(endsAt), buffer_minutes: 600, blocked_until: new Date(endsAt), status: 'confirmed' }).execute();
    await expect(insert('2027-06-13T12:00:00Z', '2027-06-13T20:00:00Z')).rejects.toMatchObject({ code: 'BL001' }); // 8 AM: still being cleaned
    await expect(insert('2027-06-13T14:00:00Z', '2027-06-13T20:00:00Z')).resolves.toBeTruthy(); // 10 AM: fine
  });

  it('simultaneous reservations cannot exceed the quantity owned', async () => {
    const s = await configure({ crews: 5 });
    await ctx.db.updateTable('rental_items').set({ quantity: 3 }).where('id', '=', s.arch).execute();
    const r = await h.browser().post('/api/public/planner/submit', plan());
    const inquiry = await ctx.db.selectFrom('wedding_inquiries').select('id').where('reference', '=', r.json.reference).executeTakeFirstOrThrow();
    const b = await ctx.db.selectFrom('event_bookings').select('id').where('inquiry_id', '=', inquiry.id).executeTakeFirstOrThrow();
    const attempts = Array.from({ length: 6 }, () =>
      ctx.db.insertInto('rental_reservations').values({ rental_item_id: s.arch, booking_id: b.id, quantity: 1, starts_at: new Date('2027-06-12T14:00:00Z'), ends_at: new Date('2027-06-12T22:00:00Z'), blocked_until: new Date('2027-06-12T22:00:00Z'), status: 'confirmed' }).execute().then(() => 'ok', (e) => e.code),
    );
    const results = await Promise.all(attempts);
    expect(results.filter((x) => x === 'ok')).toHaveLength(3);
    expect(results.filter((x) => x === 'BL001')).toHaveLength(3);
  });

  it('a late return extends the block from when it really came back', async () => {
    const s = await configure();
    const staff = await signIn(h, s.owner.email);
    const r = await h.browser().post('/api/public/planner/submit', plan());
    const inquiry = await ctx.db.selectFrom('wedding_inquiries').select('id').where('reference', '=', r.json.reference).executeTakeFirstOrThrow();
    const b = await ctx.db.selectFrom('event_bookings').select('id').where('inquiry_id', '=', inquiry.id).executeTakeFirstOrThrow();
    const row = await ctx.db.insertInto('rental_reservations').values({ rental_item_id: s.arch, booking_id: b.id, quantity: 1, starts_at: new Date('2027-06-12T14:00:00Z'), ends_at: new Date('2027-06-12T22:00:00Z'), buffer_minutes: 60, blocked_until: new Date('2027-06-12T22:00:00Z'), status: 'out' }).returning('id').executeTakeFirstOrThrow();
    const res = await staff.post(`/api/admin/rental-reservations/${row.id}/return`, { returned_at: '2027-06-13T15:00:00.000Z', damage_notes: 'Scuffed leg', damage_cost_cents: 2000 });
    expect(res.status, res.text).toBe(200);
    const after = await ctx.db.selectFrom('rental_reservations').selectAll().where('id', '=', row.id).executeTakeFirstOrThrow();
    expect(after.blocked_until.toISOString()).toBe('2027-06-13T16:00:00.000Z');
    expect(after.damage_notes).toBe('Scuffed leg');
  });

  it('computes peak use across staggered reservations', () => {
    const r = (a: string, b: string, quantity: number) => ({ quantity, starts_at: new Date(a), blocked_until: new Date(b) });
    const rows = [r('2027-01-01T10:00Z', '2027-01-01T12:00Z', 2), r('2027-01-01T11:00Z', '2027-01-01T13:00Z', 3), r('2027-01-01T14:00Z', '2027-01-01T15:00Z', 9)];
    expect(peakRentalUse(rows, new Date('2027-01-01T09:00Z'), new Date('2027-01-01T13:30Z'))).toBe(5);
    expect(peakRentalUse(rows, new Date('2027-01-01T12:30Z'), new Date('2027-01-01T14:30Z'))).toBe(9);
    expect(peakRentalUse(rows, new Date('2027-01-02T00:00Z'), new Date('2027-01-02T01:00Z'))).toBe(0);
  });
});
