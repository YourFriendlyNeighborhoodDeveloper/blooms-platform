import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { dateLabel, dateTimeLabel, money, statusLabel } from '../../lib/format';
import { Button } from '../../components/ui/Button';
import { Notice, Panel, Spinner, StorePage } from '../../shop/ui';
import { cn } from '../../lib/cn';

type Project = {
  reference: string; status: string; contract_status: string; event_date: string; event_type: string; venue_name: string | null; venue_address: string | null; guest_count: number | null; booking_status: string | null; hold_expires_at: string | null;
  milestones: Array<{ id: string; title: string; description: string | null; due_on: string | null; status: string }>;
  invoices: Array<{ number: string; kind: string; status: string; total_cents: number; paid_cents: number; amount_due_cents: number; due_on: string | null; pay_token: string | null }>;
  schedule: Array<{ id: string; label: string; amount_cents: number; due_on: string | null; status: string }>;
  documents: Array<{ id: string; filename: string; kind: string }>;
};

const STATUS_COPY: Record<string, string> = {
  pending: 'Your date is being held. Your booking is confirmed once the remaining steps are done.',
  confirmed: 'Your booking is confirmed and on our calendar.',
  in_preparation: 'We are preparing for your event.',
  event_scheduled: 'Everything is scheduled for your event.',
  completed: 'Your event is complete. Thank you for choosing us.',
  cancelled: 'This booking has been cancelled.',
};

export default function ProjectPortal() {
  const { token } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Project>(`/api/public/project/${token}`)
      .then(setProject)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'We could not load your project.'));
  }, [token]);

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
  if (!project) {
    return (
      <StorePage narrow title="Your event">
        <Spinner />
      </StorePage>
    );
  }

  return (
    <StorePage eyebrow={`Project ${project.reference}`} title={`${project.event_type} on ${dateLabel(project.event_date, { month: 'long', day: 'numeric', year: 'numeric' })}`} intro={<p>{STATUS_COPY[project.status] ?? statusLabel(project.status)}</p>}>
      {project.status === 'pending' && project.hold_expires_at && <Notice tone="warning" className="mb-6">Your date is held until {dateTimeLabel(project.hold_expires_at)}.</Notice>}
      {project.contract_status === 'pending' && <Notice className="mb-6">The team will send your contract shortly.</Notice>}
      {project.contract_status === 'sent' && <Notice tone="warning" className="mb-6">Your contract is ready. Please sign and return it so we can confirm your booking.</Notice>}
      <div className="grid gap-6 lg:grid-cols-12">
        <Panel className="lg:col-span-7" title="Your timeline">
          {project.milestones.length === 0 ? (
            <p className="text-charcoal/70">Your timeline appears here once your booking is confirmed.</p>
          ) : (
            <ol className="space-y-5">
              {project.milestones.map((m) => (
                <li key={m.id} className="relative pl-7">
                  <span aria-hidden="true" className={cn('absolute top-1 left-0 grid h-5 w-5 place-items-center rounded-full text-[0.7rem]', m.status === 'done' ? 'bg-sage text-ivory' : 'border border-charcoal/30')}>
                    {m.status === 'done' ? '✓' : ''}
                  </span>
                  <p className="font-medium">{m.title}{m.status === 'done' && <span className="sr-only"> (done)</span>}</p>
                  {m.due_on && <p className="text-[0.85rem] text-charcoal/70">{dateLabel(m.due_on, { month: 'long', day: 'numeric', year: 'numeric' })}</p>}
                  {m.description && m.description !== m.title && <p className="mt-1 text-[0.9rem] text-charcoal/75">{m.description}</p>}
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <div className="space-y-6 lg:col-span-5">
          <Panel title="Payments">
            {project.invoices.length === 0 && <p className="text-charcoal/70">Nothing is due yet.</p>}
            <ul className="space-y-4">
              {project.invoices.map((i) => (
                <li key={i.number} className="border-b border-charcoal/10 pb-4 last:border-0 last:pb-0">
                  <div className="flex justify-between gap-3">
                    <p className="capitalize">{i.kind}</p>
                    <p className="tabular-nums">{money(i.total_cents)}</p>
                  </div>
                  <p className="text-[0.85rem] text-charcoal/70">
                    {i.amount_due_cents > 0 ? `${money(i.amount_due_cents)} due${i.due_on ? ` by ${dateLabel(i.due_on, { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}` : 'Paid in full'}
                  </p>
                  {i.pay_token && (
                    <div className="mt-3">
                      <Button to={`/pay/${i.pay_token}`} variant="outline">
                        Pay now
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Details">
            <dl className="space-y-2 text-[0.92rem]">
              {project.venue_name && <div><dt className="inline text-charcoal/70">Venue: </dt><dd className="inline">{project.venue_name}</dd></div>}
              {project.venue_address && <div><dt className="inline text-charcoal/70">Address: </dt><dd className="inline">{project.venue_address}</dd></div>}
              {project.guest_count !== null && <div><dt className="inline text-charcoal/70">Guests: </dt><dd className="inline">{project.guest_count}</dd></div>}
            </dl>
            {project.documents.length > 0 && (
              <ul className="mt-3 space-y-1 text-[0.9rem]">
                {project.documents.map((d) => (
                  <li key={d.id}><a className="underline" href={`/api/public/project/${token}/documents/${d.id}`}>{d.filename}</a></li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </StorePage>
  );
}
