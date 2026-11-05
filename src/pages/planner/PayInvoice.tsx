import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { dateLabel, money } from '../../lib/format';
import { Arrow, Button } from '../../components/ui/Button';
import { TextField } from '../../components/forms/fields';
import { Notice, Panel, Row, Spinner, StorePage } from '../../shop/ui';

type Invoice = { number: string; kind: string; status: string; subtotal_cents: number; tax_cents: number; total_cents: number; paid_cents: number; amount_due_cents: number; due_on: string | null; notes: string | null; is_test: boolean; lines: Array<{ id: string; description: string; quantity: number; total_cents: number }>; can_pay: boolean; payments_enabled: boolean };

const TITLES: Record<string, string> = { deposit: 'Pay your deposit', balance: 'Pay your balance', custom: 'Pay your invoice' };

export default function PayInvoice() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState('');
  const [showPartial, setShowPartial] = useState(false);

  const load = useCallback(() => {
    api<Invoice>(`/api/public/pay/${token}`)
      .then(setInvoice)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'We could not load this invoice.'));
  }, [token]);
  useEffect(load, [load]);

  const fromCheckout = params.get('from') === 'checkout';
  // The payment confirmation comes from the provider, not from this page, so wait for it.
  useEffect(() => {
    if (!fromCheckout || !invoice?.can_pay) return;
    const id = window.setInterval(load, 4000);
    const stop = window.setTimeout(() => window.clearInterval(id), 120_000);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(stop);
    };
  }, [fromCheckout, invoice, load]);

  if (error) {
    return (
      <StorePage narrow title="This link has expired">
        <Notice>{error}</Notice>
      </StorePage>
    );
  }
  if (!invoice) {
    return (
      <StorePage narrow title="Payment">
        <Spinner />
      </StorePage>
    );
  }

  const pay = async () => {
    setBusy(true);
    setPayError(null);
    try {
      const amount = showPartial && partial ? Math.round(Number(partial) * 100) : null;
      if (amount !== null && !(amount > 0)) throw new ApiError(400, 'bad_amount', 'Please enter an amount.');
      const { url } = await api<{ url: string }>(`/api/public/pay/${token}`, { body: { amount_cents: amount } });
      window.location.assign(url);
    } catch (err) {
      setPayError(err instanceof ApiError ? err.message : 'We could not start the payment. Please try again.');
      setBusy(false);
    }
  };

  return (
    <StorePage narrow eyebrow={`Invoice ${invoice.number}`} title={TITLES[invoice.kind] ?? TITLES.custom}>
      {invoice.is_test && <Notice tone="warning" className="mb-6"><strong>Test mode.</strong> No real payment is taken here.</Notice>}
      {params.get('accepted') && <Notice tone="success" className="mb-6">Thank you. Your quote is accepted and your date is being held. Your booking is confirmed once this is paid.</Notice>}
      {params.get('cancelled') && <Notice className="mb-6">You came back without paying. Nothing was charged.</Notice>}
      {fromCheckout && invoice.can_pay && <Notice className="mb-6">We are waiting for confirmation from the payment provider. This page updates by itself.</Notice>}
      {!invoice.can_pay && invoice.status === 'paid' && <Notice tone="success" className="mb-6">This invoice is paid in full. Thank you.</Notice>}
      {invoice.status === 'void' && <Notice tone="warning" className="mb-6">This invoice has been cancelled.</Notice>}
      <Panel>
        <ul className="space-y-1 text-[0.95rem]">
          {invoice.lines.map((l) => (
            <li key={l.id} className="flex justify-between gap-4">
              <span>{l.description}</span>
              <span className="tabular-nums">{money(l.total_cents)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 border-t border-charcoal/15 pt-3">
          {invoice.tax_cents > 0 && <Row label="Tax" value={money(invoice.tax_cents)} />}
          <Row label="Total" value={money(invoice.total_cents)} />
          {invoice.paid_cents > 0 && <Row label="Paid so far" value={money(invoice.paid_cents)} />}
          <Row strong label="Amount due" value={money(invoice.amount_due_cents)} />
        </dl>
        {invoice.due_on && <p className="mt-2 text-[0.88rem] text-charcoal/70">Due by {dateLabel(invoice.due_on, { month: 'long', day: 'numeric', year: 'numeric' })}.</p>}
        {invoice.notes && <p className="mt-3 text-[0.9rem] whitespace-pre-line">{invoice.notes}</p>}
        {invoice.can_pay && invoice.payments_enabled && (
          <div className="mt-6">
            {invoice.kind !== 'deposit' && (
              <button type="button" className="link-underline mb-4 block text-[0.88rem] text-charcoal/70" onClick={() => setShowPartial((s) => !s)}>
                {showPartial ? 'Pay the full amount' : 'Pay part of this now'}
              </button>
            )}
            {showPartial && <TextField className="mb-5" label="Amount in dollars" inputMode="decimal" value={partial} onChange={(e) => setPartial(e.target.value)} />}
            {payError && <Notice tone="error" className="mb-4">{payError}</Notice>}
            <Button onClick={pay} size="lg" icon={<Arrow />}>
              {busy ? 'One moment…' : 'Pay securely'}
            </Button>
            <p className="mt-3 text-[0.8rem] text-charcoal/70">Payment is handled on a secure page. Your card details never reach this site.</p>
          </div>
        )}
        {invoice.can_pay && !invoice.payments_enabled && <Notice tone="warning" className="mt-6">Online payment is not available yet. Please call the shop to pay.</Notice>}
      </Panel>
    </StorePage>
  );
}
