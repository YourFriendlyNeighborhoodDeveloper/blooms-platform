/// <reference lib="dom" />
import { expect, test, type Locator, type Page } from '@playwright/test';
import { query } from './support/helpers.js';

/**
 * Flora on a phone, as a first-time visitor sees her: the launcher must be on screen without
 * scrolling, labelled, uncovered, clear of the concept badge, and the conversation must fit the
 * screen, including when the keyboard takes half of it. Runs in Chromium (Pixel 7) and in WebKit,
 * Safari's engine (iPhone 13).
 */

async function expectFullyOnScreen(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  const vp = page.viewportSize();
  expect(box, 'element has a box').not.toBeNull();
  expect(vp).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp!.width + 0.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp!.height + 0.5);
  return box!;
}

/** Nothing sits on top of the element once the intro has lifted: a tap in its middle lands on it. */
async function expectUncovered(page: Page, locator: Locator, testId: string) {
  await expect
    .poll(
      async () => {
        const box = (await locator.boundingBox())!;
        return page.evaluate(({ x, y, testId }) => Boolean(document.elementFromPoint(x, y)?.closest(`[data-testid="${testId}"]`)), { x: box.x + box.width / 2, y: box.y + box.height / 2, testId });
      },
      { timeout: 15_000, message: 'the middle of the launcher is not covered by anything' },
    )
    .toBe(true);
}

async function waitForOnline(page: Page) {
  await expect.poll(async () => (await page.request.get('/api/public/concierge/status')).json().then((s) => s.available), { timeout: 30_000 }).toBe(true);
}

for (const path of ['/', '/shop', '/plan', '/weddings-events']) {
  test(`the launcher is on screen without scrolling on ${path}`, async ({ page }) => {
    await page.goto(path);
    const launcher = page.getByTestId('flora-launcher');
    // The intro curtain plays on a first visit; the launcher is there as soon as it lifts.
    await expect(launcher).toBeVisible({ timeout: 20_000 });
    await expect(launcher).toContainText('Chat with Flora');
    await expect(launcher).toHaveAccessibleName(/Chat with Flora/);
    const box = await expectFullyOnScreen(page, launcher);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await expect.poll(async () => page.evaluate(() => window.scrollY)).toBe(0);
    await expectUncovered(page, launcher, 'flora-launcher');
    const badge = await page.locator('.concept-badge > button').boundingBox();
    if (badge) {
      const overlap = !(box.x >= badge.x + badge.width || badge.x >= box.x + box.width || box.y >= badge.y + badge.height || badge.y >= box.y + box.height);
      expect(overlap, 'launcher and concept badge do not overlap').toBe(false);
    }
  });
}

test('the conversation fills the phone screen, and the text box stays above the keyboard', async ({ page }) => {
  await waitForOnline(page);
  await page.goto('/');
  await page.getByTestId('flora-launcher').click();
  const panel = page.getByTestId('flora-panel');
  await expect(panel).toBeVisible();
  const vp = page.viewportSize()!;
  const box = await expectFullyOnScreen(page, panel);
  expect(box.width).toBeGreaterThanOrEqual(vp.width - 1);
  await expect(panel.getByRole('button', { name: 'Close chat' })).toBeVisible();
  await expect(panel.getByText('Online', { exact: true })).toBeVisible();

  const input = panel.getByRole('textbox', { name: 'Message Flora' });
  await expectFullyOnScreen(page, input);
  const fontSize = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize, 'at least 16px, so Safari does not zoom in').toBeGreaterThanOrEqual(16);

  // An on-screen keyboard leaves roughly half the screen. The panel follows the visible area.
  await input.focus();
  const keyboardOpen = Math.round(vp.height * 0.55);
  await page.setViewportSize({ width: vp.width, height: keyboardOpen });
  await expect.poll(async () => {
    const b = await input.boundingBox();
    return Boolean(b && b.y >= 0 && b.y + b.height <= keyboardOpen + 0.5);
  }).toBe(true);
  await page.setViewportSize(vp);

  await panel.getByRole('button', { name: 'Close chat' }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByTestId('flora-launcher')).toBeVisible();
});

test('/?chat=open opens Flora straight away', async ({ page }) => {
  await page.goto('/?chat=open');
  await expect(page.getByTestId('flora-panel')).toBeVisible({ timeout: 20_000 });
});

test('when the AI service is paused, Flora stays visible and says so, with ways to carry on', async ({ page }) => {
  await query(`INSERT INTO system_alerts (code, severity, title, dedupe_key) VALUES ('concierge_provider_credits', 'critical', 'Flora is paused (test)', 'concierge-provider-credits') ON CONFLICT DO NOTHING`);
  try {
    await expect.poll(async () => (await page.request.get('/api/public/concierge/status')).json().then((s) => s.state), { timeout: 30_000 }).toBe('offline');
    await page.goto('/');
    const launcher = page.getByTestId('flora-launcher');
    await expect(launcher).toBeVisible({ timeout: 20_000 });
    await expect(launcher).toContainText('Offline right now');
    await expect(launcher).toHaveAccessibleName(/Offline right now/);
    await launcher.click();
    const panel = page.getByTestId('flora-panel');
    const banner = panel.getByRole('status');
    await expect(banner).toContainText('Flora is offline right now');
    await expect(banner).toContainText(/can't answer messages/);
    await expectFullyOnScreen(page, banner);
    await expect(panel.getByText(/no credits/)).toBeVisible();
    await expect(panel.getByRole('textbox', { name: 'Message Flora' })).toBeDisabled();
    await panel.getByRole('link', { name: 'Plan your event' }).click();
    await expect(page).toHaveURL(/\/plan$/);
  } finally {
    await query(`DELETE FROM system_alerts WHERE code = 'concierge_provider_credits'`);
    await waitForOnline(page);
  }
});
