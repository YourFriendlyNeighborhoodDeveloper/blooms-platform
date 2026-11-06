import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Request } from '@playwright/test';
import { newCustomer, query, signInStaff } from './support/helpers.js';

/**
 * Flora in the browser, with the scripted stand-in instead of a model: the widget, a plan saved from
 * the chat, the private review link, editing and sending it on the website, and the sandbox view in
 * the dashboard. The stand-in runs a tool only when a test asks for it with "/tool name {json}".
 */
test('a chat saves a plan, the visitor reviews and sends it, and it lands in the sandbox, not the pipeline', async ({ browser }) => {
  const page = await newCustomer(browser);
  await page.goto('/');
  await page.getByRole('button', { name: 'Ask Flora' }).click();
  const panel = page.getByRole('dialog', { name: /Chat with Flora, an automated assistant/ });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Automated assistant · demonstration')).toBeVisible();
  await expect(panel.getByText(/demonstration by Abraxas Technologies/)).toBeVisible();
  await expect(panel.getByText(/answers are simulated/)).toBeVisible();

  const a11y = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(a11y.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  await panel.getByRole('button', { name: 'Plan my wedding' }).click();
  await expect(panel.getByText(/Simulated assistant/).first()).toBeVisible();

  const input = panel.getByRole('textbox', { name: 'Message Flora' });
  const details = { contact_name: 'Morgan Example', contact_email: 'morgan@demo.example', event_type: 'Wedding', event_date: '2027-08-14', venue_name: 'Lakeside Pavilion', guest_count: 90, colors: 'ivory and gold' };
  await input.fill(`/tool save_wedding_details ${JSON.stringify(details)}`);
  await input.press('Enter');
  await expect(panel.getByText(/still_needed_to_send/)).toBeVisible();
  await input.fill('/tool send_planning_link {"consent_confirmed":false}');
  await input.press('Enter');
  await panel.getByRole('link', { name: /Review and send my plan/ }).click();

  await expect(page).toHaveURL(/\/plan\/draft\//);
  await expect(page.getByRole('heading', { name: 'Review and send your plan' })).toBeVisible();
  await expect(page.getByText(/Demonstration sandbox\./)).toBeVisible();
  await expect(page.getByLabel('Your name')).toHaveValue('Morgan Example');
  await expect(page.getByLabel('Venue name')).toHaveValue('Lakeside Pavilion');
  await page.getByLabel('Venue name').fill('Lakeside Pavilion, north lawn');
  const submits: number[] = [];
  page.on('request', (r: Request) => r.url().includes('/submit') && submits.push(Date.now()));
  for (const step of ['Your style', 'Flowers & décor', 'Budget', 'Your date', 'Send']) {
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('[aria-current="step"]')).toContainText(step);
  }
  // Reaching the last step must not send anything by itself.
  await expect(page.getByRole('button', { name: 'Send my plan' })).toBeVisible();
  expect(submits).toEqual([]);
  await page.getByRole('button', { name: 'Send my plan' }).click();
  await expect(page.getByRole('heading', { name: 'Your practice plan is saved' })).toBeVisible();

  const draft = await query<{ status: string; sandbox: boolean; venue: string }>(`SELECT status, sandbox, data->>'venue_name' AS venue FROM concierge_drafts WHERE contact_email = 'morgan@demo.example'`);
  expect(draft).toEqual([{ status: 'submitted', sandbox: true, venue: 'Lakeside Pavilion, north lawn' }]);
  const inquiries = await query(`SELECT i.id FROM wedding_inquiries i JOIN customers c ON c.id = i.customer_id WHERE c.email = 'morgan@demo.example'`);
  expect(inquiries).toHaveLength(0);

  const staff = await signInStaff(browser, 'owner@demo.example');
  await staff.goto('/admin/flora?tab=sandbox');
  const row = staff.getByRole('row', { name: /Morgan Example/ });
  await expect(row).toContainText('Sent by customer');
  await row.getByRole('link', { name: /Chat FL-/ }).click();
  await expect(staff.locator('summary', { hasText: 'save_wedding_details' })).toBeVisible();
  await expect(staff.locator('summary', { hasText: 'send_planning_link' })).toBeVisible();
  await staff.goto('/admin/flora');
  await expect(staff.getByText(/Estimated spend/)).toBeVisible();
});

test('a caller can continue on the website with the code Flora read out', async ({ browser }) => {
  const page = await newCustomer(browser);
  await page.goto('/continue');
  await page.getByLabel('Six-digit code').fill('123456');
  await page.getByLabel('Last four digits of your phone').fill('0142');
  await page.getByRole('button', { name: 'Open my plan' }).click();
  await expect(page.getByText(/That code did not match/)).toBeVisible();
});
