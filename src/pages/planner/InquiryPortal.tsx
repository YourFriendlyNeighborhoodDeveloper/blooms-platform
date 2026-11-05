import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { dateLabel, dateTimeLabel, money, timeLabel, shopTimezone } from '../../lib/format';
import { Arrow, Button } from '../../components/ui/Button';
import { SelectField } from '../../components/forms/fields';
import { Notice, Panel, Spinner, StorePage } from '../../shop/ui';
import { cn } from '../../lib/cn';

type View = {
  reference: string; event_type: string; event_date: string; venue_name: string | null; guest_count: number | null; status: string; stage: string;
  availability: { status?: string; summary?: string; alternatives: string[] };
  suggested_date: string | null; clarification_request: string | null; decline_reason: string | null;
  consultation: { id: string; starts_at: string; ends_at: string; format: string; staff_name: string } | null;
  consultations_enabled: boolean; consultation_formats: string[]; preferred_format: string | null;
  documents: Array<{ id: string; filename: string; kind: string; mime_type: string }>;
  items: Array<{ id: string; name: string; quantity: number; pricing_mode: string }>;
  quote: { reference: string; status: string; total_cents: number; deposit_cents: number; valid_until: string | null; token: string | null } | null;
  project: { status: string; token: string | null } | null;
};

type Slot = { start: string; end: string };

function ConsultationPicker({ token, view, onDone }: { token: string; view: View; onDone: () => void }) {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [format, setFormat] = useState(view.preferred_format && view.consultation_formats.includes(view.preferred_format) ? view.preferred_format : view.consultation_formats[0] ?? '');
  const [day, setDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<{ slots: Slot[]; configured: boolean; timezone: string }>(`/api/public/plan/${token}/consultation-slots`)
      .then((r) => {
        setSlots(r.slots);
        setConfigured(r.configured);
      })
      .catch(() => setSlots([]));
  }, [token]);
  useEffect(load, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots ?? []) {
      const key = new Date(s.start).toLocaleDateString('en-CA', { timeZone: shopTimezone() });
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return [...map.entries()];
  }, [slots]);

  const book = async (slot: Slot) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/public/plan/${token}/consultation`, { body: { starts_at: new Date(slot.start).toISOString(), format, reschedule: Boolean(view.consultation) } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That time could not be booked.');
      load();
    } finally {
      setBusy(false);
    }
  };

  if (!slots) return <Spinner label="Finding open times…" />;
  if (!configured || !slots.length) {
    return <Notice>Online booking has no open times right now. The team will contact you to arrange a time.</Notice>;
  }
  const selected = byDay.find(([d]) => d === (day ?? byDay[0][0]));
  return (
    <div>
      <SelectField label="How would you like to meet?" required value={format} onChange={(e) => setFormat(e.target.value)}>
        {view.consultation_formats.map((f) => (
          <option key={f}>{f}</option>
        ))}
      </SelectField>
      <p className="eyebrow mt-6 text-charcoal/70">Choose a day</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {byDay.slice(0, 21).map(([d]) => (
          <button key={d} type="button" aria-pressed={selected?.[0] === d} onClick={() => setDay(d)} className={cn('rounded-full border px-3.5 py-2 text-[0.85rem] transition-colors', selected?.[0] === d ? 'border-charcoal bg-charcoal text-ivory' : 'border-charcoal/25 hover:border-charcoal/60')}>
            {dateLabel(d, { weekday: 'short', month: 'short', day: 'numeric' })}
          </button>
        ))}
      </div>
      <p className="eyebrow mt-6 text-charcoal/70">Choose a time</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {selected?.[1].map((s) => (
          <button key={s.start} type="button" data-testid="consultation-slot" disabled={busy} onClick={() => book(s)} className="rounded-2xl border border-charcoal/25 px-4 py-2.5 text-[0.9rem] transition-colors hover:bg-charcoal hover:text-ivory disabled:opacity-50">
            {timeLabel(s.start)}
          </button>
        ))}
      </div>
      {error && <Notice tone="error" className="mt-4">{error}</Notice>}
    </div>
  );
}

export default function InquiryPortal() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<View>(`/api/public/plan/${token}`)
      .then(setView)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'We could not load your plan.'));
  }, [token]);
  useEffect(load, [load]);

  if (error) {
    return (
      <StorePage narrow title="This link has expired">
        <Notice>{error}</Notice>
        <div className="mt-6">
          <Button to="/account">Sign in to your account</Button>
        </div>
      </StorePage>
    );
  }
  if (!view) {
    return (
      <StorePage narrow title="Your plan">
        <Spinner />
      </StorePage>
    );
  }

  const closed = view.status === 'declined' || view.status === 'closed';
  const cancel = async () => {
    await api(`/api/public/plan/${token}/consultation`, { method: 'DELETE' }).catch(() => {});
    setNotice('Your consultation was cancelled.');
    load();
  };

  return (
    <StorePage eyebrow={`Reference ${view.reference}`} title={`${view.event_type} on ${dateLabel(view.event_date, { month: 'long', day: 'numeric', year: 'numeric' })}`} intro={<p>Status: {view.stage}</p>}>
      {params.get('new') && <Notice tone="success" className="mb-6"><strong>Thank you. Your plan is saved and with the team.</strong> A confirmation is on its way to your inbox. Your date is not reserved yet.</Notice>}
      {notice && <Notice className="mb-6">{notice}</Notice>}
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          {view.clarification_request && view.status === 'clarification_requested' && (
            <Panel title="The team has a question">
              <p className="whitespace-pre-line">{view.clarification_request}</p>
              <p className="mt-3 text-[0.9rem] text-charcoal/70">Please reply to their email, or call the shop.</p>
            </Panel>
          )}
          {view.suggested_date && view.status === 'date_suggested' && (
            <Panel title="A date suggestion">
              <p>The team suggests <strong>{dateLabel(view.suggested_date)}</strong> instead. It is not reserved until you confirm it together.</p>
            </Panel>
          )}
          {closed && view.decline_reason && (
            <Panel title="About your date">
              <p className="whitespace-pre-line">{view.decline_reason}</p>
            </Panel>
          )}
          {view.quote?.token && (
            <Panel title={view.quote.status === 'accepted' ? 'Your accepted quote' : 'Your quote is ready'}>
              <p className="text-[1.05rem]">Total {money(view.quote.total_cents)}{view.quote.deposit_cents > 0 && `, deposit ${money(view.quote.deposit_cents)}`}</p>
              <div className="mt-4">
                <Button to={`/quote/${view.quote.token}`} icon={<Arrow />}>
                  Review your quote
                </Button>
              </div>
            </Panel>
          )}
          {view.project?.token && (
            <Panel title="Your project page">
              <p>Follow your timeline and payments here.</p>
              <div className="mt-4">
                <Button to={`/project/${view.project.token}`} icon={<Arrow />}>
                  Open your project
                </Button>
              </div>
            </Panel>
          )}
          {!closed && view.consultations_enabled && (
            <Panel title="Consultation">
              {view.consultation && !changing ? (
                <>
                  <p className="text-[1.1rem]">{dateTimeLabel(view.consultation.starts_at)}</p>
                  <p className="mt-1 text-[0.92rem] text-charcoal/70">{view.consultation.format} with {view.consultation.staff_name}</p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button type="button" onClick={() => setChanging(true)} className="link-underline text-[0.92rem]">Change the time</button>
                    <button type="button" onClick={cancel} className="link-underline text-[0.92rem] text-rose-deep">Cancel it</button>
                  </div>
                </>
              ) : (
                <ConsultationPicker
                  token={token as string}
                  view={view}
                  onDone={() => {
                    setChanging(false);
                    setNotice('Your consultation is booked. A confirmation is on its way.');
                    load();
                  }}
                />
              )}
            </Panel>
          )}
        </div>
        <div className="space-y-6 lg:col-span-5">
          <Panel title="Date check">
            <p className="text-[0.95rem]">{view.availability.summary}</p>
            {view.availability.alternatives.length > 0 && (
              <p className="mt-2 text-[0.88rem] text-charcoal/70">Nearby dates that may work: {view.availability.alternatives.map((d) => dateLabel(d, { month: 'short', day: 'numeric', year: 'numeric' })).join(', ')}.</p>
            )}
          </Panel>
          <Panel title="What you sent">
            <dl className="space-y-2 text-[0.92rem]">
              {view.venue_name && <div><dt className="inline text-charcoal/70">Venue: </dt><dd className="inline">{view.venue_name}</dd></div>}
              {view.guest_count !== null && <div><dt className="inline text-charcoal/70">Guests: </dt><dd className="inline">{view.guest_count}</dd></div>}
            </dl>
            {view.items.length > 0 && (
              <ul className="mt-3 space-y-1 text-[0.92rem]">
                {view.items.map((i) => (
                  <li key={i.id}>{i.quantity} × {i.name}</li>
                ))}
              </ul>
            )}
            {view.documents.length > 0 && (
              <ul className="mt-3 space-y-1 text-[0.88rem]">
                {view.documents.map((d) => (
                  <li key={d.id}><a className="underline" href={`/api/public/plan/${token}/documents/${d.id}`}>{d.filename}</a></li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </StorePage>
  );
}
