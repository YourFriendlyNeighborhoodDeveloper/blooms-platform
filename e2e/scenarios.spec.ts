import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  addProductToCart, continueToPayment, fillAddress, fillContact, futureSaturday, newCustomer, orderForToken, pickFirstOpenSlot, query, resetRateLimits, signInStaff, simulatePayment, staffApi, waitForNotification,
} from './support/helpers.js';

test.beforeEach(resetRateLimits);

const email = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}@example.test`;

test('Scenario A: a normal flower purchase, from browsing to delivered', async ({ browser }) => {
  const customerEmail = email('avery');
  const customer = await newCustomer(browser);

  await customer.goto('/');
  await customer.getByRole('navigation').getByRole('link', { name: 'Shop', exact: true }).first().click();
  await expect(customer).toHaveURL(/\/shop$/);

  await customer.getByRole('link', { name: /Garden Bouquet/ }).first().click();
  await expect(customer.getByRole('heading', { name: /Garden Bouquet/ })).toBeVisible();

  await customer.getByLabel('Choose').selectOption({ label: 'Deluxe · $95.00' });
  await customer.getByLabel('Ribbon color').selectOption('Velvet burgundy');
  await customer.getByLabel('Card message').fill('Happy birthday, Alex. Love, Avery.');
  await customer.getByRole('button', { name: /Add to cart/ }).click();
  await Promise.all([customer.waitForURL(/\/cart$/), customer.getByRole('link', { name: 'View cart' }).click()]);
  await expect(customer.getByRole('heading', { name: /cart/i }).first()).toBeVisible();
  await expect(customer.getByText(/Garden Bouquet/).first()).toBeVisible();
  await expect(customer.getByText(/Velvet burgundy/)).toBeVisible();

  await customer.getByRole('link', { name: /checkout/i }).click();
  await fillContact(customer, { name: 'Avery Example', email: customerEmail });
  await customer.getByText('Local delivery').click();
  await fillAddress(customer);
  await expect(customer.getByText('Delivers to Nearby (demo) for $12.00.')).toBeVisible();
  await pickFirstOpenSlot(customer);
  // Item 95.00 + ribbon 5.00 + delivery 12.00; tax 6% of the 100.00 of goods is 6.00.
  await expect(customer.getByText('$118.00')).toBeVisible();

  await continueToPayment(customer);
  await expect(customer.getByText('$118.00')).toBeVisible();
  await expect(customer.getByText('Simulated: no real payment')).toBeVisible();
  const token = await simulatePayment(customer);

  // Reaching this page proves nothing by itself. The record below reflects the verified webhook.
  await expect(customer.getByText('Your order is confirmed').or(customer.getByText('Payment confirmed')).first()).toBeVisible();
  const order = await orderForToken(token);
  expect(order.payment_status).toBe('paid');
  await waitForNotification(customerEmail, 'order_confirmation');

  const staff = await signInStaff(browser, 'owner@demo.example');
  await staff.goto('/admin/orders');
  await staff.getByRole('link', { name: order.reference }).click();
  await expect(staff.getByRole('heading', { name: order.reference })).toBeVisible();
  await expect(staff.getByText('Velvet burgundy')).toBeVisible();

  // Production work exists and the florist can see it.
  const tasks = await query(`SELECT title FROM staff_tasks WHERE subject_id = $1`, [order.id]);
  expect(tasks.length).toBeGreaterThan(0);
  await expect(staff.getByText(String((tasks[0] as { title: string }).title))).toBeVisible();

  await staff.getByRole('button', { name: 'Start preparing' }).click();
  await expect(staff.getByRole('button', { name: 'Mark ready' })).toBeVisible();
  await customer.reload();
  await expect(customer.getByText('Being prepared').first()).toBeVisible();

  await staff.getByRole('button', { name: 'Mark ready' }).click();
  await staff.getByRole('button', { name: 'Send out for delivery' }).click();
  await expect(staff.getByRole('button', { name: 'Delivered' })).toBeVisible();
  await customer.reload();
  await expect(customer.getByText('Out for delivery').first()).toBeVisible();

  await staff.getByRole('button', { name: 'Delivered' }).click();
  await expect(staff.getByRole('button', { name: 'Delivered' })).toHaveCount(0);
  await customer.reload();
  await expect(customer.getByText('Fulfilled').first()).toBeVisible();

  // Each change was recorded, and the customer was told.
  const history = await query<{ to_status: string }>(`SELECT to_status FROM order_status_history WHERE order_id = $1 ORDER BY created_at`, [order.id]);
  expect(history.map((h: { to_status: string }) => h.to_status)).toEqual(expect.arrayContaining(['preparing', 'ready', 'out_for_delivery', 'fulfilled']));
  await waitForNotification(customerEmail, 'order_out_for_delivery');
  await waitForNotification(customerEmail, 'order_delivered');

  await staff.context().close();
  await customer.context().close();
});

test('Scenario B: an impossible same-day delivery is blocked, and no payment is collected', async ({ browser }) => {
  const owner = await signInStaff(browser, 'owner@demo.example');
  // Today's cutoff has always passed at 00:00, whatever time this test runs.
  await staffApi(owner, 'PUT', '/api/admin/settings/ordering', { same_day_cutoff: '00:00' });

  try {
    const customer = await newCustomer(browser);
    await addProductToCart(customer, 'demo-mason-jar');
    await customer.goto('/checkout');
    await fillContact(customer, { name: 'Blair Example', email: email('blair') });
    await customer.getByText('Local delivery').click();
    await fillAddress(customer);
    await expect(customer.getByText(/Earliest available/)).toBeVisible();

    const today = await customer.evaluate(() => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Detroit' }));
    const slots = await customer.evaluate(async () => {
      const cart = (await (await fetch('/api/public/cart')).json()) as { lines: Array<{ id: string }> };
      const res = await fetch('/api/public/availability/slots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'delivery', postal_code: '48609', line_ids: cart.lines.map((l: { id: string }) => l.id) }) });
      return (await res.json()) as { slots: Array<{ date: string; status: string }>; earliest: { date: string } };
    });
    // Every slot left today is refused, and the customer sees open alternatives instead.
    const todaySlots = slots.slots.filter((s) => s.date === today);
    for (const s of todaySlots) expect(s.status).toBe('blocked');
    expect(slots.earliest.date > today).toBe(true);
    expect(slots.slots.some((s) => s.status === 'open')).toBe(true);
    for (const radio of await customer.locator(`input[name="slot-${today}"]`).all()) await expect(radio).toBeDisabled();

    // Bypassing the page changes nothing. The server decides, and refuses.
    const before = await query<{ n: string }>(`SELECT count(*) AS n FROM mock_gateway_sessions`);
    const windows = await query<{ id: string }>(`SELECT id FROM delivery_windows WHERE kind = 'delivery' AND weekday = EXTRACT(DOW FROM $1::date) LIMIT 1`, [today]);
    const windowId = windows[0]?.id ?? (await query<{ id: string }>(`SELECT id FROM delivery_windows WHERE kind = 'delivery' LIMIT 1`))[0].id;
    const forged = await customer.evaluate(
      async ({ today, windowId }: { today: string; windowId: string }) => {
        const cart = (await (await fetch('/api/public/cart')).json()) as { lines: Array<{ id: string }> };
        const res = await fetch('/api/public/checkout', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            idempotency_key: crypto.randomUUID(),
            contact: { name: 'Blair Example', email: 'blair-forged@example.test', phone: null },
            consents: {},
            fulfillments: [{ line_ids: cart.lines.map((l: { id: string }) => l.id), method: 'delivery', date: today, window_id: windowId, address: { line1: '123 Example Lane', line2: null, city: 'Saginaw', region: 'MI', postal_code: '48609' } }],
          }),
        });
        return { status: res.status, body: await res.json() };
      },
      { today, windowId },
    );
    expect(forged.status).toBeGreaterThanOrEqual(400);
    expect(forged.status).toBeLessThan(500);
    const after = await query<{ n: string }>(`SELECT count(*) AS n FROM mock_gateway_sessions`);
    expect(after[0].n).toBe(before[0].n);
    expect(await query(`SELECT 1 FROM orders WHERE contact_email = 'blair-forged@example.test'`)).toHaveLength(0);
    await customer.context().close();
  } finally {
    await staffApi(owner, 'PUT', '/api/admin/settings/ordering', { same_day_cutoff: '13:00' });
    await owner.context().close();
  }
});

test('Scenario C: a wedding inquiry, from the planner through to a confirmed project', async ({ browser }) => {
  const customerEmail = email('riley');
  const eventDate = futureSaturday(30);
  const customer = await newCustomer(browser);
  await customer.goto('/plan');

  // Step 1: the event
  await customer.getByLabel('Your name').fill('Riley Example');
  await customer.getByRole('textbox', { name: 'Email' }).fill(customerEmail);
  await customer.getByLabel('Event date').fill(eventDate);
  await customer.getByLabel('Estimated guests').fill('120');
  await customer.getByLabel('Ceremony time').fill('15:00');
  await customer.getByLabel('Venue name').fill('Fictional Barn');
  await customer.getByText('$5,000 – $10,000').click();
  await customer.getByRole('button', { name: /Continue/ }).click();

  // Step 2: style, with a real image upload
  await customer.getByLabel('Your colors').fill('Blush and sage');
  await customer.getByLabel('Tell us what you are picturing').fill('Soft, loose and garden-like.');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await customer.locator('input[type="file"]').setInputFiles({ name: 'inspiration.png', mimeType: 'image/png', buffer: png });
  await expect(customer.getByRole('button', { name: /Remove inspiration/ })).toBeVisible();
  await customer.getByRole('button', { name: /Continue/ }).click();

  // Step 3: selections
  await customer.getByRole('button', { name: 'Add Bridal bouquet (demo)' }).click();
  await customer.getByRole('button', { name: /Continue/ }).click();

  // Step 4: the estimate is honest about what it is
  await expect(customer.getByText('This is a starting point, not a final price.')).toBeVisible();
  await customer.getByRole('button', { name: /Continue/ }).click();

  // Step 5: availability
  await expect(customer.getByText(/looks open|available|open/i).first()).toBeVisible();
  await customer.getByRole('button', { name: /Continue/ }).click();

  // Step 6: send
  await customer.getByRole('button', { name: /Send my plan/ }).click();
  await expect(customer.getByText('Thank you. Your plan is saved and with the team.')).toBeVisible();

  // Everything was saved, with nothing reserved yet.
  const inquiry = (await query<{ id: string; reference: string }>(`SELECT i.id, i.reference FROM wedding_inquiries i JOIN customers c ON c.id = i.customer_id WHERE c.email = $1`, [customerEmail]))[0];
  expect(inquiry).toBeTruthy();
  const saved = await query(`SELECT 1 FROM wedding_inquiry_items WHERE inquiry_id = $1`, [inquiry.id]);
  expect(saved.length).toBeGreaterThan(0);
  await waitForNotification(customerEmail, 'wedding_inquiry_received');
  await expect.poll(async () => (await query(`SELECT 1 FROM notifications WHERE template_code = 'staff_new_inquiry' AND subject_id = $1`, [inquiry.id])).length, { timeout: 30_000 }).toBeGreaterThan(0);

  // The customer books a consultation from the times offered.
  const consultationButton = customer.getByTestId('consultation-slot').first();
  await expect(consultationButton).toBeVisible();
  await consultationButton.click();
  await expect(customer.getByText(/Your consultation/).first()).toBeVisible();
  const consultations = await query(`SELECT 1 FROM consultations WHERE inquiry_id = $1 AND status = 'booked'`, [inquiry.id]);
  expect(consultations).toHaveLength(1);

  // The team reviews, approves, and sends a quote.
  const staff = await signInStaff(browser, 'owner@demo.example');
  await staff.goto(`/admin/weddings/${inquiry.id}`);
  await expect(staff.getByText('Blush and sage')).toBeVisible();
  await staff.getByRole('button', { name: 'Accept and start planning' }).click();
  await staff.getByRole('button', { name: 'New quote' }).click();
  await staff.getByLabel('Price each').first().fill('250.00');
  await staff.getByLabel('Deposit, in dollars').fill('50.00');
  await staff.getByRole('button', { name: 'Save draft' }).click();
  await staff.getByRole('button', { name: 'Send to customer' }).click();
  await waitForNotification(customerEmail, 'quote_ready');

  // The customer accepts. That holds the date. It does not confirm it.
  const quoteMail = (await query<{ body: string }>(`SELECT body FROM notifications WHERE recipient = $1 AND template_code = 'quote_ready'`, [customerEmail]))[0].body;
  const quoteToken = quoteMail.match(/\/quote\/([\w-]+)/)?.[1];
  await customer.goto(`/quote/${quoteToken}`);
  await customer.getByLabel('Type your full name').fill('Riley Example');
  await customer.getByText('I accept this quote and its terms.').click();
  await customer.getByRole('button', { name: 'Accept quote' }).click();

  await expect.poll(async () => (await query<{ status: string }>(`SELECT status FROM event_bookings WHERE inquiry_id = $1`, [inquiry.id]))[0]?.status).toBe('hold');

  // The deposit is paid, and only the verified payment confirms it.
  await customer.getByRole('link', { name: /Pay|deposit/i }).or(customer.getByRole('button', { name: /Pay securely/ })).first().click();
  const payNow = customer.getByRole('button', { name: /Pay securely/ });
  if (await payNow.isVisible().catch(() => false)) await payNow.click();
  await expect(customer).toHaveURL(/\/api\/dev\/mock-checkout\//);
  await customer.getByRole('button', { name: 'Pay (simulate success)' }).click();
  await expect.poll(async () => (await query<{ status: string }>(`SELECT status FROM event_bookings WHERE inquiry_id = $1`, [inquiry.id]))[0]?.status, { timeout: 20_000 }).toBe('confirmed');

  // Crew and calendar reservations now exist, and the project is live.
  const reservations = await query<{ status: string }>(`SELECT r.status FROM resource_reservations r JOIN event_bookings b ON b.id = r.booking_id WHERE b.inquiry_id = $1`, [inquiry.id]);
  expect(reservations.length).toBeGreaterThan(0);
  expect(reservations.every((r: { status: string }) => r.status === 'confirmed')).toBe(true);
  await waitForNotification(customerEmail, 'booking_confirmed');

  await staff.context().close();
  await customer.context().close();
});

test('Scenario D: a fully booked date protects existing bookings and offers alternatives', async ({ browser }) => {
  const eventDate = futureSaturday(40);
  const owner = await signInStaff(browser, 'owner@demo.example');

  const submit = async (customerEmail: string) => {
    const customer = await newCustomer(browser);
    await customer.goto('/plan');
    const res = await customer.evaluate(
      async ({ customerEmail, eventDate }: { customerEmail: string; eventDate: string }) => {
        const r = await fetch('/api/public/planner/submit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ idempotency_key: crypto.randomUUID(), contact: { name: 'Booked Example', email: customerEmail }, event_type: 'Wedding', event_date: eventDate, ceremony_time: '15:00', reception_time: '17:00', venue_name: 'Fictional Barn', guest_count: 80, style: {}, selections: [] }),
        });
        return (await r.json()) as { reference: string };
      },
      { customerEmail, eventDate },
    );
    const inquiry = (await query<{ id: string }>(`SELECT id FROM wedding_inquiries WHERE reference = $1`, [res.reference]))[0];
    const quote = await staffApi(owner, 'POST', `/api/admin/weddings/${inquiry.id}/quotes`, { lines: [{ description: 'Florals', quantity: 1, unit_price_cents: 100000 }], deposit_cents: 0 });
    await staffApi(owner, 'POST', `/api/admin/weddings/quotes/${quote.id}/send`, {});
    await waitForNotification(customerEmail, 'quote_ready');
    const body = (await query<{ body: string }>(`SELECT body FROM notifications WHERE recipient = $1 AND template_code = 'quote_ready'`, [customerEmail]))[0].body;
    return { customer, token: body.match(/\/quote\/([\w-]+)/)?.[1] as string, inquiryId: inquiry.id };
  };
  const accept = (customer: Awaited<ReturnType<typeof submit>>['customer'], token: string) =>
    customer.evaluate(async (token: string) => {
      const r = await fetch(`/api/public/quotes/${token}/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Booked Example', agree: true }) });
      return { status: r.status, body: await r.json() };
    }, token);

  // Two events use both demo crews.
  for (const who of ['first', 'second']) {
    const e = await submit(email(who));
    const ok = await accept(e.customer, e.token);
    expect(ok.status).toBe(200);
    await e.customer.context().close();
  }
  const confirmed = await query<{ id: string }>(`SELECT id FROM event_bookings WHERE event_date = $1 AND status = 'confirmed'`, [eventDate]);
  expect(confirmed).toHaveLength(2);

  // A third customer sees that in the planner, with real alternatives.
  const third = await newCustomer(browser);
  await third.goto('/plan');
  await third.getByLabel('Your name').fill('Third Example');
  await third.getByRole('textbox', { name: 'Email' }).fill(email('third'));
  await third.getByLabel('Event date').fill(eventDate);
  await third.getByLabel('Ceremony time').fill('15:00');
  for (let i = 0; i < 4; i++) await third.getByRole('button', { name: /Continue/ }).click();
  await expect(third.getByText('Nearby dates that may work')).toBeVisible();
  await third.context().close();

  // Even if a quote slips through, accepting it cannot take the date.
  const late = await submit(email('late'));
  const refused = await accept(late.customer, late.token);
  expect(refused.status).toBe(409);
  const stillConfirmed = await query<{ id: string }>(`SELECT id FROM event_bookings WHERE event_date = $1 AND status = 'confirmed'`, [eventDate]);
  expect(stillConfirmed.map((b: { id: string }) => b.id).sort()).toEqual(confirmed.map((b: { id: string }) => b.id).sort());
  await late.customer.context().close();
  await owner.context().close();
});

test('Scenario E: an inventory shortage blocks the sale, or goes to review, and alerts the owner', async ({ browser }) => {
  const owner = await signInStaff(browser, 'owner@demo.example');
  const jar = (await query<{ id: string; on_hand: number }>(`SELECT i.id, l.on_hand FROM inventory_items i JOIN inventory_levels l ON l.item_id = i.id WHERE i.sku = 'MAT-JAR'`))[0];
  await staffApi(owner, 'POST', `/api/admin/inventory/items/${jar.id}/adjust`, { delta: -jar.on_hand, reason: 'adjust', note: 'E2E shortage' });

  try {
    const customer = await newCustomer(browser);
    await customer.goto('/shop/demo-mason-jar');
    await expect(customer.getByText('Sold out for now.')).toBeVisible();
    await expect(customer.getByRole('button', { name: /Add to cart/ })).toHaveCount(0);

    // The owner gets an actionable alert.
    await expect.poll(async () => (await query(`SELECT 1 FROM low_stock_events WHERE item_id = $1`, [jar.id])).length, { timeout: 20_000 }).toBeGreaterThan(0);
    await owner.goto('/admin');
    await expect(owner.getByRole('heading', { name: 'Low stock' })).toBeVisible();
    await expect(owner.getByText(/Glass jar/)).toBeVisible();

    // With the review setting, the order is accepted for review only, with no payment taken.
    await staffApi(owner, 'PUT', '/api/admin/settings/ordering', { out_of_stock_behavior: 'review' });
    await customer.goto('/shop/demo-mason-jar');
    await customer.getByRole('button', { name: /Add to cart/ }).click();
    await expect(customer.getByText('Added to your cart.')).toBeVisible();
    await customer.goto('/checkout');
    const customerEmail = email('ellis');
    await fillContact(customer, { name: 'Ellis Example', email: customerEmail });
    await customer.getByText('Pick up at the shop').click();
    await pickFirstOpenSlot(customer);
    await expect(customer.getByText('The shop confirms this one first.')).toBeVisible();
    await customer.getByRole('button', { name: /Send my request/ }).click();
    await expect(customer).toHaveURL(/\/track\//);
    await expect(customer.getByText('With the shop for review').first()).toBeVisible();
    const order = (await query<{ status: string; payment_status: string; id: string }>(`SELECT id, status, payment_status FROM orders WHERE contact_email = $1`, [customerEmail]))[0];
    expect(order.status).toBe('awaiting_review');
    expect(order.payment_status).not.toBe('paid');
    await expect.poll(async () => (await query(`SELECT 1 FROM notifications WHERE template_code = 'staff_order_needs_approval' AND subject_id = $1`, [order.id])).length, { timeout: 30_000 }).toBeGreaterThan(0);
    await customer.context().close();
  } finally {
    await staffApi(owner, 'PUT', '/api/admin/settings/ordering', { out_of_stock_behavior: 'reject' });
    await staffApi(owner, 'POST', `/api/admin/inventory/items/${jar.id}/adjust`, { delta: jar.on_hand, reason: 'adjust', note: 'E2E restore' });
    await owner.context().close();
  }
});

test('Scenario F: with Twilio disabled, orders work and no text is attempted', async ({ browser }) => {
  const customerEmail = email('finley');
  const customer = await newCustomer(browser);
  await addProductToCart(customer, 'demo-soy-candle');
  await customer.goto('/checkout');
  await fillContact(customer, { name: 'Finley Example', email: customerEmail, phone: '(989) 555-0142' });
  await customer.getByText('Pick up at the shop').click();
  await pickFirstOpenSlot(customer);
  await expect(customer.getByText('Sales tax')).toBeVisible();

  // No text-message option is offered, because none could be sent.
  await expect(customer.getByText('Text me updates about this order.')).toHaveCount(0);

  await continueToPayment(customer);
  const token = await simulatePayment(customer);
  const order = await orderForToken(token);
  expect(order.payment_status).toBe('paid');
  await waitForNotification(customerEmail, 'order_confirmation');

  const texts = await query(`SELECT 1 FROM notifications n JOIN customers c ON c.id = n.customer_id WHERE c.email = $1 AND n.channel = 'sms'`, [customerEmail]);
  expect(texts).toHaveLength(0);

  const staff = await signInStaff(browser, 'owner@demo.example');
  await staff.goto(`/admin/orders/${order.id}`);
  await staff.getByRole('button', { name: 'Mark ready' }).click();
  await staff.getByRole('button', { name: 'Mark picked up' }).click();
  await customer.reload();
  await expect(customer.getByText('Fulfilled').first()).toBeVisible();
  await staff.context().close();
  await customer.context().close();
});

test('Scenario G: an uncertain payment stays pending, then settles exactly once', async ({ browser, request }) => {
  const customerEmail = email('gale');
  const customer = await newCustomer(browser);
  await addProductToCart(customer, 'demo-soy-candle');
  await customer.goto('/checkout');
  await fillContact(customer, { name: 'Gale Example', email: customerEmail });
  await customer.getByText('Pick up at the shop').click();
  await pickFirstOpenSlot(customer);
  await continueToPayment(customer);
  const sessionUrl = new URL(customer.url()).pathname;
  const token = await simulatePayment(customer, 'Bank transfer (payment stays pending)');

  // Landing back on the site does not make it paid.
  await expect(customer.getByText('Payment processing').first()).toBeVisible();
  let order = await orderForToken(token);
  expect(order.payment_status).not.toBe('paid');
  expect(await query(`SELECT 1 FROM staff_tasks WHERE subject_id = $1`, [order.id])).toHaveLength(0);
  expect(await query(`SELECT 1 FROM notifications WHERE recipient = $1 AND template_code = 'order_confirmation'`, [customerEmail])).toHaveLength(0);

  // The settlement arrives, then arrives again.
  expect((await request.post(`${sessionUrl}/settle`)).ok()).toBe(true);
  expect((await request.post(`${sessionUrl}/settle`)).ok()).toBe(true);

  order = await orderForToken(token);
  expect(order.payment_status).toBe('paid');
  const payments = await query<{ status: string; amount_cents: number }>(`SELECT status, amount_cents FROM payments WHERE order_id = $1`, [order.id]);
  expect(payments).toHaveLength(1);
  expect(payments[0].status).toBe('succeeded');
  expect(await query(`SELECT 1 FROM orders WHERE contact_email = $1`, [customerEmail])).toHaveLength(1);
  expect((await query(`SELECT 1 FROM staff_tasks WHERE subject_id = $1`, [order.id])).length).toBeGreaterThan(0);
  await waitForNotification(customerEmail, 'order_confirmation');
  expect(await query(`SELECT 1 FROM notifications WHERE recipient = $1 AND template_code = 'order_confirmation'`, [customerEmail])).toHaveLength(1);

  await customer.reload();
  await expect(customer.getByText('Payment confirmed').or(customer.getByText('Accepted')).first()).toBeVisible();
  await customer.context().close();
});

test('Scenario H: each item in an order has its own tracked status', async ({ browser }) => {
  const customerEmail = email('harper');
  const customer = await newCustomer(browser);
  await addProductToCart(customer, 'demo-white-bouquet');
  await addProductToCart(customer, 'demo-soy-candle');
  await customer.goto('/checkout');
  await fillContact(customer, { name: 'Harper Example', email: customerEmail });
  await customer.getByText('Pick up at the shop').first().click();
  await pickFirstOpenSlot(customer);
  await continueToPayment(customer);
  const token = await simulatePayment(customer);
  const order = await orderForToken(token);

  const staff = await signInStaff(browser, 'owner@demo.example');
  await staff.goto(`/admin/orders/${order.id}`);
  const candle = staff.locator('li', { hasText: 'Fig & Cedar Candle' }).first();
  const bouquet = staff.locator('li', { hasText: 'Quiet White Bouquet' }).first();

  await candle.getByRole('button', { name: 'Mark ready' }).click();
  await expect(candle.getByRole('button', { name: 'Mark picked up' })).toBeVisible();
  await bouquet.getByRole('button', { name: 'Start preparing' }).click();
  // "Mark ready" is already on screen before this click, so wait for the recorded status instead.
  const statusOf = async (name: string) => (await query<{ name: string; status: string }>(`SELECT name, status FROM order_items WHERE order_id = $1`, [order.id])).find((i: { name: string; status: string }) => i.name.includes(name))?.status;
  await expect.poll(() => statusOf('Bouquet')).toBe('preparing');
  expect(await statusOf('Candle')).toBe('ready');
  await expect(bouquet.getByRole('button', { name: 'Start preparing' })).toHaveCount(0);

  // The customer sees each one, and that the order is not finished.
  await customer.reload();
  const candleRow = customer.locator('li', { hasText: 'Fig & Cedar Candle' }).first();
  const bouquetRow = customer.locator('li', { hasText: 'Quiet White Bouquet' }).first();
  await expect(candleRow.getByText('Ready')).toBeVisible();
  await expect(bouquetRow.getByText('Being prepared')).toBeVisible();

  // Handing over one item leaves the order open.
  await candle.getByRole('button', { name: 'Mark picked up' }).click();
  await expect(candle.getByText(/fulfilled/i)).toBeVisible();
  await expect.poll(async () => (await orderForToken(token)).status).toBe('partially_fulfilled');
  await customer.reload();
  await expect(customer.getByText('Partly complete').first()).toBeVisible();

  // Only the last item finishes it.
  await bouquet.getByRole('button', { name: 'Mark ready' }).click();
  await bouquet.getByRole('button', { name: 'Mark picked up' }).click();
  await expect.poll(async () => (await orderForToken(token)).status).toBe('fulfilled');
  await customer.reload();
  await expect(customer.getByText('Fulfilled').first()).toBeVisible();

  await staff.context().close();
  await customer.context().close();
});
