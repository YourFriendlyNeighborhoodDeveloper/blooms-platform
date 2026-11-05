import { useState } from 'react';
import { api } from '../../lib/api';
import { dateTimeLabel } from '../../lib/format';
import { useSession } from '../session';
import { Badge, Btn, Card, Field, Input, Loader, PageHeader, useAction, useLoad } from '../ui';

type Session = { id: string; ip: string | null; user_agent: string | null; created_at: string; last_seen_at: string; current: boolean };

export default function MyAccount() {
  const { user, can } = useSession();
  const sessions = useLoad<{ sessions: Session[] }>('/api/admin/auth/sessions');
  const { busy, run } = useAction();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [feed, setFeed] = useState<string | null>(null);
  return (
    <>
      <PageHeader title="Your account" subtitle={user?.email} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Change your password">
          <div className="space-y-3">
            <Field label="Current password"><Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
            <Field label="New password" hint="At least 12 characters. Other devices are signed out."><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
            <Btn tone="primary" disabled={busy || !current || !next} onClick={async () => { const ok = await run(() => api('/api/admin/auth/change-password', { body: { current_password: current, new_password: next } }), 'Password changed.'); if (ok !== undefined) { setCurrent(''); setNext(''); void sessions.reload(); } }}>Change password</Btn>
          </div>
        </Card>
        <Card title="Where you are signed in">
          <Loader state={sessions}>
            {(d) => (
              <ul className="divide-y divide-charcoal/8 text-[0.85rem]">
                {d.sessions.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{s.user_agent ?? 'Unknown device'}</p>
                      <p className="text-[0.75rem] text-charcoal/70">Last active {dateTimeLabel(s.last_seen_at)}{s.ip ? ` · ${s.ip}` : ''}</p>
                    </div>
                    {s.current ? <Badge tone="good">this device</Badge> : <Btn small disabled={busy} onClick={async () => { await run(() => api(`/api/admin/auth/sessions/${s.id}`, { method: 'DELETE' }), 'Signed out.'); void sessions.reload(); }}>Sign out</Btn>}
                  </li>
                ))}
              </ul>
            )}
          </Loader>
        </Card>
        {can('calendar.view') && (
          <Card title="Your calendar feed">
            <p className="mb-3 text-[0.85rem] text-charcoal/70">Subscribe from Google, Apple or Outlook calendar to see your schedule there. It is read-only, so an edit in your calendar app can never change a booking. Treat the link like a password.</p>
            {feed ? <Input readOnly aria-label="Calendar feed link" value={feed} onFocus={(e) => e.target.select()} /> : <Btn disabled={busy} onClick={async () => { const res = await run(() => api<{ url: string }>('/api/admin/calendar/feed-link', { body: {} })); if (res) setFeed(res.url); }}>Create my link</Btn>}
          </Card>
        )}
      </div>
    </>
  );
}
