import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError, newIdempotencyKey } from '../../lib/api';
import { dateLabel, money } from '../../lib/format';
import { Arrow, Button } from '../../components/ui/Button';
import { ChipGroup, SelectField, TextArea, TextField } from '../../components/forms/fields';
import { cn } from '../../lib/cn';
import { Check, Notice, Panel, ProductImage, QuantityStepper, Row, Spinner, StorePage, TestModeBanner } from '../../shop/ui';

type Service = { id: string; name: string; description: string | null; image_url: string | null; pricing_mode: 'package' | 'estimate' | 'custom_quote'; unit: string; unit_price_cents: number | null; est_low_cents: number | null; est_high_cents: number | null };
type Rental = { id: string; name: string; category: string | null; description: string | null; image_url: string | null; price_cents: number | null; max_quantity: number };
type Options = {
  categories: Array<{ id: string; name: string; description: string | null; services: Service[] }>;
  rentals: Rental[];
  event_types: string[];
  budget_ranges: string[];
  style_options: string[];
  consultation_formats: string[];
  min_notice_days: number;
  today: string;
  sms_available: boolean;
  sms_consent_text: { transactional: string; marketing: string };
  cancellation_policy: string | null;
};
type EstimateLine = { service_id: string | null; rental_item_id: string | null; name: string; category: string; quantity: number; unit: string; pricing_mode: Service['pricing_mode']; line_low_cents: number | null; line_high_cents: number | null };
type Estimate = { lines: EstimateLine[]; published_total_cents: number; estimate_low_cents: number; estimate_high_cents: number; pending_quote_count: number; estimated_tax_low_cents: number | null; estimated_tax_high_cents: number | null; tax_note: string; deposit_note: string; estimated_deposit_low_cents: number | null; estimated_deposit_high_cents: number | null };
type Availability = { status: 'available' | 'review' | 'unavailable'; summary: string; reasons: Array<{ code: string; message: string }>; alternatives: string[]; rentals: Array<{ name: string; requested: number; available: number }> };
type Upload = { id: string; filename: string };

type Draft = {
  name: string; email: string; phone: string; event_type: string; event_date: string; ceremony_time: string; reception_time: string; venue_name: string; venue_address: string; guest_count: string; budget_range: string; consultation_format: string;
  colors: string; theme: string; floral_styles: string[]; preferences: string; must_haves: string; optional_services: string;
  services: Record<string, number>; rentals: Record<string, number>;
  draft_token: string; uploads: Upload[];
  sms_transactional: boolean; sms_marketing: boolean; email_marketing: boolean;
};

const EMPTY: Draft = { name: '', email: '', phone: '', event_type: 'Wedding', event_date: '', ceremony_time: '', reception_time: '', venue_name: '', venue_address: '', guest_count: '', budget_range: '', consultation_format: '', colors: '', theme: '', floral_styles: [], preferences: '', must_haves: '', optional_services: '', services: {}, rentals: {}, draft_token: '', uploads: [], sms_transactional: false, sms_marketing: false, email_marketing: false };

const STORAGE_KEY = 'blooms-planner-draft';
const STEPS = ['Your event', 'Your style', 'Flowers & décor', 'Budget', 'Your date', 'Send'];

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // Consent is never restored from a saved draft. It must be given freshly each time.
    return raw ? { ...EMPTY, ...JSON.parse(raw), sms_transactional: false, sms_marketing: false, email_marketing: false } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function saveDraft(d: Draft) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  } catch {
    /* A saved draft is a convenience. The planner works without it. */
  }
}

const priceHint = (s: Service) => {
  if (s.pricing_mode === 'package' && s.unit_price_cents !== null) return `${money(s.unit_price_cents)}${s.unit !== 'each' ? ` per ${s.unit}` : ''}`;
  if (s.pricing_mode === 'estimate' && s.est_low_cents !== null && s.est_high_cents !== null) return `Estimate: ${money(s.est_low_cents)} – ${money(s.est_high_cents)}${s.unit !== 'each' ? ` per ${s.unit}` : ''}`;
  return 'Custom quote';
};

function ChoiceCard({ title, description, image, hint, quantity, max, onChange }: { title: string; description?: string | null; image?: string | null; hint: string; quantity: number; max?: number; onChange: (n: number) => void }) {
  return (
    <li className={cn('flex flex-col overflow-hidden rounded-2xl border bg-[#fffdf9] transition-colors', quantity > 0 ? 'border-charcoal' : 'border-charcoal/12')}>
      {image && <ProductImage url={image} alt="" className="aspect-[4/3] w-full" />}
      <div className="flex flex-1 flex-col p-4">
        <p className="font-display text-[1.2rem] leading-tight">{title}</p>
        {description && <p className="mt-1 text-[0.85rem] text-charcoal/70">{description}</p>}
        <p className="mt-2 text-[0.85rem] text-rose-deep">{hint}</p>
        <div className="mt-auto pt-4">
          {quantity > 0 ? (
            <div className="flex items-center gap-3">
              <QuantityStepper value={quantity} max={max} onChange={(n) => onChange(n)} label={`quantity of ${title}`} />
              <button type="button" className="link-underline text-[0.85rem] text-charcoal/70" onClick={() => onChange(0)}>
                Remove<span className="sr-only"> {title}</span>
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => onChange(1)} className="rounded-full border border-charcoal/30 px-4 py-2 text-[0.88rem] transition-colors hover:bg-charcoal hover:text-ivory">
              Add<span className="sr-only"> {title}</span>
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export default function Planner() {
  const navigate = useNavigate();
  const [options, setOptions] = useState<Options | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const idempotency = useRef(newIdempotencyKey());
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<Options>('/api/public/planner/options').then(setOptions).catch((err) => setLoadError(err instanceof ApiError ? err.message : 'We could not load the planner.'));
  }, []);

  useEffect(() => saveDraft(draft), [draft]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
  };

  const selections = useMemo(
    () => [
      ...Object.entries(draft.services).filter(([, q]) => q > 0).map(([service_id, quantity]) => ({ service_id, quantity })),
      ...Object.entries(draft.rentals).filter(([, q]) => q > 0).map(([rental_item_id, quantity]) => ({ rental_item_id, quantity })),
    ],
    [draft.services, draft.rentals],
  );
  const guestCount = draft.guest_count ? Number(draft.guest_count) : null;

  useEffect(() => {
    if (step !== 3) return;
    setEstimate(null);
    api<Estimate>('/api/public/planner/estimate', { body: { selections, guest_count: guestCount } }).then(setEstimate).catch(() => setEstimate(null));
  }, [step, selections, guestCount]);

  useEffect(() => {
    if (step !== 4 || !draft.event_date) return;
    setChecking(true);
    setAvailability(null);
    api<Availability>('/api/public/planner/availability', {
      body: { event_date: draft.event_date, ceremony_time: draft.ceremony_time || null, reception_time: draft.reception_time || null, rentals: Object.entries(draft.rentals).filter(([, q]) => q > 0).map(([rental_item_id, quantity]) => ({ rental_item_id, quantity })) },
    })
      .then(setAvailability)
      .catch(() => setAvailability(null))
      .finally(() => setChecking(false));
  }, [step, draft.event_date, draft.ceremony_time, draft.reception_time, draft.rentals]);

  const validateStep = (i: number) => {
    const e: Record<string, string> = {};
    if (i === 0) {
      if (draft.name.trim().length < 2) e.name = 'Please share your name.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(draft.email.trim())) e.email = 'Please check your email address.';
      if (draft.phone && draft.phone.replace(/\D/g, '').length < 10) e.phone = 'Please enter a 10-digit US phone number, or leave it blank.';
      if (!draft.event_type) e.event_type = 'Please choose the type of event.';
      if (!draft.event_date) e.event_date = 'Please choose a date. An estimate is fine.';
      else if (options && draft.event_date <= options.today) e.event_date = 'Please choose a date in the future.';
      if (draft.guest_count && !/^\d+$/.test(draft.guest_count)) e.guest_count = 'Please use a whole number.';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const go = (next: number) => {
    if (next > step && !validateStep(step)) return;
    setStep(next);
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => top.current?.focus({ preventScroll: true }), 50);
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploadError(null);
    setUploading(true);
    let token = draft.draft_token;
    const added: Upload[] = [];
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set('file', file);
        if (token) form.set('draft_token', token);
        const res = await api<{ id: string; filename: string; draft_token: string }>('/api/public/planner/uploads', { formData: form });
        token = res.draft_token;
        added.push({ id: res.id, filename: res.filename });
      }
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'That photo could not be uploaded.');
    } finally {
      setDraft((d) => ({ ...d, draft_token: token, uploads: [...d.uploads, ...added] }));
      setUploading(false);
    }
  };

  const removeUpload = async (id: string) => {
    await api(`/api/public/planner/uploads/${id}`, { method: 'DELETE', body: { draft_token: draft.draft_token } }).catch(() => {});
    setDraft((d) => ({ ...d, uploads: d.uploads.filter((u) => u.id !== id) }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await api<{ reference: string; portal_token: string }>('/api/public/planner/submit', {
        body: {
          idempotency_key: idempotency.current,
          contact: { name: draft.name.trim(), email: draft.email.trim(), phone: draft.phone.trim() || null },
          event_type: draft.event_type,
          event_date: draft.event_date,
          ceremony_time: draft.ceremony_time || null,
          reception_time: draft.reception_time || null,
          venue_name: draft.venue_name.trim() || null,
          venue_address: draft.venue_address.trim() || null,
          guest_count: guestCount,
          budget_range: draft.budget_range || null,
          consultation_format: draft.consultation_format || null,
          style: { colors: draft.colors.trim() || null, theme: draft.theme.trim() || null, floral_styles: draft.floral_styles, preferences: draft.preferences.trim() || null, must_haves: draft.must_haves.trim() || null, optional_services: draft.optional_services.trim() || null },
          selections,
          draft_token: draft.draft_token || null,
          consents: { sms_transactional: draft.sms_transactional, sms_marketing: draft.sms_marketing, email_marketing: draft.email_marketing },
        },
      });
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* Nothing to clean up. */
      }
      navigate(`/plan/${res.portal_token}?new=1`);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setSubmitError(apiErr?.message ?? 'We could not send that. Please try again. Your answers are saved here.');
      idempotency.current = newIdempotencyKey();
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <StorePage title="Plan your event" narrow>
        <Notice tone="error">{loadError}</Notice>
      </StorePage>
    );
  }
  if (!options) {
    return (
      <StorePage title="Plan your event" narrow>
        <Spinner />
      </StorePage>
    );
  }

  const hasCatalog = options.categories.length > 0 || options.rentals.length > 0;

  return (
    <StorePage eyebrow="Wedding & event planner" title="Plan your event, whenever you are ready" intro="Share your date, your style and your wish list. See a first estimate, check your date and book a consultation. There is no obligation, and your answers save as you go.">
      <TestModeBanner />
      <div ref={top} tabIndex={-1} className="scroll-mt-28 outline-none">
        <ol className="mb-8 flex flex-wrap gap-x-5 gap-y-2" aria-label="Planner steps">
          {STEPS.map((label, i) => (
            <li key={label} className={cn('flex items-center gap-2 text-[0.85rem]', i === step ? 'font-medium text-charcoal' : 'text-charcoal/70')} aria-current={i === step ? 'step' : undefined}>
              <span className={cn('grid h-6 w-6 place-items-center rounded-full text-[0.72rem]', i === step ? 'bg-charcoal text-ivory' : i < step ? 'bg-blush text-charcoal' : 'border border-charcoal/25')} aria-hidden="true">
                {i < step ? '✓' : i + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>
        <p className="sr-only" aria-live="polite">
          Step {step + 1} of {STEPS.length}: {STEPS[step]}
        </p>

        <form onSubmit={submit} noValidate>
          {step === 0 && (
            <Panel>
              <div className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
                <TextField label="Your name" name="name" required autoComplete="name" value={draft.name} onChange={(e) => set('name', e.target.value)} error={errors.name} />
                <TextField label="Email" name="email" type="email" required autoComplete="email" inputMode="email" value={draft.email} onChange={(e) => set('email', e.target.value)} error={errors.email} />
                <TextField label="Phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" value={draft.phone} onChange={(e) => set('phone', e.target.value)} error={errors.phone} />
                <SelectField label="Type of event" name="event_type" required value={draft.event_type} onChange={(e) => set('event_type', e.target.value)} error={errors.event_type}>
                  {options.event_types.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </SelectField>
                <TextField label="Event date" name="event_date" type="date" required min={options.today} value={draft.event_date} onChange={(e) => set('event_date', e.target.value)} error={errors.event_date} hint="An estimate is fine." />
                <TextField label="Estimated guests" name="guest_count" inputMode="numeric" value={draft.guest_count} onChange={(e) => set('guest_count', e.target.value.replace(/[^\d]/g, '').slice(0, 5))} error={errors.guest_count} />
                <TextField label="Ceremony time" name="ceremony_time" type="time" value={draft.ceremony_time} onChange={(e) => set('ceremony_time', e.target.value)} />
                <TextField label="Reception time" name="reception_time" type="time" value={draft.reception_time} onChange={(e) => set('reception_time', e.target.value)} />
                <TextField label="Venue name" name="venue_name" value={draft.venue_name} onChange={(e) => set('venue_name', e.target.value)} />
                <TextField label="Venue address" name="venue_address" value={draft.venue_address} onChange={(e) => set('venue_address', e.target.value)} />
                <ChipGroup className="sm:col-span-2" label="Estimated budget" name="budget_range" options={options.budget_ranges} value={draft.budget_range} onChange={(v) => set('budget_range', v as string)} hint="Optional" />
                <ChipGroup className="sm:col-span-2" label="How would you like to meet?" name="consultation_format" options={options.consultation_formats} value={draft.consultation_format} onChange={(v) => set('consultation_format', v as string)} hint="Optional" />
              </div>
            </Panel>
          )}

          {step === 1 && (
            <Panel>
              <div className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
                <TextField label="Your colors" name="colors" placeholder="Blush, sage, a little gold…" value={draft.colors} onChange={(e) => set('colors', e.target.value)} />
                <TextField label="Theme" name="theme" value={draft.theme} onChange={(e) => set('theme', e.target.value)} />
                <ChipGroup className="sm:col-span-2" label="Floral style" name="floral_styles" multiple options={options.style_options} value={draft.floral_styles} onChange={(v) => set('floral_styles', v as string[])} hint="Choose any that feel right" />
                <TextArea className="sm:col-span-2" label="Tell us what you are picturing" name="preferences" maxLength={4000} value={draft.preferences} onChange={(e) => set('preferences', e.target.value)} />
                <TextArea className="sm:col-span-2" label="Must-haves" name="must_haves" maxLength={2000} value={draft.must_haves} onChange={(e) => set('must_haves', e.target.value)} />
                <TextArea className="sm:col-span-2" label="Anything else you might want help with" name="optional_services" maxLength={2000} value={draft.optional_services} onChange={(e) => set('optional_services', e.target.value)} />
              </div>
              <div className="mt-8">
                <p className="eyebrow text-charcoal/70">Inspiration photos</p>
                <p className="mt-1 text-[0.85rem] text-charcoal/70">JPEG, PNG or WebP, up to 10 MB each and 12 in total. Only the Blooms team can see them, and location data is removed.</p>
                <label className="mt-3 inline-block cursor-pointer rounded-full border border-charcoal/30 px-5 py-2.5 text-[0.9rem] transition-colors hover:bg-charcoal hover:text-ivory has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]">
                  {uploading ? 'Uploading…' : 'Add photos'}
                  <input type="file" name="inspiration" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(e) => { void uploadFiles(e.target.files); e.target.value = ''; }} />
                </label>
                {uploadError && <Notice tone="error" className="mt-3">{uploadError}</Notice>}
                {draft.uploads.length > 0 && (
                  <ul className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6">
                    {draft.uploads.map((u) => (
                      <li key={u.id} className="relative">
                        <img src={`/api/public/planner/uploads/${u.id}/file?token=${encodeURIComponent(draft.draft_token)}`} alt={u.filename} className="aspect-square w-full rounded-xl object-cover" />
                        <button type="button" onClick={() => removeUpload(u.id)} aria-label={`Remove ${u.filename}`} className="absolute top-1 right-1 grid h-7 w-7 place-items-center rounded-full bg-ink/70 text-[0.8rem] text-ivory">
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Panel>
          )}

          {step === 2 && (
            <div className="space-y-8">
              {!hasCatalog && (
                <Notice>
                  The shop has not published its wedding menu online yet. Tell the team what you would like in the previous step, and they will build your quote from there.
                </Notice>
              )}
              {options.categories.map((c) => (
                <section key={c.id} aria-labelledby={`cat-${c.id}`}>
                  <h2 id={`cat-${c.id}`} className="text-[1.7rem] leading-tight">{c.name}</h2>
                  {c.description && <p className="mt-1 text-[0.92rem] text-charcoal/70">{c.description}</p>}
                  <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {c.services.map((s) => (
                      <ChoiceCard key={s.id} title={s.name} description={s.description} image={s.image_url} hint={priceHint(s)} quantity={draft.services[s.id] ?? 0} onChange={(n) => set('services', { ...draft.services, [s.id]: n })} />
                    ))}
                  </ul>
                </section>
              ))}
              {options.rentals.length > 0 && (
                <section aria-labelledby="planner-rentals">
                  <h2 id="planner-rentals" className="text-[1.7rem] leading-tight">Rentals</h2>
                  <p className="mt-1 text-[0.92rem] text-charcoal/70">Availability for your date is checked on the next steps.</p>
                  <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {options.rentals.map((r) => (
                      <ChoiceCard key={r.id} title={r.name} description={r.description} image={r.image_url} hint={r.price_cents !== null ? `${money(r.price_cents)} each` : 'Custom quote'} quantity={draft.rentals[r.id] ?? 0} max={r.max_quantity} onChange={(n) => set('rentals', { ...draft.rentals, [r.id]: n })} />
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}

          {step === 3 && (
            <Panel title="Your first estimate">
              {!estimate && <Spinner label="Adding it up…" />}
              {estimate && !estimate.lines.length && <p className="text-charcoal/70">You have not chosen anything yet. That is fine: the team can build a quote from your notes.</p>}
              {estimate && estimate.lines.length > 0 && (
                <>
                  <table className="w-full text-left text-[0.92rem]">
                    <caption className="sr-only">Itemized estimate</caption>
                    <thead>
                      <tr className="border-b border-charcoal/15 text-[0.75rem] tracking-wide text-charcoal/70 uppercase">
                        <th scope="col" className="py-2 font-semibold">Item</th>
                        <th scope="col" className="py-2 font-semibold">Type</th>
                        <th scope="col" className="py-2 text-right font-semibold">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {estimate.lines.map((l) => (
                        <tr key={(l.service_id ?? l.rental_item_id) as string} className="border-b border-charcoal/8">
                          <td className="py-2.5 pr-3">{l.quantity} × {l.name}</td>
                          <td className="py-2.5 pr-3 text-[0.82rem] text-charcoal/70">{l.pricing_mode === 'package' ? 'Published price' : l.pricing_mode === 'estimate' ? 'Estimate' : 'Custom quote'}</td>
                          <td className="py-2.5 text-right tabular-nums">
                            {l.pricing_mode === 'custom_quote' ? 'Quoted by the team' : l.pricing_mode === 'estimate' ? `${money(l.line_low_cents)} – ${money(l.line_high_cents)}` : money(l.line_low_cents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <dl className="mt-5">
                    {estimate.published_total_cents > 0 && <Row label="Published prices" value={money(estimate.published_total_cents)} />}
                    {estimate.estimate_high_cents > 0 && <Row label="Estimates" value={`${money(estimate.estimate_low_cents)} – ${money(estimate.estimate_high_cents)}`} />}
                    {estimate.pending_quote_count > 0 && <Row label="Awaiting a custom quote" value={`${estimate.pending_quote_count} ${estimate.pending_quote_count === 1 ? 'item' : 'items'}`} />}
                    {estimate.estimated_tax_high_cents !== null && estimate.estimated_tax_high_cents > 0 && (
                      <Row label="Estimated sales tax" value={estimate.estimated_tax_low_cents === estimate.estimated_tax_high_cents ? money(estimate.estimated_tax_high_cents) : `${money(estimate.estimated_tax_low_cents)} – ${money(estimate.estimated_tax_high_cents)}`} />
                    )}
                    {estimate.estimated_deposit_high_cents !== null && estimate.estimated_deposit_high_cents > 0 && (
                      <Row label="Estimated deposit" value={estimate.estimated_deposit_low_cents === estimate.estimated_deposit_high_cents ? money(estimate.estimated_deposit_high_cents) : `${money(estimate.estimated_deposit_low_cents)} – ${money(estimate.estimated_deposit_high_cents)}`} />
                    )}
                  </dl>
                  <p className="mt-2 text-[0.82rem] text-charcoal/70">{estimate.tax_note} {estimate.deposit_note} The remaining balance is set out in your formal quote.</p>
                </>
              )}
              <Notice className="mt-6">
                <strong>This is a starting point, not a final price.</strong> Your date and price are confirmed only in a formal quote from the team, once you accept it and pay any deposit.
              </Notice>
            </Panel>
          )}

          {step === 4 && (
            <Panel title={draft.event_date ? `Checking ${dateLabel(draft.event_date)}` : 'Your date'}>
              {checking && <Spinner label="Checking your date…" />}
              {availability && (
                <>
                  <Notice tone={availability.status === 'available' ? 'success' : availability.status === 'unavailable' ? 'warning' : 'info'}>{availability.summary}</Notice>
                  {availability.status === 'unavailable' && availability.reasons.length > 0 && (
                    <ul className="mt-4 list-disc pl-5 text-[0.92rem]">
                      {availability.reasons.map((r) => (
                        <li key={r.code + r.message}>{r.message}</li>
                      ))}
                    </ul>
                  )}
                  {availability.alternatives.length > 0 && (
                    <div className="mt-5">
                      <p className="eyebrow text-charcoal/70">Nearby dates that may work</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {availability.alternatives.map((d) => (
                          <button key={d} type="button" onClick={() => set('event_date', d)} className="rounded-full border border-charcoal/30 px-4 py-2 text-[0.88rem] transition-colors hover:bg-charcoal hover:text-ivory">
                            {dateLabel(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
              {!checking && !availability && <Notice tone="warning">We could not check that date just now. You can still send your plan, and the team will check it for you.</Notice>}
              <div className="mt-6">
                <TextField label="Change the date" type="date" min={options.today} value={draft.event_date} onChange={(e) => set('event_date', e.target.value)} />
              </div>
            </Panel>
          )}

          {step === 5 && (
            <Panel title="Ready to send?">
              <dl className="grid gap-x-8 gap-y-4 text-[0.95rem] sm:grid-cols-2">
                <div><dt className="eyebrow text-charcoal/70">Event</dt><dd className="mt-1">{draft.event_type} on {draft.event_date ? dateLabel(draft.event_date) : '—'}</dd></div>
                <div><dt className="eyebrow text-charcoal/70">Guests</dt><dd className="mt-1">{draft.guest_count || 'Not sure yet'}</dd></div>
                <div><dt className="eyebrow text-charcoal/70">Venue</dt><dd className="mt-1">{draft.venue_name || 'Not chosen yet'}</dd></div>
                <div><dt className="eyebrow text-charcoal/70">Selected</dt><dd className="mt-1">{selections.length} {selections.length === 1 ? 'item' : 'items'}, {draft.uploads.length} {draft.uploads.length === 1 ? 'photo' : 'photos'}</dd></div>
              </dl>
              <div className="mt-7 space-y-4 border-t border-charcoal/15 pt-6">
                {options.sms_available && draft.phone && (
                  <>
                    <Check name="sms_transactional" label="Text me updates about my event and consultation." hint={options.sms_consent_text.transactional} checked={draft.sms_transactional} onChange={(v) => set('sms_transactional', v)} />
                    <Check name="sms_marketing" label="Send me promotional texts." hint={options.sms_consent_text.marketing} checked={draft.sms_marketing} onChange={(v) => set('sms_marketing', v)} />
                  </>
                )}
                <Check name="email_marketing" label="Send me occasional news and offers by email." checked={draft.email_marketing} onChange={(v) => set('email_marketing', v)} />
              </div>
              <Notice className="mt-6">Sending your plan does not reserve your date. The team reviews it and gets back to you. You can book a consultation on the next screen.</Notice>
              {submitError && <Notice tone="error" className="mt-4">{submitError}</Notice>}
            </Panel>
          )}

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            {step > 0 ? (
              <button type="button" onClick={() => go(step - 1)} className="link-underline text-[0.95rem] text-charcoal/70">
                ← Back
              </button>
            ) : (
              <span />
            )}
            {step < STEPS.length - 1 ? (
              <Button onClick={() => go(step + 1)} size="lg" icon={<Arrow />}>
                Continue
              </Button>
            ) : (
              <Button type="submit" size="lg" icon={<Arrow />}>
                {submitting ? 'Sending…' : 'Send my plan'}
              </Button>
            )}
          </div>
        </form>
      </div>
    </StorePage>
  );
}
