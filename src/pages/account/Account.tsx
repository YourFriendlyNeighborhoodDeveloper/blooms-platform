import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { dateLabel, dateTimeLabel, money, statusLabel } from '../../lib/format';
import { Arrow, Button } from '../../components/ui/Button';
import { TextArea, TextField } from '../../components/forms/fields';
import { Check, Notice, Panel, Spinner, StorePage } from '../../shop/ui';

type Me = { id: string; name: string; email: string; phone_e164: string | null; preferences: { email_marketing: boolean; sms_transactional: boolean; sms_marketing: boolean }; sms_available: boolean; sms_consent_text: { transactional: string; marketing: string } };
type OrderRow = { id: string; reference: string; status: string; placed_at: string; total_cents: number };
type EventRow = { reference: string; event_type: string; event_date: string; status: string; project_status: string | null; plan_token: string; project_token: string | null };
type InvoiceRow = { number: string; kind: string; status: string; total_cents: number; paid_cents: number; due_on: string | null; pay_token: string | null };

function SignIn() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/account/login', { body: { email: email.trim() } });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <StorePage narrow eyebrow="Your account" title="Sign in with your email" intro="We email you a private link, so there is no password to remember. Any orders you placed with this email appear in your account automatically.">
      <Panel>
        {sent ? (
          <Notice tone="success">A sign-in link is on its way to {email}. It works once and lasts 30 minutes.</Notice>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-6">
            <TextField label="Email" name="email" type="email" required autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" icon={<Arrow />}>
              {busy ? 'Sending…' : 'Email me a link'}
            </Button>
          </form>
        )}
      </Panel>
    </StorePage>
  );
}

function Preferences({ me, onSaved }: { me: Me; onSaved: () => void }) {
  const [name, setName] = useState(me.name);
  const [phone, setPhone] = useState(me.phone_e164 ?? '');
  const [prefs, setPrefs] = useState(me.preferences);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    try {
      await api('/api/account/me', { method: 'PATCH', body: { name: name.trim(), phone: phone.trim() || null } });
      await api('/api/account/preferences', { method: 'PUT', body: prefs });
      setMessage({ tone: 'success', text: 'Saved.' });
      onSaved();
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'That could not be saved.' });
    }
  };
  return (
    <Panel title="Your details and preferences">
      <form onSubmit={save} noValidate className="space-y-6">
        <TextField label="Name" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <p className="text-[0.85rem] text-charcoal/70">Signed in as {me.email}</p>
        <div className="space-y-4">
          <Check label="Email me occasional news and offers." checked={prefs.email_marketing} onChange={(v) => setPrefs((p) => ({ ...p, email_marketing: v }))} />
          {me.sms_available && (
            <>
              <Check label="Text me updates about my orders and events." hint={me.sms_consent_text.transactional} checked={prefs.sms_transactional} onChange={(v) => setPrefs((p) => ({ ...p, sms_transactional: v }))} />
              <Check label="Send me promotional texts." hint={me.sms_consent_text.marketing} checked={prefs.sms_marketing} onChange={(v) => setPrefs((p) => ({ ...p, sms_marketing: v }))} />
            </>
          )}
        </div>
        <p className="text-[0.8rem] text-charcoal/70">Messages about orders you place are always sent by email.</p>
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        <Button type="submit" variant="outline">
          Save
        </Button>
      </form>
    </Panel>
  );
}

function Support() {
  const [topic, setTopic] = useState('');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await api<{ reference: string }>('/api/account/support', { body: { topic: topic.trim() || 'General question', message: message.trim() } });
      setResult({ tone: 'success', text: `Sent. Your reference is ${res.reference}.` });
      setMessage('');
      setTopic('');
    } catch (err) {
      setResult({ tone: 'error', text: err instanceof ApiError ? err.message : 'That could not be sent.' });
    }
  };
  return (
    <Panel title="Ask the shop">
      <form onSubmit={submit} noValidate className="space-y-6">
        <TextField label="Topic" value={topic} onChange={(e) => setTopic(e.target.value)} />
        <TextArea label="Your message" required maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} />
        {result && <Notice tone={result.tone}>{result.text}</Notice>}
        <Button type="submit" variant="outline">
          Send
        </Button>
      </form>
    </Panel>
  );
}

export default function Account() {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<'loading' | 'signed_out' | 'ready'>('loading');
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [privacy, setPrivacy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const profile = await api<Me>('/api/account/me');
      setMe(profile);
      const [o, e, i] = await Promise.all([api<{ orders: OrderRow[] }>('/api/account/orders'), api<{ events: EventRow[] }>('/api/account/events'), api<{ invoices: InvoiceRow[] }>('/api/account/invoices')]);
      setOrders(o.orders);
      setEvents(e.events);
      setInvoices(i.invoices);
      setState('ready');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setState('signed_out');
      else setState('signed_out');
    }
  }, []);
  useEffect(() => void load(), [load]);

  if (state === 'loading') {
    return (
      <StorePage narrow title="Your account">
        <Spinner />
      </StorePage>
    );
  }
  if (state === 'signed_out' || !me) return <SignIn />;

  const openOrder = async (id: string) => {
    const res = await api<{ token: string }>(`/api/account/orders/${id}`);
    window.location.assign(`/track/${res.token}`);
  };
  const requestData = async (kind: 'export' | 'delete') => {
    await api('/api/account/data-request', { body: { kind } });
    setPrivacy(kind === 'export' ? 'Your request is with the team. They will send your data to this email.' : 'Your request is with the team. They will confirm once your details have been erased.');
  };
  const signOut = async () => {
    await api('/api/account/logout', { body: {} });
    setState('signed_out');
    setMe(null);
  };

  return (
    <StorePage eyebrow="Your account" title={`Hello, ${me.name.split(' ')[0]}`} aside={<button type="button" onClick={signOut} className="link-underline text-[0.92rem]">Sign out</button>}>
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <Panel title="Your orders">
            {orders.length === 0 ? (
              <p className="text-charcoal/70">No orders yet. <Link to="/shop" className="link-underline text-rose-deep">Visit the shop</Link></p>
            ) : (
              <ul className="divide-y divide-charcoal/10">
                {orders.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <button type="button" className="link-underline font-medium" onClick={() => openOrder(o.id)}>{o.reference}</button>
                      <p className="text-[0.82rem] text-charcoal/70">{dateTimeLabel(o.placed_at)}</p>
                    </div>
                    <p className="text-[0.9rem]">{statusLabel(o.status)}</p>
                    <p className="tabular-nums">{money(o.total_cents)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Your events">
            {events.length === 0 ? (
              <p className="text-charcoal/70">Nothing planned yet. <Link to="/plan" className="link-underline text-rose-deep">Plan your event</Link></p>
            ) : (
              <ul className="divide-y divide-charcoal/10">
                {events.map((e) => (
                  <li key={e.reference} className="py-3">
                    <p className="font-medium">{e.event_type} on {dateLabel(e.event_date, { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                    <p className="text-[0.85rem] text-charcoal/70">{statusLabel(e.project_status ?? e.status)}</p>
                    <div className="mt-1 flex gap-4 text-[0.9rem]">
                      <Link to={`/plan/${e.plan_token}`} className="link-underline text-rose-deep">Your plan</Link>
                      {e.project_token && <Link to={`/project/${e.project_token}`} className="link-underline text-rose-deep">Your project</Link>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {invoices.length > 0 && (
            <Panel title="Invoices and quotes">
              <ul className="divide-y divide-charcoal/10">
                {invoices.map((i) => (
                  <li key={i.number} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="font-medium">{i.number}</p>
                      <p className="text-[0.82rem] text-charcoal/70 capitalize">{i.kind} · {statusLabel(i.status)}</p>
                    </div>
                    <p className="tabular-nums">{money(i.total_cents - i.paid_cents)} due</p>
                    {i.pay_token && <Link to={`/pay/${i.pay_token}`} className="link-underline text-rose-deep">Pay now</Link>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
        <div className="space-y-6 lg:col-span-5">
          <Preferences me={me} onSaved={load} />
          <Support />
          <Panel title="Your data">
            <p className="text-[0.9rem] text-charcoal/75">You can ask for a copy of what we hold about you, or ask us to erase it. Financial records are kept where the law requires.</p>
            <div className="mt-4 flex flex-wrap gap-4 text-[0.9rem]">
              <button type="button" className="link-underline" onClick={() => requestData('export')}>Request my data</button>
              <button type="button" className="link-underline text-rose-deep" onClick={() => requestData('delete')}>Request erasure</button>
            </div>
            {privacy && <Notice tone="success" className="mt-4">{privacy}</Notice>}
          </Panel>
        </div>
      </div>
    </StorePage>
  );
}
