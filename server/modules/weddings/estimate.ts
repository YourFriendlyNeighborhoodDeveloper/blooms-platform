import type { Db } from '../../db/client.js';
import { applyBps } from '../../lib/money.js';
import type { SettingsState } from '../settings/service.js';

export type SelectedItem = { service_id?: string | null; rental_item_id?: string | null; quantity: number; notes?: string | null };

export type EstimateLine = {
  service_id: string | null;
  rental_item_id: string | null;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  pricing_mode: 'package' | 'estimate' | 'custom_quote';
  unit_price_cents: number | null;
  est_low_cents: number | null;
  est_high_cents: number | null;
  line_low_cents: number | null;
  line_high_cents: number | null;
  taxable: boolean;
  notes: string | null;
};

export type Estimate = {
  lines: EstimateLine[];
  published_total_cents: number;
  estimate_low_cents: number;
  estimate_high_cents: number;
  pending_quote_count: number;
  estimated_tax_low_cents: number | null;
  estimated_tax_high_cents: number | null;
  tax_note: string;
  deposit_note: string;
  estimated_deposit_low_cents: number | null;
  estimated_deposit_high_cents: number | null;
  is_guaranteed: false;
};

/**
 * The budget builder keeps three kinds of number apart: prices the owner published, ranges that are
 * only estimates, and items that have no price until a person quotes them. The result can never be
 * read as a final price; only an accepted quote is one. No price is ever invented here.
 */
export async function computeEstimate(db: Db, settings: SettingsState, selected: SelectedItem[], guestCount?: number | null): Promise<Estimate> {
  const serviceIds = selected.flatMap((s) => (s.service_id ? [s.service_id] : []));
  const rentalIds = selected.flatMap((s) => (s.rental_item_id ? [s.rental_item_id] : []));
  const services = serviceIds.length
    ? await db
        .selectFrom('wedding_services as s')
        .innerJoin('service_categories as c', 'c.id', 's.category_id')
        .select(['s.id', 's.name', 's.pricing_mode', 's.unit', 's.unit_price_cents', 's.est_low_cents', 's.est_high_cents', 's.taxable', 'c.name as category'])
        .where('s.id', 'in', serviceIds)
        .where('s.active', '=', true)
        .execute()
    : [];
  const rentals = rentalIds.length ? await db.selectFrom('rental_items').select(['id', 'name', 'price_cents', 'category']).where('id', 'in', rentalIds).where('active', '=', true).execute() : [];

  const lines: EstimateLine[] = selected.flatMap((sel): EstimateLine[] => {
    if (sel.service_id) {
      const s = services.find((x) => x.id === sel.service_id);
      if (!s) return [];
      const qty = s.unit === 'guest' && guestCount ? guestCount * sel.quantity : sel.quantity;
      const low = s.pricing_mode === 'package' ? s.unit_price_cents : s.pricing_mode === 'estimate' ? s.est_low_cents : null;
      const high = s.pricing_mode === 'package' ? s.unit_price_cents : s.pricing_mode === 'estimate' ? s.est_high_cents : null;
      return [
        {
          service_id: s.id,
          rental_item_id: null,
          name: s.name,
          category: s.category,
          quantity: qty,
          unit: s.unit,
          pricing_mode: s.pricing_mode as EstimateLine['pricing_mode'],
          unit_price_cents: s.unit_price_cents,
          est_low_cents: s.est_low_cents,
          est_high_cents: s.est_high_cents,
          line_low_cents: low === null ? null : low * qty,
          line_high_cents: high === null ? null : high * qty,
          taxable: s.taxable,
          notes: sel.notes ?? null,
        },
      ];
    }
    const r = rentals.find((x) => x.id === sel.rental_item_id);
    if (!r) return [];
    const priced = r.price_cents !== null;
    return [
      {
        service_id: null,
        rental_item_id: r.id,
        name: r.name,
        category: 'Rentals',
        quantity: sel.quantity,
        unit: 'each',
        pricing_mode: priced ? 'package' : 'custom_quote',
        unit_price_cents: r.price_cents,
        est_low_cents: null,
        est_high_cents: null,
        line_low_cents: priced ? (r.price_cents as number) * sel.quantity : null,
        line_high_cents: priced ? (r.price_cents as number) * sel.quantity : null,
        taxable: true,
        notes: sel.notes ?? null,
      },
    ];
  });

  const published = lines.filter((l) => l.pricing_mode === 'package').reduce((s, l) => s + (l.line_low_cents ?? 0), 0);
  const estLow = lines.filter((l) => l.pricing_mode === 'estimate').reduce((s, l) => s + (l.line_low_cents ?? 0), 0);
  const estHigh = lines.filter((l) => l.pricing_mode === 'estimate').reduce((s, l) => s + (l.line_high_cents ?? 0), 0);
  const pending = lines.filter((l) => l.pricing_mode === 'custom_quote').length;

  const rate = settings.tax.rates_bps.standard;
  const taxableLow = lines.filter((l) => l.taxable).reduce((s, l) => s + (l.line_low_cents ?? 0), 0);
  const taxableHigh = lines.filter((l) => l.taxable).reduce((s, l) => s + (l.line_high_cents ?? 0), 0);
  const percent = settings.events.deposit_percent;
  return {
    lines,
    published_total_cents: published,
    estimate_low_cents: estLow,
    estimate_high_cents: estHigh,
    pending_quote_count: pending,
    estimated_tax_low_cents: rate === undefined ? null : applyBps(taxableLow, rate),
    estimated_tax_high_cents: rate === undefined ? null : applyBps(taxableHigh, rate),
    tax_note: rate === undefined ? 'Applicable sales tax is added to your formal quote.' : 'Estimated tax, confirmed on your formal quote.',
    deposit_note: percent === null ? 'Any deposit is set out in your formal quote.' : `Bookings usually need a ${percent}% deposit, confirmed on your formal quote.`,
    estimated_deposit_low_cents: percent === null ? null : applyBps(published + estLow, percent * 100),
    estimated_deposit_high_cents: percent === null ? null : applyBps(published + estHigh, percent * 100),
    is_guaranteed: false,
  };
}
