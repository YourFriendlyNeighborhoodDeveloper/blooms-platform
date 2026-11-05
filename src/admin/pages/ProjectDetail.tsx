import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../../lib/api';
import { dateLabel, dateTimeLabel, money, statusLabel } from '../../lib/format';
import { useSession } from '../session';
import { AssignedTeam } from '../components/AssignedTeam';
import { Badge, Btn, Card, Checkbox, Field, Input, Loader, Modal, PageHeader, Select, StatusBadge, Textarea, useAction, useLoad } from '../ui';

type Project = {
  id: string; reference: string; status: string; contract_status: string; contract_signed_at: string | null; booking_id: string | null; inquiry_id: string; customer_id: string; event_date: string; event_type: string; venue_name: string | null; venue_address: string | null; guest_count: number | null; customer_name: string; customer_email: string; customer_phone: string | null;
  booking: { status: string; event_start: string; event_end: string; hold_expires_at: string | null; setup_minutes: number; teardown_minutes: number; travel_minutes: number } | null;
  crews: Array<{ id: string; phase: string; starts_at: string; ends_at: string; status: string; name: string }>;
  rentals: Array<{ id: string; quantity: number; starts_at: string; ends_at: string; status: string; name: string; damage_notes: string | null }>;
  tasks: Array<{ id: string; title: string; status: string; due_at: string | null; required_capability: string | null; assigned_to: string | null; assignee: string | null }>;
  milestones: Array<{ id: string; title: string; due_on: string | null; status: string; customer_visible: boolean }>;
  materials: Array<{ id: string; quantity: number; needed_by: string | null; name: string; unit: string; sku: string }>;
  documents: Array<{ id: string; kind: string; filename: string; mime_type: string; customer_visible: boolean }>;
  invoices: Array<{ id: string; number: string; kind: string; status: string; total_cents: number; paid_cents: number; due_on: string | null }>;
  schedule: Array<{ id: string; label: string; amount_cents: number; due_on: string | null; status: string }>;
  payments: Array<{ id: string; invoice_id: string; amount_cents: number; refunded_cents: number; status: string; gateway: string; paid_at: string | null }>;
  access: { financials: boolean };
};

export default function ProjectDetail() {
  const { id } = useParams();
  const state = useLoad<Project>(`/api/admin/weddings/projects/${id}`);
  const team = useLoad<{ staff: Array<{ id: string; display_name: string }> }>('/api/admin/team');
  const { can } = useSession();
  const { busy, run } = useAction();
  const [modal, setModal] = useState<null | 'cancel' | 'invoice' | 'manual' | 'refund' | 'upload'>(null);
  const [text, setText] = useState('');
  const [amount, setAmount] = useState('');
  const [target, setTarget] = useState<string | null>(null);
  const [invoiceForm, setInvoiceForm] = useState({ description: '', amount: '', due_on: '', send: true });
  const [upload, setUpload] = useState<{ kind: string; visible: boolean }>({ kind: 'contract', visible: true });
  const manage = can('weddings.manage');
  const post = async (path: string, body: unknown, success: string) => {
    const ok = await run(() => api(path, { body }), success);
    if (ok !== undefined) {
      setModal(null);
      setText('');
      setAmount('');
      void state.reload();
    }
  };
  const sendFile = async (file: File | undefined) => {
    if (!file) return;
    const form = new FormData();
    form.set('file', file);
    form.set('kind', upload.kind);
    form.set('customer_visible', String(upload.visible));
    const ok = await run(() => api(`/api/admin/weddings/projects/${id}/documents`, { formData: form }), 'File added.');
    if (ok !== undefined) {
      setModal(null);
      void state.reload();
    }
  };
  return (
    <Loader state={state}>
      {(p) => (
        <>
          <PageHeader
            title={`${p.customer_name}: ${p.event_type}`}
            back={{ to: `/admin/weddings/${p.inquiry_id}`, label: 'Inquiry' }}
            subtitle={<>{dateLabel(p.event_date)} · {p.reference}</>}
            actions={<StatusBadge status={p.status} />}
          />
          {p.status === 'pending' && (
            <Card className="mb-4 border-gold/60 bg-gold-soft/20" title="Not confirmed yet">
              <p className="text-[0.88rem]">A booking is confirmed only when the deposit is paid in full and any required contract is signed.{p.booking?.hold_expires_at && ` The date is held until ${dateTimeLabel(p.booking.hold_expires_at)}.`}</p>
            </Card>
          )}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Card title="Tasks">
                {p.tasks.length === 0 && <p className="text-[0.88rem] text-charcoal/70">Tasks appear when the booking is confirmed.</p>}
                <ul className="divide-y divide-charcoal/8 text-[0.86rem]">
                  {p.tasks.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div className="min-w-0 flex-1">
                        <p className={t.status === 'done' ? 'line-through opacity-60' : ''}>{t.title}</p>
                        <p className="text-[0.72rem] text-charcoal/70">{t.due_at && dateTimeLabel(t.due_at)}{t.required_capability && ` · ${statusLabel(t.required_capability)}`}</p>
                      </div>
                      {can('tasks.manage') && (
                        <>
                          <label>
                            <span className="sr-only">Assign {t.title}</span>
                            <Select className="h-8 w-36 py-0 text-[0.78rem]" value={t.assigned_to ?? ''} onChange={async (e) => { await run(() => api(`/api/admin/tasks/${t.id}`, { method: 'PATCH', body: { assigned_to: e.target.value || null } })); void state.reload(); }}>
                              <option value="">Unassigned</option>
                              {team.data?.staff.map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
                            </Select>
                          </label>
                          <Btn small disabled={busy} onClick={async () => { await run(() => api(`/api/admin/tasks/${t.id}`, { method: 'PATCH', body: { status: t.status === 'done' ? 'open' : 'done' } })); void state.reload(); }}>{t.status === 'done' ? 'Reopen' : 'Done'}</Btn>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
              <Card title="Customer timeline">
                {p.milestones.length === 0 && <p className="text-[0.88rem] text-charcoal/70">Appears when the booking is confirmed.</p>}
                <ul className="divide-y divide-charcoal/8 text-[0.86rem]">
                  {p.milestones.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <span>{m.title}{m.due_on && <span className="text-charcoal/70"> · {m.due_on}</span>}</span>
                      {manage && <Btn small disabled={busy} onClick={() => post(`/api/admin/weddings/projects/${p.id}/milestones/${m.id}`, { status: m.status === 'done' ? 'upcoming' : 'done' }, 'Updated.')}>{m.status === 'done' ? 'Undo' : 'Mark done'}</Btn>}
                    </li>
                  ))}
                </ul>
              </Card>
              <Card title="Materials needed">
                {p.materials.length === 0 && <p className="text-[0.88rem] text-charcoal/70">None calculated. Link a recipe to a service to see them here.</p>}
                <ul className="grid gap-x-6 text-[0.86rem] sm:grid-cols-2">
                  {p.materials.map((m) => <li key={m.id} className="flex justify-between gap-2"><span>{m.name}</span><span className="tabular-nums">{m.quantity} {m.unit}</span></li>)}
                </ul>
              </Card>
              {p.access.financials && (
                <Card title="Money" actions={can('quotes.manage') && <Btn small onClick={() => setModal('invoice')}>New invoice</Btn>}>
                  <ul className="mb-3 space-y-1 text-[0.86rem]">
                    {p.schedule.map((s) => (
                      <li key={s.id} className="flex flex-wrap justify-between gap-2">
                        <span>{s.label}{s.due_on && <span className="text-charcoal/70"> · due {s.due_on}</span>}</span>
                        <span className="flex items-center gap-2 tabular-nums">{money(s.amount_cents)} <StatusBadge status={s.status} /></span>
                      </li>
                    ))}
                  </ul>
                  <ul className="divide-y divide-charcoal/8 border-t border-charcoal/10 text-[0.86rem]">
                    {p.invoices.map((inv) => (
                      <li key={inv.id} className="py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">{inv.number} <span className="font-normal capitalize text-charcoal/70">{inv.kind}</span></span>
                          <span className="tabular-nums">{money(inv.paid_cents)} of {money(inv.total_cents)}</span>
                          <StatusBadge status={inv.status} />
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {can('quotes.manage') && inv.status !== 'paid' && inv.status !== 'void' && (
                            <>
                              <Btn small disabled={busy} onClick={() => post(`/api/admin/invoices/${inv.id}/send`, {}, 'Sent to the customer.')}>Send</Btn>
                              <Btn small onClick={() => { setTarget(inv.id); setModal('manual'); }}>Record payment</Btn>
                              {inv.paid_cents === 0 && <Btn small tone="ghost" disabled={busy} onClick={() => post(`/api/admin/invoices/${inv.id}/void`, {}, 'Voided.')}>Void</Btn>}
                            </>
                          )}
                        </div>
                        {p.payments.filter((x) => x.invoice_id === inv.id).map((x) => (
                          <div key={x.id} className="mt-1 flex flex-wrap items-center gap-2 text-[0.78rem] text-charcoal/70">
                            <span>{x.gateway} payment of {money(x.amount_cents)}{x.refunded_cents > 0 && `, ${money(x.refunded_cents)} refunded`}</span>
                            <StatusBadge status={x.status} />
                            {can('orders.refund') && x.status === 'succeeded' && x.amount_cents > x.refunded_cents && <Btn small onClick={() => { setTarget(x.id); setModal('refund'); }}>Refund</Btn>}
                          </div>
                        ))}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
            <div className="space-y-4">
              <Card title="Customer">
                <Link to={`/admin/customers/${p.customer_id}`} className="font-medium hover:underline">{p.customer_name}</Link>
                <p className="text-[0.85rem] break-all">{p.customer_email}</p>
                {p.customer_phone && <p className="text-[0.85rem]">{p.customer_phone}</p>}
                <p className="mt-2 text-[0.85rem]">{p.venue_name}{p.venue_address ? `, ${p.venue_address}` : ''}</p>
              </Card>
              <AssignedTeam subjectType="project" subjectId={p.id} canManage={manage} />
              <Card title="Contract">
                <p className="mb-2"><StatusBadge status={p.contract_status} /></p>
                {manage && (
                  <label>
                    <span className="sr-only">Contract status</span>
                    <Select disabled={busy} value={p.contract_status} onChange={(e) => post(`/api/admin/weddings/projects/${p.id}/contract`, { status: e.target.value }, 'Contract updated.')}>
                      <option value="not_required">Not required</option>
                      <option value="pending">Pending</option>
                      <option value="sent">Sent</option>
                      <option value="signed">Signed</option>
                    </Select>
                  </label>
                )}
                <p className="mt-2 text-[0.75rem] text-charcoal/70">Marking a contract signed is your record. This system does not collect legal e-signatures.</p>
              </Card>
              <Card title="Schedule">
                {p.booking && <p className="mb-2 text-[0.85rem]">{dateTimeLabel(p.booking.event_start)} to {dateTimeLabel(p.booking.event_end)}</p>}
                <ul className="space-y-1 text-[0.82rem]">
                  {p.crews.map((c) => <li key={c.id}>{c.name}: {c.phase}, {dateTimeLabel(c.starts_at)} <StatusBadge status={c.status} /></li>)}
                </ul>
              </Card>
              <Card title="Rentals">
                {p.rentals.length === 0 && <p className="text-[0.85rem] text-charcoal/70">None.</p>}
                <ul className="space-y-1 text-[0.82rem]">
                  {p.rentals.map((r) => <li key={r.id}>{r.quantity} × {r.name} <StatusBadge status={r.status} />{r.damage_notes && <span className="block text-rose-deep">{r.damage_notes}</span>}</li>)}
                </ul>
              </Card>
              <Card title="Documents" actions={manage && <Btn small onClick={() => setModal('upload')}>Add</Btn>}>
                {p.documents.length === 0 && <p className="text-[0.85rem] text-charcoal/70">None.</p>}
                <ul className="space-y-1 text-[0.82rem]">
                  {p.documents.map((d) => <li key={d.id}><a className="underline" href={`/api/admin/weddings/documents/${d.id}/file`} target="_blank" rel="noopener noreferrer">{d.filename}</a> <Badge>{d.kind}</Badge>{d.customer_visible && <Badge tone="info">customer can see</Badge>}</li>)}
                </ul>
              </Card>
              {manage && !['cancelled', 'completed'].includes(p.status) && (
                <Card title="Status">
                  <div className="flex flex-wrap gap-2">
                    {p.status !== 'pending' && <Btn small disabled={busy} onClick={() => post(`/api/admin/weddings/projects/${p.id}/status`, { status: 'in_preparation' }, 'Updated.')}>In preparation</Btn>}
                    {p.status !== 'pending' && <Btn small disabled={busy} onClick={() => post(`/api/admin/weddings/projects/${p.id}/status`, { status: 'event_scheduled' }, 'Updated.')}>Event scheduled</Btn>}
                    {p.status !== 'pending' && <Btn small disabled={busy} onClick={() => post(`/api/admin/weddings/projects/${p.id}/status`, { status: 'completed' }, 'Updated.')}>Completed</Btn>}
                    <Btn small tone="danger" onClick={() => setModal('cancel')}>Cancel booking</Btn>
                  </div>
                </Card>
              )}
            </div>
          </div>

          <Modal title="Cancel this booking" open={modal === 'cancel'} onClose={() => setModal(null)}>
            <p className="mb-3 text-[0.88rem]">This releases crews and rentals and tells the customer. Refunds are separate: issue them from the payments above, according to your policy.</p>
            <Field label="Reason" required><Textarea value={text} onChange={(e) => setText(e.target.value)} /></Field>
            <div className="mt-4 flex justify-end gap-2"><Btn onClick={() => setModal(null)}>Keep it</Btn><Btn tone="danger" disabled={busy || !text.trim()} onClick={() => post(`/api/admin/weddings/projects/${p.id}/cancel`, { reason: text }, 'Cancelled.')}>Cancel booking</Btn></div>
          </Modal>
          <Modal title="New invoice" open={modal === 'invoice'} onClose={() => setModal(null)}>
            <div className="space-y-3">
              <Field label="Description" required><Input value={invoiceForm.description} onChange={(e) => setInvoiceForm({ ...invoiceForm, description: e.target.value })} /></Field>
              <Field label="Amount, in dollars" required><Input inputMode="decimal" value={invoiceForm.amount} onChange={(e) => setInvoiceForm({ ...invoiceForm, amount: e.target.value })} /></Field>
              <Field label="Due"><Input type="date" value={invoiceForm.due_on} onChange={(e) => setInvoiceForm({ ...invoiceForm, due_on: e.target.value })} /></Field>
              <Checkbox label="Send it to the customer now" checked={invoiceForm.send} onChange={(v) => setInvoiceForm({ ...invoiceForm, send: v })} />
            </div>
            <div className="mt-4 flex justify-end gap-2"><Btn onClick={() => setModal(null)}>Close</Btn><Btn tone="primary" disabled={busy || !invoiceForm.description.trim() || !(Number(invoiceForm.amount) > 0)} onClick={() => post('/api/admin/invoices', { customer_id: p.customer_id, project_id: p.id, kind: 'custom', lines: [{ description: invoiceForm.description, quantity: 1, unit_price_cents: Math.round(Number(invoiceForm.amount) * 100) }], due_on: invoiceForm.due_on || null, send: invoiceForm.send }, 'Invoice created.')}>Create</Btn></div>
          </Modal>
          <Modal title="Record a payment" open={modal === 'manual'} onClose={() => setModal(null)}>
            <div className="space-y-3">
              <p className="text-[0.85rem] text-charcoal/70">For cash or a check taken in person.</p>
              <Field label="Amount, in dollars" required><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
              <Field label="Reference"><Input value={text} onChange={(e) => setText(e.target.value)} /></Field>
            </div>
            <div className="mt-4 flex justify-end gap-2"><Btn onClick={() => setModal(null)}>Close</Btn><Btn tone="primary" disabled={busy || !(Number(amount) > 0)} onClick={() => post(`/api/admin/invoices/${target}/manual-payment`, { amount_cents: Math.round(Number(amount) * 100), reference: text || null }, 'Payment recorded.')}>Record</Btn></div>
          </Modal>
          <Modal title="Refund" open={modal === 'refund'} onClose={() => setModal(null)}>
            <div className="space-y-3">
              <Field label="Amount, in dollars" required><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
              <Field label="Reason" required><Textarea value={text} onChange={(e) => setText(e.target.value)} /></Field>
            </div>
            <div className="mt-4 flex justify-end gap-2"><Btn onClick={() => setModal(null)}>Close</Btn><Btn tone="danger" disabled={busy || !(Number(amount) > 0) || !text.trim()} onClick={() => post(`/api/admin/payments/${target}/refund`, { amount_cents: Math.round(Number(amount) * 100), reason: text }, 'Refund issued.')}>Issue refund</Btn></div>
          </Modal>
          <Modal title="Add a document" open={modal === 'upload'} onClose={() => setModal(null)}>
            <div className="space-y-3">
              <Field label="Kind"><Select value={upload.kind} onChange={(e) => setUpload({ ...upload, kind: e.target.value })}><option value="contract">Contract</option><option value="proposal">Proposal</option><option value="other">Other</option></Select></Field>
              <Checkbox label="The customer can see this" checked={upload.visible} onChange={(v) => setUpload({ ...upload, visible: v })} />
              <Field label="PDF or image"><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => sendFile(e.target.files?.[0])} /></Field>
            </div>
          </Modal>
        </>
      )}
    </Loader>
  );
}
