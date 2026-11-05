import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { money } from '../../lib/format';
import { Arrow, Button } from '../../components/ui/Button';
import { ChipGroup, SelectField, TextArea, TextField } from '../../components/forms/fields';
import { useCart } from '../../shop/CartContext';
import { Notice, ProductImage, QuantityStepper, Spinner, StorePage, TestModeBanner } from '../../shop/ui';
import { cn } from '../../lib/cn';

type Choice = { value: string; label?: string; price_delta_cents?: number };
type Option = { code: string; label: string; input_type: 'select' | 'multiselect' | 'text' | 'textarea'; required: boolean; max_length: number | null; help_text: string | null; choices: Choice[] };
type Variant = { id: string; name: string; sku: string; price_cents: number; sale_price_cents: number | null; available_quantity: number | null };
type Product = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  short_description: string | null;
  is_custom: boolean;
  allow_pickup: boolean;
  allow_delivery: boolean;
  allow_shipping: boolean;
  delivery_restriction: string | null;
  min_lead_hours: number;
  return_policy: string | null;
  out_of_stock_behavior: 'reject' | 'review' | 'backorder';
  division: { code: string; name: string };
  variants: Variant[];
  images: Array<{ id: string; url: string; alt: string }>;
  options: Option[];
};

const priceOf = (v: Variant) => (v.sale_price_cents !== null && v.sale_price_cents < v.price_cents ? v.sale_price_cents : v.price_cents);

export default function ProductPage() {
  const { slug } = useParams();
  const { addItem } = useCart();
  const [product, setProduct] = useState<Product | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [variantId, setVariantId] = useState('');
  const [options, setOptions] = useState<Record<string, string | string[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    let live = true;
    api<Product>(`/api/public/products/${slug}`)
      .then((p) => {
        if (!live) return;
        setProduct(p);
        setVariantId((p.variants.find((v) => v.available_quantity !== 0) ?? p.variants[0]).id);
      })
      .catch((err) => live && setLoadError(err instanceof ApiError ? err.message : 'We could not load this product.'));
    return () => {
      live = false;
    };
  }, [slug]);

  const variant = product?.variants.find((v) => v.id === variantId) ?? null;
  const optionsPrice = useMemo(() => {
    if (!product) return 0;
    let total = 0;
    for (const o of product.options) {
      const value = options[o.code];
      const chosen = Array.isArray(value) ? value : value ? [value] : [];
      for (const v of chosen) total += o.choices.find((c) => c.value === v)?.price_delta_cents ?? 0;
    }
    return total;
  }, [product, options]);

  if (loadError) {
    return (
      <StorePage title="That item is not available" narrow>
        <Notice tone="error">{loadError}</Notice>
        <div className="mt-6">
          <Button to="/shop">Back to the shop</Button>
        </div>
      </StorePage>
    );
  }
  if (!product || !variant) {
    return (
      <StorePage title="Loading…" narrow>
        <Spinner />
      </StorePage>
    );
  }

  const canRequestWhenOut = product.out_of_stock_behavior !== 'reject';
  const soldOut = variant.available_quantity === 0 && !canRequestWhenOut;
  const onSale = priceOf(variant) < variant.price_cents;
  const methods = [product.allow_pickup && 'pickup', product.allow_delivery && 'local delivery', product.allow_shipping && 'shipping'].filter(Boolean) as string[];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setAdded(false);
    try {
      await addItem(variant.id, quantity, options);
      setAdded(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That could not be added. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const image = product.images[imageIndex] ?? product.images[0];

  return (
    <section data-nav="light" className="min-h-[100svh] bg-ivory pt-28 pb-24 lg:pt-36">
      <div className="shell">
        <TestModeBanner />
        <nav aria-label="Breadcrumb" className="mb-6 text-[0.85rem] text-charcoal/70">
          <Link to="/shop" className="link-underline">
            Shop
          </Link>{' '}
          /{' '}
          <Link to={`/shop?division=${product.division.code}`} className="link-underline">
            {product.division.name}
          </Link>
        </nav>
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-6">
            <ProductImage url={image?.url ?? null} alt={image?.alt || product.name} className="aspect-[4/5] w-full rounded-[24px]" />
            {product.images.length > 1 && (
              <div className="mt-3 flex gap-2" role="group" aria-label="Product photos">
                {product.images.map((img, i) => (
                  <button key={img.id} type="button" aria-label={`Show photo ${i + 1}`} aria-pressed={i === imageIndex} onClick={() => setImageIndex(i)} className={cn('h-20 w-16 overflow-hidden rounded-xl ring-offset-2 ring-offset-ivory', i === imageIndex && 'ring-2 ring-charcoal')}>
                    <ProductImage url={img.url} alt="" className="h-full w-full" />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="lg:col-span-5 lg:col-start-8">
            <p className="eyebrow text-rose-deep">{product.division.name}</p>
            <h1 className="mt-3 text-[clamp(2.2rem,4.4vw,3.8rem)] leading-[1.02] tracking-[-0.03em]">{product.name}</h1>
            <p className="mt-4 text-[1.5rem] tabular-nums">
              {money(priceOf(variant) + optionsPrice)}
              {onSale && <s className="ml-3 text-[1.1rem] text-charcoal/70">{money(variant.price_cents + optionsPrice)}</s>}
            </p>
            {product.description && <p className="mt-5 whitespace-pre-line text-[1.02rem] leading-relaxed text-charcoal/80">{product.description}</p>}

            <form onSubmit={submit} className="mt-8 space-y-7" noValidate>
              {product.variants.length > 1 && (
                <SelectField label="Choose" required value={variantId} onChange={(e) => setVariantId(e.target.value)}>
                  {product.variants.map((v) => (
                    <option key={v.id} value={v.id} disabled={v.available_quantity === 0 && !canRequestWhenOut}>
                      {v.name} · {money(priceOf(v))}
                      {v.available_quantity === 0 ? (canRequestWhenOut ? ' · out of stock' : ' · sold out') : ''}
                    </option>
                  ))}
                </SelectField>
              )}
              {product.options.map((o) => {
                const label = o.label;
                const describe = (c: Choice) => `${c.label ?? c.value}${c.price_delta_cents ? ` (+${money(c.price_delta_cents)})` : ''}`;
                if (o.input_type === 'select') {
                  return (
                    <SelectField key={o.code} label={label} required={o.required} value={String(options[o.code] ?? '')} onChange={(e) => setOptions((s) => ({ ...s, [o.code]: e.target.value }))}>
                      <option value="">Choose one…</option>
                      {o.choices.map((c) => (
                        <option key={c.value} value={c.value}>
                          {describe(c)}
                        </option>
                      ))}
                    </SelectField>
                  );
                }
                if (o.input_type === 'multiselect') {
                  return (
                    <ChipGroup
                      key={o.code}
                      label={label}
                      name={o.code}
                      multiple
                      required={o.required}
                      options={o.choices.map((c) => c.value)}
                      value={(options[o.code] as string[]) ?? []}
                      onChange={(v) => setOptions((s) => ({ ...s, [o.code]: v as string[] }))}
                      hint={o.help_text ?? undefined}
                    />
                  );
                }
                if (o.input_type === 'textarea') {
                  return (
                    <TextArea
                      key={o.code}
                      label={label}
                      required={o.required}
                      maxLength={o.max_length ?? 500}
                      hint={o.help_text ?? undefined}
                      value={String(options[o.code] ?? '')}
                      onChange={(e) => setOptions((s) => ({ ...s, [o.code]: e.target.value }))}
                    />
                  );
                }
                return (
                  <TextField
                    key={o.code}
                    label={label}
                    required={o.required}
                    maxLength={o.max_length ?? 200}
                    hint={o.help_text ?? undefined}
                    value={String(options[o.code] ?? '')}
                    onChange={(e) => setOptions((s) => ({ ...s, [o.code]: e.target.value }))}
                  />
                );
              })}

              {error && <Notice tone="error">{error}</Notice>}
              {added && (
                <Notice tone="success">
                  Added to your cart.{' '}
                  <Link to="/cart" className="underline">
                    View cart
                  </Link>
                </Notice>
              )}

              <div className="flex flex-wrap items-center gap-4">
                <QuantityStepper value={quantity} onChange={setQuantity} max={canRequestWhenOut ? null : variant.available_quantity} label="quantity" />
                {soldOut ? (
                  <p className="text-charcoal/70">Sold out for now.</p>
                ) : (
                  <Button type="submit" size="lg" icon={<Arrow />}>
                    {busy ? 'Adding…' : 'Add to cart'}
                  </Button>
                )}
              </div>
            </form>

            <dl className="mt-10 space-y-3 border-t border-charcoal/15 pt-6 text-[0.92rem]">
              <div>
                <dt className="eyebrow text-charcoal/70">How you can get it</dt>
                <dd className="mt-1 capitalize">{methods.join(', ') || 'Please call the shop'}</dd>
              </div>
              {variant.available_quantity !== null && variant.available_quantity > 0 && variant.available_quantity <= 5 && (
                <div>
                  <dt className="eyebrow text-charcoal/70">Availability</dt>
                  <dd className="mt-1">Only {variant.available_quantity} left</dd>
                </div>
              )}
              {variant.available_quantity === 0 && canRequestWhenOut && (
                <div>
                  <dt className="eyebrow text-charcoal/70">Availability</dt>
                  <dd className="mt-1">{product.out_of_stock_behavior === 'backorder' ? 'On backorder. Ordering now holds your place, and the shop will confirm timing.' : 'Out of stock right now. You can still ask, and the shop will confirm whether it can be done.'}</dd>
                </div>
              )}
              {product.min_lead_hours > 0 && (
                <div>
                  <dt className="eyebrow text-charcoal/70">Notice needed</dt>
                  <dd className="mt-1">At least {product.min_lead_hours} hours</dd>
                </div>
              )}
              {product.is_custom && (
                <div>
                  <dt className="eyebrow text-charcoal/70">Made for you</dt>
                  <dd className="mt-1">The shop confirms custom pieces before scheduling them.</dd>
                </div>
              )}
              {product.delivery_restriction && (
                <div>
                  <dt className="eyebrow text-charcoal/70">Delivery note</dt>
                  <dd className="mt-1">{product.delivery_restriction}</dd>
                </div>
              )}
              {product.return_policy && (
                <div>
                  <dt className="eyebrow text-charcoal/70">Returns</dt>
                  <dd className="mt-1">{product.return_policy}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}
