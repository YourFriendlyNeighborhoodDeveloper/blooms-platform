/// <reference lib="dom" />
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Flora on the deployed site, as a first-time visitor sees her, in Safari's engine at iPhone size,
 * Chrome at Android size, and desktop Chrome. The launcher must be on screen without scrolling,
 * uncovered and labelled, and what it says about her status must match the server. The panel must
 * fit the screen. Set STAGING_SCREENSHOTS to a folder to keep screenshots of each.
 */

type Status = { shown: boolean; available: boolean; state: 'online' | 'offline' | 'resting'; status_message: string | null };

async function shot(page: Page, name: string) {
  const dir = process.env.STAGING_SCREENSHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${test.info().project.name}-${name}.png` });
}

async function onScreen(page: Page, locator: Locator) {
  const box = (await locator.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 0.5);
  return box;
}

// The page fixture uses each project's own device (screen, touch, user agent) and a fresh visit,
// so the intro plays first, as it does for a real first-time visitor.
test('a first-time visitor sees Flora, can open her, and is told her real status', async ({ page }) => {
  const status = (await (await page.request.get('/api/public/concierge/status')).json()) as Status;
  expect(status.shown, 'Flora is set up on this deployment').toBe(true);

  await page.goto('/');
  const launcher = page.getByTestId('flora-launcher');
  await expect(launcher).toBeVisible({ timeout: 20_000 });
  await expect(launcher).toContainText('Chat with Flora');
  await onScreen(page, launcher);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect
    .poll(async () => {
      const b = (await launcher.boundingBox())!;
      return page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('[data-testid="flora-launcher"]')), { x: b.x + b.width / 2, y: b.y + b.height / 2 });
    }, { timeout: 15_000, message: 'nothing covers the launcher' })
    .toBe(true);
  await expect(launcher).toContainText(status.available ? 'online' : 'Offline');
  // It never sits on top of the home page's own buttons.
  const lb = (await launcher.boundingBox())!;
  for (const name of ['Explore Flowers', 'Plan Your Event']) {
    // The visible pill: on phones the link itself stretches across the row, beyond what is drawn.
    const b = await page.getByRole('main').getByRole('link', { name }).first().locator('> span').first().boundingBox();
    if (b) expect(lb.x >= b.x + b.width || b.x >= lb.x + lb.width || lb.y >= b.y + b.height || b.y >= lb.y + lb.height, `launcher clear of ${name}`).toBe(true);
  }
  await shot(page, 'launcher');

  await launcher.click();
  const panel = page.getByTestId('flora-panel');
  await expect(panel).toBeVisible();
  await onScreen(page, panel);
  await expect(panel.getByRole('button', { name: 'Close chat' })).toBeVisible();
  const input = panel.getByRole('textbox', { name: 'Message Flora' });
  await onScreen(page, input);
  expect(await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  if (status.available) {
    await expect(panel.getByText('Online', { exact: true })).toBeVisible();
    await expect(input).toBeEnabled();
  } else {
    const banner = panel.getByRole('status');
    await expect(banner).toContainText(/offline/i);
    // The explanation is on screen when the panel opens, not scrolled away.
    await onScreen(page, banner);
    await expect(banner).toBeInViewport();
    await expect(input).toBeDisabled();
    await expect(panel.getByRole('link', { name: 'Plan your event' })).toBeVisible();
  }
  await shot(page, 'panel');
});
