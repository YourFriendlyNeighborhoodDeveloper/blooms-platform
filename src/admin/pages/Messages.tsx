import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { dateTimeLabel } from '../../lib/format';
import { useSession } from '../session';
import { Btn, Card, Loader, PageHeader, Select, StatusBadge, useAction, useLoad } from '../ui';

type Message = { id: string; reference: string; customer_id: string | null; topic: string; name: string; email: string; phone_e164: string | null; message: string; status: string; created_at: string };

export default function Messages() {
  const { can } = useSession();
  const [status, setStatus] = useState('');
  const state = useLoad<{ messages: Message[] }>(`/api/admin/messages${status ? `?status=${status}` : ''}`);
  const { busy, run } = useAction();
  const update = async (id: string, next: string) => {
    const ok = await run(() => api(`/api/admin/messages/${id}`, { method: 'PATCH', body: { status: next } }));
    if (ok !== undefined) void state.reload();
  };
  return (
    <>
      <PageHeader title="Messages" subtitle="Notes sent through the website" actions={<label><span className="sr-only">Status</span><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="new">New</option><option value="open">Open</option><option value="closed">Closed</option></Select></label>} />
      <Card>
        <Loader state={state}>
          {(d) =>
            d.messages.length === 0 ? (
              <p className="py-6 text-center text-[0.88rem] text-charcoal/70">No messages.</p>
            ) : (
              <ul className="divide-y divide-charcoal/8">
                {d.messages.map((m) => (
                  <li key={m.id} className="py-3 text-[0.88rem]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{m.customer_id ? <Link className="hover:underline" to={`/admin/customers/${m.customer_id}`}>{m.name}</Link> : m.name} <span className="font-normal text-charcoal/70">· {m.topic}</span></p>
                      <StatusBadge status={m.status} />
                    </div>
                    <p className="mt-1 whitespace-pre-line">{m.message}</p>
                    <p className="mt-1 text-[0.75rem] text-charcoal/70">{dateTimeLabel(m.created_at)} · <a className="underline" href={`mailto:${m.email}`}>{m.email}</a>{m.phone_e164 && <> · <a className="underline" href={`tel:${m.phone_e164}`}>{m.phone_e164}</a></>}</p>
                    {can('customers.manage') && m.status !== 'closed' && (
                      <div className="mt-2 flex gap-2">
                        {m.status === 'new' && <Btn small disabled={busy} onClick={() => update(m.id, 'open')}>Mark as open</Btn>}
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
