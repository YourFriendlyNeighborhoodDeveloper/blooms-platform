import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../../lib/api';
import { dateTimeLabel } from '../../lib/format';
import { cn } from '../../lib/cn';
import { useSession } from '../session';
import { Badge, Btn, Card, Loader, PageHeader, Select, StatusBadge, useAction, useLoad } from '../ui';

type Message = {
  id: string; reference: string; customer_id: string | null; topic: string; name: string; email: string | null; phone_e164: string | null; message: string; status: string; created_at: string;
  priority: 'low' | 'normal' | 'high' | 'urgent'; category: string; source: string | null; acknowledged_at: string | null; acknowledged_by_name: string | null; escalated_at: string | null; due_at: string | null;
  conversation_id: string | null; conversation_reference: string | null; conversation_channel: string | null; sandbox: boolean; assigned_name: string | null;
};

const PRIORITY_TONE: Record<string, string> = { urgent: 'bad', high: 'warn', normal: 'neutral', low: 'neutral' };
const SOURCE: Record<string, string> = { contact_form: 'Website form', flora_chat: 'Flora, website chat', flora_voice: 'Flora, phone call' };

/** Website messages and requests Flora passed on, in one queue. Urgent and time-sensitive ones come first. */
export default function Messages() {
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('');
  const sandbox = params.get('sandbox') === 'only';
  const highlighted = params.get('ticket');
  const state = useLoad<{ messages: Message[] }>(`/api/admin/messages?${new URLSearchParams({ ...(status ? { status } : {}), ...(sandbox ? { sandbox: 'only' } : {}) })}`);
  const { busy, run } = useAction();
  const update = async (id: string, next: string) => {
    const ok = await run(() => api(`/api/admin/messages/${id}`, { method: 'PATCH', body: { status: next } }));
    if (ok !== undefined) void state.reload();
  };
  const acknowledge = async (id: string) => {
    const ok = await run(() => api(`/api/admin/messages/${id}/acknowledge`, { method: 'POST' }), 'Acknowledged');
    if (ok !== undefined) void state.reload();
  };
  return (
    <>
      <PageHeader
        title="Messages"
        subtitle={sandbox ? 'Requests from demonstration conversations. Nobody was notified about these.' : 'Notes from the website, and requests Flora passed on'}
        actions={
          <div className="flex flex-wrap gap-2">
            <label><span className="sr-only">Status</span><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="new">New</option><option value="open">Open</option><option value="closed">Closed</option></Select></label>
            <Btn small onClick={() => setParams(sandbox ? {} : { sandbox: 'only' })}>{sandbox ? 'Show real requests' : 'Show sandbox requests'}</Btn>
          </div>
        }
      />
      <Card>
        <Loader state={state}>
          {(d) =>
            d.messages.length === 0 ? (
              <p className="py-6 text-center text-[0.88rem] text-charcoal/70">No messages.</p>
            ) : (
              <ul className="divide-y divide-charcoal/8">
                {d.messages.map((m) => (
                  <li key={m.id} className={cn('py-3 text-[0.88rem]', highlighted === m.id && 'rounded-lg bg-blush/30 px-3')}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">
                        {m.customer_id ? <Link className="hover:underline" to={`/admin/customers/${m.customer_id}`}>{m.name}</Link> : m.name} <span className="font-normal text-charcoal/70">· {m.topic} · {m.reference}</span>
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {m.priority !== 'normal' && <Badge tone={PRIORITY_TONE[m.priority]}>{m.priority === 'high' ? 'soon' : m.priority}</Badge>}
                        {m.sandbox && <Badge tone="warn">Sandbox</Badge>}
                        <StatusBadge status={m.status} />
                      </div>
                    </div>
                    <p className="mt-1 whitespace-pre-line">{m.message}</p>
                    <p className="mt-1 text-[0.75rem] text-charcoal/70">
                      {dateTimeLabel(m.created_at)} · {SOURCE[m.source ?? ''] ?? m.source ?? 'Website'}
                      {m.conversation_id && (
                        <>
                          {' · '}
                          <Link className="underline" to={`/admin/flora/conversations/${m.conversation_id}`}>
                            {m.conversation_channel === 'voice' ? 'call' : 'chat'} {m.conversation_reference}
                          </Link>
                        </>
                      )}
                      {m.email && <> · <a className="underline" href={`mailto:${m.email}`}>{m.email}</a></>}
                      {m.phone_e164 && <> · <a className="underline" href={`tel:${m.phone_e164}`}>{m.phone_e164}</a></>}
                    </p>
                    <p className="mt-0.5 text-[0.75rem] text-charcoal/70">
                      {m.acknowledged_at ? `Acknowledged ${dateTimeLabel(m.acknowledged_at)}${m.acknowledged_by_name ? ` by ${m.acknowledged_by_name}` : ''}` : m.escalated_at ? `Escalated ${dateTimeLabel(m.escalated_at)}: not yet acknowledged` : m.due_at ? `Escalates ${dateTimeLabel(m.due_at)} unless acknowledged` : null}
                    </p>
                    {can('customers.manage') && m.status !== 'closed' && (
                      <div className="mt-2 flex gap-2">
                        {!m.acknowledged_at && <Btn small tone="primary" disabled={busy} onClick={() => acknowledge(m.id)}>Acknowledge</Btn>}
                        {m.status === 'new' && m.acknowledged_at && <Btn small disabled={busy} onClick={() => update(m.id, 'open')}>Mark as open</Btn>}
                        <Btn small disabled={busy} onClick={() => update(m.id, 'closed')}>Close</Btn>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )
          }
        </Loader>
      </Card>
    </>
  );
}
