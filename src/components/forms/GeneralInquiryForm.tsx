import { useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { DemoNotice, SelectField, TextArea, TextField } from './fields';
import { formatPhone, isEmail, phoneDigits, useForm, type Rules } from './useForm';
import { Arrow, Button } from '../ui/Button';
import { BloomMark } from '../fx/BloomMark';
import { business, links } from '../../data/business';
import { cn } from '../../lib/cn';
import { api, ApiError } from '../../lib/api';
import { PLATFORM_ENABLED } from '../../lib/platform';

const TOPICS = [
  { id: 'flowers', label: 'Flowers & arrangements' },
  { id: 'events', label: 'Weddings & events' },
  { id: 'rentals', label: 'Event rentals' },
  { id: 'boutique', label: 'The boutique' },
  { id: 'other', label: 'Something else' },
];

type V = { name: string; email: string; phone: string; topic: string; message: string };

const rules: Rules<V> = {
  name: (v) => (String(v).trim().length < 2 ? 'Please share your name.' : String(v).length > 80 ? 'Please keep the name under 80 characters.' : null),
  email: (v) => (!String(v).trim() ? 'An email address helps Blooms reply.' : !isEmail(String(v)) ? 'Please check the email format (name@example.com).' : null),
  phone: (v) => {
    const d = phoneDigits(String(v));
    return d && d.length !== 10 ? 'Please enter a 10-digit US phone number, or leave it blank.' : null;
  },
  topic: (v) => (v ? null : 'What is your note about?'),
  message: (v) => {
    const s = String(v).trim();
    if (s.length < 10) return 'A few more words, please — at least 10 characters.';
    if (s.length > 2000) return 'Please keep it under 2,000 characters.';
    return null;
  },
};

export function GeneralInquiryForm({ defaultTopic = '', className }: { defaultTopic?: string; className?: string }) {
  const [params] = useSearchParams();
  const initial = useMemo<V>(() => {
    const topic = params.get('topic');
    const idea = params.get('idea');
    return {
      name: '',
      email: '',
      phone: '',
      topic: topic && TOPICS.some((t) => t.id === topic) ? topic : defaultTopic,
      message: idea ? `${idea.slice(0, 600)}\n\n` : '',
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const form = useForm<V>(initial, rules);
  const { values, errors, set, blur } = form;
  const [sent, setSent] = useState<V | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [website, setWebsite] = useState('');

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.validateAll().ok) return;
    if (!PLATFORM_ENABLED) {
      setSent({ ...values, phone: values.phone ? formatPhone(values.phone) : '' });
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      const topic = TOPICS.find((t) => t.id === values.topic)?.label ?? values.topic;
      const res = await api<{ reference: string }>('/api/public/contact', { body: { name: values.name, email: values.email, phone: values.phone || null, topic, message: values.message, website } });
      setReference(res.reference);
      setSent({ ...values, phone: values.phone ? formatPhone(values.phone) : '' });
      form.reset();
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : 'We could not send that. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={cn('relative', className)}>
      <AnimatePresence mode="wait" initial={false}>
        {sent ? (
          <motion.div
            key="done"
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-[28px] border border-charcoal/10 bg-ivory p-7 sm:p-10"
          >
            <BloomMark size={52} />
            {PLATFORM_ENABLED ? (
              <>
                <p className="eyebrow mt-5 text-rose-deep">Message received</p>
                <h3 className="mt-2 text-[clamp(1.7rem,3vw,2.3rem)] leading-tight">Thank you. Your note is with the shop.</h3>
                <p className="mt-4 text-charcoal/75">
                  Someone will reply during business hours, and a confirmation is on its way to your inbox.{reference && ` Your reference is ${reference}.`} If it can&rsquo;t wait:
                </p>
              </>
            ) : (
              <>
                <p className="eyebrow mt-5 text-rose-deep">Concept demo complete</p>
                <h3 className="mt-2 text-[clamp(1.7rem,3vw,2.3rem)] leading-tight">Looks good — though nothing was sent.</h3>
                <p className="mt-4 text-charcoal/75">
                  Your note ({TOPICS.find((t) => t.id === sent.topic)?.label.toLowerCase()}) passed every check. On a live site it would go to the shop; on
                  this concept it stays with you. Reach Blooms directly:
                </p>
              </>
            )}
            <div className="mt-7 flex flex-wrap gap-3">
              <Button href={links.tel} variant="solid">
                Call {business.phone.display}
              </Button>
              <Button href={links.mailto} variant="outline">
                Email the shop
              </Button>
              <button type="button" onClick={() => setSent(null)} className="link-underline px-2 text-sm text-charcoal/70">
                {PLATFORM_ENABLED ? 'Send another note' : 'Edit my note'}
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            ref={form.formRef}
            noValidate
            onSubmit={onSubmit}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-[28px] border border-charcoal/10 bg-ivory p-6 sm:p-10"
            aria-labelledby="general-form-title"
          >
            <p className="eyebrow text-rose-deep">General inquiry</p>
            <h3 id="general-form-title" className="mt-2 text-[clamp(1.7rem,3vw,2.3rem)] leading-tight">
              Send the shop a note
            </h3>
            {!PLATFORM_ENABLED && <DemoNotice className="mt-6" />}
            {PLATFORM_ENABLED && (
              <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
                <label>
                  Leave this field empty
                  <input tabIndex={-1} autoComplete="off" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} />
                </label>
              </div>
            )}
            <div className="mt-8 grid gap-x-8 gap-y-8 sm:grid-cols-2">
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
                autoComplete="tel"
                inputMode="tel"
                value={values.phone}
                onChange={(e) => set('phone', e.target.value)}
                onBlur={() => {
                  if (phoneDigits(values.phone).length === 10) set('phone', formatPhone(values.phone));
                  blur('phone');
                }}
                error={errors.phone}
              />
              <SelectField label="Topic" name="topic" required value={values.topic} onChange={(e) => set('topic', e.target.value)} onBlur={() => blur('topic')} error={errors.topic}>
                <option value="">Choose one…</option>
                {TOPICS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </SelectField>
              <TextArea
                className="sm:col-span-2"
                label="Message"
                name="message"
                required
                maxLength={2000}
                placeholder="What are you hoping for? Occasion, date, colors, questions…"
                hint={`${values.message.trim().length}/2000`}
                value={values.message}
                onChange={(e) => set('message', e.target.value)}
                onBlur={() => blur('message')}
                error={errors.message}
              />
            </div>
            {sendError && (
              <p role="alert" className="mt-6 rounded-2xl border border-rose-deep/40 bg-blush/50 p-4 text-[0.92rem]">
                {sendError} You can also call <a className="underline" href={links.tel}>{business.phone.display}</a>.
              </p>
            )}
            <div className="mt-9 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[0.85rem] text-charcoal/70">Fields marked * are required.</p>
              <Button type="submit" variant="solid" size="lg" icon={<Arrow />}>
                {PLATFORM_ENABLED ? (sending ? 'Sending…' : 'Send my note') : 'Check my note'}
              </Button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
