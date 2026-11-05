import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { dateTimeLabel, money } from '../../lib/format';
import { useSession } from '../session';
import { Badge, Card, Input, Loader, PageHeader, Select, StatusBadge, Table, useLoad, type Column } from '../ui';

type Row = {
  id: string;
  reference: string;
  status: string;
  payment_status?: string;
  contact_name: string;
  placed_at: string;
  total_cents?: number;
  needs_attention: boolean;
  attention_reason: string | null;
  is_test: boolean;
  items_text: string;
  methods: string;
  next_window: string | null;
};

const STATUSES = ['open', 'awaiting_review', 'awaiting_payment', 'payment_processing', 'payment_failed', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'shipped', 'partially_fulfilled', 'delivery_failed', 'inventory_shortage', 'needs_customer', 'fulfilled', 'completed', 'rejected', 'cancelled', 'expired'];

export default function Orders() {
  const [params, setParams] = useSearchParams();
  const { can } = useSession();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const query = useMemo(() => {
    const s = new URLSearchParams(params);
    if (!s.has('limit')) s.set('limit', '100');
    return s.toString();
  }, [params]);
  const state = useLoad<{ orders: Row[]; total: number }>(`/api/admin/orders?${query}`);

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const financial = can('orders.financials');
  const columns: Column<Row>[] = [
    { key: 'ref', label: 'Order', render: (r) => (
      <div>
        <Link to={`/admin/orders/${r.id}`} className="font-medium underline-offset-2 hover:underline">
          {r.reference}
        </Link>
        {r.is_test && <span className="ml-1.5"><Badge tone="warn">test</Badge></span>}
        <p className="text-[0.75rem] text-charcoal/70">{dateTimeLabel(r.placed_at)}</p>
      </div>
    ) },
    { key: 'customer', label: 'Customer', render: (r) => r.contact_name },
    { key: 'items', label: 'Items', render: (r) => <span className="line-clamp-2 max-w-xs">{r.items_text}</span> },
    { key: 'when', label: 'Due', render: (r) => (r.next_window ? dateTimeLabel(r.next_window) : <span className="capitalize">{r.methods}</span>) },
    { key: 'status', label: 'Status', render: (r) => (
      <div className="space-y-1">
        <StatusBadge status={r.status} />
        {r.needs_attention && <div><Badge tone="bad">needs attention</Badge></div>}
      </div>
    ) },
    ...(financial ? [
      { key: 'payment', label: 'Payment', render: (r: Row) => <StatusBadge status={r.payment_status} /> },
      { key: 'total', label: 'Total', align: 'right' as const, render: (r: Row) => money(r.total_cents) },
    ] : []),
  ];

  return (
    <>
      <PageHeader
        title="Orders"
        subtitle={state.data ? `${state.data.total} matching` : undefined}
      />
      <Card>
        <form
          className="mb-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            set('q', search.trim());
          }}
        >
          <label className="min-w-[14rem] flex-1">
            <span className="sr-only">Search orders</span>
            <Input type="search" placeholder="Order number, name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label>
            <span className="sr-only">Status</span>
            <Select value={params.get('status') ?? ''} onChange={(e) => set('status', e.target.value)}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </label>
          <label>
            <span className="sr-only">Department</span>
            <Select value={params.get('division') ?? ''} onChange={(e) => set('division', e.target.value)}>
              <option value="">All departments</option>
              <option value="floral">Floral</option>
              <option value="boutique">Boutique</option>
            </Select>
          </label>
          <label className="flex items-center gap-2 text-[0.85rem]">
            <input type="checkbox" checked={params.get('attention') === 'true'} onChange={(e) => set('attention', e.target.checked ? 'true' : '')} />
            Needs attention
          </label>
          {can('orders.export') && (
            <a href={`/api/admin/orders/export.csv?${query}`} className="ml-auto text-[0.85rem] underline">
              Export CSV
            </a>
          )}
        </form>
        <Loader state={state}>{(d) => <Table columns={columns} rows={d.orders} rowKey={(r) => r.id} caption="Orders" empty="No orders match." />}</Loader>
      </Card>
    </>
  );
}
