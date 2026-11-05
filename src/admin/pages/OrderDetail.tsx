import { useState } from 'react';
import { useParams } from 'react-router';
import { api } from '../../lib/api';
import { dateLabel, dateTimeLabel, money, statusLabel, timeLabel } from '../../lib/format';
import { useSession } from '../session';
import { AssignedTeam } from '../components/AssignedTeam';
import { Badge, BtnLink, Btn, Card, Checkbox, Field, Input, Loader, Modal, PageHeader, Select, StatusBadge, Textarea, useAction, useLoad } from '../ui';

type Item = { id: string; name: string; variant_name: string | null; sku: string | null; quantity: number; status: string; options: { display?: Array<{ label: string; value: string }> }; line_subtotal_cents?: number; discount_cents?: number; tax_cents?: number; prep_minutes: number };
type Fulfillment = {
  id: string; method: string; status: string; scheduled_date: string | null; window_start: string | null; window_end: string | null; window_id: string | null; fee_cents?: number; recipient_name: string | null; recipient_phone: string | null;
  address: { line1?: string; line2?: string | null; city?: string; region?: string; postal_code?: string } | null; instructions: string | null; card_message: string | null; carrier: string | null; tracking_number: string | null; tracking_url: string | null; assigned_staff_id: string | null;
  delivery_id: string | null; delivery_status: string | null; driver_staff_id: string | null; vehicle_id: string | null; route_id: string | null; proof_note: string | null; failure_reason: string | null; zone_name: string | null; items: Array<{ order_item_id: string; quantity: number }>;
};
type Order = {
  id: string; reference: string; status: string; payment_status?: string; needs_attention: boolean; attention_reason: string | null; acceptance_mode: string; review_timing: string; acceptance_reasons: Array<{ code: string; message: string }>;
  contact_name: string; contact_email?: string; contact_phone: string | null; customer_id: string; customer_note: string | null; placed_at: string; hold_expires_at: string | null; is_test: boolean;
  subtotal_cents?: number; discount_cents?: number; delivery_cents?: number; shipping_cents?: number; tax_cents?: number; total_cents?: number; paid_cents?: number; refunded_cents?: number;
  items: Item[]; fulfillments: Fulfillment[];
  history: Array<{ id: string; from_status: string | null; to_status: string; note: string | null; created_at: string; actor_type: string; item_name: string | null; actor_email: string | null; customer_visible: boolean }>;
  notes: Array<{ id: string; body: string; created_at: string; author: string | null }>;
  tasks: Array<{ id: string; title: string; status: string; due_at: string | null }>;
  payments: Array<{ id: string; gateway: string; kind: string; amount_cents: number; status: string; refunded_cents: number; failure_reason: string | null; paid_at: string | null; created_at: string; manual_reference: string | null }>;
  refunds: Array<{ id: string; amount_cents: number; reason: string | null; status: string; created_at: string }>;
  communications: Array<{ id: string; direction: string; channel: string; subject: string | null; created_at: string }>;
  access: { financials: boolean; customers: boolean };
};

const ITEM_NEXT: Record<string, Array<{ to: string; label: string; methods?: string[] }>> = {
  pending: [{ to: 'preparing', label: 'Start preparing' }, { to: 'ready', label: 'Mark ready' }, { to: 'shortage', label: 'Short on stock' }],
  backordered: [{ to: 'preparing', label: 'Start preparing' }, { to: 'ready', label: 'Mark ready' }],
  shortage: [{ to: 'preparing', label: 'Start preparing' }, { to: 'ready', label: 'Mark ready' }, { to: 'backordered', label: 'Backorder' }],
  preparing: [{ to: 'ready', label: 'Mark ready' }, { to: 'shortage', label: 'Short on stock' }],
  ready: [{ to: 'out_for_delivery', label: 'Send out for delivery', methods: ['delivery'] }, { to: 'shipped', label: 'Mark shipped', methods: ['shipping'] }, { to: 'fulfilled', label: 'Mark picked up', methods: ['pickup'] }],
  out_for_delivery: [{ to: 'fulfilled', label: 'Delivered' }, { to: 'delivery_failed', label: 'Delivery failed' }],
  delivery_failed: [{ to: 'out_for_delivery', label: 'Try delivery again' }, { to: 'ready', label: 'Back at the shop' }, { to: 'fulfilled', label: 'Delivered' }],
  shipped: [{ to: 'fulfilled', label: 'Delivered' }, { to: 'delivery_failed', label: 'Delivery problem' }],
};

const closed = ['fulfilled', 'completed', 'cancelled', 'rejected', 'expired', 'returned'];

export default function OrderDetail() {
  const { id } = useParams();
  const { can } = useSession();
  const state = useLoad<Order>(`/api/admin/orders/${id}`);
  const { busy, run } = useAction();
  const [modal, setModal] = useState<null | 'reject' | 'cancel' | 'refund' | 'info' | 'failed' | 'ship' | 'manual' | 'return'>(null);
  const [returning, setReturning] = useState<{ itemId: string; name: string; max: number; quantity: string; restock: boolean } | null>(null);
  const [text, setText] = useState('');
  const [amount, setAmount] = useState('');
  const [refundToo, setRefundToo] = useState(true);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState<{ itemIds: string[]; status: string } | null>(null);
  const [tracking, setTracking] = useState({ carrier: '', tracking_number: '', tracking_url: '' });

  const [moving, setMoving] = useState<{ id: string; date: string; window_id: string; note: string; override: boolean; windows: Array<{ id: string; weekday: number; start_time: string; end_time: string }> } | null>(null);
  const [instructions, setInstructions] = useState<{ id: string; text: string } | null>(null);
  const [swap, setSwap] = useState<{ itemId: string; name: string; options: Array<{ component_id: string; original_name: string; substitute_item_id: string; substitute_name: string; needed: number; available: number }> | null } | null>(null);
  const openReschedule = async (f: Fulfillment) => {
    const res = await run(() => api<{ windows: NonNullable<typeof moving>['windows'] }>(`/api/admin/fulfillments/${f.id}/windows`));
    if (res) setMoving({ id: f.id, date: f.scheduled_date ?? '', window_id: '', note: '', override: false, windows: res.windows });
  };
  const openSubstitute = async (itemId: string, name: string) => {
    setSwap({ itemId, name, options: null });
    const res = await run(() => api<{ substitutes: NonNullable<NonNullable<typeof swap>['options']> }>(`/api/admin/inventory/substitutes?order_item_id=${itemId}`));
    setSwap(res ? { itemId, name, options: res.substitutes } : null);
  };

  const close = () => {
    setModal(null);
    setText('');
    setAmount('');
    setPending(null);
  };
  const post = async (path: string, body: unknown, success: string) => {
    const ok = await run(() => api(`/api/admin/orders/${id}/${path}`, { body }), success);
    if (ok !== undefined) {
      close();
      await state.reload();
    }
    return ok;
  };

  const setItemStatus = (itemIds: string[], status: string, extra: Record<string, unknown> = {}) => post('items/status', { item_ids: itemIds, status, ...extra }, `Updated to ${status.replace(/_/g, ' ')}.`);

  return (
    <Loader state={state}>
      {(o) => {
        const review = o.status === 'awaiting_review' || o.status === 'needs_customer';
        const working = !closed.includes(o.status) && !['awaiting_payment', 'payment_processing', 'payment_failed', 'awaiting_review'].includes(o.status);
        const manage = can('orders.manage');
        const refundable = o.payments.filter((p) => p.status === 'succeeded' && p.amount_cents > p.refunded_cents);
        return (
          <>
            <PageHeader
              title={o.reference}
              back={{ to: '/admin/orders', label: 'Orders' }}
              subtitle={<>Placed {dateTimeLabel(o.placed_at)}{o.is_test && <span className="ml-2"><Badge tone="warn">test data</Badge></span>}</>}
              actions={
                <>
                  <StatusBadge status={o.status} />
                  {o.payment_status && <StatusBadge status={o.payment_status} />}
                  <BtnLink small to={`/admin/orders/${o.id}/slip`}>Packing slip</BtnLink>
                </>
              }
            />

            {o.needs_attention && (
              <Card className="mb-4 border-rose-deep/40 bg-blush/30" title="Needs a decision">
                <p className="text-[0.9rem]">{o.attention_reason}</p>
                {manage && (
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <Field label="What did you decide?" className="min-w-[16rem] flex-1">
                      <Input value={note} onChange={(e) => setNote(e.target.value)} />
                    </Field>
                    <Btn tone="primary" disabled={busy || !note.trim()} onClick={async () => { await post('resolve-attention', { note }, 'Marked as resolved.'); setNote(''); }}>
                      Mark resolved
                    </Btn>
                  </div>
                )}
              </Card>
            )}

            {review && manage && (
              <Card className="mb-4 border-gold/60 bg-gold-soft/20" title="Waiting for your decision">
                {o.acceptance_reasons?.length > 0 && (
                  <ul className="mb-3 list-disc pl-5 text-[0.88rem]">
                    {o.acceptance_reasons.map((r) => (
                      <li key={r.code + r.message}>{r.message}</li>
                    ))}
                  </ul>
                )}
                {o.hold_expires_at && <p className="mb-3 text-[0.82rem] text-charcoal/70">Stock and capacity are held until {dateTimeLabel(o.hold_expires_at)}.</p>}
                <div className="flex flex-wrap gap-2">
                  <Btn tone="primary" disabled={busy} onClick={() => post('approve', {}, o.payment_status === 'paid' ? 'Order accepted.' : 'Approved. The customer has been asked to pay.')}>
                    {o.payment_status === 'paid' ? 'Accept order' : 'Approve and request payment'}
                  </Btn>
                  <Btn onClick={() => setModal('info')}>Ask the customer</Btn>
                  <Btn tone="danger" onClick={() => setModal('reject')}>Decline</Btn>
                </div>
              </Card>
            )}

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                {o.fulfillments.map((f) => {
                  const items = o.items.filter((i) => f.items.some((x) => x.order_item_id === i.id));
                  return (
                    <Card key={f.id} title={<span className="capitalize">{f.method}{f.zone_name ? ` · ${f.zone_name}` : ''}</span>} actions={<div className="flex flex-wrap items-center gap-1.5">{working && manage && f.method !== 'shipping' && <Btn small onClick={() => openReschedule(f)}>Change date or time</Btn>}{working && manage && <Btn small onClick={() => { setInstructions({ id: f.id, text: f.instructions ?? '' }); }}>Edit instructions</Btn>}<StatusBadge status={f.delivery_status ?? f.status} /></div>}>
                      <div className="mb-3 grid gap-x-6 gap-y-1 text-[0.86rem] sm:grid-cols-2">
                        {f.scheduled_date && f.window_start && f.window_end && <p><strong>When:</strong> {dateLabel(f.scheduled_date)}, {timeLabel(f.window_start)} – {timeLabel(f.window_end)}</p>}
                        {f.recipient_name && <p><strong>For:</strong> {f.recipient_name}{f.recipient_phone ? ` · ${f.recipient_phone}` : ''}</p>}
                        {f.address && <p className="sm:col-span-2"><strong>Address:</strong> {[f.address.line1, f.address.line2, f.address.city, f.address.region, f.address.postal_code].filter(Boolean).join(', ')}</p>}
                        {f.instructions && <p className="sm:col-span-2"><strong>Instructions:</strong> {f.instructions}</p>}
                        {f.tracking_number && <p className="sm:col-span-2"><strong>Tracking:</strong> {f.carrier} {f.tracking_number}</p>}
                        {f.failure_reason && <p className="sm:col-span-2 text-rose-deep"><strong>Failure:</strong> {f.failure_reason}</p>}
                      </div>
                      <ul className="divide-y divide-charcoal/10 border-t border-charcoal/10">
                        {items.map((i) => (
                          <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid="admin-item">
                            <div className="min-w-0 flex-1">
                              <p className="text-[0.9rem] font-medium">{i.quantity} × {i.name}{i.variant_name && i.variant_name !== 'Standard' ? ` (${i.variant_name})` : ''}</p>
                              <p className="text-[0.75rem] text-charcoal/70">{i.sku}</p>
                              {i.options?.display?.map((d) => (
                                <p key={d.label} className="text-[0.8rem] break-words text-charcoal/70">{d.label}: {d.value}</p>
                              ))}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <StatusBadge status={i.status} />
                              {working && (manage || can('inventory.manage')) && ['pending', 'preparing', 'shortage', 'backordered'].includes(i.status) && <Btn small onClick={() => openSubstitute(i.id, i.name)}>Use a substitute</Btn>}
                              {manage && ['fulfilled', 'shipped'].includes(i.status) && <Btn small onClick={() => { setText(''); setReturning({ itemId: i.id, name: i.name, max: i.quantity, quantity: String(i.quantity), restock: true }); setModal('return'); }}>Record a return</Btn>}
                              {working && (manage || can('deliveries.manage')) && (ITEM_NEXT[i.status] ?? [])
                                .filter((n) => !n.methods || n.methods.includes(f.method))
                                .filter((n) => manage || ['out_for_delivery', 'fulfilled', 'delivery_failed'].includes(n.to))
                                .map((n) => (
                                  <Btn
                                    key={n.to}
                                    small
                                    disabled={busy}
                                    onClick={() => {
                                      if (n.to === 'delivery_failed') {
                                        setPending({ itemIds: [i.id], status: n.to });
                                        setModal('failed');
                                      } else if (n.to === 'shipped') {
                                        setPending({ itemIds: [i.id], status: n.to });
                                        setModal('ship');
                                      } else {
                                        void setItemStatus([i.id], n.to);
                                      }
                                    }}
                                  >
                                    {n.label}
                                  </Btn>
                                ))}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  );
                })}

                {o.tasks.length > 0 && (
                  <Card title="Tasks">
                    <ul className="space-y-1 text-[0.88rem]">
                      {o.tasks.map((t) => (
                        <li key={t.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span>{t.title}</span>
                          <StatusBadge status={t.status} />
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                <Card title="History">
                  <ol className="space-y-2 text-[0.85rem]">
                    {o.history.map((h) => (
                      <li key={h.id} className="border-l-2 border-charcoal/10 pl-3">
                        <p>{h.item_name ? `${h.item_name}: ` : ''}{statusLabel(h.to_status)}{!h.customer_visible && <span className="ml-1 text-[0.72rem] text-charcoal/70">(internal)</span>}</p>
                        {h.note && <p className="text-charcoal/70">{h.note}</p>}
                        <p className="text-[0.72rem] text-charcoal/70">{dateTimeLabel(h.created_at)} · {h.actor_email ?? h.actor_type}</p>
                      </li>
                    ))}
                  </ol>
                </Card>
              </div>

              <div className="space-y-4">
                <AssignedTeam subjectType="order" subjectId={o.id} canManage={manage} />

                <Card title="Customer">
                  <p className="text-[0.92rem] font-medium">{o.contact_name}</p>
                  {o.contact_email && <p className="text-[0.85rem] break-all"><a className="underline" href={`mailto:${o.contact_email}`}>{o.contact_email}</a></p>}
                  {o.contact_phone && <p className="text-[0.85rem]"><a className="underline" href={`tel:${o.contact_phone}`}>{o.contact_phone}</a></p>}
                  {o.customer_note && <p className="mt-2 rounded-lg bg-ivory-deep/60 p-2 text-[0.85rem]">{o.customer_note}</p>}
                  {o.access.customers && <a href={`/admin/customers/${o.customer_id}`} className="mt-2 inline-block text-[0.8rem] underline">Customer record</a>}
                </Card>

                {o.access.financials && (
                  <Card title="Payment">
                    <dl className="space-y-1 text-[0.86rem]">
                      <div className="flex justify-between"><dt>Items</dt><dd className="tabular-nums">{money(o.subtotal_cents)}</dd></div>
                      {Boolean(o.discount_cents) && <div className="flex justify-between"><dt>Discount</dt><dd className="tabular-nums">−{money(o.discount_cents)}</dd></div>}
                      {Boolean(o.delivery_cents) && <div className="flex justify-between"><dt>Delivery</dt><dd className="tabular-nums">{money(o.delivery_cents)}</dd></div>}
                      {Boolean(o.shipping_cents) && <div className="flex justify-between"><dt>Shipping</dt><dd className="tabular-nums">{money(o.shipping_cents)}</dd></div>}
                      <div className="flex justify-between"><dt>Tax</dt><dd className="tabular-nums">{money(o.tax_cents)}</dd></div>
                      <div className="flex justify-between border-t border-charcoal/10 pt-1 font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(o.total_cents)}</dd></div>
                      <div className="flex justify-between"><dt>Paid</dt><dd className="tabular-nums">{money(o.paid_cents)}</dd></div>
                      {Boolean(o.refunded_cents) && <div className="flex justify-between"><dt>Refunded</dt><dd className="tabular-nums">{money(o.refunded_cents)}</dd></div>}
                    </dl>
                    <ul className="mt-3 space-y-1 border-t border-charcoal/10 pt-2 text-[0.8rem]">
                      {o.payments.map((p) => (
                        <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span>{p.gateway} · {money(p.amount_cents)}</span>
                          <StatusBadge status={p.status} />
                          {p.failure_reason && <span className="w-full text-rose-deep">{p.failure_reason}</span>}
                        </li>
                      ))}
                      {o.refunds.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span>Refund · {money(r.amount_cents)}</span>
                          <StatusBadge status={r.status} />
                          {r.reason && <span className="w-full text-charcoal/70">{r.reason}</span>}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {can('orders.refund') && refundable.length > 0 && <Btn small onClick={() => setModal('refund')}>Refund</Btn>}
                      {manage && (o.paid_cents ?? 0) < (o.total_cents ?? 0) && !closed.includes(o.status) && <Btn small onClick={() => setModal('manual')}>Record payment</Btn>}
                    </div>
                  </Card>
                )}

                <Card title="Internal notes">
                  <ul className="mb-3 space-y-2 text-[0.85rem]">
                    {o.notes.map((n) => (
                      <li key={n.id} className="rounded-lg bg-ivory-deep/50 p-2">
                        <p className="whitespace-pre-line">{n.body}</p>
                        <p className="mt-1 text-[0.72rem] text-charcoal/70">{n.author} · {dateTimeLabel(n.created_at)}</p>
                      </li>
                    ))}
                  </ul>
                  <Textarea aria-label="Add a note" value={text} onChange={(e) => setText(e.target.value)} placeholder="Customers never see these." />
                  <Btn small className="mt-2" disabled={busy || !text.trim()} onClick={() => post('notes', { body: text }, 'Note added.')}>Add note</Btn>
                </Card>

                {manage && !closed.includes(o.status) && (
                  <Card title="More actions">
                    <div className="flex flex-wrap gap-2">
                      {!review && <Btn small onClick={() => setModal('info')}>Ask the customer</Btn>}
                      <Btn small tone="danger" onClick={() => setModal('cancel')}>Cancel order</Btn>
                    </div>
                  </Card>
                )}

                {o.communications.length > 0 && (
                  <Card title="Messages sent">
                    <ul className="space-y-1 text-[0.8rem]">
                      {o.communications.map((m) => (
                        <li key={m.id}>
                          <span className="capitalize">{m.channel}</span>: {m.subject ?? '(text message)'} <span className="text-charcoal/70">· {dateTimeLabel(m.created_at)}</span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
              </div>
            </div>

            <Modal title="Decline this order" open={modal === 'reject'} onClose={close}>
              <p className="mb-3 text-[0.88rem]">The customer sees this reason. {(o.paid_cents ?? 0) > 0 ? 'Their payment is refunded in full automatically.' : 'They have not been charged.'}</p>
              <Field label="Reason" required><Textarea value={text} onChange={(e) => setText(e.target.value)} /></Field>
              <div className="mt-4 flex justify-end gap-2">
                <Btn onClick={close}>Keep it</Btn>
                <Btn tone="danger" disabled={busy || !text.trim()} onClick={() => post('reject', { reason: text }, 'Order declined.')}>Decline order</Btn>
              </div>
            </Modal>

            <Modal title="Cancel this order" open={modal === 'cancel'} onClose={close}>
              <Field label="Reason" required hint="The customer sees this."><Textarea value={text} onChange={(e) => setText(e.target.value)} /></Field>
              {(o.paid_cents ?? 0) > (o.refunded_cents ?? 0) && can('orders.refund') && (
                <div className="mt-3"><Checkbox label="Refund what was paid" checked={refundToo} onChange={setRefundToo} /></div>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <Btn onClick={close}>Keep it</Btn>
                <Btn tone="danger" disabled={busy || !text.trim()} onClick={() => post('cancel', { reason: text, refund: refundToo && can('orders.refund') }, 'Order cancelled.')}>Cancel order</Btn>
              </div>
            </Modal>

            <Modal title="Change date or time" open={Boolean(moving)} onClose={() => setMoving(null)}>
              {moving && (
                <div className="space-y-3">
                  <Field label="New date" required><Input type="date" value={moving.date} onChange={(e) => setMoving({ ...moving, date: e.target.value, window_id: '' })} /></Field>
                  <Field label="Time" required hint="The shop's usual rules check this move.">
                    <Select value={moving.window_id} onChange={(e) => setMoving({ ...moving, window_id: e.target.value })}>
                      <option value="">Choose a time</option>
                      {moving.windows.filter((w) => moving.date && w.weekday === new Date(`${moving.date}T12:00:00Z`).getUTCDay()).map((w) => <option key={w.id} value={w.id}>{w.start_time.slice(0, 5)} to {w.end_time.slice(0, 5)}</option>)}
                    </Select>
                  </Field>
                  <Field label="Note for the customer"><Textarea value={moving.note} onChange={(e) => setMoving({ ...moving, note: e.target.value })} /></Field>
                  {can('settings.manage') && <Checkbox label="Override capacity limits" hint="Only if you know the shop can do it." checked={moving.override} onChange={(v) => setMoving({ ...moving, override: v })} />}
                </div>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <Btn onClick={() => setMoving(null)}>Close</Btn>
                <Btn tone="primary" disabled={busy || !moving?.date || !moving.window_id} onClick={async () => { if (!moving) return; const ok = await run(() => api(`/api/admin/fulfillments/${moving.id}/reschedule`, { body: { date: moving.date, window_id: moving.window_id, override: moving.override, note: moving.note.trim() || null } }), 'Rescheduled, and the customer has been told.'); if (ok !== undefined) { setMoving(null); await state.reload(); } }}>Move it</Btn>
              </div>
            </Modal>

            <Modal title="Delivery or pickup instructions" open={Boolean(instructions)} onClose={() => setInstructions(null)}>
              {instructions && <Field label="Instructions"><Textarea rows={4} value={instructions.text} onChange={(e) => setInstructions({ ...instructions, text: e.target.value })} /></Field>}
              <div className="mt-4 flex justify-end gap-2">
                <Btn onClick={() => setInstructions(null)}>Close</Btn>
                <Btn tone="primary" disabled={busy} onClick={async () => { if (!instructions) return; const ok = await run(() => api(`/api/admin/fulfillments/${instructions.id}`, { method: 'PATCH', body: { instructions: instructions.text.trim() || null } }), 'Saved.'); if (ok !== undefined) { setInstructions(null); await state.reload(); } }}>Save</Btn>
              </div>
            </Modal>

            <Modal title={`Use a substitute: ${swap?.name ?? ''}`} open={Boolean(swap)} onClose={() => setSwap(null)}>
              {swap && (swap.options === null ? <p className="text-[0.88rem]">Checking…</p> : swap.options.length === 0 ? <p className="text-[0.88rem]">No substitutes have been approved for this item. You can add them to its recipe under Products.</p> : (
                <ul className="divide-y divide-charcoal/10 text-[0.88rem]">
                  {swap.options.map((x) => (
                    <li key={`${x.component_id}:${x.substitute_item_id}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>Replace {x.original_name} with <strong>{x.needed} {x.substitute_name}</strong> <span className="text-charcoal/70">({x.available} available)</span></span>
                      <Btn small disabled={busy || x.available < x.needed} onClick={async () => { const ok = await run(() => api('/api/admin/inventory/substitute', { body: { order_item_id: swap.itemId, component_id: x.component_id, substitute_item_id: x.substitute_item_id } }), 'Substitute reserved.'); if (ok !== undefined) { setSwap(null); await state.reload(); } }}>Use this</Btn>
                    </li>
                  ))}
                </ul>
              ))}
              <div className="mt-4 flex justify-end"><Btn onClick={() => setSwap(null)}>Close</Btn></div>
            </Modal>

            <Modal title={`Return: ${returning?.name ?? ''}`} open={modal === 'return'} onClose={close}>
              {returning && (
                <div className="space-y-3">
                  <Field label={`How many came back? (up to ${returning.max})`} required><Input inputMode="numeric" value={returning.quantity} onChange={(e) => setReturning({ ...returning, quantity: e.target.value })} /></Field>
                  <Field label="Reason"><Textarea value={text} onChange={(e) => setText(e.target.value)} /></Field>
                  <Checkbox label="Put it back in stock" checked={returning.restock} onChange={(v) => setReturning({ ...returning, restock: v })} />
                  <p className="text-[0.8rem] text-charcoal/70">Recording a return does not move money. Use Refund for that.</p>
                </div>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <Btn onClick={close}>Close</Btn>
                <Btn tone="primary" disabled={busy || !returning || !(Number(returning.quantity) > 0) || Number(returning.quantity) > returning.max} onClick={() => returning && post('returns', { order_item_id: returning.itemId, quantity: Number(returning.quantity), reason: text.trim() || null, restock: returning.restock }, 'Return recorded.')}>Record return</Btn>
              </div>
            </Modal>

            <Modal title="Refund" open={modal === 'refund'} onClose={close}>
              <div className="space-y-3">
                <p className="text-[0.85rem] text-charcoal/70">Up to {money(refundable.reduce((s, p) => s + p.amount_cents - p.refunded_cents, 0))} can be refunded.</p>
                <Field label="Amount in dollars" required><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
                <Field label="Reason" required hint="Included in the customer's refund email."><Textarea value={text} onChange={(e) => setText(e.target.value)} /></Field>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Btn onClick={close}>Close</Btn>
                <Btn tone="danger" disabled={busy || !(Number(amount) > 0) || !text.trim()} onClick={() => post('refund', { amount_cents: Math.round(Number(amount) * 100), reason: text }, 'Refund issued.')}>Issue refund</Btn>
              </div>
            </Modal>

            <Modal title="Record a payment" open={modal === 'manual'} onClose={close}>
              <div className="space-y-3">
                <p className="text-[0.85rem] text-charcoal/70">For cash or a check taken in person. Nothing is charged by this screen.</p>
                <Field label="Amount in dollars" required><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
                <Field label="Reference" hint="Check number or receipt."><Input value={text} onChange={(e) => setText(e.target.value)} /></Field>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Btn onClick={close}>Close</Btn>
                <Btn tone="primary" disabled={busy || !(Number(amount) > 0)} onClick={() => post('manual-payment', { amount_cents: Math.round(Number(amount) * 100), reference: text || null }, 'Payment recorded.')}>Record payment</Btn>
              </div>
            </Modal>

            <Modal title="Ask the customer" open={modal === 'info'} onClose={close}>
              <Field label="Question" required hint="Sent to the customer by email."><Textarea value={text} onChange={(e) => setText(e.target.value)} /></Field>
              <div className="mt-4 flex justify-end gap-2">
                <Btn onClick={close}>Close</Btn>
                <Btn tone="primary" disabled={busy || !text.trim()} onClick={() => post('request-info', { question: text }, 'Sent to the customer.')}>Send</Btn>
              </div>
            </Modal>

            <Modal title="What went wrong?" open={modal === 'failed'} onClose={close}>
              <Field label="Reason" required hint="Sent to the customer."><Textarea value={text} onChange={(e) => setText(e.target.value)} /></Field>
              <div className="mt-4 flex justify-end gap-2">
                <Btn onClick={close}>Close</Btn>
                <Btn tone="danger" disabled={busy || !text.trim() || !pending} onClick={() => pending && setItemStatus(pending.itemIds, pending.status, { reason: text })}>Record failed delivery</Btn>
              </div>
            </Modal>

            <Modal title="Shipment details" open={modal === 'ship'} onClose={close}>
              <div className="space-y-3">
                <Field label="Carrier"><Select value={tracking.carrier} onChange={(e) => setTracking((t) => ({ ...t, carrier: e.target.value }))}><option value="">Choose…</option><option>USPS</option><option>UPS</option><option>FedEx</option><option>Other</option></Select></Field>
                <Field label="Tracking number"><Input value={tracking.tracking_number} onChange={(e) => setTracking((t) => ({ ...t, tracking_number: e.target.value }))} /></Field>
                <Field label="Tracking link" hint="Optional."><Input type="url" value={tracking.tracking_url} onChange={(e) => setTracking((t) => ({ ...t, tracking_url: e.target.value }))} /></Field>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Btn onClick={close}>Close</Btn>
                <Btn tone="primary" disabled={busy || !pending} onClick={() => pending && setItemStatus(pending.itemIds, pending.status, { tracking: { carrier: tracking.carrier || null, tracking_number: tracking.tracking_number || null, tracking_url: tracking.tracking_url || null } })}>Mark shipped</Btn>
              </div>
            </Modal>
          </>
        );
      }}
    </Loader>
  );
}
