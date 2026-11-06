import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../../lib/api';
import { dateLabel, dateTimeLabel } from '../../lib/format';
import { cn } from '../../lib/cn';
import { useSession } from '../session';
import { Badge, Btn, Card, Checkbox, Field, Input, Loader, PageHeader, Select, Stat, Table, Textarea, useAction, useLoad } from '../ui';

type Overview = {
  month: string; spent_dollars: number; budget_dollars: number; prices_checked_on: string; provider: string;
  models: Record<'chat' | 'voice' | 'transcription', { model: string; priced: boolean }>;
  channels: { chat: { enabled: boolean; mode: string; available: boolean; reason: string | null }; voice: { enabled: boolean; mode: string; available: boolean; reason: string | null; number: string | null; line_configured: boolean } };
  texting: { available: boolean; note: string | null };
  activity: Array<{ channel: string; mode: string; conversations: number; drafts: number; calls_minutes: number }>;
  open_requests: Record<string, number>;
};
type Conversation = { id: string; reference: string; channel: 'chat' | 'voice'; mode: 'demo' | 'customer'; status: string; started_at: string; ended_at: string | null; end_reason: string | null; outcome: string | null; turns: number; tool_calls: number; call_seconds: number | null; est_cost_dollars: number; texts_sent: number; caller_phone_e164: string | null; draft_reference: string | null; draft_status: string | null };
type SandboxDraft = { id: string; reference: string; status: string; data: { event_type?: string; event_date?: string; venue_name?: string; guest_count?: number }; contact_name: string | null; contact_email: string | null; contact_phone_e164: string | null; preferred_consultation_at: string | null; link_channel: string | null; sandbox_result: { availability?: { status: string; summary: string } } | null; submitted_at: string | null; created_at: string; conversation_id: string | null; conversation_reference: string | null; channel: string | null };
type Entry = { id: string; title: string; body: string; keywords: string; published: boolean; is_demo: boolean; updated_at: string };

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'conversations', label: 'Conversations' },
  { key: 'sandbox', label: 'Sandbox' },
  { key: 'knowledge', label: 'Knowledge' },
] as const;

const usd = (n: number) => `$${n.toFixed(2)}`;
const phone = (e164: string | null) => (e164 ? e164.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3') : '—');
const ModeBadge = ({ mode }: { mode: string }) => <Badge tone={mode === 'demo' ? 'warn' : 'good'}>{mode === 'demo' ? 'Sandbox' : 'Customer'}</Badge>;

function OverviewTab() {
  const state = useLoad<Overview>('/api/admin/concierge/overview');
  return (
    <Loader state={state}>
      {(d) => {
        const pct = d.budget_dollars > 0 ? Math.min(100, Math.round((d.spent_dollars / d.budget_dollars) * 100)) : 0;
        const totals = d.activity.reduce((t, a) => ({ conversations: t.conversations + a.conversations, drafts: t.drafts + a.drafts, minutes: t.minutes + a.calls_minutes }), { conversations: 0, drafts: 0, minutes: 0 });
        return (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label={`Estimated spend, ${d.month}`} value={`${usd(d.spent_dollars)} of ${usd(d.budget_dollars)}`} hint={d.budget_dollars > 0 ? `${pct}% of the monthly budget` : 'No budget set: Flora stays off'} tone={pct >= 90 ? 'attention' : undefined} />
              <Stat label="Conversations this month" value={totals.conversations} hint={`${totals.minutes} phone minutes`} />
              <Stat label="Plans saved" value={totals.drafts} />
              <Stat label="Open requests from Flora" value={Object.values(d.open_requests).reduce((a, b) => a + b, 0)} hint={d.open_requests.urgent ? `${d.open_requests.urgent} urgent` : undefined} to="/admin/messages" tone={d.open_requests.urgent ? 'attention' : undefined} />
            </div>
            {d.budget_dollars > 0 && (
              <div className="h-2 overflow-hidden rounded-full bg-charcoal/8" role="img" aria-label={`${pct} percent of the monthly budget used`}>
                <div className={cn('h-full rounded-full', pct >= 90 ? 'bg-rose-deep' : 'bg-charcoal/70')} style={{ width: `${pct}%` }} />
              </div>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Website chat">
                <dl className="space-y-1.5 text-[0.88rem]">
                  <div className="flex justify-between gap-3"><dt className="text-charcoal/70">Status</dt><dd>{d.channels.chat.available ? <Badge tone="good">Answering</Badge> : <Badge>{d.channels.chat.reason ?? 'Off'}</Badge>}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-charcoal/70">Mode</dt><dd><ModeBadge mode={d.channels.chat.mode} /></dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-charcoal/70">Model</dt><dd>{d.models.chat.model}{!d.models.chat.priced && ' (priced conservatively)'}</dd></div>
                </dl>
              </Card>
              <Card title="Phone line">
                <dl className="space-y-1.5 text-[0.88rem]">
                  <div className="flex justify-between gap-3"><dt className="text-charcoal/70">Status</dt><dd>{d.channels.voice.available ? <Badge tone="good">Answering</Badge> : <Badge>{d.channels.voice.reason ?? 'Off'}</Badge>}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-charcoal/70">Mode</dt><dd><ModeBadge mode={d.channels.voice.mode} /></dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-charcoal/70">Number</dt><dd>{d.channels.voice.line_configured ? phone(d.channels.voice.number) : 'Not configured'}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-charcoal/70">Model</dt><dd>{d.models.voice.model}, transcripts by {d.models.transcription.model}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-charcoal/70">Texting links</dt><dd>{d.texting.available ? <Badge tone="good">On</Badge> : <Badge tone="warn">Off</Badge>}</dd></div>
                </dl>
                {d.texting.note && <p className="mt-3 text-[0.8rem] text-charcoal/70">{d.texting.note}</p>}
              </Card>
            </div>
            <p className="text-[0.8rem] text-charcoal/70">
              Provider: {d.provider === 'openai' ? 'OpenAI API' : d.provider === 'mock' ? 'simulated (no AI model connected)' : 'none'}. Costs are estimates from published rates checked on {dateLabel(d.prices_checked_on)}, including Twilio call minutes. The provider's own invoice is the real figure. Change the budget, limits, models and greetings under <Link className="underline" to="/admin/settings?tab=concierge">Settings → Flora</Link>.
            </p>
          </div>
        );
      }}
    </Loader>
  );
}

function ConversationsTab() {
  const [mode, setMode] = useState('');
  const [channel, setChannel] = useState('');
  const state = useLoad<{ conversations: Conversation[] }>(`/api/admin/concierge/conversations?${new URLSearchParams({ ...(mode ? { mode } : {}), ...(channel ? { channel } : {}) })}`);
  return (
    <Card
      actions={
        <div className="flex gap-2">
          <label><span className="sr-only">Mode</span><Select value={mode} onChange={(e) => setMode(e.target.value)}><option value="">All modes</option><option value="demo">Sandbox</option><option value="customer">Customer</option></Select></label>
          <label><span className="sr-only">Channel</span><Select value={channel} onChange={(e) => setChannel(e.target.value)}><option value="">Chat and phone</option><option value="chat">Chat</option><option value="voice">Phone</option></Select></label>
        </div>
      }
    >
      <Loader state={state}>
        {(d) => (
          <Table
            caption="Flora conversations"
            rows={d.conversations}
            rowKey={(r) => r.id}
            empty="No conversations yet."
            columns={[
              { key: 'ref', label: 'Conversation', render: (r) => <Link className="font-medium hover:underline" to={`/admin/flora/conversations/${r.id}`}>{r.reference}</Link> },
              { key: 'when', label: 'Started', render: (r) => dateTimeLabel(r.started_at) },
              { key: 'channel', label: 'Channel', render: (r) => (r.channel === 'voice' ? `Phone${r.call_seconds ? `, ${Math.ceil(r.call_seconds / 60)} min` : ''}` : 'Chat') },
              { key: 'mode', label: 'Mode', render: (r) => <ModeBadge mode={r.mode} /> },
              { key: 'outcome', label: 'Outcome', render: (r) => (r.draft_reference ? `Plan ${r.draft_reference} (${r.draft_status})` : (r.outcome ?? r.status).replace(/_/g, ' ')) },
              { key: 'turns', label: 'Turns', align: 'right', render: (r) => r.turns },
              { key: 'cost', label: 'Est. cost', align: 'right', render: (r) => usd(r.est_cost_dollars) },
            ]}
          />
        )}
      </Loader>
    </Card>
  );
}

function SandboxTab() {
  const { can } = useSession();
  const state = useLoad<{ drafts: SandboxDraft[] }>('/api/admin/concierge/sandbox');
  const { busy, run } = useAction();
  const clear = async () => {
    if (!window.confirm('Delete every sandbox conversation, plan and request? Customer records are not touched.')) return;
    const ok = await run(() => api('/api/admin/concierge/sandbox', { method: 'DELETE' }), 'Sandbox cleared');
    if (ok !== undefined) void state.reload();
  };
  return (
    <Card title="Demonstration sandbox" actions={can('concierge.manage') ? <Btn small disabled={busy} onClick={clear}>Clear sandbox</Btn> : undefined}>
      <p className="mb-4 text-[0.85rem] text-charcoal/70">Plans saved by callers and visitors in demonstration mode, with fictional data. They never enter the wedding pipeline, and nobody is notified about them.</p>
      <Loader state={state}>
        {(d) => (
          <Table
            caption="Sandbox plans"
            rows={d.drafts}
            rowKey={(r) => r.id}
            empty="Nothing in the sandbox."
            columns={[
              { key: 'ref', label: 'Plan', render: (r) => <span className="font-medium">{r.reference}</span> },
              { key: 'who', label: 'Name', render: (r) => r.contact_name ?? '—' },
              { key: 'event', label: 'Event', render: (r) => `${r.data.event_type ?? 'Event'}${r.data.event_date ? `, ${dateLabel(r.data.event_date)}` : ''}${r.data.guest_count ? `, ${r.data.guest_count} guests` : ''}` },
              { key: 'venue', label: 'Venue', render: (r) => r.data.venue_name ?? '—' },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'submitted' ? 'good' : 'neutral'}>{r.status === 'submitted' ? 'Sent by customer' : 'Saved by Flora'}</Badge> },
              { key: 'date', label: 'Date check', render: (r) => r.sandbox_result?.availability?.summary ?? '—' },
              { key: 'from', label: 'From', render: (r) => (r.conversation_id ? <Link className="hover:underline" to={`/admin/flora/conversations/${r.conversation_id}`}>{r.channel === 'voice' ? 'Call' : 'Chat'} {r.conversation_reference}</Link> : '—') },
            ]}
          />
        )}
      </Loader>
    </Card>
  );
}

function KnowledgeTab() {
  const { can } = useSession();
  const state = useLoad<{ entries: Entry[] }>('/api/admin/concierge/knowledge');
  const { busy, run } = useAction();
  const [editing, setEditing] = useState<Partial<Entry> | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const body = { title: editing.title ?? '', body: editing.body ?? '', keywords: editing.keywords ?? '', published: editing.published ?? false };
    const ok = await run(() => (editing.id ? api(`/api/admin/concierge/knowledge/${editing.id}`, { method: 'PATCH', body }) : api('/api/admin/concierge/knowledge', { body })), 'Saved');
    if (ok !== undefined) {
      setEditing(null);
      void state.reload();
    }
  };
  const remove = async (id: string) => {
    if (!window.confirm('Delete this entry?')) return;
    const ok = await run(() => api(`/api/admin/concierge/knowledge/${id}`, { method: 'DELETE' }), 'Deleted');
    if (ok !== undefined) void state.reload();
  };
  return (
    <div className="space-y-4">
      <Card title="What Flora knows" actions={can('concierge.manage') && !editing ? <Btn small tone="primary" onClick={() => setEditing({ published: false })}>Add an answer</Btn> : undefined}>
        <p className="mb-4 text-[0.85rem] text-charcoal/70">Flora states business facts only from your settings, your catalog and these answers. Write them the way you would say them. An answer is used only once it is published.</p>
        {editing && (
          <form onSubmit={save} className="mb-6 space-y-4 rounded-xl border border-charcoal/12 p-4">
            <Field label="Question or topic" required><Input value={editing.title ?? ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} maxLength={160} /></Field>
            <Field label="Answer" required><Textarea rows={5} value={editing.body ?? ''} onChange={(e) => setEditing({ ...editing, body: e.target.value })} maxLength={4000} /></Field>
            <Field label="Other words people might use" hint="Optional, separated by spaces."><Input value={editing.keywords ?? ''} onChange={(e) => setEditing({ ...editing, keywords: e.target.value })} maxLength={400} /></Field>
            <Checkbox label="Published: Flora may use this answer" checked={editing.published ?? false} onChange={(v) => setEditing({ ...editing, published: v })} />
            <div className="flex gap-2">
              <Btn tone="primary" disabled={busy}>Save</Btn>
              <Btn type="button" onClick={() => setEditing(null)}>Cancel</Btn>
            </div>
          </form>
        )}
        <Loader state={state}>
          {(d) =>
            d.entries.length === 0 ? (
              <p className="py-6 text-center text-[0.88rem] text-charcoal/70">No answers yet.</p>
            ) : (
              <ul className="divide-y divide-charcoal/8">
                {d.entries.map((k) => (
                  <li key={k.id} className="py-3 text-[0.88rem]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{k.title}</p>
                      <div className="flex items-center gap-2">
                        {k.is_demo && <Badge tone="warn">Demo</Badge>}
                        <Badge tone={k.published ? 'good' : 'neutral'}>{k.published ? 'Published' : 'Draft'}</Badge>
                      </div>
                    </div>
                    <p className="mt-1 whitespace-pre-line text-charcoal/80">{k.body}</p>
                    {can('concierge.manage') && (
                      <div className="mt-2 flex gap-2">
                        <Btn small onClick={() => setEditing(k)}>Edit</Btn>
                        <Btn small disabled={busy} onClick={() => remove(k.id)}>Delete</Btn>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )
          }
        </Loader>
      </Card>
    </div>
  );
}

export default function Concierge() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === params.get('tab'))?.key ?? 'overview') as (typeof TABS)[number]['key'];
  return (
    <>
      <PageHeader title="Flora" subtitle="The AI concierge on the website and the phone" />
      <div role="tablist" aria-label="Flora sections" className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setParams(t.key === 'overview' ? {} : { tab: t.key })} className={cn('rounded-full px-4 py-1.5 text-[0.85rem] transition-colors', tab === t.key ? 'bg-charcoal text-ivory' : 'border border-charcoal/20 hover:border-charcoal/50')}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <OverviewTab />}
      {tab === 'conversations' && <ConversationsTab />}
      {tab === 'sandbox' && <SandboxTab />}
      {tab === 'knowledge' && <KnowledgeTab />}
    </>
  );
}
