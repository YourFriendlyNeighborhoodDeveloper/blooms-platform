import { Link, useParams } from 'react-router';
import { dateTimeLabel } from '../../lib/format';
import { cn } from '../../lib/cn';
import { Badge, Card, Loader, PageHeader, StatusBadge, useLoad } from '../ui';

type Message = { id: string; role: 'customer' | 'assistant' | 'tool' | 'event'; content: string | null; tool_name: string | null; tool_args: unknown; tool_result: unknown; refused: boolean; created_at: string };
type Detail = {
  conversation: { id: string; reference: string; channel: 'chat' | 'voice'; mode: 'demo' | 'customer'; status: string; model: string | null; started_at: string; ended_at: string | null; end_reason: string | null; outcome: string | null; turns: number; tool_calls: number; call_seconds: number | null; input_tokens: string; output_tokens: string; audio_input_tokens: string; audio_output_tokens: string; est_cost_dollars: number; caller_phone_e164: string | null; texts_sent: number; transcript_purged_at: string | null; converted_inquiry_id: string | null };
  messages: Message[];
  drafts: Array<{ id: string; reference: string; sandbox: boolean; status: string; contact_name: string | null; contact_email: string | null; link_channel: string | null; inquiry_id: string | null; submitted_at: string | null }>;
  tickets: Array<{ id: string; reference: string; topic: string; priority: string; category: string; status: string; acknowledged_at: string | null; escalated_at: string | null; sandbox: boolean }>;
  verifications: Array<{ reference: string; verified_at: string | null; failures: number; created_at: string }>;
};

const phone = (e164: string | null) => (e164 ? e164.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3') : 'hidden or none');

/** One conversation as it happened: what was said, every tool Flora asked for, and what the server allowed. */
export default function ConciergeConversation() {
  const { id = '' } = useParams();
  const state = useLoad<Detail>(`/api/admin/concierge/conversations/${id}`);
  return (
    <Loader state={state}>
      {(d) => {
        const c = d.conversation;
        return (
          <>
            <PageHeader title={`${c.channel === 'voice' ? 'Call' : 'Chat'} ${c.reference}`} subtitle={`${dateTimeLabel(c.started_at)} · ${c.mode === 'demo' ? 'Sandbox (demonstration)' : 'Customer'}`} back={{ to: '/admin/flora?tab=conversations', label: 'Conversations' }} />
            <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Card title="Transcript">
                {c.transcript_purged_at && <p className="mb-3 text-[0.82rem] text-charcoal/70">The words were removed on {dateTimeLabel(c.transcript_purged_at)} under the retention setting. The record of actions remains.</p>}
                <ol className="space-y-3">
                  {d.messages.map((m) => (
                    <li key={m.id} className={cn('flex flex-col', m.role === 'customer' ? 'items-end' : 'items-start')}>
                      {m.role === 'tool' ? (
                        <details className={cn('w-full rounded-xl border px-3 py-2 text-[0.8rem]', m.refused ? 'border-rose-deep/40 bg-rose-deep/5' : 'border-charcoal/12 bg-charcoal/[0.03]')}>
                          <summary className="cursor-pointer">
                            <span className="font-mono">{m.tool_name}</span> {m.refused && <Badge tone="bad">Refused by the server</Badge>}
                          </summary>
                          <pre className="mt-2 overflow-x-auto text-[0.75rem] whitespace-pre-wrap">{JSON.stringify({ asked_for: m.tool_args, result: m.tool_result }, null, 2)}</pre>
                        </details>
                      ) : m.role === 'event' ? (
                        <p className="w-full text-center text-[0.75rem] text-charcoal/70">{m.content}</p>
                      ) : (
                        <>
                          <span className="mb-0.5 text-[0.7rem] text-charcoal/70">{m.role === 'customer' ? (c.channel === 'voice' ? 'Caller' : 'Visitor') : 'Flora'} · {dateTimeLabel(m.created_at)}</span>
                          <p className={cn('max-w-[85%] rounded-2xl px-3.5 py-2 text-[0.88rem] whitespace-pre-line', m.role === 'customer' ? 'bg-charcoal text-ivory' : 'bg-blush/40')}>{m.content ?? '(removed)'}</p>
                        </>
                      )}
                    </li>
                  ))}
                </ol>
              </Card>
              <div className="space-y-4">
                <Card title="Summary">
                  <dl className="space-y-1.5 text-[0.85rem]">
                    <div className="flex justify-between gap-3"><dt className="text-charcoal/70">Status</dt><dd><StatusBadge status={c.status} /></dd></div>
                    {c.end_reason && <div className="flex justify-between gap-3"><dt className="text-charcoal/70">Ended</dt><dd>{c.end_reason.replace(/_/g, ' ')}</dd></div>}
                    {c.channel === 'voice' && <div className="flex justify-between gap-3"><dt className="text-charcoal/70">Caller ID</dt><dd>{phone(c.caller_phone_e164)}</dd></div>}
                    {c.call_seconds !== null && <div className="flex justify-between gap-3"><dt className="text-charcoal/70">Length</dt><dd>{Math.floor(c.call_seconds / 60)} min {c.call_seconds % 60} s</dd></div>}
                    <div className="flex justify-between gap-3"><dt className="text-charcoal/70">Model</dt><dd>{c.model}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-charcoal/70">Turns · tools</dt><dd>{c.turns} · {c.tool_calls}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-charcoal/70">Tokens in · out</dt><dd className="tabular-nums">{Number(c.input_tokens).toLocaleString()} · {Number(c.output_tokens).toLocaleString()}</dd></div>
                    {c.channel === 'voice' && <div className="flex justify-between gap-3"><dt className="text-charcoal/70">Audio tokens in · out</dt><dd className="tabular-nums">{Number(c.audio_input_tokens).toLocaleString()} · {Number(c.audio_output_tokens).toLocaleString()}</dd></div>}
                    <div className="flex justify-between gap-3"><dt className="text-charcoal/70">Estimated cost</dt><dd>${c.est_cost_dollars.toFixed(2)}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-charcoal/70">Texts sent</dt><dd>{c.texts_sent}</dd></div>
                  </dl>
                </Card>
                {d.drafts.map((p) => (
                  <Card key={p.id} title={`Plan ${p.reference}`}>
                    <p className="text-[0.85rem]">{p.sandbox ? <Badge tone="warn">Sandbox</Badge> : <Badge tone="good">Customer</Badge>} {p.status === 'submitted' ? `Sent ${p.submitted_at ? dateTimeLabel(p.submitted_at) : ''}` : 'Saved, not yet sent'}</p>
                    <p className="mt-1 text-[0.82rem] text-charcoal/70">{p.contact_name ?? 'No name yet'}{p.contact_email ? ` · ${p.contact_email}` : ''}{p.link_channel ? ` · link given by ${p.link_channel === 'code' ? 'six-digit code' : p.link_channel}` : ''}</p>
                    {p.inquiry_id && <Link className="mt-2 inline-block text-[0.85rem] underline" to={`/admin/weddings/${p.inquiry_id}`}>Open the inquiry</Link>}
                  </Card>
                ))}
                {c.converted_inquiry_id && (
                  <Card title="Real request">
                    <p className="text-[0.85rem]">The caller asked for a real consultation. Only the details they confirmed were sent.</p>
                    <Link className="mt-2 inline-block text-[0.85rem] underline" to={`/admin/weddings/${c.converted_inquiry_id}`}>Open the inquiry</Link>
                  </Card>
                )}
                {d.tickets.length > 0 && (
                  <Card title="Requests for the team">
                    <ul className="space-y-2 text-[0.85rem]">
                      {d.tickets.map((t) => (
                        <li key={t.id}>
                          <Link className="font-medium hover:underline" to={`/admin/messages${t.sandbox ? '?sandbox=only' : ''}`}>{t.reference}</Link> · {t.topic} · <Badge tone={t.priority === 'urgent' ? 'bad' : t.priority === 'high' ? 'warn' : 'neutral'}>{t.priority}</Badge> {t.sandbox && <Badge tone="warn">Sandbox</Badge>}
                          <p className="text-[0.78rem] text-charcoal/70">{t.acknowledged_at ? `Acknowledged ${dateTimeLabel(t.acknowledged_at)}` : t.escalated_at ? `Escalated ${dateTimeLabel(t.escalated_at)}` : 'Not yet acknowledged'}</p>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
                {d.verifications.length > 0 && (
                  <Card title="Identity checks">
                    <ul className="space-y-1 text-[0.85rem]">
                      {d.verifications.map((v, i) => (
                        <li key={i}>{v.reference}: {v.verified_at ? `verified ${dateTimeLabel(v.verified_at)}` : `not verified${v.failures ? `, ${v.failures} wrong codes` : ''}`}</li>
                      ))}
                    </ul>
                  </Card>
                )}
              </div>
            </div>
          </>
        );
      }}
    </Loader>
  );
}
