import { expect, test, type Page } from '@playwright/test';
import { addProductToCart, continueToPayment, fillAddress, fillContact, orderForToken, pickFirstOpenSlot, resetRateLimits, simulatePayment, skipIntro, STAFF_PASSWORD } from './support/helpers.js';

test.beforeEach(async ({ page }) => {
  await resetRateLimits();
  await skipIntro(page);
});

async function expectNoSidewaysScroll(page: Page, label: string) {
  const overflow = await page.evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  expect(overflow as number, `${label} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
}

for (const path of ['/', '/shop', '/shop/demo-garden-bouquet', '/cart', '/plan', '/track', '/account', '/live', '/privacy', '/flowers', '/weddings-events', '/rentals', '/boutique', '/about']) {
  test(`no sideways scrolling on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForTimeout(800);
    await expectNoSidewaysScroll(page, path);
  });
}

test('a customer can buy on a phone, from product to payment', async ({ page }) => {
  await addProductToCart(page, 'demo-mason-jar');
  await page.goto('/cart');
  await expectNoSidewaysScroll(page, 'cart with an item');
  await page.getByRole('link', { name: /checkout/i }).click();
  await fillContact(page, { name: 'Morgan Example', email: `morgan-${Date.now()}@example.test` });
  await page.getByText('Local delivery').click();
  await fillAddress(page);
  await pickFirstOpenSlot(page);
  await expectNoSidewaysScroll(page, 'checkout');
  await continueToPayment(page);
  const token = await simulatePayment(page);
  await expectNoSidewaysScroll(page, 'tracking');
  expect((await orderForToken(token)).payment_status).toBe('paid');
});

test('the wedding planner works on a phone', async ({ page }) => {
  await page.goto('/plan');
  await page.getByLabel('Your name').fill('Morgan Example');
  await page.getByRole('textbox', { name: 'Email' }).fill(`morgan-plan-${Date.now()}@example.test`);
  await page.getByLabel('Event date').fill('2030-06-15');
  for (const label of ['style', 'selections', 'estimate', 'date']) {
    await page.getByRole('button', { name: /Continue/ }).click();
    await page.waitForTimeout(300);
    await expectNoSidewaysScroll(page, `planner ${label}`);
  }
});

test('staff can sign in and work on a phone', async ({ page }) => {
  await page.goto('/admin');
  await page.getByLabel('Email').fill('driver@demo.example');
  await page.getByLabel('Password').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expectNoSidewaysScroll(page, 'staff overview');
  await page.goto('/admin/deliveries');
  await expect(page.getByRole('heading', { name: 'Deliveries' })).toBeVisible();
  await expectNoSidewaysScroll(page, 'staff deliveries');
  await page.goto('/admin/calendar');
  await expectNoSidewaysScroll(page, 'staff calendar');
});
