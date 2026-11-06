import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { dateLabel, dateTimeLabel, money } from '../../lib/format';
import { Notice, Panel, Row, Spinner, StorePage } from '../../shop/ui';
import { PlannerForm, type PlannerDraft, type PlannerSubmitResult } from './Planner';

type DraftData = {
  event_type?: string | null; event_date?: string | null; ceremony_time?: string | null; reception_time?: string | null; venue_name?: string | null; venue_address?: string | null;
  guest_count?: number | null; budget_range?: string | null; consultation_format?: string | null; colors?: string | null; theme?: string | null; floral_styles?: string[] | null;
  preferences?: string | null; must_haves?: string | null; selections?: Array<{ service_id?: string | null; rental_item_id?: string | null; quantity: number }> | null;
};
type SandboxResult = { availability: { status: string; summary: string; alternatives: string[] }; estimate: { published_total_cents: number; estimate_low_cents: number; estimate_high_cents: number; pending_quote_count: number } };
type View = {
  reference: string; sandbox: boolean; status: 'draft' | 'submitted' | 'expired'; created_via: 'chat' | 'voice'; assistant_name: string;
  contact: { name: string | null; email: string | null; phone: string | null }; data: DraftData; preferred_consultation_at: string | null; submitted_at: string | null; sandbox_result: SandboxResult | null;
};

const phoneDisplay = (e164: string | null) => (e164 ? e164.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3') : '');

function toPlanner(v: View): Partial<PlannerDraft> {
  const d = v.data ?? {};
  const services: Record<string, number> = {};
  const rentals: Record<string, number> = {};
  for (const s of d.selections ?? []) {
    if (s.service_id) services[s.service_id] = s.quantity;
    if (s.rental_item_id) rentals[s.rental_item_id] = s.quantity;
  }
  return {
    name: v.contact.name ?? '', email: v.contact.email ?? '', phone: phoneDisplay(v.contact.phone),
    event_type: d.event_type ?? 'Wedding', event_date: d.event_date ?? '', ceremony_time: d.ceremony_time ?? '', reception_time: d.reception_time ?? '',
    venue_name: d.venue_name ?? '', venue_address: d.venue_address ?? '', guest_count: d.guest_count != null ? String(d.guest_count) : '',
    budget_range: d.budget_range ?? '', consultation_format: d.consultation_format ?? '', colors: d.colors ?? '', theme: d.theme ?? '', floral_styles: d.floral_styles ?? [],
    preferences: d.preferences ?? '', must_haves: d.must_haves ?? '', services, rentals,
  };
}

function SandboxSent({ view }: { view: View }) {
  const r = view.sandbox_result;
  return (
    <StorePage eyebrow="Demonstration sandbox" title="Your practice plan is saved" narrow>
      <Notice tone="success">
        Saved to the demonstration sandbox as <strong>{view.reference}</strong>. This is an Abraxas Technologies demonstration: nothing was sent to the shop, and nothing is reserved.
      </Notice>
      {r && (
        <Panel title="What the system worked out" className="mt-6">
          <Notice tone={r.availability.status === 'available' ? 'success' : r.availability.status === 'unavailable' ? 'warning' : 'info'}>{r.availability.summary}</Notice>
          <dl className="mt-4">
            {r.estimate.published_total_cents > 0 && <Row label="Published prices" value={money(r.estimate.published_total_cents)} />}
            {r.estimate.estimate_high_cents > 0 && <Row label="Estimates" value={`${money(r.estimate.estimate_low_cents)} – ${money(r.estimate.estimate_high_cents)}`} />}
            {r.estimate.pending_quote_count > 0 && <Row label="Awaiting a custom quote" value={`${r.estimate.pending_quote_count}`} />}
          </dl>
          <p className="mt-3 text-[0.82rem] text-charcoal/70">Demo catalog and example prices. A real plan is confirmed only in a formal quote from the team.</p>
        </Panel>
      )}
      <p className="mt-6 text-[0.92rem]">
        Want a real consultation? Ask {view.assistant_name} to pass on a real request, or <Link className="underline" to="/plan">use the planner</Link>.
      </p>
    </StorePage>
  );
}

/** The plan Flora saved, opened from the text or the code. Everything is editable before it is sent. */
export default function DraftReview() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api<View>(`/api/public/concierge/drafts/${encodeURIComponent(token)}`)
      .then(setView)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'We could not load this plan.'));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (error) {
    return (
      <StorePage title="Your plan" narrow>
        <Notice tone="error">{error}</Notice>
        <p className="mt-6 text-[0.92rem]">
          You can still <Link className="underline" to="/plan">plan on the website</Link>.
        </p>
      </StorePage>
    );
  }
  if (!view) {
    return (
      <StorePage title="Your plan" narrow>
        <Spinner />
      </StorePage>
    );
  }
  if (view.status === 'submitted' && view.sandbox) return <SandboxSent view={view} />;
  if (view.status !== 'draft') {
    return (
      <StorePage title="Your plan" narrow>
        <Notice tone="info">{view.status === 'submitted' ? `This plan was sent as ${view.reference}. The confirmation email has your private link.` : 'This saved plan has expired. You can start a new one on the website.'}</Notice>
      </StorePage>
    );
  }

  const onSubmitted = (res: PlannerSubmitResult) => {
    if (res.sandbox) void load();
    else if (res.portal_token) navigate(`/plan/${res.portal_token}?new=1`);
  };

  const banner = (
    <div className="mb-8 space-y-3">
      <Notice tone="info">
        {view.assistant_name} saved this from your {view.created_via === 'voice' ? 'call' : 'chat'} ({view.reference}). Check every step, change anything, add photos, then send it.
        {view.preferred_consultation_at && <> Your chosen consultation, {dateTimeLabel(view.preferred_consultation_at)}, is booked when you send the plan, if it is still free.</>}
      </Notice>
      {view.sandbox && (
        <Notice tone="warning">
          <strong>Demonstration sandbox.</strong> This is an Abraxas Technologies demonstration with fictional products and prices. Sending it saves a practice plan; the shop does not receive it.
        </Notice>
      )}
      {view.data.event_date && <p className="text-[0.85rem] text-charcoal/70">Event date on file: {dateLabel(view.data.event_date)}</p>}
    </div>
  );

  return (
    <PlannerForm
      initial={toPlanner(view)}
      submitPath={`/api/public/concierge/drafts/${encodeURIComponent(token)}/submit`}
      storageKey={`blooms-flora-${view.reference}`}
      banner={banner}
      eyebrow={view.sandbox ? 'Demonstration · your plan from Flora' : 'Your plan from Flora'}
      title="Review and send your plan"
      intro="Everything Flora saved is filled in below. Nothing is final until you send it, and sending it does not reserve your date."
      onSubmitted={onSubmitted}
    />
  );
}
