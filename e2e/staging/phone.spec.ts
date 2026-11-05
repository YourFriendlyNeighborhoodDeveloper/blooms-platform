import { expect, test } from '@playwright/test';
import { api, firstOpenSlot, mailbox, signIn, uniqueEmail, waitForMail } from './support.js';

/**
 * Mission 3: the first test customer, on a phone-sized screen. A real order goes through checkout
 * and the simulated payment, then the owner moves it through fulfilment while the customer's private
 * tracking page follows along, and each step's message lands in the staging mailbox.
 */
test('a customer orders on a phone, and watches the shop fulfil it', async ({ page, browser, request }) => {
  const email = uniqueEmail('first-customer');
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem('blooms-intro-seen', '1');
    } catch {
      /* Private browsing. */
    }
  });

  const owner = await signIn(browser);
  const stemsBefore = (await api<{ items: Array<{ sku: string; on_hand: number }> }>(owner, 'GET', '/api/admin/inventory/items?q=MAT-ROSE-STEM')).items.find((i) => i.sku === 'MAT-ROSE-STEM')?.on_hand as number;

  // The storefront, with its demonstration notices.
  await page.goto('/');
  await expect(page.getByText('Concept by Abraxas Technologies').first()).toBeVisible();
  await page.goto('/shop');
  await expect(page.getByText('Test mode.').first()).toBeVisible();

  // Choose and customize an arrangement.
  await page.getByRole('link', { name: /Classic Rose Bouquet/ }).first().click();
  await expect(page.getByRole('heading', { name: /Classic Rose Bouquet/ })).toBeVisible();
  await page.getByLabel('Choose').selectOption({ label: 'A dozen · $75.00' });
  await page.getByLabel('Rose color').selectOption('Blush');
  await page.getByLabel('Card message').fill('With love from the very first test customer.');
  await page.getByRole('button', { name: /Add to cart/ }).click();
  await Promise.all([page.waitForURL(/\/cart$/), page.getByRole('link', { name: 'View cart' }).click()]);
  await expect(page.getByText(/Blush/).first()).toBeVisible();

  // Checkout: pickup at a time the shop can actually meet.
  await Promise.all([page.waitForURL(/\/checkout$/), page.getByRole('link', { name: /checkout/i }).click()]);
  await page.getByLabel('Your name').fill('Abraxas Test Customer');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByText('Pick up at the shop').click();
  await firstOpenSlot(page).click();
  await expect(page.getByText('Sales tax')).toBeVisible();
  // $75.00 plus 6% tax in the demo settings.
  await expect(page.getByText('$79.50').first()).toBeVisible();
  await page.getByRole('button', { name: /Continue to secure payment/ }).click();

  // The simulated payment page says plainly that no money moves.
  await expect(page).toHaveURL(/\/api\/dev\/mock-checkout\//);
  await expect(page.getByText('Simulated: no real payment')).toBeVisible();
  await page.getByRole('button', { name: 'Pay (simulate success)' }).click();
  await expect(page).toHaveURL(/\/track\//);
  const trackingUrl = page.url().split('?')[0];
  await expect(page.getByText('Test order.').first()).toBeVisible();
  await expect(page.getByText(/Accepted|Payment confirmed/).first()).toBeVisible();

  // The owner sees the paid order, without anyone entering it by hand.
  const found = await api<{ orders: Array<{ id: string; reference: string; status: string; payment_status: string; is_test: boolean }> }>(owner, 'GET', `/api/admin/orders?q=${encodeURIComponent(email)}`);
  expect(found.orders).toHaveLength(1);
  const order = found.orders[0];
  expect(order.payment_status).toBe('paid');
  expect(order.is_test).toBe(true);
  await waitForMail(request, email, /We have your order/);

  await owner.goto(`/admin/orders/${order.id}`);
  await expect(owner.getByRole('heading', { name: order.reference })).toBeVisible();
  await expect(owner.getByText('With love from the very first test customer.')).toBeVisible();
  await owner.getByLabel('Team member to assign').selectOption({ label: 'Finley Florist, Florist (demo)' });
  await owner.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(owner.getByRole('button', { name: 'Remove Finley Florist' })).toBeVisible();

  // Preparing: the customer's page follows.
  await owner.getByRole('button', { name: 'Start preparing' }).click();
  await expect.poll(async () => (await api(owner, 'GET', `/api/admin/orders/${order.id}`)).status).toBe('preparing');
  await page.goto(trackingUrl);
  await expect(page.getByText('Being prepared').first()).toBeVisible();

  // Ready for pickup.
  await owner.getByRole('button', { name: 'Mark ready' }).click();
  await expect.poll(async () => (await api(owner, 'GET', `/api/admin/orders/${order.id}`)).status).toBe('ready');
  await page.reload();
  await expect(page.getByText('Ready').first()).toBeVisible();
  await waitForMail(request, email, /ready/i);

  // Picked up.
  await owner.getByRole('button', { name: 'Mark picked up' }).click();
  await expect.poll(async () => (await api(owner, 'GET', `/api/admin/orders/${order.id}`)).status).toBe('fulfilled');
  await page.reload();
  await expect(page.getByText('Fulfilled').first()).toBeVisible();

  // Stock left the shelf exactly once: a dozen roses.
  const stemsAfter = (await api<{ items: Array<{ sku: string; on_hand: number }> }>(owner, 'GET', '/api/admin/inventory/items?q=MAT-ROSE-STEM')).items.find((i) => i.sku === 'MAT-ROSE-STEM')?.on_hand as number;
  expect(stemsBefore - stemsAfter).toBe(12);

  // Every step is in the order history, and every message was captured, labelled as a test.
  const detail = await api<{ history: Array<{ to_status: string }> }>(owner, 'GET', `/api/admin/orders/${order.id}`);
  expect(detail.history.map((h) => h.to_status)).toEqual(expect.arrayContaining(['payment_confirmed', 'accepted', 'preparing', 'ready', 'fulfilled']));
  const messages = await mailbox(request, email);
  expect(messages.length).toBeGreaterThanOrEqual(3);
  expect(messages.every((m) => m.Subject.startsWith('[Test] '))).toBe(true);
  test.info().annotations.push({ type: 'order', description: `${order.reference} ${trackingUrl}` });
  test.info().annotations.push({ type: 'messages', description: messages.map((m) => m.Subject).join(' | ') });
});
