import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../../lib/api';
import { dateLabel, dateTimeLabel, money, statusLabel } from '../../lib/format';
import { useSession } from '../session';
import { Badge, Btn, Card, Checkbox, Field, Input, Loader, Modal, PageHeader, StatusBadge, Textarea, useAction, useLoad } from '../ui';

type Item = { id: string; service_id: string | null; rental_item_id: string | null; name: string; quantity: number; pricing_mode: string; unit_price_cents?: number | null; est_low_cents?: number | null; est_high_cents?: number | null; notes: string | null };
type QuoteLine = { id: string; service_id: string | null; rental_item_id: string | null; description: string; quantity: number; unit_price_cents: number; total_cents: number; taxable: boolean };
type Quote = { id: string; reference: string; version: number; status: string; subtotal_cents: number; discount_cents: number; tax_cents: number; total_cents: number; deposit_cents: number; valid_until: string | null; terms: string | null; customer_message: string | null; internal_notes: string | null; requires_contract: boolean; accepted_name: string | null; accepted_at: string | null; lines: QuoteLine[] };
type Inquiry = {
  quote_defaults?: { requires_contract: boolean };
  id: string; reference: string; customer_id: string; event_type: string; event_date: string; ceremony_time: string | null; reception_time: string | null; venue_name: string | null; venue_address: string | null; guest_count: number | null; budget_range?: string | null; consultation_format: string | null; status: string; stage_name: string; suggested_date: string | null; clarification_request: string | null; decline_reason: string | null; is_test: boolean; customer_name: string; customer_email: string; customer_phone: string | null;
  answers: { style?: { colors?: string; theme?: string; floral_styles?: string[]; preferences?: string; must_haves?: string; optional_services?: string } };
  items: Item[]; documents: Array<{ id: string; kind: string; filename: string; mime_type: string; customer_visible: boolean }>; consultations: Array<{ id: string; starts_at: string; format: string; status: string; staff_name: string; notes: string | null }>; quotes: Quote[];
  booking: { id: string; status: string; hold_expires_at: string | null } | null; project: { id: string; reference: string; status: string; contract_status: string } | null; notes: Array<{ id: string; direction: string; channel: string; subject: string | null; body: string | null; created_at: string; author: string | null }>;
  live_availability: { status: string; summary: string; reasons: Array<{ code: string; message: string }>; alternatives: string[]; crews: { total: number; free: number; required: number }; rentals: Array<{ name: string; requested: number; available: number }> };
};

type LineDraft = { service_id: string | null; rental_item_id: string | null; description: string; quantity: string; price: string; taxable: boolean };

function QuoteEditor({ inquiry, quote, onClose, onSaved }: { inquiry: Inquiry; quote: Quote | null; onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useAction();
  const initial: LineDraft[] = quote
    ? quote.lines.map((l) => ({ service_id: l.service_id, rental_item_id: l.rental_item_id, description: l.description, quantity: String(l.quantity), price: (l.unit_price_cents / 100).toFixed(2), taxable: l.taxable }))
    : inquiry.items.map((i) => ({ service_id: i.service_id, rental_item_id: i.rental_item_id, description: i.name, quantity: String(i.quantity), price: i.unit_price_cents ? (i.unit_price_cents / 100).toFixed(2) : '', taxable: true }));
  const [lines, setLines] = useState<LineDraft[]>(initial.length ? initial : [{ service_id: null, rental_item_id: null, description: '', quantity: '1', price: '', taxable: true }]);
  const [deposit, setDeposit] = useState(quote ? (quote.deposit_cents / 100).toFixed(2) : '');
  const [discount, setDiscount] = useState(quote ? (quote.discount_cents / 100).toFixed(2) : '');
  const [message, setMessage] = useState(quote?.customer_message ?? '');
  const [terms, setTerms] = useState(quote?.terms ?? '');
  const [notes, setNotes] = useState(quote?.internal_notes ?? '');
  const [validUntil, setValidUntil] = useState(quote?.valid_until ?? '');
  const [contract, setContract] = useState(quote?.requires_contract ?? inquiry.quote_defaults?.requires_contract ?? false);
  const update = (i: number, patch: Partial<LineDraft>) => setLines((s) => s.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const subtotal = lines.reduce((s, l) => s + Math.round(Number(l.price || 0) * 100) * (Number(l.quantity) || 0), 0);
  const save = async () => {
    const body = {
      lines: lines.filter((l) => l.description.trim()).map((l) => ({ service_id: l.service_id, rental_item_id: l.rental_item_id, description: l.description.trim(), quantity: Number(l.quantity) || 1, unit_price_cents: Math.round(Number(l.price || 0) * 100), taxable: l.taxable })),
      deposit_cents: Math.round(Number(deposit || 0) * 100),
      discount_cents: Math.round(Number(discount || 0) * 100),
      customer_message: message || null,
      terms: terms || null,
      internal_notes: notes || null,
      valid_until: validUntil || null,
      requires_contract: contract,
    };
    const ok = await run(() => (quote ? api(`/api/admin/weddings/quotes/${quote.id}`, { method: 'PUT', body }) : api(`/api/admin/weddings/${inquiry.id}/quotes`, { body })), 'Quote saved as a draft.');
    if (ok !== undefined) onSaved();
  };
  return (
    <Modal title={quote ? `Edit quote ${quote.reference}` : 'Build a quote'} open onClose={onClose} wide>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-12 items-end gap-2">
            <Field label={i === 0 ? 'Description' : ' '} className="col-span-12 sm:col-span-6"><Input aria-label="Description" value={l.description} onChange={(e) => update(i, { description: e.target.value })} /></Field>
            <Field label={i === 0 ? 'Qty' : ' '} className="col-span-3 sm:col-span-1"><Input aria-label="Quantity" inputMode="numeric" value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} /></Field>
            <Field label={i === 0 ? 'Each, in dollars' : ' '} className="col-span-4 sm:col-span-2"><Input aria-label="Price each" inputMode="decimal" value={l.price} onChange={(e) => update(i, { price: e.target.value })} /></Field>
            <div className="col-span-3 pb-2 sm:col-span-2"><Checkbox label="Taxable" checked={l.taxable} onChange={(v) => update(i, { taxable: v })} /></div>
            <div className="col-span-2 sm:col-span-1"><Btn small tone="ghost" aria-label="Remove line" onClick={() => setLines((s) => s.filter((_, j) => j !== i))}>✕</Btn></div>
          </div>
        ))}
      </div>
      <Btn small className="mt-2" onClick={() => setLines((s) => [...s, { service_id: null, rental_item_id: null, description: '', quantity: '1', price: '', taxable: true }])}>Add a line</Btn>
      <p className="mt-3 text-[0.9rem]">Subtotal: <strong className="tabular-nums">{money(subtotal)}</strong> <span className="text-charcoal/70">(tax is added from your settings)</span></p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Discount, in dollars"><Input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>
        <Field label="Deposit, in dollars" hint="Paying this confirms the booking."><Input inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} /></Field>
        <Field label="Valid until" hint="Blank uses your default."><Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field>
        <Field label="Message to the customer" className="sm:col-span-3"><Textarea value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
        <Field label="Terms" hint="Blank uses your cancellation policy." className="sm:col-span-3"><Textarea value={terms} onChange={(e) => setTerms(e.target.value)} /></Field>
        <Field label="Internal notes" hint="Customers never see these." className="sm:col-span-3"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <div className="mt-3"><Checkbox label="A signed contract is also required before confirming" checked={contract} onChange={setContract} /></div>
      <div className="mt-4 flex justify-end gap-2">
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn tone="primary" disabled={busy} onClick={save}>Save draft</Btn>
      </div>
    </Modal>
  );
}

export default function WeddingDetail() {
  const { id } = useParams();
  const state = useLoad<Inquiry>(`/api/admin/weddings/${id}`);
  const { can } = useSession();
  const { busy, run } = useAction();
  const [modal, setModal] = useState<null | 'decline' | 'clarify' | 'suggest' | 'edit' | 'hold'>(null);
  const [text, setText] = useState('');
  const [quoteEditor, setQuoteEditor] = useState<Quote | 'new' | null>(null);
  const [edit, setEdit] = useState({ event_date: '', guest_count: '', venue_name: '', venue_address: '' });
  const [note, setNote] = useState('');
  const [days, setDays] = useState('7');
  const manage = can('weddings.manage');
  const [booking, setBooking] = useState<{ format: string; slots: Array<{ start: string; end: string }> | null } | null>(null);
  const openBooking = async () => {
    setBooking({ format: 'In the shop', slots: null });
    const res = await run(() => api<{ slots: Array<{ start: string; end: string }> }>('/api/admin/weddings/consultation-slots'));
    setBooking(res ? { format: 'In the shop', slots: res.slots } : null);
  };

  useEffect(() => {
    if (state.data) setEdit({ event_date: state.data.event_date, guest_count: state.data.guest_count?.toString() ?? '', venue_name: state.data.venue_name ?? '', venue_address: state.data.venue_address ?? '' });
  }, [state.data]);

  const post = async (path: string, body: unknown, success: string) => {
    const ok = await run(() => api(`/api/admin/weddings/${path}`, { body }), success);
    if (ok !== undefined) {
      setModal(null);
      setText('');
      void state.reload();
    }
  };

  return (
    <Loader state={state}>
      {(i) => {
        const style = i.answers?.style ?? {};
        const open = !['declined', 'closed', 'converted'].includes(i.status);
        const live = i.live_availability;
        return (
          <>
            <PageHeader
              title={i.customer_name}
              back={{ to: '/admin/weddings', label: 'Pipeline' }}
              subtitle={<>{i.event_type} on {dateLabel(i.event_date)} · {i.reference} {i.is_test && <Badge tone="warn">test data</Badge>}</>}
              actions={<><Badge tone="info">{i.stage_name}</Badge><StatusBadge status={i.status} /></>}
            />
            {manage && open && (
              <Card className="mb-4" title="Decide">
                <div className="flex flex-wrap gap-2">
                  {i.status !== 'in_review' && i.status !== 'accepted' && <Btn tone="primary" disabled={busy} onClick={() => post(`${i.id}/accept`, {}, 'Moved into planning.')}>Accept and start planning</Btn>}
                  <Btn onClick={() => setModal('clarify')}>Ask a question</Btn>
                  <Btn onClick={() => setModal('suggest')}>Suggest another date</Btn>
                  <Btn onClick={() => setModal('edit')}>Change details</Btn>
                  {i.booking?.status === 'inquiry' && <Btn onClick={() => setModal('hold')}>Hold this date</Btn>}
                  {i.booking?.status === 'hold' && !i.project && <Btn disabled={busy} onClick={() => post(`${i.id}/release-hold`, {}, 'Hold released.')}>Release the hold</Btn>}
                  <Btn tone="danger" onClick={() => setModal('decline')}>Decline</Btn>
                </div>
              </Card>
            )}
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                <Card title="Event">
                  <dl className="grid gap-x-6 gap-y-1.5 text-[0.88rem] sm:grid-cols-2">
                    <div><dt className="inline text-charcoal/70">Ceremony: </dt><dd className="inline">{i.ceremony_time?.slice(0, 5) ?? 'Not given'}</dd></div>
                    <div><dt className="inline text-charcoal/70">Reception: </dt><dd className="inline">{i.reception_time?.slice(0, 5) ?? 'Not given'}</dd></div>
                    <div><dt className="inline text-charcoal/70">Venue: </dt><dd className="inline">{i.venue_name ?? 'Not given'}</dd></div>
                    <div><dt className="inline text-charcoal/70">Address: </dt><dd className="inline">{i.venue_address ?? 'Not given'}</dd></div>
                    <div><dt className="inline text-charcoal/70">Guests: </dt><dd className="inline">{i.guest_count ?? 'Not given'}</dd></div>
                    {i.budget_range !== undefined && <div><dt className="inline text-charcoal/70">Budget: </dt><dd className="inline">{i.budget_range ?? 'Not given'}</dd></div>}
                    <div><dt className="inline text-charcoal/70">Prefers to meet: </dt><dd className="inline">{i.consultation_format ?? 'No preference'}</dd></div>
                  </dl>
                </Card>
                <Card title="Style">
                  <dl className="space-y-1.5 text-[0.88rem]">
                    {style.colors && <div><dt className="inline text-charcoal/70">Colors: </dt><dd className="inline">{style.colors}</dd></div>}
                    {style.theme && <div><dt className="inline text-charcoal/70">Theme: </dt><dd className="inline">{style.theme}</dd></div>}
                    {Boolean(style.floral_styles?.length) && <div><dt className="inline text-charcoal/70">Styles: </dt><dd className="inline">{style.floral_styles?.join(', ')}</dd></div>}
                    {style.preferences && <div><dt className="text-charcoal/70">Their words:</dt><dd className="whitespace-pre-line">{style.preferences}</dd></div>}
                    {style.must_haves && <div><dt className="text-charcoal/70">Must-haves:</dt><dd className="whitespace-pre-line">{style.must_haves}</dd></div>}
                    {style.optional_services && <div><dt className="text-charcoal/70">Also interested in:</dt><dd className="whitespace-pre-line">{style.optional_services}</dd></div>}
                  </dl>
                  {i.documents.filter((d) => d.mime_type.startsWith('image/')).length > 0 && (
                    <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                      {i.documents.filter((d) => d.mime_type.startsWith('image/')).map((d) => (
                        <li key={d.id}><a href={`/api/admin/weddings/documents/${d.id}/file`} target="_blank" rel="noopener noreferrer"><img src={`/api/admin/weddings/documents/${d.id}/file`} alt={d.filename} className="aspect-square w-full rounded-lg object-cover" /></a></li>
                      ))}
                    </ul>
                  )}
                </Card>
                <Card title="Requested">
                  {i.items.length === 0 && <p className="text-[0.88rem] text-charcoal/70">Nothing specific yet.</p>}
                  <ul className="divide-y divide-charcoal/8 text-[0.88rem]">
                    {i.items.map((x) => (
                      <li key={x.id} className="flex flex-wrap justify-between gap-3 py-1.5">
                        <span>{x.quantity} × {x.name}</span>
                        <span className="text-charcoal/70">{x.pricing_mode === 'package' && x.unit_price_cents ? `${money(x.unit_price_cents)} each` : x.pricing_mode === 'estimate' && x.est_low_cents ? `${money(x.est_low_cents)}–${money(x.est_high_cents)} each` : 'Custom quote'}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
                {can('weddings.financials') && (
                  <Card title="Quotes" actions={can('quotes.manage') && open && <Btn small onClick={() => setQuoteEditor('new')}>New quote</Btn>}>
                    {i.quotes.length === 0 && <p className="text-[0.88rem] text-charcoal/70">None yet.</p>}
                    <ul className="space-y-3">
                      {i.quotes.map((q) => (
                        <li key={q.id} className="rounded-lg border border-charcoal/10 p-3 text-[0.88rem]">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-medium">{q.reference} · version {q.version}</p>
                            <StatusBadge status={q.status} />
                          </div>
                          <ul className="mt-1 text-[0.8rem] text-charcoal/70">
                            {q.lines.map((l) => <li key={l.id}>{l.quantity} × {l.description}, {money(l.total_cents)}</li>)}
                          </ul>
                          <p className="mt-1 tabular-nums">Total {money(q.total_cents)} (tax {money(q.tax_cents)}{q.discount_cents ? `, discount ${money(q.discount_cents)}` : ''}) · deposit {money(q.deposit_cents)}</p>
                          {q.accepted_at && <p className="text-[0.78rem] text-charcoal/70">Accepted by {q.accepted_name}, {dateTimeLabel(q.accepted_at)}</p>}
                          {can('quotes.manage') && q.status === 'draft' && (
                            <div className="mt-2 flex gap-2">
                              <Btn small onClick={() => setQuoteEditor(q)}>Edit</Btn>
                              <Btn small tone="primary" disabled={busy} onClick={() => post(`quotes/${q.id}/send`, {}, 'Quote sent to the customer.')}>Send to customer</Btn>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
                <Card title="Notes and messages">
                  <ul className="mb-3 space-y-2 text-[0.85rem]">
                    {i.notes.map((n) => (
                      <li key={n.id} className="rounded-lg bg-ivory-deep/50 p-2">
                        <p className="text-[0.72rem] text-charcoal/70"><span className="capitalize">{n.channel}</span> · {dateTimeLabel(n.created_at)}{n.author ? ` · ${n.author}` : ''}</p>
                        {n.subject && <p className="font-medium">{n.subject}</p>}
                        {n.body && <p className="whitespace-pre-line">{n.body}</p>}
                      </li>
                    ))}
                  </ul>
                  <Textarea aria-label="Add a note" placeholder="Customers never see these." value={note} onChange={(e) => setNote(e.target.value)} />
                  <Btn small className="mt-2" disabled={busy || !note.trim()} onClick={async () => { await post(`${i.id}/notes`, { body: note }, 'Note added.'); setNote(''); }}>Add note</Btn>
                </Card>
              </div>
              <div className="space-y-4">
                <Card title="Customer">
                  <p className="font-medium">{i.customer_name}</p>
                  <p className="text-[0.85rem] break-all"><a className="underline" href={`mailto:${i.customer_email}`}>{i.customer_email}</a></p>
                  {i.customer_phone && <p className="text-[0.85rem]"><a className="underline" href={`tel:${i.customer_phone}`}>{i.customer_phone}</a></p>}
                  <Link className="mt-1 inline-block text-[0.8rem] underline" to={`/admin/customers/${i.customer_id}`}>Customer record</Link>
                </Card>
                <Card title="Availability right now">
                  <StatusBadge status={live.status === 'unavailable' ? 'failed' : live.status === 'available' ? 'succeeded' : 'pending'} />
                  <ul className="mt-2 list-disc pl-4 text-[0.82rem]">
                    {live.reasons.map((r) => <li key={r.code + r.message}>{r.message}</li>)}
                  </ul>
                  <p className="mt-2 text-[0.82rem] text-charcoal/70">Crews: {live.crews.free} free of {live.crews.total}, this event needs {live.crews.required}.</p>
                  {live.rentals.map((r) => <p key={r.name} className="text-[0.82rem] text-charcoal/70">{r.name}: {r.available} free, {r.requested} requested</p>)}
                  {live.alternatives.length > 0 && <p className="mt-2 text-[0.82rem]">Alternatives: {live.alternatives.join(', ')}</p>}
                  {i.booking && <p className="mt-2 text-[0.82rem]">Booking: <StatusBadge status={i.booking.status} />{i.booking.hold_expires_at && ` until ${dateTimeLabel(i.booking.hold_expires_at)}`}</p>}
                  {i.project && <Link className="mt-2 inline-block text-[0.85rem] font-medium underline" to={`/admin/weddings/projects/${i.project.id}`}>Open project {i.project.reference}</Link>}
                </Card>
                <Card title="Consultations">
                  {i.consultations.length === 0 && <p className="text-[0.85rem] text-charcoal/70">None booked.</p>}
                  {manage && open && <Btn small className="mb-2" onClick={openBooking}>Book for the customer</Btn>}
                  <ul className="space-y-2 text-[0.85rem]">
                    {i.consultations.map((k) => (
                      <li key={k.id}>
                        <p className="font-medium">{dateTimeLabel(k.starts_at)}</p>
                        <p className="text-charcoal/70">{k.format} with {k.staff_name} · {statusLabel(k.status)}</p>
                        {manage && k.status === 'booked' && (
                          <div className="mt-1 flex gap-2">
                            <Btn small disabled={busy} onClick={() => post(`consultations/${k.id}/complete`, { status: 'completed' }, 'Marked complete.')}>Complete</Btn>
                            <Btn small tone="ghost" disabled={busy} onClick={() => post(`consultations/${k.id}/cancel`, {}, 'Cancelled, and the customer has been told.')}>Cancel</Btn>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            </div>

            <Modal title="Decline this inquiry" open={modal === 'decline'} onClose={() => setModal(null)}>
              <Field label="Reason" required hint="The customer sees this."><Textarea value={text} onChange={(e) => setText(e.target.value)} /></Field>
              <div className="mt-4 flex justify-end gap-2"><Btn onClick={() => setModal(null)}>Keep it</Btn><Btn tone="danger" disabled={busy || !text.trim()} onClick={() => post(`${i.id}/decline`, { reason: text }, 'Declined. The customer has been told.')}>Decline</Btn></div>
            </Modal>
            <Modal title="Ask a question" open={modal === 'clarify'} onClose={() => setModal(null)}>
              <Field label="Question" required hint="Sent to the customer by email."><Textarea value={text} onChange={(e) => setText(e.target.value)} /></Field>
              <div className="mt-4 flex justify-end gap-2"><Btn onClick={() => setModal(null)}>Close</Btn><Btn tone="primary" disabled={busy || !text.trim()} onClick={() => post(`${i.id}/request-clarification`, { question: text }, 'Sent.')}>Send</Btn></div>
            </Modal>
            <Modal title="Book a consultation" open={Boolean(booking)} onClose={() => setBooking(null)}>
              {booking && (
                <div className="space-y-3">
                  <Field label="Format"><Input value={booking.format} onChange={(e) => setBooking({ ...booking, format: e.target.value })} /></Field>
                  {booking.slots === null ? <p className="text-[0.85rem]">Finding open times…</p> : booking.slots.length === 0 ? <p className="text-[0.85rem]">No open times. Check team schedules under Team.</p> : (
                    <ul className="flex max-h-72 flex-wrap gap-2 overflow-y-auto">
                      {booking.slots.slice(0, 60).map((s) => (
                        <li key={s.start}><Btn small disabled={busy} onClick={async () => { const ok = await run(() => api(`/api/admin/weddings/${i.id}/consultations`, { body: { starts_at: new Date(s.start).toISOString(), format: booking.format } }), 'Booked, and the customer has been told.'); if (ok !== undefined) { setBooking(null); await state.reload(); } }}>{dateTimeLabel(s.start)}</Btn></li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <div className="mt-4 flex justify-end"><Btn onClick={() => setBooking(null)}>Close</Btn></div>
            </Modal>
            <Modal title="Suggest another date" open={modal === 'suggest'} onClose={() => setModal(null)}>
              <Field label="Date" required hint="This does not reserve it."><Input type="date" value={text} onChange={(e) => setText(e.target.value)} /></Field>
              <div className="mt-4 flex justify-end gap-2"><Btn onClick={() => setModal(null)}>Close</Btn><Btn tone="primary" disabled={busy || !text} onClick={() => post(`${i.id}/suggest-date`, { date: text }, 'Suggestion sent.')}>Send</Btn></div>
            </Modal>
            <Modal title="Hold this date" open={modal === 'hold'} onClose={() => setModal(null)}>
              <Field label="Hold for how many days?" required hint="Crews and rentals are reserved until then."><Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
              <div className="mt-4 flex justify-end gap-2"><Btn onClick={() => setModal(null)}>Close</Btn><Btn tone="primary" disabled={busy || !Number(days)} onClick={() => post(`${i.id}/hold`, { days: Number(days) }, 'Date held.')}>Hold</Btn></div>
            </Modal>
            <Modal title="Change details" open={modal === 'edit'} onClose={() => setModal(null)}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Event date"><Input type="date" value={edit.event_date} onChange={(e) => setEdit({ ...edit, event_date: e.target.value })} /></Field>
                <Field label="Guests"><Input inputMode="numeric" value={edit.guest_count} onChange={(e) => setEdit({ ...edit, guest_count: e.target.value })} /></Field>
                <Field label="Venue"><Input value={edit.venue_name} onChange={(e) => setEdit({ ...edit, venue_name: e.target.value })} /></Field>
                <Field label="Address"><Input value={edit.venue_address} onChange={(e) => setEdit({ ...edit, venue_address: e.target.value })} /></Field>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Btn onClick={() => setModal(null)}>Close</Btn>
                <Btn tone="primary" disabled={busy} onClick={async () => { const ok = await run(() => api(`/api/admin/weddings/${i.id}`, { method: 'PATCH', body: { event_date: edit.event_date, guest_count: edit.guest_count ? Number(edit.guest_count) : null, venue_name: edit.venue_name || null, venue_address: edit.venue_address || null } }), 'Saved.'); if (ok !== undefined) { setModal(null); void state.reload(); } }}>Save</Btn>
              </div>
            </Modal>
            {quoteEditor && <QuoteEditor inquiry={i} quote={quoteEditor === 'new' ? null : quoteEditor} onClose={() => setQuoteEditor(null)} onSaved={() => { setQuoteEditor(null); void state.reload(); }} />}
          </>
        );
      }}
    </Loader>
  );
}
