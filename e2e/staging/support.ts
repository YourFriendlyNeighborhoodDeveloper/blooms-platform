import { expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';

const ownerPassword = () => {
  const value = process.env.STAGING_OWNER_PASSWORD;
  if (!value) throw new Error('Set STAGING_OWNER_PASSWORD, or run scripts/staging.sh verify.');
  return value;
};

/** The proxy's team gate in front of /admin, /api/admin and /mailbox. It uses the mailbox sign-in. */
export const gateCredentials = () => {
  const auth = process.env.STAGING_MAILBOX_AUTH;
  if (!auth) throw new Error('Set STAGING_MAILBOX_AUTH, or run scripts/staging.sh verify.');
  return { username: auth.slice(0, auth.indexOf(':')), password: auth.slice(auth.indexOf(':') + 1) };
};

export async function openPage(browser: Browser, opts: { phone?: boolean; team?: boolean } = {}) {
  const context = await browser.newContext({
    ...(opts.phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}),
    ...(opts.team ? { httpCredentials: gateCredentials() } : {}),
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem('blooms-intro-seen', '1');
    } catch {
      /* Private browsing. */
    }
  });
  return page;
}

export async function signIn(browser: Browser, email = 'owner@demo.example') {
  const page = await openPage(browser, { team: true });
  await page.goto('/admin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(ownerPassword());
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  return page;
}

/** Same-origin JSON from a signed-in page. */
export async function api<T = any>(page: Page, method: string, url: string, body?: unknown): Promise<T> {
  const result = await page.evaluate(
    async ({ method, url, body }) => {
      const res = await fetch(url, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, text: await res.text() };
    },
    { method, url, body },
  );
  if (result.status >= 400) throw new Error(`${method} ${url} returned ${result.status}: ${result.text}`);
  return result.text ? JSON.parse(result.text) : (undefined as T);
}

/** Messages captured by the staging mailbox for one address, newest first. */
export async function mailbox(request: APIRequestContext, to: string) {
  const auth = process.env.STAGING_MAILBOX_AUTH;
  if (!auth) throw new Error('Set STAGING_MAILBOX_AUTH, or run scripts/staging.sh verify.');
  const res = await request.get(`/mailbox/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`, { headers: { authorization: `Basic ${Buffer.from(auth).toString('base64')}` } });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { messages: Array<{ ID: string; Subject: string }> }).messages;
}

export async function messageText(request: APIRequestContext, id: string) {
  const auth = process.env.STAGING_MAILBOX_AUTH as string;
  const res = await request.get(`/mailbox/api/v1/message/${id}`, { headers: { authorization: `Basic ${Buffer.from(auth).toString('base64')}` } });
  return ((await res.json()) as { Text: string }).Text;
}

export async function waitForMail(request: APIRequestContext, to: string, subject: RegExp) {
  await expect.poll(async () => (await mailbox(request, to)).some((m) => subject.test(m.Subject)), { timeout: 45_000, message: `waiting for "${subject}" to ${to}` }).toBe(true);
  return (await mailbox(request, to)).find((m) => subject.test(m.Subject)) as { ID: string; Subject: string };
}

export const uniqueEmail = (prefix: string) => `${prefix}-${Date.now().toString(36)}@demo.example`;

export const firstOpenSlot = (page: Page) => page.locator('label:has(input[name^="slot-"]:not([disabled]))').first();
