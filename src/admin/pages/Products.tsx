import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../../lib/api';
import { money } from '../../lib/format';
import { CatalogSetup } from '../components/CatalogSetup';
import { Badge, Btn, Card, Field, Input, Loader, Modal, PageHeader, Select, StatusBadge, Table, useAction, useLoad, type Column } from '../ui';

type Variant = { id: string; name: string; sku: string; price_cents: number; sale_price_cents: number | null; active: boolean; available: number | null };
type Row = { id: string; name: string; slug: string; status: string; is_demo: boolean; division_name: string; variants: Variant[]; images: Array<{ url: string }>; warnings: string[] };
type Meta = { divisions: Array<{ id: string; name: string }>; categories: Array<{ id: string; name: string; division_id: string; slug: string; active: boolean }> };

export default function Products() {
  const state = useLoad<{ products: Row[] }>('/api/admin/catalog/products');
  const meta = useLoad<Meta>('/api/admin/catalog/meta');
  const navigate = useNavigate();
  const { busy, run } = useAction();
  const [open, setOpen] = useState<null | 'product'>(null);
  const [name, setName] = useState('');
  const [divisionId, setDivisionId] = useState('');

  const columns: Column<Row>[] = [
    { key: 'name', label: 'Product', render: (r) => (
      <div className="flex items-center gap-3">
        {r.images[0] ? <img src={r.images[0].url} alt="" className="h-11 w-11 rounded-lg object-cover" /> : <div className="h-11 w-11 rounded-lg bg-ivory-deep" />}
        <div>
          <Link to={`/admin/products/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
          {r.is_demo && <span className="ml-1.5"><Badge tone="warn">demo</Badge></span>}
          {r.warnings.map((w) => <p key={w} className="text-[0.75rem] text-rose-deep">{w}</p>)}
        </div>
      </div>
    ) },
    { key: 'division', label: 'Department', render: (r) => r.division_name },
    { key: 'price', label: 'Price', render: (r) => r.variants.map((v) => <div key={v.id} className="tabular-nums">{money(v.sale_price_cents ?? v.price_cents)}{r.variants.length > 1 ? ` · ${v.name}` : ''}</div>) },
    { key: 'stock', label: 'Available', render: (r) => r.variants.map((v) => <div key={v.id} className="tabular-nums">{v.available === null ? 'Made to order' : v.available}</div>) },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  const create = async () => {
    const res = await run(() => api<{ id: string }>('/api/admin/catalog/products', { body: { name, division_id: divisionId || meta.data?.divisions[0]?.id, status: 'draft' } }));
    if (res) navigate(`/admin/products/${res.id}`);
  };

  return (
    <>
      <PageHeader title="Products" subtitle="What customers can buy online" actions={<><Btn tone="primary" onClick={() => setOpen('product')}>Add product</Btn></>} />
      <Card>
        <Loader state={state}>{(d) => <Table columns={columns} rows={d.products} rowKey={(r) => r.id} caption="Products" empty="No products yet. Add your first one to open the shop." />}</Loader>
      </Card>
      <CatalogSetup />
      <Modal title="Add a product" open={Boolean(open)} onClose={() => setOpen(null)}>
        <div className="space-y-3">
          <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Department" required>
            <Select value={divisionId} onChange={(e) => setDivisionId(e.target.value)}>
              {meta.data?.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setOpen(null)}>Cancel</Btn>
          <Btn tone="primary" disabled={busy || !name.trim()} onClick={create}>Create</Btn>
        </div>
      </Modal>
    </>
  );
}
