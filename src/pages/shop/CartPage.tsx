import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../../lib/api';
import { money } from '../../lib/format';
import { Arrow, Button } from '../../components/ui/Button';
import { useCart, type CartLine } from '../../shop/CartContext';
import { Notice, Panel, ProductImage, QuantityStepper, Row, Spinner, StorePage, TestModeBanner } from '../../shop/ui';

function LineRow({ line }: { line: CartLine }) {
  const { setQuantity, removeItem } = useCart();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex gap-4 border-b border-charcoal/10 py-5 last:border-0">
      <Link to={`/shop/${line.slug}`} className="shrink-0" tabIndex={-1} aria-hidden="true">
        <ProductImage url={line.image_url} alt="" className="h-28 w-24 rounded-2xl" />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap justify-between gap-2">
          <div>
            <Link to={`/shop/${line.slug}`} className="link-underline font-display text-[1.25rem] leading-tight">
              {line.name}
            </Link>
            {line.variant_name !== 'Standard' && <p className="text-[0.9rem] text-charcoal/70">{line.variant_name}</p>}
            {line.options_display.map((o) => (
              <p key={o.label} className="text-[0.85rem] break-words text-charcoal/70">
                {o.label}: {o.value}
              </p>
            ))}
          </div>
          <p className="tabular-nums">{money(line.line_subtotal_cents)}</p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <QuantityStepper value={line.quantity} max={line.available_quantity} disabled={busy} onChange={(n) => run(() => setQuantity(line.id, n))} label={`quantity of ${line.name}`} />
          <button type="button" disabled={busy} onClick={() => run(() => removeItem(line.id))} className="link-underline text-[0.9rem] text-charcoal/70">
            Remove<span className="sr-only"> {line.name}</span>
          </button>
        </div>
        {line.problems.map((p) => (
          <Notice key={p} tone="error" className="mt-3">
            {p}
          </Notice>
        ))}
        {error && (
          <Notice tone="error" className="mt-3">
            {error}
          </Notice>
        )}
      </div>
    </li>
  );
}

export default function CartPage() {
  const { cart, loading, applyPromo, clearPromo } = useCart();
  const [code, setCode] = useState('');
  const [promoError, setPromoError] = useState<string | null>(null);

  const submitPromo = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setPromoError(null);
    try {
      await applyPromo(code.trim());
      setCode('');
    } catch (err) {
      setPromoError(err instanceof ApiError ? err.message : 'That code could not be applied.');
    }
  };

  if (loading) {
    return (
      <StorePage title="Your cart" narrow>
        <Spinner />
      </StorePage>
    );
  }

  if (!cart.lines.length) {
    return (
      <StorePage title="Your cart is empty" narrow intro="Find something lovely, or send the shop a note if you have something specific in mind.">
        <div className="flex flex-wrap gap-3">
          <Button to="/shop" icon={<Arrow />}>
            Browse the shop
          </Button>
          <Button to="/about#contact" variant="outline">
            Send a note
          </Button>
        </div>
      </StorePage>
    );
  }

  const blocked = cart.lines.some((l) => l.problems.length);

  return (
    <StorePage title="Your cart">
      <TestModeBanner />
      <div className="grid gap-8 lg:grid-cols-12">
        <Panel className="lg:col-span-7">
          <ul>
            {cart.lines.map((l) => (
              <LineRow key={l.id} line={l} />
            ))}
          </ul>
        </Panel>
        <div className="space-y-6 lg:col-span-5">
          <Panel title="Summary">
            <dl>
              <Row label="Items" value={money(cart.totals.subtotal_cents)} />
              {cart.totals.discount_cents > 0 && <Row label={`Discount (${cart.promotion?.code})`} value={`−${money(cart.totals.discount_cents)}`} />}
              <Row label="Delivery and tax" value={<span className="text-[0.85rem] text-charcoal/70">Calculated at checkout</span>} />
            </dl>
            <form onSubmit={submitPromo} className="mt-5 flex gap-2">
              <label className="flex-1">
                <span className="sr-only">Promotion code</span>
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Promotion code" className="h-11 w-full rounded-full border border-charcoal/25 bg-transparent px-4 text-[0.92rem]" />
              </label>
              <button type="submit" className="h-11 rounded-full border border-charcoal/40 px-5 text-[0.9rem] hover:bg-charcoal hover:text-ivory">
                Apply
              </button>
            </form>
            {promoError && (
              <Notice tone="error" className="mt-3">
                {promoError}
              </Notice>
            )}
            {cart.promotion_error && (
              <Notice tone="warning" className="mt-3">
                {cart.promotion_error}{' '}
                <button type="button" className="underline" onClick={() => clearPromo()}>
                  Remove it
                </button>
              </Notice>
            )}
            {cart.promotion && (
              <p className="mt-3 text-[0.88rem] text-charcoal/70">
                Code <strong>{cart.promotion.code}</strong> applied.{' '}
                <button type="button" className="underline" onClick={() => clearPromo()}>
                  Remove
                </button>
              </p>
            )}
            <div className="mt-6">
              {blocked ? <Notice tone="warning">Please remove the items marked above to continue.</Notice> : <Button to="/checkout" size="lg" icon={<Arrow />} className="w-full [&>span]:w-full [&>span>span]:w-full">Continue to checkout</Button>}
            </div>
          </Panel>
          {cart.groups.length > 1 && (
            <Notice>
              Some of these items need separate arrangements. You will choose how to receive each group at checkout, and it all stays on one order and one payment.
            </Notice>
          )}
        </div>
      </div>
    </StorePage>
  );
}
