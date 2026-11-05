import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { dateTimeLabel, money } from '../../lib/format';
import { Badge, Btn, Card, Checkbox, Field, Input, Loader, Modal, PageHeader, StatusBadge, Textarea, useAction, useLoad } from '../ui';

type Item = { id: string; name: string; category: string | null; description: string | null; image_url: string | null; quantity: number; price_cents: number | null; setup_requirements: string | null; logistics_notes: string | null; requires_delivery: boolean; cleaning_buffer_minutes: number; replacement_cost_cents: number | null; active: boolean; sort_order: number; is_demo: boolean };
type Reservation = { id: string; rental_item_id: string; quantity: number; starts_at: string; ends_at: string; blocked_until: string; status: string; item_name: string; customer_name: string | null; inquiry_id: string | null; event_date: string | null; damage_notes: string | null };

export default function Rentals() {
  const state = useLoad<{ items: Item[]; reservations: Reservation[] }>('/api/admin/rentals');
  const { busy, run } = useAction();
  const [editing, setEditing] = useState<Partial<Item> | null>(null);
  const [returning, setReturning] = useState<Reservation | null>(null);
  const [ret, setRet] = useState({ condition: '', damage: '', cost: '' });
  const [price, setPrice] = useState('');
  const [replacement, setReplacement] = useState('');

  const open = (i: Partial<Item>) => {
    setEditing(i);
    setPrice(i.price_cents !== null && i.price_cents !== undefined ? (i.price_cents / 100).toFixed(2) : '');
    setReplacement(i.replacement_cost_cents !== null && i.replacement_cost_cents !== undefined ? (i.replacement_cost_cents / 100).toFixed(2) : '');
  };

  const save = async () => {
    if (!editing) return;
    const body = { name: editing.name, category: editing.category || null, description: editing.description || null, image_url: editing.image_url || null, quantity: Number(editing.quantity) || 0, price_cents: price ? Math.round(Number(price) * 100) : null, setup_requirements: editing.setup_requirements || null, logistics_notes: editing.logistics_notes || null, requires_delivery: editing.requires_delivery ?? false, cleaning_buffer_minutes: Number(editing.cleaning_buffer_minutes) || 0, replacement_cost_cents: replacement ? Math.round(Number(replacement) * 100) : null, active: editing.active ?? true, sort_order: Number(editing.sort_order) || 0 };
    const ok = await run(() => (editing.id ? api(`/api/admin/rentals/${editing.id}`, { method: 'PUT', body }) : api('/api/admin/rentals', { body })), 'Saved.');
    if (ok !== undefined) {
      setEditing(null);
      void state.reload();
    }
  };

  return (
    <>
      <PageHeader title="Rentals" subtitle="Pieces stay blocked through their cleaning time, so they can never be promised before they are ready." actions={<Btn tone="primary" onClick={() => open({ quantity: 1, active: true, cleaning_buffer_minutes: 0 })}>Add rental item</Btn>} />
      <Loader state={state}>
        {(d) => (
          <div className="space-y-4">
            <Card title="Items">
              {d.items.length === 0 && <p className="text-[0.88rem] text-charcoal/70">No rental items yet. Add your arches, stands and vases here.</p>}
              <ul className="divide-y divide-charcoal/8 text-[0.88rem]">
                {d.items.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <div>
                      <p className="font-medium">{i.name} {!i.active && <Badge>hidden</Badge>} {i.is_demo && <Badge tone="warn">demo</Badge>}</p>
                      <p className="text-[0.78rem] text-charcoal/70">{i.quantity} owned · {i.cleaning_buffer_minutes} minute turnaround{i.price_cents !== null ? ` · ${money(i.price_cents)}` : ''}{i.replacement_cost_cents !== null ? ` · ${money(i.replacement_cost_cents)} to replace` : ''}</p>
                    </div>
                    <Btn small onClick={() => open(i)}>Edit</Btn>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Reservations">
              {d.reservations.length === 0 && <p className="text-[0.88rem] text-charcoal/70">Nothing reserved.</p>}
              <ul className="divide-y divide-charcoal/8 text-[0.86rem]">
                {d.reservations.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <div>
                      <p className="font-medium">{r.quantity} × {r.item_name}</p>
                      <p className="text-[0.78rem] text-charcoal/70">
                        {r.inquiry_id ? <Link className="underline" to={`/admin/weddings/${r.inquiry_id}`}>{r.customer_name}</Link> : r.customer_name} · {dateTimeLabel(r.starts_at)} to {dateTimeLabel(r.ends_at)} · free again {dateTimeLabel(r.blocked_until)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={r.status} />
                      {(r.status === 'confirmed' || r.status === 'approved') && <Btn small disabled={busy} onClick={async () => { await run(() => api(`/api/admin/rental-reservations/${r.id}/out`, { body: {} }), 'Marked as out.'); void state.reload(); }}>Mark out</Btn>}
                      {(r.status === 'out' || r.status === 'confirmed') && <Btn small onClick={() => { setReturning(r); setRet({ condition: '', damage: '', cost: '' }); }}>Record return</Btn>}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}
      </Loader>
      <Modal title={editing?.id ? 'Edit rental item' : 'Add a rental item'} open={Boolean(editing)} onClose={() => setEditing(null)}>
        {editing && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required className="sm:col-span-2"><Input value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="How many do you own?" required><Input inputMode="numeric" value={editing.quantity ?? ''} onChange={(e) => setEditing({ ...editing, quantity: Number(e.target.value) || 0 })} /></Field>
            <Field label="Category"><Input value={editing.category ?? ''} onChange={(e) => setEditing({ ...editing, category: e.target.value })} /></Field>
            <Field label="Cleaning and turnaround, in minutes" hint="Blocked after each return."><Input inputMode="numeric" value={editing.cleaning_buffer_minutes ?? 0} onChange={(e) => setEditing({ ...editing, cleaning_buffer_minutes: Number(e.target.value) || 0 })} /></Field>
            <Field label="Rental price, in dollars" hint="Blank means custom quote."><Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
            <Field label="Replacement cost, in dollars"><Input inputMode="decimal" value={replacement} onChange={(e) => setReplacement(e.target.value)} /></Field>
            <Field label="Image link"><Input value={editing.image_url ?? ''} onChange={(e) => setEditing({ ...editing, image_url: e.target.value })} /></Field>
            <Field label="Description" className="sm:col-span-2"><Textarea value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
            <Field label="Setup requirements" className="sm:col-span-2"><Textarea value={editing.setup_requirements ?? ''} onChange={(e) => setEditing({ ...editing, setup_requirements: e.target.value })} /></Field>
            <Field label="Pickup or delivery notes" className="sm:col-span-2"><Textarea value={editing.logistics_notes ?? ''} onChange={(e) => setEditing({ ...editing, logistics_notes: e.target.value })} /></Field>
            <div className="space-y-2 sm:col-span-2">
              <Checkbox label="Must be delivered by the shop" checked={editing.requires_delivery ?? false} onChange={(v) => setEditing({ ...editing, requires_delivery: v })} />
              <Checkbox label="Offered in the planner" checked={editing.active ?? true} onChange={(v) => setEditing({ ...editing, active: v })} />
            </div>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setEditing(null)}>Cancel</Btn>
          <Btn tone="primary" disabled={busy || !editing?.name?.trim()} onClick={save}>Save</Btn>
        </div>
      </Modal>
      <Modal title={`Return: ${returning?.item_name ?? ''}`} open={Boolean(returning)} onClose={() => setReturning(null)}>
        <div className="space-y-3">
          <Field label="Condition"><Input value={ret.condition} onChange={(e) => setRet({ ...ret, condition: e.target.value })} /></Field>
          <Field label="Damage notes"><Textarea value={ret.damage} onChange={(e) => setRet({ ...ret, damage: e.target.value })} /></Field>
          <Field label="Damage cost, in dollars"><Input inputMode="decimal" value={ret.cost} onChange={(e) => setRet({ ...ret, cost: e.target.value })} /></Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setReturning(null)}>Cancel</Btn>
          <Btn tone="primary" disabled={busy} onClick={async () => { if (!returning) return; const ok = await run(() => api(`/api/admin/rental-reservations/${returning.id}/return`, { body: { condition_notes: ret.condition || null, damage_notes: ret.damage || null, damage_cost_cents: ret.cost ? Math.round(Number(ret.cost) * 100) : null } }), 'Return recorded.'); if (ok !== undefined) { setReturning(null); void state.reload(); } }}>Record return</Btn>
        </div>
      </Modal>
    </>
  );
}
