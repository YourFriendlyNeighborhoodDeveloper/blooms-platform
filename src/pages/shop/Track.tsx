import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { dateLabel, dateTimeLabel, money, timeLabel } from '../../lib/format';
import { Arrow, Button } from '../../components/ui/Button';
import { TextField } from '../../components/forms/fields';
import { ITEM_STATUS_COPY, ORDER_STATUS_COPY } from '../../../shared/status';
import { useCart } from '../../shop/CartContext';
import { Notice, Panel, Row, Spinner, StorePage } from '../../shop/ui';
import { cn } from '../../lib/cn';

type Fulfillment = {
  id: string;
  method: 'pickup' | 'delivery' | 'shipping';
  status: string;
  scheduled_date: string | null;
  window_start: string | null;
  window_end: string | null;
  destination: string | null;
  carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  delivery_status: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  driver_name: string | null;
  fulfilled_at: string | null;
  item_ids: string[];
};

type OrderView = {
  reference: string;
  status: string;
  payment_status: string;
  placed_at: string;
  customer_first_name: string;
  is_test: boolean;
  totals: { subtotal_cents: number; discount_cents: number; delivery_cents: number; shipping_cents: number; tax_cents: number; total_cents: number; paid_cents: number; refunded_cents: number };
  can_pay: boolean;
  hold_expires_at: string | null;
  items: Array<{ id: string; name: string; variant_name: string | null; quantity: number; status: string; options: Array<{ label: string; value: string }>; line_total_cents: number }>;
  fulfillments: Fulfillment[];
  timeline: Array<{ id: string; status: string; note: string | null; at: string; item: string | null }>;
};

const FULFILLMENT_TITLE = { pickup: 'Pickup', delivery: 'Delivery', shipping: 'Shipping' };

const ITEM_TONE: Record<string, string> = {
  ready: 'bg-sage/15 text-sage-deep',
  fulfilled: 'bg-sage/15 text-sage-deep',
  preparing: 'bg-gold-soft/50',
  out_for_delivery: 'bg-gold-soft/50',
  shipped: 'bg-gold-soft/50',
  shortage: 'bg-blush',
  delivery_failed: 'bg-blush',
  backordered: 'bg-blush',
  cancelled: 'bg-charcoal/10 text-charcoal/70',
  refunded: 'bg-charcoal/10 text-charcoal/70',
};

function LookupForm() {
  const [reference, setReference] = useState('');
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api('/api/public/track/lookup', { body: { reference: reference.trim(), email: email.trim() } });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return done ? (
    <Notice tone="success">If that order matches that email, a private link is on its way. It may take a minute to arrive.</Notice>
  ) : (
    <form onSubmit={submit} noValidate className="grid gap-x-6 gap-y-6 sm:grid-cols-2">
      <TextField label="Order number" required placeholder="BL-XXXX-XXXX" value={reference} onChange={(e) => setReference(e.target.value)} />
      <TextField label="Email used for the order" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      {error && (
        <Notice tone="error" className="sm:col-span-2">
          {error}
        </Notice>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" icon={<Arrow />}>
          {busy ? 'Sending…' : 'Email me a link'}
        </Button>
      </div>
    </form>
  );
}

export function TrackLookup() {
  return (
    <StorePage narrow eyebrow="Order status" title="Find your order" intro="Enter your order number and email, and we will send a private link. Your order details are never shown on this page.">
      <Panel>
        <LookupForm />
      </Panel>
    </StorePage>
  );
}

export default function Track() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const { refresh } = useCart();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    try {
      setOrder(await api<OrderView>(`/api/public/track/${token}`));
      setError(null);
    } catch (err) {
      setError(err as ApiError);
    }
  }, [token]);

  useEffect(() => {
    void load();
    if (params.get('from') === 'checkout') void refresh().catch(() => {});
  }, [load, params, refresh]);

  // After checkout the webhook may still be on its way, so keep checking briefly instead of guessing.
  useEffect(() => {
    if (!order || !['awaiting_payment', 'payment_processing'].includes(order.status) || params.get('from') !== 'checkout') return;
    const id = window.setInterval(() => void load(), 4000);
    const stop = window.setTimeout(() => window.clearInterval(id), 120_000);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(stop);
    };
  }, [order, params, load]);

  if (error) {
    return (
      <StorePage narrow eyebrow="Order status" title="This link has expired" intro="For your privacy, order links do not last forever. Request a new one here.">
        <Panel>
          <LookupForm />
        </Panel>
      </StorePage>
    );
  }
  if (!order) {
    return (
      <StorePage narrow title="Order status">
        <Spinner />
      </StorePage>
    );
  }

  const copy = ORDER_STATUS_COPY[order.status] ?? { title: order.status, body: '' };
  const pay = async () => {
    setPaying(true);
    setPayError(null);
    try {
      const { url } = await api<{ url: string }>(`/api/public/track/${token}/pay`, { body: {} });
      window.location.assign(url);
    } catch (err) {
      setPayError(err instanceof ApiError ? err.message : 'We could not start payment. Please try again.');
      setPaying(false);
    }
  };
  const justPaidPending = params.get('from') === 'checkout' && order.status === 'awaiting_payment';

  return (
    <StorePage eyebrow={`Order ${order.reference}`} title={copy.title} intro={<p>{copy.body}</p>}>
      {order.is_test && <Notice tone="warning" className="mb-6"><strong>Test order.</strong> This order is demonstration data, and no real payment was taken.</Notice>}
      {justPaidPending && <Notice className="mb-6">We are waiting for confirmation from the payment provider. This page updates by itself.</Notice>}
      <div className="grid gap-8 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          {order.can_pay && (
            <Panel>
              <p className="text-[1.05rem]">{money(order.totals.total_cents - order.totals.paid_cents)} is due to confirm this order.</p>
              {order.hold_expires_at && <p className="mt-1 text-[0.9rem] text-charcoal/70">Held for you until {dateTimeLabel(order.hold_expires_at)}.</p>}
              {payError && <Notice tone="error" className="mt-4">{payError}</Notice>}
              <div className="mt-5">
                <Button onClick={pay} icon={<Arrow />}>
                  {paying ? 'One moment…' : 'Pay securely'}
                </Button>
              </div>
            </Panel>
          )}

          {order.fulfillments.map((f) => {
            const items = order.items.filter((i) => f.item_ids.includes(i.id));
            return (
              <Panel key={f.id} title={FULFILLMENT_TITLE[f.method]}>
                {f.scheduled_date && f.window_start && f.window_end && (
                  <p className="text-[1rem]">
                    {dateLabel(f.scheduled_date)}, {timeLabel(f.window_start)} – {timeLabel(f.window_end)}
                  </p>
                )}
                {f.destination && <p className="text-[0.9rem] text-charcoal/70">To {f.destination}</p>}
                {f.method === 'delivery' && f.driver_name && f.status !== 'fulfilled' && <p className="mt-1 text-[0.9rem] text-charcoal/70">Your driver: {f.driver_name}</p>}
                {f.dispatched_at && <p className="mt-1 text-[0.9rem] text-charcoal/70">Left the shop {dateTimeLabel(f.dispatched_at)}</p>}
                {f.delivered_at && <p className="mt-1 text-[0.9rem] text-charcoal/70">Delivered {dateTimeLabel(f.delivered_at)}</p>}
                {f.tracking_number && (
                  <p className="mt-2 text-[0.92rem]">
                    {f.carrier ?? 'Carrier'} tracking:{' '}
                    {f.tracking_url ? (
                      <a className="link-underline text-rose-deep" href={f.tracking_url} target="_blank" rel="noopener noreferrer">
                        {f.tracking_number}
                      </a>
                    ) : (
                      f.tracking_number
                    )}
                  </p>
                )}
                <ul className="mt-5 divide-y divide-charcoal/10 border-t border-charcoal/10">
                  {items.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3.5" data-testid="order-item">
                      <div className="min-w-0">
                        <p>
                          {i.quantity} × {i.name}
                          {i.variant_name && i.variant_name !== 'Standard' ? ` (${i.variant_name})` : ''}
                        </p>
                        {i.options.map((o) => (
                          <p key={o.label} className="text-[0.82rem] break-words text-charcoal/70">
                            {o.label}: {o.value}
                          </p>
                        ))}
                      </div>
                      <span className={cn('rounded-full bg-ivory-deep px-3 py-1 text-[0.8rem]', ITEM_TONE[i.status])}>{ITEM_STATUS_COPY[i.status] ?? i.status}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            );
          })}

          <Panel title="History">
            <ol className="space-y-4">
              {order.timeline.map((t) => (
                <li key={t.id} className="relative pl-5 text-[0.92rem] before:absolute before:top-2 before:left-0 before:h-2 before:w-2 before:rounded-full before:bg-rose">
                  <p className="font-medium">
                    {t.item ? `${t.item}: ${ITEM_STATUS_COPY[t.status] ?? t.status}` : (ORDER_STATUS_COPY[t.status]?.title ?? t.status)}
                  </p>
                  {t.note && <p className="text-charcoal/70">{t.note}</p>}
                  <p className="text-[0.8rem] text-charcoal/70">{dateTimeLabel(t.at)}</p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
        <div className="lg:col-span-5">
          <Panel title="Summary" className="lg:sticky lg:top-28">
            <dl>
              <Row label="Items" value={money(order.totals.subtotal_cents)} />
              {order.totals.discount_cents > 0 && <Row label="Discount" value={`−${money(order.totals.discount_cents)}`} />}
              {order.totals.delivery_cents > 0 && <Row label="Delivery" value={money(order.totals.delivery_cents)} />}
              {order.totals.shipping_cents > 0 && <Row label="Shipping" value={money(order.totals.shipping_cents)} />}
              <Row label="Sales tax" value={money(order.totals.tax_cents)} />
              <Row strong label="Total" value={money(order.totals.total_cents)} />
              <Row label="Paid" value={money(order.totals.paid_cents)} />
              {order.totals.refunded_cents > 0 && <Row label="Refunded" value={money(order.totals.refunded_cents)} />}
            </dl>
            <p className="mt-4 text-[0.82rem] text-charcoal/70">Placed {dateTimeLabel(order.placed_at)}</p>
          </Panel>
        </div>
      </div>
    </StorePage>
  );
}
