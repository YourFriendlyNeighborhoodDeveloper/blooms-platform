import { expect, type Browser, type Page } from '@playwright/test';
import pg from 'pg';

export const STAFF_PASSWORD = 'e2e-password-not-secret';
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgres://blooms:blooms_dev_only@127.0.0.1:54329/blooms_e2e';

/** Direct database reads, used to verify what the browser cannot see. */
export async function query<T extends pg.QueryResultRow = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

export async function skipIntro(page: Page) {
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem('blooms-intro-seen', '1');
    } catch {
      /* Private mode. */
    }
  });
}

export async function newCustomer(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await skipIntro(page);
  return page;
}

export async function signInStaff(browser: Browser, email: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await skipIntro(page);
  await page.goto('/admin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('link', { name: 'Sign out' }).or(page.getByRole('button', { name: 'Sign out' }))).toBeVisible();
  return page;
}

/** Same-origin JSON call from a signed-in staff page, for arranging state a test is not about. */
export async function staffApi<T = any>(page: Page, method: string, url: string, body?: unknown): Promise<T> {
  const result = await page.evaluate(
    async ({ method, url, body }) => {
      const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      return { status: res.status, text };
    },
    { method, url, body },
  );
  if (result.status >= 400) throw new Error(`${method} ${url} returned ${result.status}: ${result.text}`);
  return result.text ? JSON.parse(result.text) : (undefined as T);
}

export async function addProductToCart(page: Page, slug: string, setup?: (page: Page) => Promise<void>) {
  await page.goto(`/shop/${slug}`);
  await expect(page.getByRole('button', { name: /Add to cart/ })).toBeVisible();
  if (setup) await setup(page);
  await page.getByRole('button', { name: /Add to cart/ }).click();
  await expect(page.getByText('Added to your cart.')).toBeVisible();
}

export type Contact = { name: string; email: string; phone?: string };

export async function fillContact(page: Page, contact: Contact) {
  await page.getByLabel('Your name').fill(contact.name);
  await page.getByRole('textbox', { name: 'Email' }).fill(contact.email);
  if (contact.phone) await page.getByRole('textbox', { name: 'Phone' }).fill(contact.phone);
}

export async function fillAddress(page: Page, zip = '48609') {
  await page.getByLabel('Street address').fill('123 Example Lane');
  await page.getByLabel('City').fill('Saginaw');
  await page.getByLabel('State').fill('MI');
  await page.getByLabel('ZIP').fill(zip);
}

/** Chooses the first time the server actually offers. Radios are visually hidden, so this clicks the label. */
export async function pickFirstOpenSlot(page: Page, scope: ReturnType<Page['locator']> = page.locator('body')) {
  const slot = scope.locator('label:has(input[name^="slot-"]:not([disabled]))').first();
  await expect(slot).toBeVisible();
  await slot.click();
}

export async function continueToPayment(page: Page) {
  const submit = page.getByRole('button', { name: /Continue to secure payment/ });
  await expect(submit).toBeVisible();
  await submit.click();
  await expect(page).toHaveURL(/\/api\/dev\/mock-checkout\//);
}

export async function simulatePayment(page: Page, label: 'Pay (simulate success)' | 'Bank transfer (payment stays pending)' = 'Pay (simulate success)') {
  await page.getByRole('button', { name: label }).click();
  await expect(page).toHaveURL(/\/track\//);
  return page.url().match(/\/track\/([^/?]+)/)?.[1] as string;
}

export async function orderForToken(token: string) {
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(token).digest('hex');
  const rows = await query<{ id: string; reference: string; status: string; payment_status: string }>(
    `SELECT o.id, o.reference, o.status, o.payment_status FROM orders o JOIN access_tokens t ON t.subject_id = o.id WHERE t.token_hash = $1`,
    [hash],
  );
  return rows[0];
}

/** The browser and the tests all come from one address, so public rate limits are reset between tests. */
export const resetRateLimits = () => query('DELETE FROM rate_limits');

/** Waits for the background worker to finish delivering messages it has queued. */
export async function waitForNotification(email: string, templateCode: string) {
  await expect
    .poll(async () => (await query(`SELECT 1 FROM notifications WHERE recipient = $1 AND template_code = $2 AND status IN ('sent', 'delivered')`, [email, templateCode])).length, { timeout: 30_000 })
    .toBeGreaterThan(0);
}

/** A date far enough ahead for event rules, on a Saturday so it is a realistic wedding date. */
export function futureSaturday(weeksAhead: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + weeksAhead * 7);
  while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
