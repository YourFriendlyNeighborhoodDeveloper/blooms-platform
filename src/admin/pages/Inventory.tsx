import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../../lib/api';
import { useSession } from '../session';
import { Badge, Btn, Card, Checkbox, Field, Input, Loader, Modal, PageHeader, Select, Table, useAction, useLoad, type Column } from '../ui';

type Row = { id: string; sku: string; name: string; kind: string; unit: string; low_stock_threshold: number | null; perishable: boolean; on_hand: number; reserved: number; available: number; supplier_name: string | null };

export default function Inventory() {
  const [params, setParams] = useSearchParams();
  const { can } = useSession();
  const [q, setQ] = useState(params.get('q') ?? '');
  const query = useMemo(() => params.toString(), [params]);
  const state = useLoad<{ items: Row[] }>(`/api/admin/inventory/items?${query}`);
  const { busy, run } = useAction();
  const [adding, setAdding] = useState(false);
  const [adjust, setAdjust] = useState<Row | null>(null);
  const locations = useLoad<{ locations: Array<{ id: string; name: string; is_default: boolean }> }>('/api/admin/inventory/locations');
  const [locationName, setLocationName] = useState('');
  const [locationId, setLocationId] = useState('');
  const [form, setForm] = useState({ sku: '', name: '', kind: 'material', unit: 'each', threshold: '', reorder: '', perishable: false });
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('receive');
  const [note, setNote] = useState('');
  const [bestBy, setBestBy] = useState('');

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const columns: Column<Row>[] = [
    { key: 'name', label: 'Item', render: (r) => (
      <div>
        <Link to={`/admin/inventory/items/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
        {r.perishable && <span className="ml-1.5"><Badge tone="info">perishable</Badge></span>}
        <p className="text-[0.75rem] text-charcoal/70">{r.sku}</p>
      </div>
    ) },
    { key: 'kind', label: 'Type', render: (r) => <span className="capitalize">{r.kind.replace('_', ' ')}</span> },
    { key: 'on_hand', label: 'On hand', align: 'right', render: (r) => r.on_hand },
    { key: 'reserved', label: 'Promised', align: 'right', render: (r) => r.reserved },
    { key: 'available', label: 'Available', align: 'right', render: (r) => <span className={r.low_stock_threshold !== null && r.available <= r.low_stock_threshold ? 'font-semibold text-rose-deep' : ''}>{r.available} {r.unit}</span> },
    { key: 'threshold', label: 'Alert at', align: 'right', render: (r) => r.low_stock_threshold ?? '—' },
    { key: 'supplier', label: 'Supplier', render: (r) => r.supplier_name ?? '—' },
    ...(can('inventory.manage') ? [{ key: 'actions', label: '', render: (r: Row) => <Btn small onClick={() => { setAdjust(r); setDelta(''); setReason('receive'); setNote(''); setBestBy(''); }}>Adjust</Btn> }] : []),
  ];

  const create = async () => {
    const ok = await run(() => api('/api/admin/inventory/items', { body: { sku: form.sku, name: form.name, kind: form.kind, unit: form.unit, low_stock_threshold: form.threshold ? Number(form.threshold) : null, reorder_quantity: form.reorder ? Number(form.reorder) : null, perishable: form.perishable } }), 'Item added.');
    if (ok !== undefined) {
      setAdding(false);
      setForm({ sku: '', name: '', kind: 'material', unit: 'each', threshold: '', reorder: '', perishable: false });
      void state.reload();
    }
  };

  const applyAdjust = async () => {
    if (!adjust) return;
    const raw = Number(delta);
    const signed = reason === 'waste' || reason === 'spoilage' ? -Math.abs(raw) : raw;
    const ok = await run(() => api(`/api/admin/inventory/items/${adjust.id}/adjust`, { body: { delta: signed, reason, note: note || null, best_by: bestBy || null, ...(locationId ? { location_id: locationId } : {}) } }), 'Stock updated.');
    if (ok !== undefined) {
      setAdjust(null);
      void state.reload();
    }
  };

  return (
    <>
      <PageHeader title="Inventory" subtitle="Finished goods and the materials that make them" actions={can('inventory.manage') && <Btn tone="primary" onClick={() => setAdding(true)}>Add item</Btn>} />
      <Card>
        <form className="mb-4 flex flex-wrap items-center gap-3" onSubmit={(e) => { e.preventDefault(); set('q', q.trim()); }}>
          <label className="min-w-[14rem] flex-1">
            <span className="sr-only">Search inventory</span>
            <Input type="search" placeholder="Name or SKU" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <label>
            <span className="sr-only">Type</span>
            <Select value={params.get('kind') ?? ''} onChange={(e) => set('kind', e.target.value)}>
              <option value="">All types</option>
              <option value="finished_good">Finished goods</option>
              <option value="material">Materials</option>
              <option value="packaging">Packaging</option>
            </Select>
          </label>
          <label className="flex items-center gap-2 text-[0.85rem]">
            <input type="checkbox" checked={params.get('low') === 'true'} onChange={(e) => set('low', e.target.checked ? 'true' : '')} />
            Low stock only
          </label>
        </form>
        <Loader state={state}>{(d) => <Table columns={columns} rows={d.items} rowKey={(r) => r.id} caption="Inventory" empty="No stock items yet." />}</Loader>
      </Card>
      <Modal title="Add a stock item" open={adding} onClose={() => setAdding(false)}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="SKU" required><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></Field>
          <Field label="Type"><Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="material">Material</option><option value="finished_good">Finished good</option><option value="packaging">Packaging</option><option value="other">Other</option></Select></Field>
          <Field label="Unit" hint="Such as stem, bunch or each."><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></Field>
          <Field label="Alert when at or below"><Input inputMode="numeric" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} /></Field>
          <Field label="Usual reorder quantity"><Input inputMode="numeric" value={form.reorder} onChange={(e) => setForm({ ...form, reorder: e.target.value })} /></Field>
        </div>
        <div className="mt-3"><Checkbox label="Perishable (track best-by dates)" checked={form.perishable} onChange={(v) => setForm({ ...form, perishable: v })} /></div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setAdding(false)}>Cancel</Btn>
          <Btn tone="primary" disabled={busy || !form.name.trim() || !form.sku.trim()} onClick={create}>Add item</Btn>
        </div>
      </Modal>
      <Card title="Stock locations" className="mt-4">
        <ul className="mb-3 flex flex-wrap gap-2 text-[0.85rem]">
          {locations.data?.locations.map((l) => <li key={l.id}><Badge tone={l.is_default ? 'info' : 'neutral'}>{l.name}{l.is_default ? ' (main)' : ''}</Badge></li>)}
        </ul>
        {can('inventory.manage') && (
          <div className="flex gap-2">
            <label className="flex-1"><span className="sr-only">New location name</span><Input placeholder="Such as Cooler or Back room" value={locationName} onChange={(e) => setLocationName(e.target.value)} /></label>
            <Btn disabled={busy || !locationName.trim()} onClick={async () => { const ok = await run(() => api('/api/admin/inventory/locations', { body: { name: locationName.trim() } }), 'Location added.'); if (ok !== undefined) { setLocationName(''); void locations.reload(); } }}>Add</Btn>
          </div>
        )}
      </Card>
      <Modal title={`Adjust ${adjust?.name ?? ''}`} open={Boolean(adjust)} onClose={() => setAdjust(null)}>
        <div className="space-y-3">
          <Field label="What happened?">
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="receive">Received new stock</option>
              <option value="count">Stock count correction</option>
              <option value="adjust">Other correction</option>
              <option value="waste">Waste</option>
              <option value="spoilage">Spoilage</option>
              <option value="return">Customer return</option>
            </Select>
          </Field>
          <Field label="Quantity" hint={reason === 'waste' || reason === 'spoilage' ? 'How many were lost.' : 'Use a negative number to reduce stock.'}><Input inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} /></Field>
          {reason === 'receive' && adjust?.perishable && <Field label="Best by"><Input type="date" value={bestBy} onChange={(e) => setBestBy(e.target.value)} /></Field>}
          {(locations.data?.locations.length ?? 0) > 1 && (
            <Field label="Location">
              <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">Main location</option>
                {locations.data?.locations.filter((l) => !l.is_default).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setAdjust(null)}>Cancel</Btn>
          <Btn tone="primary" disabled={busy || !Number(delta)} onClick={applyAdjust}>Save</Btn>
        </div>
      </Modal>
    </>
  );
}
