import { expect, test } from '@playwright/test';
import { signInStaff, staffApi } from './support/helpers.js';

// Runs last. After every browser flow above, the records must still agree with each other.
test('after all browser flows, every record check passes', async ({ browser }) => {
  const owner = await signInStaff(browser, 'owner@demo.example');
  const report = await staffApi<{ ok: boolean; checks: Array<{ id: string; violations: number; sample: unknown[] }> }>(owner, 'GET', '/api/admin/system/integrity');
  expect(report.checks.filter((c) => c.violations > 0)).toEqual([]);
  expect(report.ok).toBe(true);
  await owner.context().close();
});
