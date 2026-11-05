import { Link } from 'react-router';
import { api } from '../../lib/api';
import { useSession } from '../session';
import { Badge, Btn, Card, Loader, PageHeader, useAction, useLoad } from '../ui';

type Check = { id: string; group: string; title: string; status: 'ok' | 'todo' | 'blocker' | 'optional'; detail: string; link?: string };
type Data = { checks: Check[]; ready_for_live: boolean; warnings: string[] };

const TONE: Record<Check['status'], { tone: string; label: string }> = {
  ok: { tone: 'good', label: 'Done' },
  todo: { tone: 'warn', label: 'To do' },
  blocker: { tone: 'bad', label: 'Needed' },
  optional: { tone: 'neutral', label: 'Optional' },
};

export default function Setup() {
  const state = useLoad<Data>('/api/admin/readiness');
  const { user } = useSession();
  const { busy, run } = useAction();
  return (
    <>
      <PageHeader title="Launch checklist" subtitle="What has to be true before accepting real customers. Nothing here goes live by itself." />
      <Loader state={state}>
        {(d) => {
          const groups = [...new Set(d.checks.map((c) => c.group))];
          const needed = d.checks.filter((c) => c.status === 'blocker').length;
          return (
            <div className="space-y-4">
              <Card className={d.ready_for_live ? 'border-sage/50' : 'border-rose-deep/30'}>
                <p className="font-display text-[1.4rem] leading-tight">{d.ready_for_live ? 'Every required item is done.' : `${needed} ${needed === 1 ? 'item is' : 'items are'} still needed before going live.`}</p>
                {d.ready_for_live && <p className="mt-1 text-[0.88rem] text-charcoal/70">Going live is still a deliberate decision, made in the server configuration. See docs/operations.md.</p>}
              </Card>
              {d.warnings.length > 0 && (
                <Card title="Check these combinations" className="border-gold/60">
                  <ul className="list-disc pl-5 text-[0.88rem]">
                    {d.warnings.map((w) => <li key={w}>{w}</li>)}
                  </ul>
                </Card>
              )}
              {groups.map((g) => (
                <Card key={g} title={g}>
                  <ul className="divide-y divide-charcoal/8">
                    {d.checks.filter((c) => c.group === g).map((c) => (
                      <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 py-2 text-[0.88rem]" data-testid={`check-${c.id}`}>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{c.link ? <Link className="hover:underline" to={c.link}>{c.title}</Link> : c.title}</p>
                          <p className="text-[0.8rem] text-charcoal/70">{c.detail}</p>
                        </div>
                        {c.id === 'backups' && user?.roles.includes('owner') && <Btn small disabled={busy} onClick={async () => { const ok = await run(() => api('/api/admin/readiness/backups', { body: {} }), 'Recorded.'); if (ok !== undefined) void state.reload(); }}>I tested a restore today</Btn>}
                        <Badge tone={TONE[c.status].tone}>{TONE[c.status].label}</Badge>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          );
        }}
      </Loader>
    </>
  );
}
