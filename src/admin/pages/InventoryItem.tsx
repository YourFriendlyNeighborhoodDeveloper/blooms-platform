import { useParams } from 'react-router';
import { dateTimeLabel, statusLabel } from '../../lib/format';
import { Card, Loader, PageHeader, StatusBadge, Table, useLoad, type Column } from '../ui';

type Movement = { id: string; delta_on_hand: number; delta_reserved: number; reason: string; note: string | null; created_at: string; actor: string | null; order_reference: string | null };
type Item = {
  id: string; name: string; sku: string; unit: string; kind: string; low_stock_threshold: number | null;
  levels: Array<{ location_id: string; location: string; on_hand: number; reserved: number }>;
  movements: Movement[];
  lots: Array<{ id: string; quantity_remaining: number; best_by: string | null; received_at: string; note: string | null }>;
  reservations: Array<{ id: string; quantity: number; status: string; expires_at: string | null; order_reference: string | null; order_id: string | null }>;
};

export default function InventoryItem() {
  const { id } = useParams();
  const state = useLoad<Item>(`/api/admin/inventory/items/${id}`);
  const columns: Column<Movement>[] = [
    { key: 'when', label: 'When', render: (m) => dateTimeLabel(m.created_at) },
    { key: 'reason', label: 'What', render: (m) => statusLabel(m.reason) },
    { key: 'on_hand', label: 'On hand', align: 'right', render: (m) => (m.delta_on_hand > 0 ? `+${m.delta_on_hand}` : m.delta_on_hand || '') },
    { key: 'reserved', label: 'Promised', align: 'right', render: (m) => (m.delta_reserved > 0 ? `+${m.delta_reserved}` : m.delta_reserved || '') },
    { key: 'ref', label: 'Order', render: (m) => m.order_reference ?? '' },
    { key: 'note', label: 'Note', render: (m) => m.note ?? '' },
    { key: 'who', label: 'By', render: (m) => m.actor ?? 'System' },
  ];
  return (
    <Loader state={state}>
      {(i) => (
        <>
          <PageHeader title={i.name} subtitle={`${i.sku} · ${statusLabel(i.kind)} · measured in ${i.unit}`} back={{ to: '/admin/inventory', label: 'Inventory' }} />
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Stock by location">
              <ul className="space-y-1 text-[0.88rem]">
                {i.levels.map((l) => (
                  <li key={l.location_id} className="flex justify-between gap-3">
                    <span>{l.location}</span>
                    <span className="tabular-nums">{l.on_hand} on hand, {l.reserved} promised</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Open reservations">
              {i.reservations.length === 0 && <p className="text-[0.88rem] text-charcoal/70">None.</p>}
              <ul className="space-y-1 text-[0.85rem]">
                {i.reservations.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                    {r.order_id ? <a className="underline" href={`/admin/orders/${r.order_id}`}>{r.order_reference}</a> : <span>Event</span>}
                    <span className="tabular-nums">{r.quantity}</span>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Lots with stock left">
              {i.lots.length === 0 && <p className="text-[0.88rem] text-charcoal/70">None tracked.</p>}
              <ul className="space-y-1 text-[0.85rem]">
                {i.lots.map((l) => (
                  <li key={l.id} className="flex justify-between gap-3">
                    <span>{l.quantity_remaining} left</span>
                    <span className="text-charcoal/70">{l.best_by ? `Best by ${l.best_by}` : 'No date'}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <Card title="History" className="mt-4">
            <Table columns={columns} rows={i.movements} rowKey={(m) => m.id} caption="Stock movements" empty="No movements yet." />
          </Card>
        </>
      )}
    </Loader>
  );
}
