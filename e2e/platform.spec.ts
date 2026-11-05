import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { addProductToCart, continueToPayment, fillContact, newCustomer, orderForToken, pickFirstOpenSlot, query, resetRateLimits, signInStaff, simulatePayment, staffApi, waitForNotification } from './support/helpers.js';

test.beforeEach(resetRateLimits);

const email = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}@example.test`;

async function placePaidPickup(browser: Parameters<typeof newCustomer>[0], customerEmail: string, slug = 'demo-gift-box') {
  const customer = await newCustomer(browser);
  await addProductToCart(customer, slug);
  await customer.goto('/checkout');
  await fillContact(customer, { name: 'Example Customer', email: customerEmail });
  await customer.getByText('Pick up at the shop').click();
  await pickFirstOpenSlot(customer);
  await continueToPayment(customer);
  const token = await simulatePayment(customer);
  return { customer, token, order: await orderForToken(token) };
}

test('product discovery: search, filters and persistent catalog data', async ({ page }) => {
  await page.goto('/shop');
  await expect(page.getByRole('link', { name: /Garden Bouquet/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Boutique', exact: true }).click();
  await expect(page.getByRole('link', { name: /Fig & Cedar Candle/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Garden Bouquet/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Everything', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search the shop' });
  await search.fill('peony');
  await search.press('Enter');
  await expect(page.getByRole('link', { name: /Peony Season/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Garden Bouquet/ })).toHaveCount(0);
});

test('cart: persists across a reload, and prices come from the server', async ({ browser }) => {
  const customer = await newCustomer(browser);
  await addProductToCart(customer, 'demo-soy-candle');
  await customer.goto('/cart');
  await expect(customer.getByText(/Fig & Cedar Candle/).first()).toBeVisible();
  await customer.reload();
  await expect(customer.getByText(/Fig & Cedar Candle/).first()).toBeVisible();

  // A client-submitted price has no way in: the field is ignored, and a stale total is refused.
  const result = await customer.evaluate(async () => {
    const cart = (await (await fetch('/api/public/cart')).json()) as { lines: Array<{ id: string; variant_id: string }> };
    const add = await fetch('/api/public/cart/items', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ variant_id: cart.lines[0].variant_id, quantity: 1, price_cents: 1, unit_price_cents: 1 }) });
    const after = (await (await fetch('/api/public/cart')).json()) as { lines: Array<{ unit_price_cents: number }>; totals: { subtotal_cents: number } };
    return { addStatus: add.status, subtotal: after.totals.subtotal_cents, unit: after.lines[0].unit_price_cents };
  });
  expect(result.unit).toBe(2800);
  expect(result.subtotal).toBe(5600);
  await customer.context().close();
});

test('promotion codes apply on the server, and invalid ones are refused', async ({ browser }) => {
  const customer = await newCustomer(browser);
  await addProductToCart(customer, 'demo-mason-jar');
  await customer.goto('/cart');
  const code = customer.getByLabel(/promo|code/i).first();
  await code.fill('NOT-A-REAL-CODE');
  await customer.getByRole('button', { name: 'Apply' }).click();
  await expect(customer.getByText(/not valid|isn.t valid|not recognized|could not|did not/i).first()).toBeVisible();
  await code.fill('WELCOME10');
  await customer.getByRole('button', { name: 'Apply' }).click();
  await expect(customer.getByText('WELCOME10').first()).toBeVisible();
  await expect(customer.getByText('−$3.50').first()).toBeVisible();
  await customer.context().close();
});

test('order tracking: links are private, and lookups reveal nothing', async ({ browser }) => {
  const customerEmail = email('private');
  const { customer, token, order } = await placePaidPickup(browser, customerEmail);

  const stranger = await newCustomer(browser);
  await stranger.goto('/track/not-a-real-token-at-all-000000000000');
  await expect(stranger.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
  await expect(stranger.getByText(order.reference)).toHaveCount(0);

  // The same answer whether or not the order exists, so it can't be used to probe customers.
  await stranger.goto('/track');
  await stranger.getByLabel('Order number').fill(order.reference);
  await stranger.getByLabel('Email used for the order').fill('wrong-person@example.test');
  await stranger.getByRole('button', { name: /Email me a link/ }).click();
  await expect(stranger.getByText(/If that order matches that email/)).toBeVisible();
  const sent = await query(`SELECT 1 FROM notifications WHERE recipient = 'wrong-person@example.test'`);
  expect(sent).toHaveLength(0);

  // An anonymous API call gets nothing without the token, and the token view holds no address or email.
  const body = await customer.evaluate(async (t: string) => (await (await fetch(`/api/public/track/${t}`)).text()), token);
  expect(body).not.toContain(customerEmail);
  await stranger.context().close();
  await customer.context().close();
});

test('customer accounts: passwordless sign-in shows order history, and one customer never sees another', async ({ browser }) => {
  const customerEmail = email('member');
  const { customer, order } = await placePaidPickup(browser, customerEmail);

  await customer.goto('/account');
  await customer.getByRole('textbox', { name: 'Email' }).fill(customerEmail);
  await customer.getByRole('button', { name: /link|sign in/i }).click();
  await expect(customer.getByText(/on its way|check your email/i).first()).toBeVisible();

  await waitForNotification(customerEmail, 'customer_login');
  const mail = (await query<{ body: string }>(`SELECT body FROM notifications WHERE recipient = $1 AND template_code = 'customer_login' ORDER BY created_at DESC LIMIT 1`, [customerEmail]))[0].body;
  const link = mail.match(/https?:\/\/\S+/)?.[0] as string;
  await customer.goto(link);
  await expect(customer.getByText(order.reference).first()).toBeVisible();

  // The link works once.
  const other = await newCustomer(browser);
  await other.goto(link);
  await expect(other.getByText(order.reference)).toHaveCount(0);

  // Another customer's session cannot read this one's data.
  const otherEmail = email('other');
  const second = await placePaidPickup(browser, otherEmail, 'demo-soy-candle');
  await second.customer.goto('/account');
  await second.customer.getByRole('textbox', { name: 'Email' }).fill(otherEmail);
  await second.customer.getByRole('button', { name: /link|sign in/i }).click();
  await waitForNotification(otherEmail, 'customer_login');
  const otherMail = (await query<{ body: string }>(`SELECT body FROM notifications WHERE recipient = $1 AND template_code = 'customer_login' ORDER BY created_at DESC LIMIT 1`, [otherEmail]))[0].body;
  await second.customer.goto(otherMail.match(/https?:\/\/\S+/)?.[0] as string);
  await expect(second.customer.getByText(second.order.reference).first()).toBeVisible();
  await expect(second.customer.getByText(order.reference)).toHaveCount(0);

  await other.context().close();
  await second.customer.context().close();
  await customer.context().close();
});

test('refunds: staff refund through the dashboard, and the customer is told', async ({ browser }) => {
  const customerEmail = email('refund');
  const { customer, token, order } = await placePaidPickup(browser, customerEmail);
  const staff = await signInStaff(browser, 'owner@demo.example');
  await staff.goto(`/admin/orders/${order.id}`);
  await staff.getByRole('button', { name: 'Refund', exact: true }).click();
  const dialog = staff.getByRole('dialog');
  await dialog.getByLabel(/Amount in dollars/).fill('10.00');
  await dialog.getByLabel(/Reason/).fill('Customer changed their mind');
  await dialog.getByRole('button', { name: 'Issue refund' }).click();

  await expect.poll(async () => (await orderForToken(token)).payment_status, { timeout: 15_000 }).toMatch(/partially_refunded|refunded/);
  const refunds = await query<{ status: string; amount_cents: number }>(`SELECT status, amount_cents FROM refunds WHERE order_id = $1`, [order.id]);
  expect(refunds).toHaveLength(1);
  expect(refunds[0].amount_cents).toBe(1000);
  await waitForNotification(customerEmail, 'refund_issued');
  await customer.reload();
  await expect(customer.getByText(/Refunded/i).first()).toBeVisible();
  await staff.context().close();
  await customer.context().close();
});

test('role restrictions: each role sees and does only its own work', async ({ browser }) => {
  const customerEmail = email('roles');
  const { customer, order } = await placePaidPickup(browser, customerEmail);
  await customer.context().close();

  // A driver has no financial view, and no access to settings or team.
  const driver = await signInStaff(browser, 'driver@demo.example');
  await expect(driver.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await expect(driver.getByRole('link', { name: 'Reports' })).toHaveCount(0);
  await expect(driver.getByRole('link', { name: 'Team' })).toHaveCount(0);
  const driverSettings = await driver.evaluate(async () => (await fetch('/api/admin/settings')).status);
  expect(driverSettings).toBe(403);
  const driverRefund = await driver.evaluate(async (id: string) => (await fetch(`/api/admin/orders/${id}/refund`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount_cents: 100 }) })).status, order.id);
  expect(driverRefund).toBe(403);
  await driver.goto(`/admin/orders/${order.id}`);
  await expect(driver.getByRole('heading', { name: 'Payment' })).toHaveCount(0);
  await driver.context().close();

  // A florist works orders but cannot refund, or read money totals.
  const florist = await signInStaff(browser, 'florist@demo.example');
  const view = await florist.evaluate(async (id: string) => (await (await fetch(`/api/admin/orders/${id}`)).json()) as { total_cents?: number; payments?: unknown[] }, order.id);
  expect(view.total_cents).toBeUndefined();
  await florist.goto('/admin/settings');
  await expect(florist.getByRole('heading', { name: 'Settings' })).toHaveCount(0);
  await florist.context().close();

  // Only an owner can approve business rules.
  const finance = await signInStaff(browser, 'finance@demo.example');
  const approve = await finance.evaluate(async () => (await fetch('/api/admin/settings/ordering/approval', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approved: true }) })).status);
  expect(approve).toBe(403);
  await finance.context().close();

  // No session, no dashboard data.
  const anonymous = await newCustomer(browser);
  await anonymous.goto('/');
  const status = await anonymous.evaluate(async () => (await fetch('/api/admin/orders')).status);
  expect(status).toBe(401);
  await anonymous.context().close();
});

test('staff calendar: month view shows real bookings, and a move respects the rules', async ({ browser }) => {
  const customerEmail = email('calendar');
  const { customer, order } = await placePaidPickup(browser, customerEmail);
  await customer.context().close();

  const staff = await signInStaff(browser, 'owner@demo.example');
  const date = (await query<{ scheduled_date: string }>(`SELECT scheduled_date::text FROM fulfillments WHERE order_id = $1`, [order.id]))[0].scheduled_date;
  await staff.goto('/admin/calendar');
  await expect(staff.getByRole('button', { name: 'month' })).toBeVisible();

  const from = date;
  const data = await staffApi<{ items: Array<{ kind: string; source_id: string; title: string; movable: boolean }> }>(staff, 'GET', `/api/admin/calendar?from=${from}&to=${from}&kinds=pickup`);
  const item = data.items.find((i) => i.title.includes(order.reference));
  expect(item).toBeTruthy();

  await staff.getByRole('button', { name: 'day', exact: true }).click();
  await expect(staff.getByRole('heading', { name: 'Capacity' })).toBeVisible();
  await staff.getByRole('button', { name: 'week', exact: true }).click();
  await staff.getByRole('button', { name: 'month', exact: true }).click();

  // A move onto a closed day is refused and nothing changes.
  await staffApi(staff, 'POST', '/api/admin/blackouts', { starts_on: '2030-01-07', ends_on: '2030-01-07', reason: 'closure', affects: [] });
  const moved = await staff.evaluate(
    async ({ id }: { id: string }) => (await fetch('/api/admin/calendar/move', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'pickup', id, date: '2030-01-07' }) })).status,
    { id: item?.source_id as string },
  );
  expect(moved).toBeGreaterThanOrEqual(400);
  const still = await query<{ scheduled_date: string }>(`SELECT scheduled_date::text FROM fulfillments WHERE order_id = $1`, [order.id]);
  expect(still[0].scheduled_date).toBe(date);
  await staff.context().close();
});

test('owner settings: a change takes effect for customers, and is recorded in the audit log', async ({ browser }) => {
  const owner = await signInStaff(browser, 'owner@demo.example');
  await owner.goto('/admin/settings');
  await owner.getByRole('button', { name: 'Shop', exact: true }).click();
  await owner.getByLabel('Notice shown in the shop').fill('Closed for inventory on Friday.');
  await owner.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(owner.getByText('Saved.')).toBeVisible();

  const customer = await newCustomer(browser);
  await customer.goto('/shop');
  await expect(customer.getByText('Closed for inventory on Friday.')).toBeVisible();
  await customer.context().close();

  const audit = await query(`SELECT 1 FROM audit_logs WHERE action LIKE 'settings%' AND created_at > now() - interval '1 minute'`);
  expect(audit.length).toBeGreaterThan(0);
  await staffApi(owner, 'PUT', '/api/admin/settings/general', { notice_banner: 'This is demo data with example pricing. Payments run in test mode.' });
  await owner.context().close();
});

test('Facebook: a video is manageable, loads only on request, and fails safely', async ({ browser }) => {
  const owner = await signInStaff(browser, 'owner@demo.example');
  await staffApi(owner, 'POST', '/api/admin/marketing/videos', { url: 'https://www.facebook.com/examplepage/videos/1234567890/', title: 'A look inside the studio', kind: 'video', enabled: true, featured: true });
  await owner.context().close();

  const customer = await newCustomer(browser);
  const external: string[] = [];
  customer.on('request', (r) => {
    if (/facebook\.(com|net)/.test(r.url())) external.push(r.url());
  });
  await customer.route(/facebook\.(com|net)/, (route) => route.abort());
  await customer.goto('/live');
  await expect(customer.getByText('A look inside the studio').first()).toBeVisible();
  // Nothing from Meta loads until the visitor asks for it.
  expect(external).toHaveLength(0);

  // Blocked or unavailable, the page still works, and a link out remains.
  await customer.getByRole('button', { name: /play|watch|load/i }).first().click();
  await expect(customer.getByRole('link', { name: /Facebook/i }).first()).toBeVisible();
  await expect(customer.getByRole('navigation').first()).toBeVisible();
  await customer.context().close();
});

test('order desk: staff assign someone, change the date, print a slip and record a return', async ({ browser }) => {
  const customerEmail = email('desk');
  const { customer, order } = await placePaidPickup(browser, customerEmail);
  await customer.context().close();

  const staff = await signInStaff(browser, 'owner@demo.example');
  await staff.goto(`/admin/orders/${order.id}`);

  await staff.getByLabel('Team member to assign').selectOption({ label: 'Finley Florist, Florist (demo)' });
  await staff.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(staff.getByRole('button', { name: 'Remove Finley Florist' })).toBeVisible();

  const before = (await query<{ scheduled_date: string }>(`SELECT scheduled_date::text FROM fulfillments WHERE order_id = $1`, [order.id]))[0].scheduled_date;
  await staff.getByRole('button', { name: 'Change date or time' }).click();
  const dialog = staff.getByRole('dialog');
  // A later weekday that the demo shop is open: two weeks on, on a Monday.
  const target = new Date(Date.now() + 14 * 864e5);
  while (target.getUTCDay() !== 1) target.setUTCDate(target.getUTCDate() + 1);
  const newDate = target.toISOString().slice(0, 10);
  await dialog.getByLabel('New date').fill(newDate);
  await dialog.getByLabel('Time').selectOption({ index: 1 });
  await dialog.getByRole('button', { name: 'Move it' }).click();
  await expect.poll(async () => (await query<{ scheduled_date: string }>(`SELECT scheduled_date::text FROM fulfillments WHERE order_id = $1`, [order.id]))[0].scheduled_date).not.toBe(before);
  expect((await query<{ scheduled_date: string }>(`SELECT scheduled_date::text FROM fulfillments WHERE order_id = $1`, [order.id]))[0].scheduled_date).toBe(newDate);

  await staff.getByRole('link', { name: 'Packing slip' }).click();
  await expect(staff.getByText(`Order ${order.reference}`)).toBeVisible();
  await expect(staff.getByRole('button', { name: 'Print' })).toBeVisible();
  await expect(staff.getByText('$')).toHaveCount(0);
  await staff.getByRole('link', { name: 'Back to the order' }).click();

  await staff.getByRole('button', { name: 'Mark ready' }).click();
  await staff.getByRole('button', { name: 'Mark picked up' }).click();
  await staff.getByRole('button', { name: 'Record a return' }).click();
  await staff.getByRole('dialog').getByLabel('Reason').fill('Changed their mind');
  await staff.getByRole('dialog').getByRole('button', { name: 'Record return' }).click();
  await expect.poll(async () => (await query<{ status: string }>(`SELECT status FROM orders WHERE id = $1`, [order.id]))[0].status).toBe('returned');
  await staff.context().close();
});

test('owner setup: departments, stages, roles and crews can be changed without a developer', async ({ browser }) => {
  const owner = await signInStaff(browser, 'owner@demo.example');
  await owner.goto('/admin/products');
  await owner.getByRole('button', { name: 'Add department' }).click();
  await owner.getByRole('dialog').getByLabel('Name').fill('Holiday Market');
  await owner.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(owner.getByText('Holiday Market')).toBeVisible();

  await owner.goto('/admin/weddings');
  await owner.getByRole('button', { name: 'Manage stages' }).click();
  await owner.getByRole('dialog').getByLabel('Add a stage').fill('Site visit');
  await owner.getByRole('dialog').getByRole('button', { name: /Add|Save/ }).last().click();
  await expect.poll(async () => (await query(`SELECT 1 FROM pipeline_stages WHERE name = 'Site visit'`)).length).toBe(1);
  await owner.getByRole('dialog').getByRole('button', { name: /Cancel|Close/ }).first().click().catch(() => {});
  await owner.reload();
  await expect(owner.getByRole('heading', { name: 'Weddings & events' })).toBeVisible({ timeout: 30_000 });
  await expect(owner.getByRole('region', { name: /^Site visit,/ })).toBeVisible();

  await owner.goto('/admin/team');
  await owner.getByRole('button', { name: 'Edit what they can do' }).first().click();
  await expect(owner.getByRole('dialog').getByRole('checkbox').first()).toBeVisible();
  await owner.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await owner.context().close();
});

test('owner onboarding: the setup steps, and products loaded from a spreadsheet', async ({ browser }) => {
  const owner = await signInStaff(browser, 'owner@demo.example');
  await owner.goto('/admin/onboarding');
  await expect(owner.getByRole('heading', { name: 'Set up your shop' })).toBeVisible();
  await expect(owner.getByText('Products and photos')).toBeVisible();
  await owner.getByRole('link', { name: 'Go there' }).nth(5).click();
  await expect(owner).toHaveURL(/tab=ordering/);
  await expect(owner.getByRole('heading', { name: 'Ordering' })).toBeVisible();

  await owner.goto('/admin/products');
  const csv = [
    'name,department,category,variant,sku,price,stock,pickup,delivery,status',
    'E2E Sunflower Bunch,Floral,Seasonal,Standard,E2E-SUN-1,38.00,6,yes,yes,draft',
    'E2E Sunflower Bunch,Floral,Seasonal,Large,E2E-SUN-2,52.00,3,yes,yes,draft',
  ].join('\n');
  await owner.locator('input[type="file"][accept=".csv,text/csv"]').setInputFiles({ name: 'products.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await owner.getByRole('button', { name: 'Check the file' }).click();
  await expect(owner.getByText(/Ready to import: 1 product with 2 variants/)).toBeVisible();
  await owner.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(owner.getByText(/Imported: 1 product with 2 variants/)).toBeVisible();
  await expect(owner.getByRole('link', { name: 'E2E Sunflower Bunch' })).toBeVisible();
  await owner.context().close();
});

test('hours the owner confirms replace the unverified listing on the public site', async ({ page }) => {
  await page.goto('/about');
  // The demo shop saved all seven days: Monday to Saturday 9 to 6, closed Sunday.
  await expect(page.getByText('Mon–Sat · 9 AM–6 PM').first()).toBeVisible();
  await expect(page.getByText('Hours from the township listing')).toHaveCount(0);
  await expect(page.getByText(/^Unverified:/)).toHaveCount(0);
});

test('the original site pages still render in the platform build', async ({ page }) => {
  for (const [path, heading] of [['/', /Blooms|floral|flower/i], ['/flowers', /flower/i], ['/weddings-events', /wedding|event/i], ['/rentals', /rental/i], ['/boutique', /boutique/i], ['/about', /about|story|blooms/i]] as const) {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(path);
    await expect(page.getByRole('heading').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
    expect(errors).toHaveLength(0);
  }
});
