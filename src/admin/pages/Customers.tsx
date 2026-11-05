import { useState } from 'react';
import { Link } from 'react-router';
import { money, shortDate } from '../../lib/format';
import { useSession } from '../session';
import { Badge, Card, Input, Loader, PageHeader, Table, useLoad, type Column } from '../ui';

type Row = { id: string; name: string; email: string; phone_e164: string | null; created_at: string; tags: string[]; anonymized_at: string | null; order_count: number; lifetime_cents?: number; event_count: number };

export default function Customers() {
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const state = useLoad<{ customers: Row[] }>(`/api/admin/customers${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  const columns: Column<Row>[] = [
    { key: 'name', label: 'Customer', render: (r) => (
      <div>
        <Link to={`/admin/customers/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
        {r.anonymized_at && <span className="ml-1.5"><Badge>erased</Badge></span>}
        {r.tags.map((t) => <span key={t} className="ml-1.5"><Badge tone="info">{t}</Badge></span>)}
        {!r.anonymized_at && <p className="text-[0.75rem] break-all text-charcoal/70">{r.email}</p>}
      </div>
    ) },
    { key: 'phone', label: 'Phone', render: (r) => r.phone_e164 ?? '' },
    { key: 'orders', label: 'Orders', align: 'right', render: (r) => r.order_count },
    { key: 'events', label: 'Events', align: 'right', render: (r) => r.event_count },
    ...(can('orders.financials') ? [{ key: 'lifetime', label: 'Lifetime spend', align: 'right' as const, render: (r: Row) => money(r.lifetime_cents) }] : []),
    { key: 'since', label: 'Since', render: (r) => shortDate(r.created_at) },
  ];
  return (
    <>
      <PageHeader title="Customers" />
      <Card>
        <form className="mb-4" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
          <label>
            <span className="sr-only">Search customers</span>
            <Input type="search" placeholder="Name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </form>
        <Loader state={state}>{(d) => <Table columns={columns} rows={d.customers} rowKey={(r) => r.id} caption="Customers" empty="No customers yet." />}</Loader>
      </Card>
      {can('customers.privacy') && <DataRequests />}
    </>
  );
}

function DataRequests() {
  const state = useLoad<{ requests: Array<{ id: string; kind: string; status: string; created_at: string; customer_id: string; name: string; email: string }> }>('/api/admin/customers/requests/data');
  const open = state.data?.requests.filter((r) => r.status === 'requested') ?? [];
  if (!open.length) return null;
  return (
    <Card title="Privacy requests" className="mt-4">
      <ul className="divide-y divide-charcoal/8 text-[0.88rem]">
        {open.map((r) => (
          <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
            <Link to={`/admin/customers/${r.customer_id}`} className="font-medium hover:underline">{r.name}</Link>
            <span>{r.kind === 'export' ? 'Wants a copy of their data' : 'Wants their data erased'}</span>
            <span className="text-charcoal/70">{shortDate(r.created_at)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
