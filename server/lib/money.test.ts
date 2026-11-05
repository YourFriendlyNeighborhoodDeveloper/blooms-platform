import { describe, expect, it } from 'vitest';
import { allocate, applyBps } from './money.js';
import { computeTotals } from '../modules/cart/pricing.js';
import { groupForFulfillment } from '../modules/cart/lines.js';
import { toCsv } from './csv.js';
import { renderTemplate, escapeHtml, unknownVariables } from './template.js';
import { generateReference } from './tokens.js';
import { toE164 } from './phone.js';
import { backoffSeconds } from '../automation/queue.js';
import { nextAllowedTime } from '../modules/notifications/service.js';
import { canTransitionItem, canTransitionOrder, deriveOrderStatus } from '../modules/orders/workflow.js';
import { inSeason } from '../modules/availability/engine.js';
import { loadEnv } from '../config/env.js';

const tax = { label: 'Sales tax', rates_bps: { standard: 600, exempt: 0 }, delivery_taxable: false, shipping_taxable: false, notes: null };
const line = (id: string, cents: number, division = 'd1', tax_category = 'standard') => ({ id, division_id: division, quantity: 1, line_subtotal_cents: cents, tax_category });

describe('money', () => {
  it('rounds basis points half up', () => {
    expect(applyBps(1000, 600)).toBe(60);
    expect(applyBps(1050, 625)).toBe(66);
    expect(applyBps(99, 600)).toBe(6);
  });

  it('allocates without losing or inventing a cent', () => {
    for (const [total, weights] of [[100, [1, 1, 1]], [1, [5, 5]], [999, [333, 333, 334]], [7, [1, 2, 3, 4]]] as Array<[number, number[]]>) {
      const parts = allocate(total, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
    expect(allocate(100, [0, 0])).toEqual([0, 0]);
  });
});

describe('computeTotals', () => {
  it('taxes items after discount, and never the delivery unless configured', () => {
    const t = computeTotals([line('a', 10000)], [{ method: 'delivery', fee_cents: 1000 }], { kind: 'percent', value: 10, division_ids: [] }, tax);
    expect(t.discount_cents).toBe(1000);
    expect(t.tax_cents).toBe(540);
    expect(t.total_cents).toBe(10000 - 1000 + 1000 + 540);
  });

  it('taxes the delivery fee when configured', () => {
    const t = computeTotals([line('a', 10000)], [{ method: 'delivery', fee_cents: 1000 }], null, { ...tax, delivery_taxable: true });
    expect(t.tax_cents).toBe(660);
  });

  it('never discounts below zero, and applies free delivery', () => {
    expect(computeTotals([line('a', 500)], [], { kind: 'fixed', value: 2000, division_ids: [] }, tax).total_cents).toBe(0);
    expect(computeTotals([line('a', 500)], [{ method: 'delivery', fee_cents: 900 }], { kind: 'free_delivery', value: 0, division_ids: [] }, tax).delivery_cents).toBe(0);
  });

  it('limits a division-specific promotion to that division', () => {
    const t = computeTotals([line('a', 1000, 'flowers'), line('b', 1000, 'gifts')], [], { kind: 'percent', value: 50, division_ids: ['flowers'] }, tax);
    expect(t.discount_cents).toBe(500);
    expect(t.lines.find((l) => l.id === 'b')?.discount_cents).toBe(0);
  });

  it('reports a missing tax rate instead of assuming zero', () => {
    const t = computeTotals([line('a', 1000, 'd1', 'luxury')], [], null, tax);
    expect(t.tax_missing).toEqual(['luxury']);
    expect(computeTotals([line('a', 1000, 'd1', 'exempt')], [], null, tax).tax_missing).toEqual([]);
  });

  it('always balances: total equals subtotal minus discount plus fees plus tax', () => {
    const t = computeTotals([line('a', 3333), line('b', 6667), line('c', 1)], [{ method: 'delivery', fee_cents: 777 }, { method: 'shipping', fee_cents: 333 }], { kind: 'percent', value: 33, division_ids: [] }, tax);
    expect(t.total_cents).toBe(t.subtotal_cents - t.discount_cents + t.delivery_cents + t.shipping_cents + t.tax_cents);
  });
});

describe('fulfilment grouping', () => {
  it('keeps compatible items together and splits the rest', () => {
    const groups = groupForFulfillment([
      { id: '1', name: 'Bouquet', methods: ['pickup', 'delivery'] },
      { id: '2', name: 'Candle', methods: ['pickup', 'delivery', 'shipping'] },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].methods).toEqual(['pickup', 'delivery']);
    expect(groups[0].note).toBeNull();

    const split = groupForFulfillment([
      { id: '1', name: 'Bouquet', methods: ['delivery'] },
      { id: '2', name: 'Sweater', methods: ['shipping'] },
    ]);
    expect(split).toHaveLength(2);
    expect(split[1].note).toContain('Sweater');
  });
});

describe('order state machine', () => {
  const items = (...s: string[]) => s.map((status) => ({ status }));
  it('derives order status from item statuses', () => {
    expect(deriveOrderStatus(items('pending', 'pending'))).toBe('accepted');
    expect(deriveOrderStatus(items('ready', 'preparing'))).toBe('preparing');
    expect(deriveOrderStatus(items('ready', 'ready'))).toBe('ready');
    expect(deriveOrderStatus(items('fulfilled', 'preparing'))).toBe('partially_fulfilled');
    expect(deriveOrderStatus(items('fulfilled', 'cancelled'))).toBe('fulfilled');
    expect(deriveOrderStatus(items('cancelled', 'refunded'))).toBe('cancelled');
    expect(deriveOrderStatus(items('out_for_delivery', 'ready'))).toBe('out_for_delivery');
    expect(deriveOrderStatus(items('delivery_failed', 'fulfilled'))).toBe('delivery_failed');
    expect(deriveOrderStatus(items('shortage', 'ready'))).toBe('inventory_shortage');
  });

  it('forbids illogical moves', () => {
    expect(canTransitionOrder('awaiting_review', 'accepted')).toBe(true);
    expect(canTransitionOrder('awaiting_payment', 'preparing')).toBe(false);
    expect(canTransitionOrder('rejected', 'accepted')).toBe(false);
    expect(canTransitionOrder('completed', 'preparing')).toBe(false);
    expect(canTransitionItem('fulfilled', 'pending')).toBe(false);
    expect(canTransitionItem('cancelled', 'preparing')).toBe(false);
    expect(canTransitionItem('preparing', 'ready')).toBe(true);
  });
});

describe('seasonal availability', () => {
  const base = { available_from: null, available_until: null };
  it('handles a season that wraps past New Year', () => {
    const winter = { ...base, season_start_md: '11-15', season_end_md: '01-05' };
    expect(inSeason(winter, '2026-12-25')).toBe(true);
    expect(inSeason(winter, '2027-01-03')).toBe(true);
    expect(inSeason(winter, '2026-06-01')).toBe(false);
  });
  it('respects explicit dates', () => {
    expect(inSeason({ season_start_md: null, season_end_md: null, available_from: '2026-02-01', available_until: '2026-02-14' }, '2026-02-15')).toBe(false);
  });
});

describe('helpers', () => {
  it('escapes variables in email HTML but leaves plain text alone', () => {
    expect(renderTemplate('Hi {{ c.name }}', { c: { name: '<b>Al</b>' } }, escapeHtml)).toBe('Hi &lt;b&gt;Al&lt;/b&gt;');
    expect(renderTemplate('{{missing.value}}!', {})).toBe('!');
    expect(unknownVariables('{{a}} {{b}}', ['a'])).toEqual(['b']);
  });

  it('neutralizes spreadsheet formulas in exports', () => {
    const csv = toCsv([{ name: '=HYPERLINK("http://evil")', note: 'a,b' }]);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain('"a,b"');
  });

  it('produces references that are neither sequential nor ambiguous', () => {
    const refs = new Set(Array.from({ length: 2000 }, () => generateReference('BL')));
    expect(refs.size).toBe(2000);
    for (const r of refs) expect(r).toMatch(/^BL-[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/);
  });


  it('normalizes US phone numbers and refuses junk', () => {
    expect(toE164('(989) 555-0123')).toBe('+19895550123');
    expect(toE164('1-989-555-0123')).toBe('+19895550123');
    expect(toE164('555-0123')).toBeNull();
    expect(toE164('(123) 456-7890')).toBeNull();
  });

  it('backs off exponentially with a cap', () => {
    expect(backoffSeconds(1, 0.5)).toBe(30);
    expect(backoffSeconds(3, 0.5)).toBe(120);
    expect(backoffSeconds(30, 0.5)).toBe(6 * 3600);
  });

  it('holds texts during quiet hours until they end', () => {
    const tz = 'America/Detroit';
    expect(nextAllowedTime(new Date('2026-11-10T18:00:00Z'), tz, '20:00', '09:00')).toBeNull(); // 1 PM
    const night = nextAllowedTime(new Date('2026-11-11T03:00:00Z'), tz, '20:00', '09:00')!; // 10 PM
    expect(night.toISOString()).toBe('2026-11-11T14:00:00.000Z'); // 9 AM next morning
    const early = nextAllowedTime(new Date('2026-11-10T12:00:00Z'), tz, '20:00', '09:00')!; // 7 AM
    expect(early.toISOString()).toBe('2026-11-10T14:00:00.000Z'); // 9 AM the same morning
  });
});

describe('startup safety', () => {
  const prod = { APP_ENV: 'production', DATABASE_URL: 'postgres://x', SESSION_SECRET: 'x'.repeat(40), PUBLIC_BASE_URL: 'https://shop.example' };

  it('refuses the simulated gateway in production', () => {
    expect(() => loadEnv({ ...prod, PAYMENTS_MODE: 'mock' })).toThrow(/mock is not allowed/);
  });

  it('refuses a live key without explicit approval, and outside production', () => {
    expect(() => loadEnv({ ...prod, PAYMENTS_MODE: 'stripe', STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' })).toThrow(/LIVE_PAYMENTS_APPROVED/);
    expect(() => loadEnv({ APP_ENV: 'development', PAYMENTS_MODE: 'stripe', STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' })).toThrow(/APP_ENV=production/);
    const ok = loadEnv({ ...prod, PAYMENTS_MODE: 'stripe', STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x', LIVE_PAYMENTS_APPROVED: 'true' });
    expect(ok.livePayments).toBe(true);
  });

  it('a test key can never be live', () => {
    const env = loadEnv({ ...prod, PAYMENTS_MODE: 'stripe', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x', LIVE_PAYMENTS_APPROVED: 'true' });
    expect(env.livePayments).toBe(false);
    expect(env.warnings.join()).toContain('test mode');
  });

  it('requires secrets and https when deployed', () => {
    expect(() => loadEnv({ APP_ENV: 'production', PUBLIC_BASE_URL: 'https://shop.example' })).toThrow(/DATABASE_URL.*\n.*SESSION_SECRET/);
    expect(() => loadEnv({ ...prod, PUBLIC_BASE_URL: 'http://shop.example' })).toThrow(/https/);
    expect(() => loadEnv({ ...prod, SESSION_SECRET: 'local-development-secret-do-not-use-when-deployed' })).toThrow(/development value/);
  });

  it('runs without Twilio, and turns SMS off when credentials are incomplete or A2P is not approved', () => {
    expect(loadEnv({ ...prod }).SMS_ENABLED).toBe(false);
    const missing = loadEnv({ ...prod, SMS_ENABLED: 'true', TWILIO_ACCOUNT_SID: 'AC1' });
    expect(missing.SMS_ENABLED).toBe(false);
    const unregistered = loadEnv({ ...prod, SMS_ENABLED: 'true', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_MESSAGING_SERVICE_SID: 'MG1' });
    expect(unregistered.SMS_ENABLED).toBe(false);
    expect(unregistered.warnings.join()).toContain('A2P');
  });

  it('real email needs a verified sender', () => {
    expect(() => loadEnv({ ...prod, EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_x' })).toThrow(/EMAIL_FROM/);
  });
});
