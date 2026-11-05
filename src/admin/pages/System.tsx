import { useState } from 'react';
import { api } from '../../lib/api';
import { dateTimeLabel, statusLabel } from '../../lib/format';
import { useSession } from '../session';
import { Btn, Card, Loader, PageHeader, StatusBadge, useAction, useLoad } from '../ui';
import { cn } from '../../lib/cn';

type Jobs = { jobs: Array<{ id: string; kind: string; status: string; attempts: number; max_attempts: number; run_at: string; last_error: string | null; finished_at: string | null }>; counts: Array<{ status: string; n: number }>; workers: Array<{ worker_id: string; last_seen_at: string; jobs_processed: number }>; pending_events: number };

function JobsTab() {
  const [status, setStatus] = useState('dead');
  const state = useLoad<Jobs>(`/api/admin/system/jobs?status=${status}`);
  const health = useLoad<{ worker_last_seen: string | null; worker_ok: boolean; storage_ok: boolean; env: string; warnings: string[] }>('/api/admin/system/health');
  const { busy, run } = useAction();
  return (
    <div className="space-y-4">
      <Card title="Health">
        <Loader state={health}>
          {(h) => (
            <ul className="space-y-1 text-[0.88rem]">
              <li>Background worker: <StatusBadge status={h.worker_ok ? 'active' : 'failed'} /> {h.worker_last_seen ? `last seen ${dateTimeLabel(h.worker_last_seen)}` : 'has not checked in'}</li>
              <li>File storage: <StatusBadge status={h.storage_ok ? 'active' : 'failed'} /></li>
              <li>Environment: {h.env}</li>
              {h.warnings.map((w) => <li key={w} className="text-rose-deep">{w}</li>)}
            </ul>
          )}
        </Loader>
      </Card>
      <IntegrityCard />
      <Card title="Background jobs">
        <Loader state={state}>
          {(d) => (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-[0.85rem]">
                {['dead', 'queued', 'running', 'succeeded'].map((s) => (
                  <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)} className={cn('rounded-full border px-3 py-1', status === s ? 'border-charcoal bg-charcoal text-ivory' : 'border-charcoal/20')}>
                    {s === 'dead' ? 'Failed' : statusLabel(s)} ({d.counts.find((c) => c.status === s)?.n ?? 0})
                  </button>
                ))}
                <span className="ml-auto text-charcoal/70">{d.pending_events} events waiting</span>
              </div>
              {d.jobs.length === 0 ? (
                <p className="py-4 text-center text-[0.85rem] text-charcoal/70">{status === 'dead' ? 'No failed jobs.' : 'None.'}</p>
              ) : (
                <ul className="divide-y divide-charcoal/8 text-[0.85rem]">
                  {d.jobs.map((j) => (
                    <li key={j.id} className="py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <code className="text-[0.8rem]">{j.kind}</code>
                        <span className="text-charcoal/70">{j.attempts} of {j.max_attempts} attempts</span>
                        <StatusBadge status={j.status} />
                        {j.status === 'dead' && <Btn small disabled={busy} onClick={async () => { await run(() => api(`/api/admin/system/jobs/${j.id}/retry`, { body: {} }), 'Queued to try again.'); void state.reload(); }}>Try again</Btn>}
                      </div>
                      {j.last_error && <p className="mt-1 text-[0.78rem] break-words text-rose-deep">{j.last_error}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Loader>
      </Card>
    </div>
  );
}

function IntegrityCard() {
  const [run, setRun] = useState(0);
  const state = useLoad<{ ok: boolean; checked_at: string; checks: Array<{ id: string; title: string; explanation: string; violations: number }> }>(`/api/admin/system/integrity?run=${run}`);
  return (
    <Card title="Record checks" actions={<Btn small onClick={() => setRun((n) => n + 1)}>Check again</Btn>}>
      <Loader state={state}>
        {(d) => (
          <>
            <p className="mb-2 text-[0.85rem]">{d.ok ? 'All records agree with each other.' : 'Some records disagree. Please look at the items marked below.'} These checks also run automatically every six hours.</p>
            <ul className="space-y-1 text-[0.85rem]">
              {d.checks.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2" title={c.explanation}>
                  <span>{c.title}</span>
                  <StatusBadge status={c.violations === 0 ? 'active' : 'failed'} />
                  {c.violations > 0 && <span className="w-full text-[0.78rem] text-rose-deep">{c.violations} to review. {c.explanation}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </Loader>
    </Card>
  );
}

function WebhooksTab() {
  const state = useLoad<{ webhooks: Array<{ id: string; provider: string; event_id: string; event_type: string; status: string; attempts: number; error: string | null; received_at: string }> }>('/api/admin/system/webhooks');
  return (
    <Card title="Payment events received">
      <Loader state={state}>
        {(d) =>
          d.webhooks.length === 0 ? (
            <p className="py-4 text-center text-[0.85rem] text-charcoal/70">None yet.</p>
          ) : (
            <ul className="divide-y divide-charcoal/8 text-[0.85rem]">
              {d.webhooks.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <code className="text-[0.78rem]">{w.event_type}</code>
                  <span className="text-charcoal/70">{dateTimeLabel(w.received_at)}</span>
                  <StatusBadge status={w.status} />
                  {w.error && <span className="w-full text-[0.78rem] text-rose-deep">{w.error}</span>}
                </li>
              ))}
            </ul>
          )
        }
      </Loader>
    </Card>
  );
}

function AlertsTab() {
  const state = useLoad<{ alerts: Array<{ id: string; severity: string; title: string; detail: string | null; link: string | null; created_at: string }> }>('/api/admin/system/alerts');
  const { busy, run } = useAction();
  return (
    <Card title="Open alerts">
      <Loader state={state}>
        {(d) =>
          d.alerts.length === 0 ? (
            <p className="py-4 text-center text-[0.85rem] text-charcoal/70">All clear.</p>
          ) : (
            <ul className="divide-y divide-charcoal/8 text-[0.86rem]">
              {d.alerts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{a.link ? <a className="hover:underline" href={a.link}>{a.title}</a> : a.title}</p>
                    {a.detail && <p className="text-[0.8rem] text-charcoal/70">{a.detail}</p>}
                    <p className="text-[0.72rem] text-charcoal/70">{dateTimeLabel(a.created_at)}</p>
                  </div>
                  <StatusBadge status={a.severity} />
                  <Btn small disabled={busy} onClick={async () => { await run(() => api(`/api/admin/system/alerts/${a.id}/resolve`, { body: {} })); void state.reload(); }}>Resolve</Btn>
                </li>
              ))}
            </ul>
          )
        }
      </Loader>
    </Card>
  );
}

function AuditTab() {
  const state = useLoad<{ entries: Array<{ id: string; actor_type: string; actor_label: string | null; action: string; subject_type: string | null; created_at: string; ip: string | null; data: unknown }> }>('/api/admin/system/audit');
  return (
    <Card title="Audit log">
      <p className="mb-3 text-[0.8rem] text-charcoal/70">A permanent record of sensitive changes. It cannot be edited or deleted.</p>
      <Loader state={state}>
        {(d) => (
          <ul className="divide-y divide-charcoal/8 text-[0.82rem]">
            {d.entries.map((e) => (
              <li key={e.id} className="py-1.5">
                <div className="flex flex-wrap justify-between gap-2">
                  <code className="text-[0.78rem]">{e.action}</code>
                  <span className="text-charcoal/70">{dateTimeLabel(e.created_at)}</span>
                </div>
                <p className="text-charcoal/70">{e.actor_label ?? e.actor_type}{e.ip ? ` · ${e.ip}` : ''}</p>
              </li>
            ))}
          </ul>
        )}
      </Loader>
    </Card>
  );
}

export default function System() {
  const { can } = useSession();
  const [tab, setTab] = useState('jobs');
  const tabs = [{ key: 'jobs', label: 'Jobs & health' }, { key: 'alerts', label: 'Alerts' }, { key: 'webhooks', label: 'Payment events' }, ...(can('audit.view') ? [{ key: 'audit', label: 'Audit log' }] : [])];
  return (
    <>
      <PageHeader title="System" subtitle="How the automation is doing" />
      <div className="mb-4 flex flex-wrap gap-1" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={cn('rounded-lg px-3 py-1.5 text-[0.86rem]', tab === t.key ? 'bg-charcoal text-ivory' : 'hover:bg-charcoal/5')}>{t.label}</button>
        ))}
      </div>
      {tab === 'jobs' && <JobsTab />}
      {tab === 'alerts' && <AlertsTab />}
      {tab === 'webhooks' && <WebhooksTab />}
      {tab === 'audit' && <AuditTab />}
    </>
  );
}
