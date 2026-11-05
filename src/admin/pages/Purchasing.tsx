import { useState } from 'react';
import { api } from '../../lib/api';
import { money, shortDate } from '../../lib/format';
import { Btn, Card, Field, Input, Loader, Modal, PageHeader, StatusBadge, Table, useAction, useLoad, type Column } from '../ui';

type Suggestion = { id: string; sku: string; name: string; unit: string; on_hand: number; reserved: number; planned: number; projected: number; suggested_quantity: number; supplier_id: string | null; supplier_name: string | null; lead_time_days: number | null; cost_cents: number | null };
type Supplier = { id: string; name: string; contact_name: string | null; email: string | null; phone: string | null; lead_time_days: number | null; active: boolean };
type PO = { id: string; reference: string; status: string; expected_on: string | null; created_at: string; supplier_name: string; lines: Array<{ id: string; item_id: string; name: string; unit: string; quantity: number; received_quantity: number; unit_cost_cents: number | null }> };

export default function Purchasing() {
  const suggestions = useLoad<{ suggestions: Suggestion[]; note: string }>('/api/admin/inventory/purchasing-suggestions');
  const suppliers = useLoad<{ suppliers: Supplier[] }>('/api/admin/inventory/suppliers');
  const orders = useLoad<{ purchase_orders: PO[] }>('/api/admin/inventory/purchase-orders');
  const requirements = useLoad<{ from: string; to: string; totals: Array<{ item_id: string; name: string; unit: string; quantity: number }> }>('/api/admin/inventory/material-requirements');
  const { busy, run } = useAction();
  const [supplierForm, setSupplierForm] = useState<Partial<Supplier> | null>(null);
  const [receiving, setReceiving] = useState<PO | null>(null);
  const [received, setReceived] = useState<Record<string, string>>({});
  const [bestBy, setBestBy] = useState('');
  const [notes, setNotes] = useState('');

  const reloadAll = () => {
    void suggestions.reload();
    void orders.reload();
  };

  const createPo = async (supplierId: string, lines: Suggestion[]) => {
    const ok = await run(() => api('/api/admin/inventory/purchase-orders', { body: { supplier_id: supplierId, notes: notes || null, lines: lines.map((l) => ({ item_id: l.id, quantity: l.suggested_quantity, unit_cost_cents: l.cost_cents })) } }), 'Purchase order drafted.');
    if (ok !== undefined) reloadAll();
  };

  const suggestionColumns: Column<Suggestion>[] = [
    { key: 'name', label: 'Item', render: (r) => r.name },
    { key: 'on_hand', label: 'On hand', align: 'right', render: (r) => r.on_hand },
    { key: 'promised', label: 'Promised', align: 'right', render: (r) => r.reserved },
    { key: 'planned', label: 'For events', align: 'right', render: (r) => r.planned },
    { key: 'projected', label: 'Projected', align: 'right', render: (r) => <span className={r.projected < 0 ? 'font-semibold text-rose-deep' : ''}>{r.projected}</span> },
    { key: 'suggest', label: 'Suggested', align: 'right', render: (r) => `${r.suggested_quantity} ${r.unit}` },
    { key: 'supplier', label: 'Supplier', render: (r) => r.supplier_name ? `${r.supplier_name}${r.lead_time_days !== null ? `, ${r.lead_time_days} days` : ''}` : 'None set' },
  ];

  return (
    <>
      <PageHeader title="Purchasing" subtitle="What to buy, from whom, and what has arrived" actions={<Btn tone="primary" onClick={() => setSupplierForm({ active: true })}>Add supplier</Btn>} />
      <div className="space-y-4">
        <Card title="Suggested purchases">
          <Loader state={suggestions}>
            {(d) => {
              const bySupplier = new Map<string, Suggestion[]>();
              for (const s of d.suggestions) if (s.supplier_id) bySupplier.set(s.supplier_id, [...(bySupplier.get(s.supplier_id) ?? []), s]);
              return (
                <>
                  <p className="mb-3 text-[0.8rem] text-charcoal/70">{d.note}</p>
                  <Table columns={suggestionColumns} rows={d.suggestions} rowKey={(r) => r.id} caption="Suggested purchases" empty="Nothing needs buying right now." />
                  {bySupplier.size > 0 && (
                    <div className="mt-3 space-y-2 border-t border-charcoal/10 pt-3">
                      <Field label="Note for new purchase orders"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
                      <div className="flex flex-wrap gap-2">
                        {[...bySupplier.entries()].map(([id, lines]) => (
                          <Btn key={id} small disabled={busy} onClick={() => createPo(id, lines)}>Draft order for {lines[0].supplier_name} ({lines.length})</Btn>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            }}
          </Loader>
        </Card>
        <Card title="Materials needed, next 30 days">
          <Loader state={requirements}>
            {(d) =>
              d.totals.length === 0 ? (
                <p className="text-[0.88rem] text-charcoal/70">No accepted orders or confirmed events need materials in this period.</p>
              ) : (
                <ul className="grid gap-x-6 gap-y-1 text-[0.88rem] sm:grid-cols-2">
                  {d.totals.map((t) => (
                    <li key={t.item_id} className="flex justify-between gap-3">
                      <span>{t.name}</span>
                      <span className="tabular-nums">{t.quantity} {t.unit}</span>
                    </li>
                  ))}
                </ul>
              )
            }
          </Loader>
        </Card>
        <Card title="Purchase orders">
          <Loader state={orders}>
            {(d) =>
              d.purchase_orders.length === 0 ? (
                <p className="text-[0.88rem] text-charcoal/70">None yet.</p>
              ) : (
                <ul className="divide-y divide-charcoal/8">
                  {d.purchase_orders.map((po) => (
                    <li key={po.id} className="py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[0.9rem] font-medium">{po.reference} · {po.supplier_name}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={po.status} />
                          {po.status === 'draft' && <Btn small disabled={busy} onClick={async () => { await run(() => api(`/api/admin/inventory/purchase-orders/${po.id}/status`, { body: { status: 'sent' } }), 'Marked as sent.'); void orders.reload(); }}>Mark sent</Btn>}
                          {(po.status === 'sent' || po.status === 'partially_received' || po.status === 'draft') && <Btn small onClick={() => { setReceiving(po); setReceived({}); setBestBy(''); }}>Receive</Btn>}
                          {(po.status === 'draft' || po.status === 'sent') && <Btn small tone="ghost" disabled={busy} onClick={async () => { await run(() => api(`/api/admin/inventory/purchase-orders/${po.id}/status`, { body: { status: 'cancelled' } }), 'Cancelled.'); void orders.reload(); }}>Cancel</Btn>}
                        </div>
                      </div>
                      <ul className="mt-1 text-[0.82rem] text-charcoal/70">
                        {po.lines.map((l) => (
                          <li key={l.id}>{l.quantity} {l.unit} × {l.name}{l.received_quantity > 0 && ` (${l.received_quantity} received)`}{l.unit_cost_cents !== null && ` at ${money(l.unit_cost_cents)}`}</li>
                        ))}
                      </ul>
                      <p className="text-[0.72rem] text-charcoal/70">Created {shortDate(po.created_at)}</p>
                    </li>
                  ))}
                </ul>
              )
            }
          </Loader>
        </Card>
        <Card title="Suppliers">
          <Loader state={suppliers}>
            {(d) =>
              d.suppliers.length === 0 ? (
                <p className="text-[0.88rem] text-charcoal/70">None yet.</p>
              ) : (
                <ul className="divide-y divide-charcoal/8 text-[0.88rem]">
                  {d.suppliers.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                      <div>
                        <p className="font-medium">{s.name}</p>
                        <p className="text-[0.78rem] text-charcoal/70">{[s.contact_name, s.email, s.phone].filter(Boolean).join(' · ')}{s.lead_time_days !== null ? ` · ${s.lead_time_days} day lead time` : ''}</p>
                      </div>
                      <Btn small onClick={() => setSupplierForm(s)}>Edit</Btn>
                    </li>
                  ))}
                </ul>
              )
            }
          </Loader>
        </Card>
      </div>

      <Modal title={supplierForm?.id ? 'Edit supplier' : 'Add a supplier'} open={Boolean(supplierForm)} onClose={() => setSupplierForm(null)}>
        {supplierForm && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required className="sm:col-span-2"><Input value={supplierForm.name ?? ''} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} /></Field>
            <Field label="Contact"><Input value={supplierForm.contact_name ?? ''} onChange={(e) => setSupplierForm({ ...supplierForm, contact_name: e.target.value })} /></Field>
            <Field label="Email"><Input type="email" value={supplierForm.email ?? ''} onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })} /></Field>
            <Field label="Phone"><Input value={supplierForm.phone ?? ''} onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })} /></Field>
            <Field label="Lead time, in days"><Input inputMode="numeric" value={supplierForm.lead_time_days ?? ''} onChange={(e) => setSupplierForm({ ...supplierForm, lead_time_days: e.target.value ? Number(e.target.value) : null })} /></Field>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setSupplierForm(null)}>Cancel</Btn>
          <Btn
            tone="primary"
            disabled={busy || !supplierForm?.name?.trim()}
            onClick={async () => {
              if (!supplierForm) return;
              const body = { name: supplierForm.name, contact_name: supplierForm.contact_name || null, email: supplierForm.email || null, phone: supplierForm.phone || null, lead_time_days: supplierForm.lead_time_days ?? null, active: true };
              const ok = await run(() => (supplierForm.id ? api(`/api/admin/inventory/suppliers/${supplierForm.id}`, { method: 'PUT', body }) : api('/api/admin/inventory/suppliers', { body })), 'Saved.');
              if (ok !== undefined) {
                setSupplierForm(null);
                void suppliers.reload();
              }
            }}
          >
            Save
          </Btn>
        </div>
      </Modal>

      <Modal title={`Receive ${receiving?.reference ?? ''}`} open={Boolean(receiving)} onClose={() => setReceiving(null)}>
        <div className="space-y-3">
          {receiving?.lines.map((l) => (
            <Field key={l.id} label={`${l.name} (${l.received_quantity} of ${l.quantity} received)`}>
              <Input inputMode="numeric" value={received[l.id] ?? ''} onChange={(e) => setReceived({ ...received, [l.id]: e.target.value })} />
            </Field>
          ))}
          <Field label="Best by, for perishables"><Input type="date" value={bestBy} onChange={(e) => setBestBy(e.target.value)} /></Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setReceiving(null)}>Cancel</Btn>
          <Btn
            tone="primary"
            disabled={busy}
            onClick={async () => {
              if (!receiving) return;
              const lines = Object.entries(received).filter(([, v]) => Number(v) > 0).map(([line_id, v]) => ({ line_id, quantity: Number(v), best_by: bestBy || null }));
              if (!lines.length) return;
              const ok = await run(() => api(`/api/admin/inventory/purchase-orders/${receiving.id}/receive`, { body: { lines } }), 'Stock received.');
              if (ok !== undefined) {
                setReceiving(null);
                reloadAll();
              }
            }}
          >
            Add to stock
          </Btn>
        </div>
      </Modal>
    </>
  );
}
