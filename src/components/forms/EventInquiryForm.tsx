import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { AnimatePresence, motion, useSpring } from 'motion/react';
import { ChipGroup, DemoNotice, SelectField, TextArea, TextField } from './fields';
import { formatPhone, isEmail, phoneDigits, todayISO, useForm, type Rules } from './useForm';
import { BloomMark } from '../fx/BloomMark';
import { Arrow, Button } from '../ui/Button';
import { business, links } from '../../data/business';

export const EVENT_SERVICES = [
  'Bridal & wedding party flowers',
  'Ceremony florals, arches & altars',
  'Reception centerpieces & cake flowers',
  'Linens, runners & chair styling',
  'Lighting & drapery',
  'Signage, card boxes & accessories',
  'Rentals & showroom selections',
  'Delivery, setup & cleanup',
] as const;

/** Maps ?service= shortcuts (from rental and service links) to a pre-selected option. */
const SERVICE_KEYS: Record<string, (typeof EVENT_SERVICES)[number]> = {
  bridal: 'Bridal & wedding party flowers',
  ceremony: 'Ceremony florals, arches & altars',
  arches: 'Ceremony florals, arches & altars',
  centerpieces: 'Reception centerpieces & cake flowers',
  tablescapes: 'Reception centerpieces & cake flowers',
  linens: 'Linens, runners & chair styling',
  lighting: 'Lighting & drapery',
  accessories: 'Signage, card boxes & accessories',
  rentals: 'Rentals & showroom selections',
  setup: 'Delivery, setup & cleanup',
};

const BUDGETS = ['Under $1,000', '$1,000 – $2,500', '$2,500 – $5,000', '$5,000 – $10,000', '$10,000+', 'Not sure yet'] as const;
const EVENT_TYPES = ['Wedding', 'Engagement', 'Rehearsal dinner', 'Shower', 'Graduation party', 'Birthday', 'Anniversary', 'Another celebration'];

type V = {
  name: string;
  email: string;
  phone: string;
  eventDate: string;
  venue: string;
  guests: string;
  eventType: string;
  services: string[];
  budget: string;
  description: string;
};

const MAX_DATE = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 4);
  return d.toISOString().slice(0, 10);
})();

const rules: Rules<V> = {
  name: (v) => {
    const s = String(v).trim();
    if (!s) return 'Please share your name.';
    if (s.length < 2) return 'That name looks a little short.';
    if (s.length > 80) return 'Please keep the name under 80 characters.';
    return null;
  },
  email: (v) => (!String(v).trim() ? 'An email address helps Blooms reply.' : !isEmail(String(v)) ? 'Please check the email format (name@example.com).' : null),
  phone: (v) => {
    const d = phoneDigits(String(v));
    if (!d) return 'A phone number, please — events often need a quick call.';
    if (d.length !== 10) return 'Please enter a 10-digit US phone number.';
    return null;
  },
  eventDate: (v) => {
    const s = String(v);
    if (!s) return 'Choose your event date (an estimate is fine).';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'Please use a valid date.';
    if (s < todayISO()) return 'That date has already passed.';
    if (s > MAX_DATE) return 'Please choose a date within the next four years.';
    return null;
  },
  venue: (v) => (String(v).trim().length < 2 ? 'Where is it happening? A venue or city is perfect.' : String(v).length > 120 ? 'Please keep this under 120 characters.' : null),
  guests: (v) => {
    const s = String(v).trim();
    if (!s) return 'An estimated guest count helps with planning.';
    if (!/^\d+$/.test(s)) return 'Please use a whole number.';
    const n = Number(s);
    if (n < 1) return 'At least one guest, surely!';
    if (n > 2000) return 'Please enter a number up to 2,000.';
    return null;
  },
  services: (v) => ((v as string[]).length ? null : 'Pick at least one service you’re interested in.'),
  budget: (v) => (v ? null : 'Choose a range — “Not sure yet” is completely fine.'),
  description: (v) => {
    const s = String(v).trim();
    if (s.length < 20) return 'Tell us a little more — at least 20 characters.';
    if (s.length > 2000) return 'Please keep it under 2,000 characters.';
    return null;
  },
};

export function EventInquiryForm() {
  const [params] = useSearchParams();
  const initial = useMemo<V>(() => {
    const pre = params.get('service');
    const preset = pre && SERVICE_KEYS[pre] ? [SERVICE_KEYS[pre]] : [];
    const type = params.get('type');
    return {
      name: '',
      email: '',
      phone: '',
      eventDate: '',
      venue: '',
      guests: '',
      eventType: type && EVENT_TYPES.includes(type) ? type : '',
      services: preset,
      budget: '',
      description: '',
    };
    // Only read the URL on first render; later edits belong to the visitor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const form = useForm<V>(initial, rules);
  const { values, errors, set, blur } = form;
  const [demoResult, setDemoResult] = useState<V | null>(null);
  const progress = useSpring(0, { stiffness: 80, damping: 18 });

  useEffect(() => {
    progress.set(form.validCount / form.total);
  }, [form.validCount, form.total, progress]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const { ok } = form.validateAll();
    if (ok) setDemoResult({ ...values, phone: formatPhone(values.phone) });
  };

  const errorCount = Object.values(errors).filter(Boolean).length;

  return (
    <div className="relative">
      <AnimatePresence mode="wait" initial={false}>
        {demoResult ? (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-[28px] border border-charcoal/10 bg-ivory p-7 sm:p-10"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-4">
              <BloomMark size={56} />
              <div>
                <p className="eyebrow text-rose-deep">Concept demo complete</p>
                <h3 className="mt-1 text-[clamp(1.8rem,3.4vw,2.6rem)] leading-tight">Everything checks out — but nothing was sent.</h3>
              </div>
            </div>
            <p className="mt-5 max-w-2xl text-charcoal/75">
              In a finished site, this inquiry would be delivered to the shop&rsquo;s inbox. This is a design concept, so your details stayed in your
              browser. To reach Blooms about your event today, call or email directly.
            </p>
            <dl className="mt-8 grid gap-x-8 gap-y-4 border-t border-charcoal/10 pt-6 text-[0.92rem] sm:grid-cols-2">
              {(
                [
                  ['Name', demoResult.name],
                  ['Email', demoResult.email],
                  ['Phone', demoResult.phone],
                  ['Event date', new Date(`${demoResult.eventDate}T12:00:00`).toLocaleDateString('en-US', { dateStyle: 'long' })],
                  ['Venue or city', demoResult.venue],
                  ['Estimated guests', demoResult.guests],
                  ['Celebration', demoResult.eventType || '—'],
                  ['Budget range', demoResult.budget],
                  ['Services', demoResult.services.join(' · ')],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className={k === 'Services' ? 'sm:col-span-2' : undefined}>
                  <dt className="eyebrow text-charcoal/50">{k}</dt>
                  <dd className="mt-1 break-words">{v}</dd>
                </div>
              ))}
              <div className="sm:col-span-2">
                <dt className="eyebrow text-charcoal/50">Description</dt>
                <dd className="mt-1 whitespace-pre-line">{demoResult.description}</dd>
              </div>
            </dl>
            <div className="mt-9 flex flex-wrap gap-3">
              <Button href={links.tel} variant="solid">
                Call {business.phone.display}
              </Button>
              <Button href={links.mailto} variant="outline">
                Email the shop
              </Button>
              <button type="button" onClick={() => setDemoResult(null)} className="link-underline px-2 text-sm text-charcoal/70 hover:text-charcoal">
                Edit my answers
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            ref={form.formRef}
            noValidate
            onSubmit={onSubmit}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-[28px] border border-charcoal/10 bg-ivory p-6 sm:p-10"
            aria-labelledby="inquiry-form-title"
          >
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="eyebrow text-rose-deep">Event inquiry</p>
                <h3 id="inquiry-form-title" className="mt-2 text-[clamp(1.8rem,3.2vw,2.5rem)] leading-tight">
                  Tell us about your celebration
                </h3>
              </div>
              <div className="flex shrink-0 flex-col items-center" aria-hidden="true">
                <BloomMark size={64} progress={progress} />
                <span className="mt-1 text-[0.7rem] text-charcoal/50 tabular-nums">
                  {form.validCount}/{form.total}
                </span>
              </div>
            </div>
            <DemoNotice className="mt-6" />

            <div className="mt-9 grid gap-x-8 gap-y-8 sm:grid-cols-2">
              <TextField label="Your name" name="name" required autoComplete="name" value={values.name} onChange={(e) => set('name', e.target.value)} onBlur={() => blur('name')} error={errors.name} />
              <TextField
                label="Email"
                name="email"
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                value={values.email}
                onChange={(e) => set('email', e.target.value)}
                onBlur={() => blur('email')}
                error={errors.email}
              />
              <TextField
                label="Phone"
                name="phone"
                type="tel"
                required
                autoComplete="tel"
                inputMode="tel"
                placeholder="(989) 555-0123"
                value={values.phone}
                onChange={(e) => set('phone', e.target.value)}
                onBlur={() => {
                  if (phoneDigits(values.phone).length === 10) set('phone', formatPhone(values.phone));
                  blur('phone');
                }}
                error={errors.phone}
              />
              <TextField
                label="Event date"
                name="eventDate"
                type="date"
                required
                min={todayISO()}
                max={MAX_DATE}
                value={values.eventDate}
                onChange={(e) => set('eventDate', e.target.value)}
                onBlur={() => blur('eventDate')}
                error={errors.eventDate}
              />
              <TextField
                label="Venue or city"
                name="venue"
                required
                autoComplete="address-level2"
                placeholder="e.g. Saginaw, or the venue name"
                value={values.venue}
                onChange={(e) => set('venue', e.target.value)}
                onBlur={() => blur('venue')}
                error={errors.venue}
              />
              <TextField
                label="Estimated guest count"
                name="guests"
                required
                inputMode="numeric"
                placeholder="e.g. 120"
                value={values.guests}
                onChange={(e) => set('guests', e.target.value.replace(/[^\d]/g, '').slice(0, 5))}
                onBlur={() => blur('guests')}
                error={errors.guests}
              />
              <SelectField label="Type of celebration" name="eventType" value={values.eventType} onChange={(e) => set('eventType', e.target.value)} className="sm:col-span-2">
                <option value="">Choose one…</option>
                {EVENT_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </SelectField>
              <ChipGroup
                className="sm:col-span-2"
                label="Services requested"
                hint="Choose all that apply"
                name="services"
                multiple
                required
                options={EVENT_SERVICES}
                value={values.services}
                onChange={(v) => set('services', v as string[])}
                onBlur={() => blur('services')}
                error={errors.services}
              />
              <ChipGroup
                className="sm:col-span-2"
                label="Estimated budget range"
                name="budget"
                required
                options={BUDGETS}
                value={values.budget}
                onChange={(v) => set('budget', v as string)}
                onBlur={() => blur('budget')}
                error={errors.budget}
              />
              <TextArea
                className="sm:col-span-2"
                label="Describe your event"
                name="description"
                required
                maxLength={2000}
                placeholder="Colors, flowers you love, the mood, inspiration you’ve saved, anything that matters to you…"
                hint={`${values.description.trim().length}/2000 · at least 20 characters`}
                value={values.description}
                onChange={(e) => set('description', e.target.value)}
                onBlur={() => blur('description')}
                error={errors.description}
              />
            </div>

            <div className="mt-10 flex flex-col gap-4 border-t border-charcoal/10 pt-8 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[0.85rem] text-charcoal/60" aria-live="polite">
                {form.submitCount > 0 && errorCount > 0
                  ? `${errorCount} field${errorCount > 1 ? 's need' : ' needs'} attention.`
                  : 'Fields marked * are required.'}
              </p>
              <Button type="submit" variant="solid" size="lg" icon={<Arrow />}>
                Check my inquiry
              </Button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
