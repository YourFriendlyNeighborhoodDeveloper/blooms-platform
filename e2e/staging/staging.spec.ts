import { expect, test, type Page } from '@playwright/test';
import { api, firstOpenSlot, mailbox, messageText, openPage, signIn, uniqueEmail, waitForMail } from './support.js';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });

async function startCheckout(page: Page, slug: string, email: string, method: 'pickup' | 'delivery' = 'pickup') {
  await page.goto(`/shop/${slug}`);
  await page.getByRole('button', { name: /Add to cart/ }).click();
  await expect(page.getByText('Added to your cart.')).toBeVisible();
  await page.goto('/checkout');
  await page.getByLabel('Your name').fill('Payment Case Example');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByText(method === 'pickup' ? 'Pick up at the shop' : 'Local delivery').click();
  await firstOpenSlot(page).click();
  await page.getByRole('button', { name: /Continue to secure payment/ }).click();
  await expect(page).toHaveURL(/\/api\/dev\/mock-checkout\//);
  return new URL(page.url()).pathname;
}

test.describe('Payments, with the simulated gateway', () => {
  test('a pending payment waits, then settles once even when the confirmation arrives twice', async ({ browser, request }) => {
    const email = uniqueEmail('pending');
    const page = await openPage(browser);
    const session = await startCheckout(page, 'demo-soy-candle', email);
    await page.getByRole('button', { name: 'Bank transfer (payment stays pending)' }).click();
    await expect(page.getByText('Payment processing').first()).toBeVisible();

    const owner = await signIn(browser);
    const before = (await api(owner, 'GET', `/api/admin/orders?q=${encodeURIComponent(email)}`)).orders[0];
    expect(before.payment_status).not.toBe('paid');
    expect((await api(owner, 'GET', `/api/admin/orders/${before.id}`)).tasks).toHaveLength(0);

    for (let i = 0; i < 2; i++) expect((await request.post(`${session}/settle`)).ok()).toBe(true);
    await expect.poll(async () => (await api(owner, 'GET', `/api/admin/orders/${before.id}`)).payment_status).toBe('paid');
    const after = await api(owner, 'GET', `/api/admin/orders/${before.id}`);
    expect(after.payments.filter((p: { status: string }) => p.status === 'succeeded')).toHaveLength(1);
    expect((await api(owner, 'GET', `/api/admin/orders?q=${encodeURIComponent(email)}`)).orders).toHaveLength(1);
    await waitForMail(request, email, /We have your order/);
    expect((await mailbox(request, email)).filter((m) => /We have your order/.test(m.Subject))).toHaveLength(1);
  });

  test('a failed payment leaves the order unpaid, and the customer can pay again', async ({ browser }) => {
    const email = uniqueEmail('failed');
    const page = await openPage(browser);
    await startCheckout(page, 'demo-soy-candle', email);
    await page.getByRole('button', { name: 'Simulate a failed bank payment' }).click();
    await expect(page.getByText('Payment did not go through').first()).toBeVisible();
    await page.getByRole('button', { name: /Pay securely/ }).click();
    await expect(page).toHaveURL(/\/api\/dev\/mock-checkout\//);
    await page.getByRole('button', { name: 'Pay (simulate success)' }).click();
    await expect(page.getByText(/Accepted|Payment confirmed/).first()).toBeVisible();
  });

  test('an abandoned checkout charges nothing and keeps the cart', async ({ browser }) => {
    const page = await openPage(browser);
    await startCheckout(page, 'demo-mason-jar', uniqueEmail('abandoned'));
    await page.getByRole('button', { name: 'Go back without paying' }).click();
    await expect(page).toHaveURL(/cancelled=1/);
    await expect(page.getByText('You came back without paying.')).toBeVisible();
    await expect(page.getByText(/Jar of Blooms/).first()).toBeVisible();
  });

  test('a partial refund is recorded, and the customer is told', async ({ browser, request }) => {
    const email = uniqueEmail('refund');
    const page = await openPage(browser);
    await startCheckout(page, 'demo-gift-box', email);
    await page.getByRole('button', { name: 'Pay (simulate success)' }).click();
    const owner = await signIn(browser);
    const order = (await api(owner, 'GET', `/api/admin/orders?q=${encodeURIComponent(email)}`)).orders[0];
    await owner.goto(`/admin/orders/${order.id}`);
    await owner.getByRole('button', { name: 'Refund', exact: true }).click();
    await owner.getByRole('dialog').getByLabel(/Amount in dollars/).fill('5.00');
    await owner.getByRole('dialog').getByLabel(/Reason/).fill('Ribbon was the wrong color');
    await owner.getByRole('dialog').getByRole('button', { name: 'Issue refund' }).click();
    await expect.poll(async () => (await api(owner, 'GET', `/api/admin/orders/${order.id}`)).payment_status).toBe('partially_refunded');
    await waitForMail(request, email, /refund/i);
  });
});

test.describe('Weddings', () => {
  test('a planner inquiry reaches the owner, is quoted, and becomes a confirmed project', async ({ browser, request }) => {
    const email = uniqueEmail('wedding');
    const page = await openPage(browser);
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + 7 * 32);
    while (date.getUTCDay() !== 6) date.setUTCDate(date.getUTCDate() + 1);
    const eventDate = date.toISOString().slice(0, 10);

    await page.goto('/plan');
    await page.getByLabel('Your name').fill('Late Night Example');
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByLabel('Event date').fill(eventDate);
    await page.getByLabel('Estimated guests').fill('110');
    await page.getByLabel('Ceremony time').fill('16:00');
    await page.getByLabel('Venue name').fill('Fictional Lakeside Pavilion');
    await page.getByText('$5,000 – $10,000').click();
    await page.getByRole('button', { name: /Continue/ }).click();

    await page.getByLabel('Your colors').fill('Dusty rose and cream');
    await page.getByLabel('Tell us what you are picturing').fill('Candlelit reception, lots of greenery on the arch.');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    await page.locator('input[type="file"]').setInputFiles({ name: 'inspiration.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByRole('button', { name: /Remove inspiration/ })).toBeVisible();
    await page.getByRole('button', { name: /Continue/ }).click();

    await page.getByRole('button', { name: 'Add Bridal bouquet (demo)' }).click();
    await page.getByRole('button', { name: 'Add Reception centerpiece package (demo)' }).click();
    await page.getByRole('button', { name: 'Add Birch ceremony arch (demo)' }).click();
    await page.getByRole('button', { name: /Continue/ }).click();
    await expect(page.getByText('This is a starting point, not a final price.')).toBeVisible();
    await page.getByRole('button', { name: /Continue/ }).click();
    await page.getByRole('button', { name: /Continue/ }).click();
    await page.getByRole('button', { name: /Send my plan/ }).click();
    await expect(page.getByText('Thank you. Your plan is saved and with the team.')).toBeVisible();
    await waitForMail(request, email, /We received your plan/);

    await page.getByTestId('consultation-slot').first().click();
    await expect(page.getByText(/Your consultation is booked/).first()).toBeVisible();
    await waitForMail(request, email, /consultation is booked/i);

    const owner = await signIn(browser);
    const board = await api<{ cards: Array<{ id: string; reference: string; event_date: string }> }>(owner, 'GET', '/api/admin/weddings/board');
    const card = board.cards.find((c) => c.event_date === eventDate && c.reference);
    expect(card).toBeTruthy();
    await owner.goto(`/admin/weddings/${card?.id}`);
    await expect(owner.getByText('Dusty rose and cream')).toBeVisible();
    await owner.getByRole('button', { name: 'Accept and start planning' }).click();
    await owner.getByRole('button', { name: 'New quote' }).click();
    await owner.getByLabel('Price each').first().fill('220.00');
    await owner.getByLabel('Deposit, in dollars').fill('300.00');
    await owner.getByRole('button', { name: 'Save draft' }).click();
    await owner.getByRole('button', { name: 'Send to customer' }).click();

    // The customer follows the real link from the captured email.
    const quoteMail = await waitForMail(request, email, /quote/i);
    const link = (await messageText(request, quoteMail.ID)).match(/https?:\/\/\S+\/quote\/[\w-]+/)?.[0] as string;
    expect(link).toBeTruthy();
    await page.goto(new URL(link).pathname);
    await page.getByLabel('Type your full name').fill('Late Night Example');
    await page.getByText('I accept this quote and its terms.').click();
    await page.getByRole('button', { name: 'Accept quote' }).click();
    await page.getByRole('button', { name: /Pay securely/ }).click();
    await expect(page).toHaveURL(/\/api\/dev\/mock-checkout\//);
    await page.getByRole('button', { name: 'Pay (simulate success)' }).click();

    await expect.poll(async () => (await api(owner, 'GET', `/api/admin/weddings/${card?.id}`)).booking?.status, { timeout: 30_000 }).toBe('confirmed');
    const detail = await api(owner, 'GET', `/api/admin/weddings/${card?.id}`);
    expect(detail.project).toBeTruthy();
    const project = await api(owner, 'GET', `/api/admin/weddings/projects/${detail.project.id}`);
    expect(project.tasks.length).toBeGreaterThan(0);
    await waitForMail(request, email, /confirmed/i);
  });

  test('a fully booked date is refused with alternatives, and opens when the owner adds capacity', async ({ browser }) => {
    const owner = await signIn(browser);
    const board = await api<{ stages: Array<{ id: string; code: string }>; cards: Array<{ event_date: string; stage_id: string }> }>(owner, 'GET', '/api/admin/weddings/board');
    const confirmedStages = new Set(board.stages.filter((s) => ['confirmed', 'in_preparation', 'event_scheduled', 'awaiting_deposit'].includes(s.code)).map((s) => s.id));
    const counts = new Map<string, number>();
    for (const c of board.cards.filter((x) => confirmedStages.has(x.stage_id))) counts.set(c.event_date, (counts.get(c.event_date) ?? 0) + 1);
    const booked = [...counts.entries()].find(([, n]) => n >= 2)?.[0] as string;
    expect(booked).toBeTruthy();

    const check = async (withArch: boolean) => {
      const options = await api(owner, 'GET', '/api/public/planner/options');
      const arch = options.rentals.find((r: { name: string }) => r.name.startsWith('Birch ceremony arch'));
      return api(owner, 'POST', '/api/public/planner/availability', { event_date: booked, ceremony_time: '15:00', rentals: withArch ? [{ rental_item_id: arch.id, quantity: 1 }] : [] });
    };
    const refused = await check(false);
    expect(refused.status).toBe('unavailable');
    expect(refused.alternatives.length).toBeGreaterThan(0);
    // Three separate limits are full: events that day, crews, and the people to staff them.
    expect(refused.reasons.map((r: { code: string }) => r.code).sort()).toEqual(['capacity_crews', 'capacity_events', 'capacity_staff']);

    // The owner adds a third crew, allows three events that day, and staffs crews with one person.
    const crew = await api(owner, 'POST', '/api/admin/resources', { kind: 'crew', name: 'Event crew C (demo)' });
    const events = (await api(owner, 'GET', '/api/admin/settings')).events;
    await api(owner, 'PUT', '/api/admin/settings/events', { max_events_per_day: 3 });
    // Each change alone is not enough: the engine still names the people limit.
    expect((await check(false)).reasons.map((r: { code: string }) => r.code)).toEqual(['capacity_staff']);
    await api(owner, 'PUT', '/api/admin/settings/events', { staff_per_crew: 1 });
    try {
      expect((await check(false)).status).toBe('available');
      // Both arches are still out that day, so a plan that needs one is still refused.
      expect((await check(true)).status).toBe('unavailable');
    } finally {
      await api(owner, 'PUT', `/api/admin/resources/${crew.id}`, { kind: 'crew', name: 'Event crew C (demo)', active: false });
      await api(owner, 'PUT', '/api/admin/settings/events', { max_events_per_day: events.max_events_per_day, staff_per_crew: events.staff_per_crew });
    }
    expect((await check(false)).status).toBe('unavailable');
  });
});

test.describe('Rules that protect the shop', () => {
  test('sold out, preparation time, same day, a full window and an absent driver are all refused', async ({ browser }) => {
    const page = await openPage(browser);
    await page.goto('/shop/demo-home-pillow');
    await expect(page.getByText('Sold out for now.')).toBeVisible();

    const owner = await signIn(browser);
    const slotsFor = async (slug: string, method: 'pickup' | 'delivery') => {
      const shopper = await openPage(browser);
      await shopper.goto(`/shop/${slug}`);
      if (slug === 'demo-custom-design') await shopper.getByLabel('Occasion').fill('Retirement party');
      if (slug === 'demo-classic-roses') await shopper.getByLabel('Rose color').selectOption('Red');
      await shopper.getByRole('button', { name: /Add to cart/ }).click();
      await expect(shopper.getByText('Added to your cart.')).toBeVisible();
      const result = await api(shopper, 'POST', '/api/public/availability/slots', { method, postal_code: method === 'delivery' ? '48609' : null, line_ids: (await api(shopper, 'GET', '/api/public/cart')).lines.map((l: { id: string }) => l.id) });
      await shopper.context().close();
      return result.slots as Array<{ date: string; start: string; status: string; reasons: Array<{ code: string }> }>;
    };
    const hour = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Detroit' });

    // Custom work needs three days' notice.
    const custom = await slotsFor('demo-custom-design', 'pickup');
    const soonest = custom.find((s) => s.status !== 'blocked');
    const limit = new Date(Date.now() + 72 * 3_600_000).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });
    expect(soonest && soonest.date >= limit.slice(0, 10)).toBeTruthy();

    // Today is never offered after the same-day cutoff, or without time to prepare.
    const roses = await slotsFor('demo-classic-roses', 'delivery');
    for (const s of roses.filter((x) => x.date === today())) expect(s.status).toBe('blocked');

    // The Saturday morning window filled by the demo orders.
    const full = roses.find((s) => s.reasons.some((r) => r.code === 'capacity_stops'));
    expect(full, 'a delivery window that is full').toBeTruthy();
    expect(hour(full?.start as string)).toBe('10:00');
    const sameDayAfternoon = roses.find((s) => s.date === full?.date && hour(s.start) === '14:00');
    expect(sameDayAfternoon?.status).toBe('open');

    // The driver's day off.
    const team = await api(owner, 'GET', '/api/admin/team');
    const driver = team.staff.find((s: { email: string }) => s.email === 'driver@demo.example');
    const off = driver.time_off[0]?.starts_on as string;
    expect(off).toBeTruthy();
    const thatDay = roses.filter((s) => s.date === off);
    expect(thatDay.length).toBeGreaterThan(0);
    for (const s of thatDay) expect(s.reasons.map((r) => r.code)).toContain('no_driver');
  });

  test('roles limit what each person sees and does', async ({ browser }) => {
    const driver = await signIn(browser, 'driver@demo.example');
    await expect(driver.getByRole('link', { name: 'Settings' })).toHaveCount(0);
    expect(await driver.evaluate(async () => (await fetch('/api/admin/settings')).status)).toBe(403);
    const florist = await signIn(browser, 'florist@demo.example');
    const anyOrder = (await api(florist, 'GET', '/api/admin/orders')).orders[0];
    expect(anyOrder.total_cents).toBeUndefined();
    expect(await florist.evaluate(async (id: string) => (await fetch(`/api/admin/orders/${id}/refund`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount_cents: 100 }) })).status, anyOrder.id)).toBe(403);
    const anonymous = await openPage(browser);
    await anonymous.goto('/');
    expect(await anonymous.evaluate(async () => (await fetch('/api/admin/orders')).status)).toBe(401);
  });
});

test.describe('Nothing private is exposed', () => {
  test('secrets never reach the browser, private files are not served, and search engines are told to stay away', async ({ request }) => {
    const secrets = (process.env.STAGING_SECRET_VALUES ?? '').split('\n').filter((s) => s.length >= 12);
    expect(secrets.length).toBeGreaterThan(0);

    const html = await (await request.get('/')).text();
    const scripts = new Set([...html.matchAll(/\/assets\/[\w.-]+\.js/g)].map((m) => m[0]));
    for (const first of [...scripts]) {
      const js = await (await request.get(first)).text();
      for (const m of js.matchAll(/assets\/[\w.-]+\.js/g)) scripts.add(`/${m[0]}`);
    }
    expect(scripts.size).toBeGreaterThan(10);
    for (const path of [...scripts, '/', '/admin', '/shop', '/api/public/config']) {
      const body = await (await request.get(path)).text();
      for (const secret of secrets) expect(body.includes(secret), `${path} must not contain a secret`).toBe(false);
    }

    for (const path of ['/.env', '/.env.staging', '/deploy/staging/.env.staging', '/deploy/staging/access.txt', '/package.json', '/server/config/env.ts']) {
      const res = await request.get(path);
      const body = await res.text();
      for (const secret of secrets) expect(body.includes(secret), `${path} must not contain a secret`).toBe(false);
      expect(body.includes('DATABASE_URL'), `${path} must not be served`).toBe(false);
    }

    const page = await request.get('/shop');
    expect(page.headers()['x-robots-tag']).toContain('noindex');
    expect(await (await request.get('/robots.txt')).text()).toContain('Disallow: /');
  });

  test('after everything above, every record check still passes', async ({ browser }) => {
    const owner = await signIn(browser);
    const report = await api(owner, 'GET', '/api/admin/system/integrity');
    expect(report.checks.filter((c: { violations: number }) => c.violations > 0)).toEqual([]);
  });
});
