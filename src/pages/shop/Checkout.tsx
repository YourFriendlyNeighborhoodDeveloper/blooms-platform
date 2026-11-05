import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router';
import { api, ApiError, newIdempotencyKey } from '../../lib/api';
import { dateLabel, money, timeLabel } from '../../lib/format';
import { Arrow, Button } from '../../components/ui/Button';
import { TextArea, TextField } from '../../components/forms/fields';
import { useCart, type CartGroup, type CartLine } from '../../shop/CartContext';
import { usePlatform } from '../../lib/platform';
import { Check, Notice, Panel, Row, Spinner, StorePage, TestModeBanner } from '../../shop/ui';
import { cn } from '../../lib/cn';

type Method = 'pickup' | 'delivery' | 'shipping';
type Slot = { date: string; window_id: string; start: string; end: string; status: 'open' | 'review' | 'blocked'; reasons: Array<{ code: string; message: string }> };
type SlotResponse = { zone: { name: string; fee_cents: number; min_order_cents: number } | null; out_of_area: boolean; slots: Slot[]; earliest: Slot | null; timezone: string };

type Address = { line1: string; line2: string; city: string; region: string; postal_code: string };
type GroupChoice = { method: Method | ''; date: string; window_id: string; address: Address; recipient_name: string; recipient_phone: string; instructions: string };

type Quote = {
  totals: { subtotal_cents: number; discount_cents: number; delivery_cents: number; shipping_cents: number; tax_cents: number; total_cents: number };
  fulfillments: Array<{ line_ids: string[]; method: Method; status: 'open' | 'review' | 'blocked'; reasons: Array<{ code: string; message: string }>; alternatives: Array<{ date: string; window_id: string; start: string; end: string; status: string }>; fee_cents: number }>;
  blockers: Array<{ code: string; message: string }>;
  acceptance: 'auto' | 'review';
  review_reasons: Array<{ code: string; message: string }>;
  review_timing: 'approve_first' | 'pay_first';
  can_place: boolean;
  sms_available: boolean;
  sms_consent_text: { transactional: string; marketing: string };
  refund_policy: string | null;
  promotion_error: string | null;
};

const METHOD_COPY: Record<Method, { title: string; note: string }> = {
  pickup: { title: 'Pick up at the shop', note: 'Collect from the shop at a time you choose.' },
  delivery: { title: 'Local delivery', note: 'Delivered by the shop within the delivery area.' },
  shipping: { title: 'Ship it', note: 'Sent by carrier to your address.' },
};

const emptyAddress: Address = { line1: '', line2: '', city: '', region: 'MI', postal_code: '' };

function SlotPicker({ data, value, onPick }: { data: SlotResponse; value: { date: string; window_id: string }; onPick: (s: Slot) => void }) {
  const byDate = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of data.slots) map.set(s.date, [...(map.get(s.date) ?? []), s]);
    return [...map.entries()];
  }, [data.slots]);
  const usable = data.slots.some((s) => s.status !== 'blocked');
  if (!data.slots.length || !usable) {
    return <Notice tone="warning">No times are available online for this choice right now. Please try another option, or call the shop.</Notice>;
  }
  return (
    <fieldset>
      <legend className="eyebrow text-charcoal/70">Choose a time</legend>
      {data.earliest && <p className="mt-2 text-[0.88rem] text-charcoal/70">Earliest available: {dateLabel(data.earliest.date)} from {timeLabel(data.earliest.start, data.timezone)}</p>}
      <div className="mt-4 max-h-[26rem] space-y-4 overflow-y-auto pr-1" data-lenis-prevent>
        {byDate.map(([date, slots]) => (
          <div key={date}>
            <p className="text-[0.92rem] font-medium">{dateLabel(date)}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {slots.map((s) => {
                const selected = value.date === s.date && value.window_id === s.window_id;
                const blocked = s.status === 'blocked';
                return (
                  <label
                    key={s.window_id}
                    title={blocked ? s.reasons[0]?.message : undefined}
                    className={cn(
                      'relative rounded-2xl border px-4 py-2.5 text-[0.88rem] transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]',
                      blocked ? 'cursor-not-allowed border-charcoal/10 text-charcoal/35' : 'cursor-pointer border-charcoal/25 hover:border-charcoal/60',
                      selected && 'border-charcoal bg-charcoal text-ivory',
                    )}
                  >
                    <input type="radio" name={`slot-${date}`} className="sr-only" disabled={blocked} checked={selected} onChange={() => onPick(s)} aria-label={`${dateLabel(date)}, ${timeLabel(s.start, data.timezone)} to ${timeLabel(s.end, data.timezone)}${blocked ? `: unavailable. ${s.reasons[0]?.message ?? ''}` : ''}`} />
                    {timeLabel(s.start, data.timezone)} – {timeLabel(s.end, data.timezone)}
                    {s.status === 'review' && <span className="ml-2 text-[0.72rem] opacity-70">shop confirms</span>}
                    {blocked && <span className="mt-0.5 block text-[0.72rem]">{s.reasons[0]?.message}</span>}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

function GroupEditor({ group, lines, choice, onChange, multiple, index }: { group: CartGroup; lines: CartLine[]; choice: GroupChoice; onChange: (patch: Partial<GroupChoice>) => void; multiple: boolean; index: number }) {
  const [slots, setSlots] = useState<SlotResponse | null>(null);
  const [slotError, setSlotError] = useState<string | null>(null);
  const zip = choice.address.postal_code.trim();
  const needsAddress = choice.method === 'delivery' || choice.method === 'shipping';

  useEffect(() => {
    setSlots(null);
    setSlotError(null);
    if (choice.method !== 'pickup' && choice.method !== 'delivery') return;
    if (choice.method === 'delivery' && !/^\d{5}$/.test(zip)) return;
    const controller = new AbortController();
    api<SlotResponse>('/api/public/availability/slots', { body: { method: choice.method, postal_code: zip || null, line_ids: group.line_ids }, signal: controller.signal })
      .then(setSlots)
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') setSlotError(err instanceof ApiError ? err.message : 'We could not load available times.');
      });
    return () => controller.abort();
  }, [choice.method, zip, group.line_ids]);

  const setAddress = (patch: Partial<Address>) => onChange({ address: { ...choice.address, ...patch } });

  return (
    <Panel title={multiple ? `Arrangement ${index + 1}` : 'How would you like to receive it?'}>
      {multiple && (
        <>
          <ul className="mb-4 text-[0.92rem] text-charcoal/75">
            {lines.map((l) => (
              <li key={l.id}>
                {l.quantity} × {l.name}
              </li>
            ))}
          </ul>
          {group.note && <Notice className="mb-5">{group.note}</Notice>}
        </>
      )}
      <fieldset>
        <legend className="sr-only">Fulfilment method</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {group.methods.map((m) => (
            <label key={m} className={cn('cursor-pointer rounded-2xl border p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]', choice.method === m ? 'border-charcoal bg-charcoal text-ivory' : 'border-charcoal/25 hover:border-charcoal/60')}>
              <input type="radio" name={`method-${group.key}`} className="sr-only" checked={choice.method === m} onChange={() => onChange({ method: m, date: '', window_id: '' })} />
              <span className="block font-medium">{METHOD_COPY[m].title}</span>
              <span className="mt-1 block text-[0.82rem] opacity-75">{METHOD_COPY[m].note}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {needsAddress && (
        <div className="mt-7 grid gap-x-6 gap-y-6 sm:grid-cols-2">
          <TextField className="sm:col-span-2" label="Street address" required autoComplete="street-address" value={choice.address.line1} onChange={(e) => setAddress({ line1: e.target.value })} />
          <TextField className="sm:col-span-2" label="Apartment, suite" autoComplete="address-line2" value={choice.address.line2} onChange={(e) => setAddress({ line2: e.target.value })} />
          <TextField label="City" required autoComplete="address-level2" value={choice.address.city} onChange={(e) => setAddress({ city: e.target.value })} />
          <div className="grid grid-cols-2 gap-4">
            <TextField label="State" required maxLength={2} autoComplete="address-level1" value={choice.address.region} onChange={(e) => setAddress({ region: e.target.value.toUpperCase() })} />
            <TextField label="ZIP" required inputMode="numeric" maxLength={10} autoComplete="postal-code" value={choice.address.postal_code} onChange={(e) => setAddress({ postal_code: e.target.value })} />
          </div>
          <TextField label="Recipient name" autoComplete="off" hint="If someone else is receiving this" value={choice.recipient_name} onChange={(e) => onChange({ recipient_name: e.target.value })} />
          <TextField label="Recipient phone" type="tel" autoComplete="off" value={choice.recipient_phone} onChange={(e) => onChange({ recipient_phone: e.target.value })} />
          <TextArea className="sm:col-span-2" label="Delivery instructions" maxLength={1000} value={choice.instructions} onChange={(e) => onChange({ instructions: e.target.value })} />
        </div>
      )}

      {choice.method === 'delivery' && slots?.out_of_area && <Notice tone="warning" className="mt-6">That ZIP code is outside the delivery area. You can choose pickup, or call the shop to ask.</Notice>}
      {choice.method === 'delivery' && slots?.zone && (
        <p className="mt-4 text-[0.9rem] text-charcoal/75">
          Delivers to {slots.zone.name} for {money(slots.zone.fee_cents)}.
        </p>
      )}
      {slotError && <Notice tone="error" className="mt-6">{slotError}</Notice>}
      {(choice.method === 'pickup' || choice.method === 'delivery') && !slots && !slotError && (choice.method === 'pickup' || /^\d{5}$/.test(zip)) && <Spinner label="Checking times…" />}
      {slots && !slots.out_of_area && (
        <div className="mt-7">
          <SlotPicker data={slots} value={choice} onPick={(s) => onChange({ date: s.date, window_id: s.window_id })} />
        </div>
      )}
    </Panel>
  );
}

const DRAFT_KEY = 'blooms-checkout-draft';

function loadDraft() {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null') as { name?: string; email?: string; phone?: string } | null;
  } catch {
    return null;
  }
}

export default function Checkout() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { cart, loading, refresh } = useCart();
  const { config } = usePlatform();
  const saved = (cart.saved_details ?? {}) as { contact?: { name?: string; email?: string; phone?: string } };
  const draft = useRef(loadDraft());
  const [name, setName] = useState(draft.current?.name ?? '');
  const [email, setEmail] = useState(draft.current?.email ?? '');
  const [phone, setPhone] = useState(draft.current?.phone ?? '');
  const [note, setNote] = useState('');
  const [choices, setChoices] = useState<Record<string, GroupChoice>>({});
  const [consents, setConsents] = useState({ sms_transactional: false, sms_marketing: false, email_marketing: false });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<Quote['fulfillments'][number]['alternatives']>([]);
  const [busy, setBusy] = useState(false);
  const [paymentRetry, setPaymentRetry] = useState<{ token: string; message: string } | null>(null);
  const idempotencyKey = useRef(newIdempotencyKey());

  useEffect(() => {
    if (saved.contact && !name && !email) {
      setName(saved.contact.name ?? '');
      setEmail(saved.contact.email ?? '');
      setPhone(saved.contact.phone ?? '');
    }
    // Only for the first load of saved details.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.id]);

  const choiceFor = useCallback(
    (g: CartGroup): GroupChoice =>
      choices[g.key] ?? { method: g.methods.length === 1 ? g.methods[0] : '', date: '', window_id: '', address: emptyAddress, recipient_name: '', recipient_phone: '', instructions: '' },
    [choices],
  );

  const payload = useMemo(() => {
    return cart.groups.map((g) => {
      const c = choiceFor(g);
      const hasAddress = c.method === 'delivery' || c.method === 'shipping';
      return {
        line_ids: g.line_ids,
        method: c.method || undefined,
        date: c.method !== 'shipping' ? c.date || null : null,
        window_id: c.method !== 'shipping' ? c.window_id || null : null,
        address: hasAddress && c.address.line1 && c.address.city && c.address.postal_code ? { ...c.address, line2: c.address.line2 || null } : null,
        recipient_name: c.recipient_name || null,
        recipient_phone: c.recipient_phone || null,
        instructions: c.instructions || null,
      };
    });
  }, [cart.groups, choiceFor]);

  const complete = payload.every((f) => f.method && (f.method === 'shipping' ? f.address : f.date && f.window_id && (f.method === 'pickup' || f.address)));

  useEffect(() => {
    if (!complete || !cart.lines.length) {
      setQuote(null);
      return;
    }
    const controller = new AbortController();
    api<Quote>('/api/public/checkout/quote', { body: { fulfillments: payload }, signal: controller.signal })
      .then((q) => {
        setQuote(q);
        setError(null);
      })
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') setError(err instanceof ApiError ? err.message : 'We could not check that. Please try again.');
      });
    return () => controller.abort();
    // The quote depends on the serialized payload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete, JSON.stringify(payload), cart.totals.total_cents, cart.lines.length]);

  if (loading) {
    return (
      <StorePage title="Checkout" narrow>
        <Spinner />
      </StorePage>
    );
  }
  if (!cart.lines.length) {
    return (
      <StorePage title="Your cart is empty" narrow>
        <Button to="/shop" icon={<Arrow />}>
          Browse the shop
        </Button>
      </StorePage>
    );
  }

  const blockedFulfillment = quote?.fulfillments.find((f) => f.status === 'blocked');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setAlternatives([]);
    const errors: Record<string, string> = {};
    if (name.trim().length < 2) errors.name = 'Please enter your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) errors.email = 'Please check your email address.';
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      setError('Please check the highlighted fields.');
      return;
    }
    if (!complete) {
      setError('Please choose how and when to receive every item.');
      return;
    }
    if (!quote?.can_place) {
      setError(quote?.blockers[0]?.message ?? blockedFulfillment?.reasons[0]?.message ?? 'Please choose a different time.');
      return;
    }
    setBusy(true);
    try {
      const contact = { name: name.trim(), email: email.trim(), phone: phone.trim() || null };
      try {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify(contact));
      } catch {
        /* Convenience only. */
      }
      await api('/api/public/cart/details', { method: 'PUT', body: { contact } }).catch(() => {});
      const placed = await api<{ tracking_token: string; next: { type: string; url?: string; message?: string } }>('/api/public/checkout', {
        body: { idempotency_key: idempotencyKey.current, contact, note: note.trim() || null, consents, fulfillments: payload, expected_total_cents: quote.totals.total_cents },
      });
      if (placed.next.type === 'redirect' && placed.next.url) {
        window.location.assign(placed.next.url);
        return;
      }
      if (placed.next.type === 'retry') {
        setPaymentRetry({ token: placed.tracking_token, message: placed.next.message ?? 'Please try paying again in a moment.' });
        return;
      }
      await refresh().catch(() => {});
      navigate(`/track/${placed.tracking_token}?from=checkout`);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setError(apiErr?.message ?? 'That did not work. Please try again.');
      setFieldErrors(apiErr?.fields ?? {});
      const details = apiErr?.details as { alternatives?: Quote['fulfillments'][number]['alternatives'] } | undefined;
      if (details?.alternatives) setAlternatives(details.alternatives);
      // A failed attempt can be retried with changed details, so it gets a fresh key.
      idempotencyKey.current = newIdempotencyKey();
    } finally {
      setBusy(false);
    }
  };

  const update = (key: string, patch: Partial<GroupChoice>, g: CartGroup) => setChoices((s) => ({ ...s, [key]: { ...choiceFor(g), ...patch } }));
  const reviewFirst = quote?.acceptance === 'review' && quote.review_timing === 'approve_first';

  return (
    <StorePage title="Checkout" intro={<>No account needed. <Link to="/account" className="link-underline text-rose-deep">Sign in</Link> if you have one, or simply continue.</>}>
      <TestModeBanner />
      {params.get('cancelled') && <Notice className="mb-6">You came back without paying. Nothing was charged, and your cart is still here.</Notice>}
      {config?.shop.payments === 'disabled' && <Notice tone="warning" className="mb-6">Online payment is not available yet. Please call the shop to place your order.</Notice>}
      <form onSubmit={submit} noValidate className="grid gap-8 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <Panel title="Your details">
            <div className="grid gap-x-6 gap-y-6 sm:grid-cols-2">
              <TextField label="Your name" name="name" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={fieldErrors.name ?? fieldErrors['contact.name']} />
              <TextField label="Email" name="email" type="email" required autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fieldErrors.email ?? fieldErrors['contact.email']} hint="For your confirmation and status updates" />
              <TextField className="sm:col-span-2" label="Phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} error={fieldErrors['contact.phone']} />
            </div>
          </Panel>

          {cart.groups.map((g, i) => (
            <GroupEditor key={g.key} index={i} group={g} multiple={cart.groups.length > 1} lines={cart.lines.filter((l) => g.line_ids.includes(l.id))} choice={choiceFor(g)} onChange={(patch) => update(g.key, patch, g)} />
          ))}

          <Panel title="Anything we should know?">
            <TextArea label="Note for the shop" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="mt-6 space-y-4">
              {quote?.sms_available && phone.trim() && (
                <>
                  <Check name="sms_transactional" label="Text me updates about this order." hint={quote.sms_consent_text.transactional} checked={consents.sms_transactional} onChange={(v) => setConsents((s) => ({ ...s, sms_transactional: v }))} />
                  <Check name="sms_marketing" label="Send me promotional texts." hint={quote.sms_consent_text.marketing} checked={consents.sms_marketing} onChange={(v) => setConsents((s) => ({ ...s, sms_marketing: v }))} />
                </>
              )}
              <Check name="email_marketing" label="Send me occasional news and offers by email." checked={consents.email_marketing} onChange={(v) => setConsents((s) => ({ ...s, email_marketing: v }))} />
            </div>
          </Panel>
        </div>

        <div className="lg:col-span-5">
          <div className="space-y-6 lg:sticky lg:top-28">
            <Panel title="Your order">
              <ul className="space-y-2 text-[0.95rem]">
                {cart.lines.map((l) => (
                  <li key={l.id} className="flex justify-between gap-4">
                    <span>
                      {l.quantity} × {l.name}
                      {l.variant_name !== 'Standard' ? ` (${l.variant_name})` : ''}
                    </span>
                    <span className="tabular-nums">{money(l.line_subtotal_cents)}</span>
                  </li>
                ))}
              </ul>
              <dl className="mt-4 border-t border-charcoal/15 pt-3">
                <Row label="Items" value={money(quote?.totals.subtotal_cents ?? cart.totals.subtotal_cents)} />
                {(quote?.totals.discount_cents ?? cart.totals.discount_cents) > 0 && <Row label="Discount" value={`−${money(quote?.totals.discount_cents ?? cart.totals.discount_cents)}`} />}
                {quote && quote.totals.delivery_cents > 0 && <Row label="Delivery" value={money(quote.totals.delivery_cents)} />}
                {quote && quote.totals.shipping_cents > 0 && <Row label="Shipping" value={money(quote.totals.shipping_cents)} />}
                {quote && <Row label="Sales tax" value={money(quote.totals.tax_cents)} />}
                <Row strong label="Total" value={quote ? money(quote.totals.total_cents) : 'Choose how to receive it'} />
              </dl>
            </Panel>

            {quote?.blockers.map((b) => (
              <Notice key={b.code + b.message} tone="error">
                {b.message}
              </Notice>
            ))}
            {blockedFulfillment && (
              <Notice tone="error">
                {blockedFulfillment.reasons[0]?.message}
                {blockedFulfillment.alternatives.length > 0 && <span className="mt-1 block">Please choose one of the available times instead.</span>}
              </Notice>
            )}
            {reviewFirst && (
              <Notice>
                <strong>The shop confirms this one first.</strong> {quote.review_reasons[0]?.message} You will not be charged now. If the shop can do it, you will receive a link to pay.
              </Notice>
            )}
            {quote?.acceptance === 'review' && quote.review_timing === 'pay_first' && (
              <Notice>
                <strong>The shop reviews this after you pay.</strong> {quote.review_reasons[0]?.message} If the shop cannot do it, your payment is refunded in full.
              </Notice>
            )}
            {error && <Notice tone="error">{error}</Notice>}
            {alternatives.length > 0 && (
              <Notice>
                Available instead:
                <ul className="mt-1 list-disc pl-5">
                  {alternatives.map((a) => (
                    <li key={a.date + a.window_id}>
                      {dateLabel(a.date)}, {timeLabel(a.start)} – {timeLabel(a.end)}
                    </li>
                  ))}
                </ul>
              </Notice>
            )}
            {paymentRetry && (
              <Notice tone="warning">
                {paymentRetry.message}{' '}
                <Link className="underline" to={`/track/${paymentRetry.token}`}>
                  View your order and try again
                </Link>
              </Notice>
            )}

            {quote?.refund_policy && <p className="whitespace-pre-line text-[0.82rem] leading-relaxed text-charcoal/70">{quote.refund_policy}</p>}

            <Button type="submit" size="lg" icon={<Arrow />} className="w-full [&>span]:w-full [&>span>span]:w-full">
              {busy ? 'One moment…' : reviewFirst ? 'Send my request' : 'Continue to secure payment'}
            </Button>
            <p className="text-center text-[0.8rem] text-charcoal/70">{reviewFirst ? 'No payment is taken now.' : 'Payment is handled on a secure page. Your card details never reach this site.'}</p>
          </div>
        </div>
      </form>
    </StorePage>
  );
}
