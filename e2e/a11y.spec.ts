import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { addProductToCart, newCustomer, pickFirstOpenSlot, resetRateLimits, signInStaff, skipIntro } from './support/helpers.js';

test.beforeEach(resetRateLimits);

async function expectNoViolations(page: Page, label: string, include?: string) {
  // The drifting petals are decorative and marked as such.
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('canvas');
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s), e.g. ${v.nodes[0].target.join(' ')} — ${(v.nodes[0].failureSummary ?? '').split('\n').slice(0, 2).join(' ')}`);
  expect(summary, `${label} has accessibility violations`).toEqual([]);
}

test('checkout form', async ({ browser }) => {
  const page = await newCustomer(browser);
  await addProductToCart(page, 'demo-soy-candle');
  await page.goto('/checkout');
  await page.getByText('Pick up at the shop').click();
  await pickFirstOpenSlot(page);
  await expect(page.getByText('Sales tax')).toBeVisible();
  await expectNoViolations(page, 'Checkout');
  await page.context().close();
});

test('every planner step', async ({ page }) => {
  await skipIntro(page);
  await page.goto('/plan');
  await page.getByLabel('Your name').fill('Riley Example');
  await page.getByRole('textbox', { name: 'Email' }).fill('riley-a11y@example.test');
  await page.getByLabel('Event date').fill('2030-06-15');
  await expectNoViolations(page, 'Planner step 1');
  for (const step of [2, 3, 4, 5, 6]) {
    await page.getByRole('button', { name: /Continue/ }).click();
    await page.waitForTimeout(500);
    await expectNoViolations(page, `Planner step ${step}`);
  }
});

for (const [name, path] of [
  ['shop', '/shop'],
  ['product', '/shop/demo-garden-bouquet'],
  ['order lookup', '/track'],
  ['customer sign-in', '/account'],
  ['privacy', '/privacy'],
  ['terms', '/terms'],
  ['live video', '/live'],
] as const) {
  test(`${name} page`, async ({ page }) => {
    await skipIntro(page);
    await page.goto(path);
    await page.waitForTimeout(900);
    await expectNoViolations(page, name);
  });
}

// These long marketing pages reveal text as you scroll, which a scan catches mid-fade, so it checks the forms.
for (const [name, path] of [
  ['contact form', '/about'],
  ['event inquiry form', '/weddings-events'],
  ['flower inquiry form', '/flowers'],
] as const) {
  test(`${name}`, async ({ page }) => {
    await skipIntro(page);
    await page.goto(path);
    const form = page.locator('form').first();
    await form.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    await expectNoViolations(page, name, 'form');
  });
}

test('staff sign-in', async ({ page }) => {
  await skipIntro(page);
  await page.goto('/admin');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expectNoViolations(page, 'Staff sign-in');
});

test('staff dashboard pages', async ({ browser }) => {
  const staff = await signInStaff(browser, 'owner@demo.example');
  for (const path of ['/admin', '/admin/orders', '/admin/calendar', '/admin/deliveries', '/admin/products', '/admin/inventory', '/admin/weddings', '/admin/settings', '/admin/setup', '/admin/reports']) {
    await staff.goto(path);
    await staff.waitForTimeout(700);
    await expectNoViolations(staff, path);
  }
  await staff.context().close();
});

test('forms can be used with the keyboard alone', async ({ page }) => {
  await skipIntro(page);
  await page.goto('/admin');
  await page.keyboard.press('Tab');
  await page.getByLabel('Email').focus();
  await page.keyboard.type('owner@demo.example');
  await page.keyboard.press('Tab');
  await page.keyboard.type('e2e-password-not-secret');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
});
