import { useState } from 'react';
import { Link } from 'react-router';
import { dateTimeLabel, money, timeLabel } from '../../lib/format';
import { Badge, Btn, Card, Loader, PageHeader, Select, Stat, StatusBadge, useLoad } from '../ui';
import { api } from '../../lib/api';

type Data = {
  today: string;
  period: { days: number; gross_cents: number; refunds_cents: number; net_cents: number; orders: number; cancellations: number } | null;
  orders: { today: number; attention: number; review: number; awaiting_production: number; unfulfilled: number; paid_today: number; failed: number } | null;
  weddings: { pending: number; upcoming_consultations: number; upcoming_events: number } | null;
  deliveries: Array<{ id: string; status: string; window_start: string | null; window_end: string | null; reference: string; order_id: string; driver_name: string | null }>;
  low_stock: Array<{ id: string; name: string; available: number; threshold: number; unit: string }>;
  invoices: { outstanding: number; overdue: number; count: number } | null;
  alerts: Array<{ id: string; code: string; severity: string; title: string; detail: string | null; link: string | null; created_at: string }>;
  my_tasks: Array<{ id: string; title: string; status: string; due_at: string | null; subject_type: string | null; subject_id: string | null }>;
  capacity: { orders: number; points: number; minutes: number; max_orders: number | null; max_points: number | null } | null;
  show_financials: boolean;
  test_mode: boolean;
};

export default function Overview() {
  const [division, setDivision] = useState('');
  const [days, setDays] = useState('30');
  const state = useLoad<Data>(`/api/admin/overview?days=${days}${division ? `&division=${division}` : ''}`);
  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="What needs you today"
        actions={
          <label>
            <span className="sr-only">Department</span>
            <Select value={division} onChange={(e) => setDivision(e.target.value)}>
              <option value="">All departments</option>
              <option value="floral">Floral</option>
              <option value="boutique">Boutique</option>
              <option value="events">Weddings & events</option>
            </Select>
          </label>
        }
      />
      <Loader state={state}>
        {(d) => (
          <div className="space-y-5">
            {d.alerts.length > 0 && (
              <Card title="Needs attention" className="border-rose-deep/30">
                <ul className="space-y-2">
                  {d.alerts.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-charcoal/8 pb-2 last:border-0 last:pb-0">
                      <div className="min-w-0 flex-1">
                        <p className="text-[0.9rem] font-medium">
                          {a.severity === 'critical' && <span className="mr-1.5"><Badge tone="bad">urgent</Badge></span>}
                          {a.link ? <Link className="hover:underline" to={a.link}>{a.title}</Link> : a.title}
                        </p>
                        {a.detail && <p className="text-[0.82rem] text-charcoal/70">{a.detail}</p>}
                      </div>
                      <Btn small onClick={async () => { await api(`/api/admin/system/alerts/${a.id}/resolve`, { body: {} }); void state.reload(); }}>Dismiss</Btn>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {d.orders && (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <Stat label="Orders today" value={d.orders.today} to="/admin/orders" />
                <Stat label="Waiting on you" value={d.orders.review + d.orders.attention} tone={d.orders.review + d.orders.attention > 0 ? 'attention' : undefined} to="/admin/orders?status=awaiting_review" hint="Review, questions, problems" />
                <Stat label="To start" value={d.orders.awaiting_production} to="/admin/orders?status=accepted" />
                <Stat label="Unfulfilled" value={d.orders.unfulfilled} to="/admin/orders?status=open" />
                {d.show_financials && <Stat label="Payments today" value={money(d.orders.paid_today)} hint={d.test_mode ? 'Test data' : 'Before refunds'} />}
                <Stat label="Failed payments" value={d.orders.failed} to="/admin/orders?status=payment_failed" tone={d.orders.failed > 0 ? 'attention' : undefined} />
              </div>
            )}
            {d.period && (
              <Card
                title="Money"
                actions={
                  <label>
                    <span className="sr-only">Period</span>
                    <Select className="h-9 py-0" value={days} onChange={(e) => setDays(e.target.value)}>
                      <option value="7">Last 7 days</option>
                      <option value="30">Last 30 days</option>
                      <option value="90">Last 90 days</option>
                      <option value="365">Last 12 months</option>
                    </Select>
                  </label>
                }
              >
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label="Gross sales" value={money(d.period.gross_cents)} hint={d.test_mode ? 'Test data' : `${d.period.orders} paid orders`} to="/admin/reports" />
                  <Stat label="Refunds" value={money(d.period.refunds_cents)} />
                  <Stat label="Net sales" value={money(d.period.net_cents)} hint="Not profit" />
                  <Stat label="Cancelled or declined" value={d.period.cancellations} to="/admin/orders?status=cancelled" />
                </div>
              </Card>
            )}
            {d.weddings && (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <Stat label="New inquiries" value={d.weddings.pending} to="/admin/weddings" tone={d.weddings.pending > 0 ? 'attention' : undefined} />
                <Stat label="Consultations" value={d.weddings.upcoming_consultations} hint="Next 14 days" to="/admin/calendar" />
                <Stat label="Confirmed events" value={d.weddings.upcoming_events} hint="Next 60 days" to="/admin/weddings" />
                {d.invoices && <Stat label="Outstanding invoices" value={money(d.invoices.outstanding)} hint={`${d.invoices.count} open`} />}
                {d.invoices && <Stat label="Overdue" value={money(d.invoices.overdue)} tone={d.invoices.overdue > 0 ? 'attention' : undefined} />}
              </div>
            )}
            <div className="grid gap-5 lg:grid-cols-2">
              {d.capacity && (
                <Card title="Capacity today">
                  <dl className="grid grid-cols-3 gap-3 text-[0.88rem]">
                    <div>
                      <dt className="text-charcoal/70">Orders</dt>
                      <dd className="font-medium tabular-nums">{d.capacity.orders}{d.capacity.max_orders !== null ? ` of ${d.capacity.max_orders}` : ''}</dd>
                    </div>
                    <div>
                      <dt className="text-charcoal/70">Workload points</dt>
                      <dd className="font-medium tabular-nums">{d.capacity.points}{d.capacity.max_points !== null ? ` of ${d.capacity.max_points}` : ''}</dd>
                    </div>
                    <div>
                      <dt className="text-charcoal/70">Estimated prep</dt>
                      <dd className="font-medium tabular-nums">{Math.round(d.capacity.minutes / 6) / 10} hours</dd>
                    </div>
                  </dl>
                  {d.capacity.max_orders === null && d.capacity.max_points === null && <p className="mt-2 text-[0.8rem] text-charcoal/70">No daily limit is set, so orders go to manual review.</p>}
                </Card>
              )}
              <Card title="Today’s deliveries" actions={<Link to="/admin/deliveries" className="text-[0.8rem] underline">All</Link>}>
                {d.deliveries.length === 0 ? (
                  <p className="text-[0.88rem] text-charcoal/70">None scheduled.</p>
                ) : (
                  <ul className="space-y-1.5 text-[0.86rem]">
                    {d.deliveries.map((x) => (
                      <li key={x.id} className="flex flex-wrap items-center justify-between gap-2">
                        <Link to={`/admin/orders/${x.order_id}`} className="font-medium hover:underline">{x.reference}</Link>
                        <span className="text-charcoal/70">{x.window_start && timeLabel(x.window_start)}{x.window_end && ` – ${timeLabel(x.window_end)}`}</span>
                        <span className="text-charcoal/70">{x.driver_name ?? 'No driver yet'}</span>
                        <StatusBadge status={x.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title="Low stock" actions={<Link to="/admin/inventory?low=true" className="text-[0.8rem] underline">Inventory</Link>}>
                {d.low_stock.length === 0 ? (
                  <p className="text-[0.88rem] text-charcoal/70">Nothing is below its alert level.</p>
                ) : (
                  <ul className="space-y-1 text-[0.86rem]">
                    {d.low_stock.map((i) => (
                      <li key={i.id} className="flex justify-between gap-3">
                        <Link to={`/admin/inventory/items/${i.id}`} className="hover:underline">{i.name}</Link>
                        <span className="tabular-nums text-charcoal/70">{i.available} {i.unit} left (alert at {i.threshold})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title="Your tasks" actions={<Link to="/admin/tasks" className="text-[0.8rem] underline">All</Link>}>
                {d.my_tasks.length === 0 ? (
                  <p className="text-[0.88rem] text-charcoal/70">Nothing assigned to you.</p>
                ) : (
                  <ul className="space-y-1 text-[0.86rem]">
                    {d.my_tasks.map((t) => (
                      <li key={t.id} className="flex flex-wrap justify-between gap-2">
                        <span>{t.title}</span>
                        <span className="text-charcoal/70">{t.due_at && dateTimeLabel(t.due_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        )}
      </Loader>
    </>
  );
}
