import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { dateLabel, money } from '../../lib/format';
import { Arrow, Button } from '../../components/ui/Button';
import { TextArea, TextField } from '../../components/forms/fields';
import { Check, Notice, Panel, Row, Spinner, StorePage } from '../../shop/ui';

type Quote = {
  reference: string; status: string; subtotal_cents: number; discount_cents: number; tax_cents: number; total_cents: number; deposit_cents: number; valid_until: string | null; terms: string | null; customer_message: string | null; requires_contract: boolean; accepted_at: string | null; accepted_name: string | null; event_date: string; event_type: string; venue_name: string | null; can_accept: boolean; tax_label: string;
  lines: Array<{ id: string; description: string; quantity: number; unit_price_cents: number; total_cents: number }>;
};

export default function QuotePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [declined, setDeclined] = useState(false);

  const load = useCallback(() => {
    api<Quote>(`/api/public/quotes/${token}`)
      .then(setQuote)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'We could not load your quote.'));
  }, [token]);
  useEffect(load, [load]);

  if (error) {
    return (
      <StorePage narrow title="This link has expired">
        <Notice>{error}</Notice>
      </StorePage>
    );
  }
  if (!quote) {
    return (
      <StorePage narrow title="Your quote">
        <Spinner />
      </StorePage>
    );
  }

  const accept = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await api<{ pay_token: string | null }>(`/api/public/quotes/${token}/accept`, { body: { name: name.trim(), agree } });
      if (res.pay_token) navigate(`/pay/${res.pay_token}?accepted=1`);
      else load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'That did not work. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await api(`/api/public/quotes/${token}/decline`, { body: { reason: reason.trim() || null } });
      setDeclined(true);
      setDeclining(false);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'That did not work. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <StorePage eyebrow={`Quote ${quote.reference}`} title={`${quote.event_type} on ${dateLabel(quote.event_date, { month: 'long', day: 'numeric', year: 'numeric' })}`} intro={quote.venue_name ? <p>{quote.venue_name}</p> : undefined}>
      {quote.status === 'expired' && <Notice tone="warning" className="mb-6">This quote has expired. Please contact the shop for an updated one.</Notice>}
      {quote.status === 'superseded' && <Notice tone="warning" className="mb-6">There is a newer version of this quote. Please check your email for the latest.</Notice>}
      {quote.status === 'accepted' && <Notice tone="success" className="mb-6">You accepted this quote{quote.accepted_name ? ` as ${quote.accepted_name}` : ''}.</Notice>}
      {(quote.status === 'declined' || declined) && <Notice className="mb-6">You declined this quote. Thank you for letting the team know.</Notice>}
      <div className="grid gap-6 lg:grid-cols-12">
        <Panel className="lg:col-span-7" title="What is included">
          {quote.customer_message && <p className="mb-5 whitespace-pre-line text-[0.98rem]">{quote.customer_message}</p>}
          <table className="w-full text-left text-[0.92rem]">
            <caption className="sr-only">Quote lines</caption>
            <thead>
              <tr className="border-b border-charcoal/15 text-[0.75rem] tracking-wide text-charcoal/70 uppercase">
                <th scope="col" className="py-2 font-semibold">Item</th>
                <th scope="col" className="py-2 text-right font-semibold">Qty</th>
                <th scope="col" className="py-2 text-right font-semibold">Price</th>
                <th scope="col" className="py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((l) => (
                <tr key={l.id} className="border-b border-charcoal/8">
                  <td className="py-2.5 pr-3">{l.description}</td>
                  <td className="py-2.5 text-right tabular-nums">{l.quantity}</td>
                  <td className="py-2.5 text-right tabular-nums">{money(l.unit_price_cents)}</td>
                  <td className="py-2.5 text-right tabular-nums">{money(l.total_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {quote.terms && (
            <div className="mt-6 border-t border-charcoal/15 pt-5">
              <h3 className="font-sans text-[0.95rem] font-semibold tracking-normal">Terms</h3>
              <p className="mt-2 text-[0.88rem] leading-relaxed whitespace-pre-line text-charcoal/75">{quote.terms}</p>
            </div>
          )}
        </Panel>
        <div className="space-y-6 lg:col-span-5">
          <Panel title="Total">
            <dl>
              <Row label="Subtotal" value={money(quote.subtotal_cents)} />
              {quote.discount_cents > 0 && <Row label="Discount" value={`−${money(quote.discount_cents)}`} />}
              <Row label={quote.tax_label} value={money(quote.tax_cents)} />
              <Row strong label="Total" value={money(quote.total_cents)} />
              {quote.deposit_cents > 0 && <Row label="Deposit due to confirm" value={money(quote.deposit_cents)} />}
              {quote.deposit_cents > 0 && <Row label="Remaining balance" value={money(quote.total_cents - quote.deposit_cents)} />}
            </dl>
            {quote.valid_until && <p className="mt-3 text-[0.85rem] text-charcoal/70">Valid until {dateLabel(quote.valid_until, { month: 'long', day: 'numeric', year: 'numeric' })}.</p>}
          </Panel>
          {quote.can_accept && !declined && (
            <Panel title="Accept this quote">
              <p className="text-[0.92rem] text-charcoal/75">
                Accepting holds your date while you complete the next step.
                {quote.deposit_cents > 0 ? ' Your booking is confirmed once the deposit is paid' : ' Your booking is confirmed once the team has what they need'}
                {quote.requires_contract ? ' and your contract is signed.' : '.'}
              </p>
              <div className="mt-5 space-y-5">
                <TextField label="Type your full name" name="accepted_name" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
                <Check name="agree" label="I accept this quote and its terms." checked={agree} onChange={setAgree} />
                {actionError && <Notice tone="error">{actionError}</Notice>}
                <Button onClick={() => { if (name.trim().length >= 2 && agree) void accept(); else setActionError('Please type your name and tick the box to accept.'); }} size="lg" icon={<Arrow />}>
                  {busy ? 'One moment…' : 'Accept quote'}
                </Button>
              </div>
              {declining ? (
                <div className="mt-6 border-t border-charcoal/15 pt-5">
                  <TextArea label="Anything you would like to share?" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
                  <div className="mt-3 flex gap-3">
                    <button type="button" className="link-underline text-[0.9rem] text-rose-deep" onClick={decline}>Decline the quote</button>
                    <button type="button" className="link-underline text-[0.9rem]" onClick={() => setDeclining(false)}>Keep it open</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="link-underline mt-5 text-[0.88rem] text-charcoal/70" onClick={() => setDeclining(true)}>
                  This is not right for me
                </button>
              )}
            </Panel>
          )}
        </div>
      </div>
    </StorePage>
  );
}
