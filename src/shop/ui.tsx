import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '../components/ui/Button';
import { usePlatform } from '../lib/platform';
import { business, links } from '../data/business';
import { cn } from '../lib/cn';

/** Standard page frame for store, account and planner pages: nav clearance and the site's type scale. */
export function StorePage({ eyebrow, title, intro, children, narrow, aside }: { eyebrow?: string; title: string; intro?: ReactNode; children: ReactNode; narrow?: boolean; aside?: ReactNode }) {
  return (
    <section data-nav="light" className="min-h-[100svh] bg-ivory pt-28 pb-24 lg:pt-36">
      <div className={cn('shell', narrow && 'max-w-3xl')}>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            {eyebrow && <p className="eyebrow text-rose-deep">{eyebrow}</p>}
            <h1 className="mt-3 text-[clamp(2.4rem,5.4vw,4.6rem)] leading-[1.02] tracking-[-0.03em]">{title}</h1>
            {intro && <div className="mt-4 max-w-xl text-[1.02rem] leading-relaxed text-charcoal/75">{intro}</div>}
          </div>
          {aside}
        </div>
        <div className="mt-10 lg:mt-14">{children}</div>
      </div>
    </section>
  );
}

export function Panel({ className, children, title, id }: { className?: string; children: ReactNode; title?: string; id?: string }) {
  return (
    <section id={id} className={cn('rounded-[24px] border border-charcoal/10 bg-[#fffdf9] p-6 sm:p-8', className)}>
      {title && <h2 className="mb-5 text-[1.5rem] leading-tight">{title}</h2>}
      {children}
    </section>
  );
}

export function Notice({ tone = 'info', children, className, role }: { tone?: 'info' | 'error' | 'success' | 'warning'; children: ReactNode; className?: string; role?: string }) {
  const tones = {
    info: 'border-charcoal/15 bg-ivory-deep/60 text-charcoal',
    error: 'border-rose-deep/40 bg-blush/50 text-charcoal',
    success: 'border-sage/40 bg-sage/10 text-charcoal',
    warning: 'border-gold/60 bg-gold-soft/30 text-charcoal',
  };
  return (
    <div role={role ?? (tone === 'error' ? 'alert' : 'status')} className={cn('rounded-2xl border p-4 text-[0.95rem] leading-relaxed', tones[tone], className)}>
      {children}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" aria-live="polite" className="py-16 text-center text-charcoal/70">
      {label}
    </p>
  );
}

/** The honest banner shown whenever the store is not taking real money. */
export function TestModeBanner() {
  const { config } = usePlatform();
  if (config?.shop.payments !== 'test') return null;
  return (
    <Notice tone="warning" className="mb-6">
      <strong>Test mode.</strong> This store is not taking real payments, and orders placed here are demonstration data.
    </Notice>
  );
}

export function CallTheShop({ message }: { message: string }) {
  const { config } = usePlatform();
  const phone = config?.contact.phone || business.phone.display;
  const tel = config?.contact.phone_e164 ? `tel:${config.contact.phone_e164}` : links.tel;
  return (
    <Panel className="text-center">
      <p className="mx-auto max-w-xl text-[1.1rem] leading-relaxed text-charcoal/80">{message}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button href={tel}>Call {phone}</Button>
        <Button to="/about#contact" variant="outline">
          Send a note
        </Button>
      </div>
    </Panel>
  );
}

export function ProductImage({ url, alt, className }: { url: string | null; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url || failed) {
    return (
      <div className={cn('grid place-items-center bg-[radial-gradient(100%_80%_at_50%_20%,#efe5da,#e2c9c2)] text-charcoal/70', className)} role="img" aria-label={alt}>
        <span className="font-display text-3xl italic">Blooms</span>
      </div>
    );
  }
  return <img src={url} alt={alt} loading="lazy" onError={() => setFailed(true)} className={cn('object-cover', className)} />;
}

export function QuantityStepper({ value, onChange, max, label, disabled }: { value: number; onChange: (n: number) => void; max?: number | null; label: string; disabled?: boolean }) {
  const top = max ?? 99;
  return (
    <div className="inline-flex items-center rounded-full border border-charcoal/25" role="group" aria-label={label}>
      <button type="button" aria-label={`Decrease ${label}`} disabled={disabled || value <= 1} onClick={() => onChange(value - 1)} className="grid h-11 w-11 place-items-center rounded-full text-lg disabled:opacity-30">
        −
      </button>
      <span className="w-8 text-center tabular-nums" aria-live="polite">
        {value}
      </span>
      <button type="button" aria-label={`Increase ${label}`} disabled={disabled || value >= top} onClick={() => onChange(value + 1)} className="grid h-11 w-11 place-items-center rounded-full text-lg disabled:opacity-30">
        +
      </button>
    </div>
  );
}

export function Row({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-1.5', strong && 'mt-2 border-t border-charcoal/15 pt-3 text-[1.15rem] font-medium')}>
      <dt className={strong ? '' : 'text-charcoal/70'}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

export const TextLink = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="link-underline text-rose-deep">
    {children}
  </Link>
);

/** Small controlled inputs for the store. They match the site's forms without carrying useForm's state. */
export function Check({ label, checked, onChange, hint, name }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode; name?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-[0.92rem] leading-snug">
      <input type="checkbox" name={name} checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-rose-deep)]" />
      <span>
        {label}
        {hint && <span className="mt-1 block text-[0.78rem] text-charcoal/70">{hint}</span>}
      </span>
    </label>
  );
}
