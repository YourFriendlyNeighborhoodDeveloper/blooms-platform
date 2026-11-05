import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../../lib/api';
import { dateLabel, dateTimeLabel, money, statusLabel } from '../../lib/format';
import { useSession } from '../session';
import { Badge, Btn, Card, Field, Input, Loader, Modal, PageHeader, StatusBadge, Textarea, useAction, useLoad } from '../ui';

type Customer = {
  id: string; name: string; email: string; phone_e164: string | null; notes: string | null; special_requests: string | null; tags: string[]; email_verified_at: string | null; anonymized_at: string | null; created_at: string;
  orders: Array<{ id: string; reference: string; status: string; payment_status?: string; placed_at: string; total_cents?: number; is_test: boolean }>;
  events: Array<{ id: string; reference: string; event_type: string; event_date: string; status: string; project_id: string | null; project_status: string | null }>;
  consultations: Array<{ id: string; starts_at: string; format: string; status: string; inquiry_id: string | null }>;
  quotes: Array<{ id: string; reference: string; status: string; total_cents: number; inquiry_id: string }>;
  invoices: Array<{ id: string; number: string; kind: string; status: string; total_cents: number; paid_cents: number; due_on: string | null; project_id: string | null }>;
  refunds: Array<{ id: string; amount_cents: number; status: string; reason: string | null; created_at: string }>;
  addresses: Array<{ id: string; line1: string; city: string; region: string; postal_code: string }>;
  communications: Array<{ id: string; direction: string; channel: string; subject: string | null; body: string | null; created_at: string; author: string | null }>;
  consents: Array<{ id: string; channel: string; purpose: string; granted: boolean; source: string; disclosure_text: string | null; created_at: string }>;
  sms_suppressed: { reason: string; created_at: string } | null;
  access: { financials: boolean };
};

export default function CustomerDetail() {
  const { id } = useParams();
  const state = useLoad<Customer>(`/api/admin/customers/${id}`);
  const { can } = useSession();
  const { busy, run } = useAction();
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ notes: '', special_requests: '', tags: '' });
  const [erasing, setErasing] = useState(false);
  const [confirm, setConfirm] = useState('');
  return (
    <Loader state={state}>
      {(c) => (
        <>
          <PageHeader title={c.name} back={{ to: '/admin/customers', label: 'Customers' }} subtitle={c.anonymized_at ? <Badge>Erased {dateTimeLabel(c.anonymized_at)}</Badge> : <span className="break-all">{c.email}{c.phone_e164 ? ` · ${c.phone_e164}` : ''}</span>} actions={c.email_verified_at && <Badge tone="good">email verified</Badge>} />
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Card title="Orders">
                {c.orders.length === 0 && <p className="text-[0.85rem] text-charcoal/70">None.</p>}
                <ul className="divide-y divide-charcoal/8 text-[0.86rem]">
                  {c.orders.map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <Link to={`/admin/orders/${o.id}`} className="font-medium hover:underline">{o.reference}</Link>
                      <span className="text-charcoal/70">{dateTimeLabel(o.placed_at)}</span>
                      <StatusBadge status={o.status} />
                      {o.total_cents !== undefined && <span className="tabular-nums">{money(o.total_cents)}</span>}
                    </li>
                  ))}
                </ul>
              </Card>
              <Card title="Events and consultations">
                {c.events.length === 0 && <p className="text-[0.85rem] text-charcoal/70">None.</p>}
                <ul className="divide-y divide-charcoal/8 text-[0.86rem]">
                  {c.events.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <Link to={e.project_id ? `/admin/weddings/projects/${e.project_id}` : `/admin/weddings/${e.id}`} className="font-medium hover:underline">{e.event_type}, {dateLabel(e.event_date, { month: 'short', day: 'numeric', year: 'numeric' })}</Link>
                      <StatusBadge status={e.project_status ?? e.status} />
                    </li>
                  ))}
                  {c.consultations.map((k) => (
                    <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <span>Consultation, {dateTimeLabel(k.starts_at)} ({k.format})</span>
                      <StatusBadge status={k.status} />
                    </li>
                  ))}
                </ul>
              </Card>
              {c.access.financials && (c.quotes.length > 0 || c.invoices.length > 0 || c.refunds.length > 0) && (
                <Card title="Quotes, invoices and refunds">
                  <ul className="space-y-1 text-[0.85rem]">
                    {c.quotes.map((q) => <li key={q.id} className="flex flex-wrap justify-between gap-2"><Link className="hover:underline" to={`/admin/weddings/${q.inquiry_id}`}>Quote {q.reference}</Link><span className="tabular-nums">{money(q.total_cents)}</span><StatusBadge status={q.status} /></li>)}
                    {c.invoices.map((i) => <li key={i.id} className="flex flex-wrap justify-between gap-2"><span>Invoice {i.number}</span><span className="tabular-nums">{money(i.paid_cents)} of {money(i.total_cents)}</span><StatusBadge status={i.status} /></li>)}
                    {c.refunds.map((r) => <li key={r.id} className="flex flex-wrap justify-between gap-2"><span>Refund{r.reason ? `: ${r.reason}` : ''}</span><span className="tabular-nums">{money(r.amount_cents)}</span><StatusBadge status={r.status} /></li>)}
                  </ul>
                </Card>
              )}
              <Card title="Communication history">
                {can('customers.manage') && (
                  <div className="mb-3">
                    <Textarea aria-label="Add a note" placeholder="Add a note, such as a phone call" value={note} onChange={(e) => setNote(e.target.value)} />
                    <Btn small className="mt-2" disabled={busy || !note.trim()} onClick={async () => { const ok = await run(() => api(`/api/admin/customers/${c.id}/notes`, { body: { body: note } }), 'Note added.'); if (ok !== undefined) { setNote(''); void state.reload(); } }}>Add note</Btn>
                  </div>
                )}
                <ul className="space-y-2 text-[0.85rem]">
                  {c.communications.map((m) => (
                    <li key={m.id} className="rounded-lg bg-ivory-deep/40 p-2">
                      <p className="text-[0.72rem] text-charcoal/70"><span className="capitalize">{m.direction}</span> {m.channel} · {dateTimeLabel(m.created_at)}{m.author ? ` · ${m.author}` : ''}</p>
                      {m.subject && <p className="font-medium">{m.subject}</p>}
                      {m.body && <p className="line-clamp-4 whitespace-pre-line">{m.body}</p>}
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
            <div className="space-y-4">
              <Card title="Notes and requests" actions={can('customers.manage') && <Btn small onClick={() => { setForm({ notes: c.notes ?? '', special_requests: c.special_requests ?? '', tags: c.tags.join(', ') }); setEditing(true); }}>Edit</Btn>}>
                <p className="text-[0.85rem] whitespace-pre-line">{c.notes || 'No notes.'}</p>
                {c.special_requests && <p className="mt-2 text-[0.85rem] whitespace-pre-line"><strong>Special requests:</strong> {c.special_requests}</p>}
              </Card>
              <Card title="Consent">
                {c.sms_suppressed && <p className="mb-2"><Badge tone="bad">Texts blocked: replied {c.sms_suppressed.reason}</Badge></p>}
                {c.consents.length === 0 && <p className="text-[0.85rem] text-charcoal/70">No marketing or text consent recorded.</p>}
                <ul className="space-y-1.5 text-[0.8rem]">
                  {c.consents.map((x) => (
                    <li key={x.id} title={x.disclosure_text ?? undefined}>
                      <span className="font-medium">{x.granted ? 'Yes' : 'No'}</span>: {x.channel} {x.purpose}<br />
                      <span className="text-charcoal/70">{statusLabel(x.source)}, {dateTimeLabel(x.created_at)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
              {can('customers.privacy') && !c.anonymized_at && (
                <Card title="Privacy">
                  <div className="flex flex-wrap gap-2">
                    <a className="inline-flex h-8 items-center rounded-lg border border-charcoal/25 px-3 text-[0.8rem]" href={`/api/admin/customers/${c.id}/export`}>Export their data</a>
                    <Btn small tone="danger" onClick={() => { setConfirm(''); setErasing(true); }}>Erase</Btn>
                  </div>
                </Card>
              )}
            </div>
          </div>
          <Modal title="Edit customer notes" open={editing} onClose={() => setEditing(false)}>
            <div className="space-y-3">
              <Field label="Notes" hint="Customers never see these."><Textarea rows={4} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
              <Field label="Special requests"><Textarea value={form.special_requests} onChange={(e) => setForm({ ...form, special_requests: e.target.value })} /></Field>
              <Field label="Tags" hint="Separate with commas."><Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></Field>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Btn onClick={() => setEditing(false)}>Cancel</Btn>
              <Btn tone="primary" disabled={busy} onClick={async () => { const ok = await run(() => api(`/api/admin/customers/${c.id}`, { method: 'PATCH', body: { notes: form.notes || null, special_requests: form.special_requests || null, tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean) } }), 'Saved.'); if (ok !== undefined) { setEditing(false); void state.reload(); } }}>Save</Btn>
            </div>
          </Modal>
          <Modal title="Erase this customer" open={erasing} onClose={() => setErasing(false)}>
            <p className="text-[0.88rem]">This permanently removes their name, contact details, addresses, notes and messages. Order totals stay for your financial records. This cannot be undone.</p>
            <Field label='Type "erase" to confirm' className="mt-3"><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
            <div className="mt-4 flex justify-end gap-2">
              <Btn onClick={() => setErasing(false)}>Keep them</Btn>
              <Btn tone="danger" disabled={busy || confirm.trim().toLowerCase() !== 'erase'} onClick={async () => { const ok = await run(() => api(`/api/admin/customers/${c.id}/anonymize`, { body: {} }), 'Customer erased.'); if (ok !== undefined) { setErasing(false); void state.reload(); } }}>Erase permanently</Btn>
            </div>
          </Modal>
        </>
      )}
    </Loader>
  );
}
