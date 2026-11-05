import { useMemo, useState } from 'react';
import { money, shopTimezone } from '../../lib/format';
import { useSession } from '../session';
import { Card, Field, Input, Loader, PageHeader, Select, Stat, useLoad } from '../ui';

type Sales = { orders: number; gross_cents: number; refunds_cents: number; net_cents: number; average_order_cents: number | null; tax_collected_cents: number; delivery_cents: number; discounts_cents: number; by_division: Array<{ division: string; orders: number; item_sales: number }>; best_sellers: Array<{ name: string; units: number; sales: number; est_cost: number | null }>; customers: number; repeat_customers: number; sources: Array<{ source: string; orders: number; sales: number }>; definitions: Record<string, string>; test_data_included: boolean };
type Ops = { fulfilled: number; average_minutes_to_fulfil: number | null; on_time: number; late: number; failed_deliveries: number; estimated_prep_minutes: number; complexity_points: number; inventory_turnover: Array<{ item: string; sold: number; on_hand: number }>; low_stock_by_day: Array<{ day: string; n: number }>; waste: Array<{ item: string; lost: number }>; definitions: Record<string, string> };
type Weddings = { inquiries: number; with_consultation: number; quoted: number; accepted: number; confirmed: number; consultation_rate_percent: number | null; quote_acceptance_percent: number | null; confirmed_revenue_cents?: number; outstanding_receivables_cents?: number; overdue_receivables_cents?: number; definitions: Record<string, string> };

const toLocal = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: shopTimezone() });

/** A single-series ranked bar. The value is always printed, so the bar is never the only way to read it. */
function Bars({ rows, format, label }: { rows: Array<{ label: string; value: number }>; format: (n: number) => string; label: string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  if (!rows.length) return <p className="text-[0.85rem] text-charcoal/70">No data for this period.</p>;
  return (
    <ul className="space-y-2" aria-label={label}>
      {rows.map((r) => (
        <li key={r.label} className="text-[0.82rem]" title={`${r.label}: ${format(r.value)}`}>
          <div className="flex justify-between gap-3">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="shrink-0 tabular-nums">{format(r.value)}</span>
          </div>
          <div aria-hidden="true" className="mt-1 h-1.5 w-full rounded-full bg-charcoal/[0.06]">
            <div className="h-1.5 rounded-full bg-[#a84a62]" style={{ width: `${Math.max(1, (r.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Reports() {
  const { can } = useSession();
  const [from, setFrom] = useState(() => toLocal(new Date(Date.now() - 29 * 864e5)));
  const [to, setTo] = useState(() => toLocal(new Date()));
  const [division, setDivision] = useState('');
  const query = useMemo(() => {
    const s = new URLSearchParams({ from, to });
    if (division) s.set('division', division);
    return s.toString();
  }, [from, to, division]);
  const financial = can('reports.financials');
  const sales = useLoad<Sales>(financial ? `/api/admin/reports/sales?${query}` : null);
  const ops = useLoad<Ops>(`/api/admin/reports/operations?${query}`);
  const weddings = useLoad<Weddings>(`/api/admin/reports/weddings?${query}`);
  return (
    <>
      <PageHeader title="Reports" subtitle="Calculated from your records. Nothing here is modeled or projected." actions={financial && <a className="inline-flex h-10 items-center rounded-lg border border-charcoal/25 bg-white px-4 text-[0.88rem]" href={`/api/admin/reports/sales.csv?${query}`}>Export CSV</a>} />
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Department"><Select value={division} onChange={(e) => setDivision(e.target.value)}><option value="">All departments</option><option value="floral">Floral</option><option value="boutique">Boutique</option></Select></Field>
        </div>
        {sales.data?.test_data_included && <p className="mt-3 text-[0.8rem] text-rose-deep">These figures include test orders, because payments are in test mode.</p>}
      </Card>
      <div className="space-y-4">
        {financial && (
          <Loader state={sales}>
            {(s) => (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                  <Stat label="Gross sales" value={money(s.gross_cents)} />
                  <Stat label="Refunds" value={money(s.refunds_cents)} />
                  <Stat label="Net sales" value={money(s.net_cents)} />
                  <Stat label="Paid orders" value={s.orders} />
                  <Stat label="Average order" value={money(s.average_order_cents)} />
                  <Stat label="Repeat customers" value={`${s.repeat_customers} of ${s.customers}`} />
                </div>
                <div className="grid gap-4 lg:grid-cols-3">
                  <Card title="Sales by department"><Bars label="Sales by department" rows={s.by_division.map((d) => ({ label: d.division, value: d.item_sales }))} format={(n) => money(n)} /></Card>
                  <Card title="Best sellers"><Bars label="Best sellers by sales" rows={s.best_sellers.map((b) => ({ label: b.name, value: b.sales }))} format={(n) => money(n)} /></Card>
                  <Card title="Sales by source"><Bars label="Sales by source" rows={s.sources.map((b) => ({ label: b.source, value: b.sales }))} format={(n) => money(n)} /><p className="mt-3 text-[0.72rem] text-charcoal/70">Only known when a link carries tracking tags.</p></Card>
                </div>
                <Card title="What these mean">
                  <dl className="space-y-1 text-[0.82rem]">
                    <div><dt className="inline font-medium">Gross sales: </dt><dd className="inline">{s.definitions.gross}</dd></div>
                    <div><dt className="inline font-medium">Net sales: </dt><dd className="inline">{s.definitions.net}</dd></div>
                    <div><dt className="inline font-medium">Profit: </dt><dd className="inline">{s.definitions.profit}</dd></div>
                    <div><dt className="inline font-medium">Sales tax collected in this period: </dt><dd className="inline tabular-nums">{money(s.tax_collected_cents)}</dd></div>
                  </dl>
                </Card>
              </>
            )}
          </Loader>
        )}
        <Loader state={weddings}>
          {(w) => (
            <Card title="Weddings and events">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <Stat label="Inquiries" value={w.inquiries} />
                <Stat label="Booked a consultation" value={w.consultation_rate_percent !== null ? `${w.consultation_rate_percent}%` : '—'} hint={`${w.with_consultation} of ${w.inquiries}`} />
                <Stat label="Quotes accepted" value={w.quote_acceptance_percent !== null ? `${w.quote_acceptance_percent}%` : '—'} hint={`${w.accepted} of ${w.quoted}`} />
                <Stat label="Confirmed" value={w.confirmed} />
                {w.confirmed_revenue_cents !== undefined && <Stat label="Confirmed revenue" value={money(w.confirmed_revenue_cents)} hint="Contracted, not all collected" />}
                {w.outstanding_receivables_cents !== undefined && <Stat label="Owed to you now" value={money(w.outstanding_receivables_cents)} hint={`${money(w.overdue_receivables_cents)} overdue`} />}
              </div>
            </Card>
          )}
        </Loader>
        <Loader state={ops}>
          {(o) => (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <Stat label="Fulfilled" value={o.fulfilled} />
                <Stat label="On time" value={o.on_time} />
                <Stat label="Late" value={o.late} tone={o.late > 0 ? 'attention' : undefined} />
                <Stat label="Failed deliveries" value={o.failed_deliveries} tone={o.failed_deliveries > 0 ? 'attention' : undefined} />
                <Stat label="Estimated prep" value={`${Math.round(o.estimated_prep_minutes / 6) / 10} hours`} hint="A planning estimate, not measured" />
                <Stat label="Workload points" value={o.complexity_points} />
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                <Card title="What moved"><Bars label="Units sold by item" rows={o.inventory_turnover.map((i) => ({ label: `${i.item} (${i.on_hand} left)`, value: i.sold }))} format={(n) => `${n} sold`} /></Card>
                <Card title="Waste and spoilage"><Bars label="Units lost by item" rows={o.waste.map((i) => ({ label: i.item, value: i.lost }))} format={(n) => `${n} lost`} /></Card>
                <Card title="Low stock alerts"><Bars label="Low stock alerts by day" rows={o.low_stock_by_day.map((i) => ({ label: i.day, value: i.n }))} format={(n) => `${n}`} /></Card>
              </div>
            </>
          )}
        </Loader>
      </div>
    </>
  );
}
