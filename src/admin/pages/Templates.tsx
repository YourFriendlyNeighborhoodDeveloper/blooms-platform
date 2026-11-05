import { useState } from 'react';
import { api } from '../../lib/api';
import { dateTimeLabel } from '../../lib/format';
import { Badge, Btn, Card, Checkbox, Field, Input, Loader, Modal, PageHeader, StatusBadge, Textarea, useAction, useLoad } from '../ui';

type Template = { id: string; code: string; channel: string; audience: string; category: string; name: string; subject: string | null; body: string; enabled: boolean };
type Rule = { id: string; event_type: string; action: string; config: { template?: string; roles?: string[] }; enabled: boolean; system: boolean };
type Data = { templates: Template[]; variables: string[]; rules: Rule[] };

export default function Templates() {
  const state = useLoad<Data>('/api/admin/templates');
  const log = useLoad<{ notifications: Array<{ id: string; template_code: string; channel: string; recipient: string; subject: string | null; status: string; status_reason: string | null; created_at: string }> }>('/api/admin/notifications?limit=50');
  const { busy, run } = useAction();
  const [editing, setEditing] = useState<Template | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [preview, setPreview] = useState<{ subject: string; text: string; segments: number | null } | null>(null);
  const [filter, setFilter] = useState('');

  const open = (t: Template) => {
    setEditing(t);
    setSubject(t.subject ?? '');
    setBody(t.body);
    setEnabled(t.enabled);
    setPreview(null);
  };

  return (
    <>
      <PageHeader title="Messages & rules" subtitle="What gets sent, when, and exactly what it says." />
      <Loader state={state}>
        {(d) => {
          const shown = d.templates.filter((t) => !filter || t.name.toLowerCase().includes(filter.toLowerCase()) || t.code.includes(filter.toLowerCase()));
          return (
            <div className="space-y-4">
              <Card title="Message templates">
                <label className="mb-3 block"><span className="sr-only">Filter templates</span><Input type="search" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
                <ul className="divide-y divide-charcoal/8 text-[0.86rem]">
                  {shown.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <div>
                        <p className="font-medium">{t.name} {!t.enabled && <Badge>off</Badge>} {t.category === 'marketing' && <Badge tone="info">marketing</Badge>}</p>
                        <p className="text-[0.72rem] text-charcoal/70">{t.channel} · to {t.audience} · {t.code}</p>
                      </div>
                      <Btn small onClick={() => open(t)}>Edit</Btn>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card title="When messages go out">
                <p className="mb-3 text-[0.82rem] text-charcoal/70">Each row sends a message when something happens. Switch off any you do not want. Marketing messages also require the customer's consent.</p>
                <ul className="divide-y divide-charcoal/8 text-[0.85rem]">
                  {d.rules.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <span><code className="text-[0.78rem]">{r.event_type}</code> sends <strong>{d.templates.find((t) => t.code === r.config.template)?.name ?? r.config.template}</strong> to {r.action === 'notify_customer' ? 'the customer' : `staff (${(r.config.roles ?? []).join(', ')})`}</span>
                      <Checkbox label="On" checked={r.enabled} onChange={async (v) => { await run(() => api(`/api/admin/rules/${r.id}`, { method: 'PATCH', body: { enabled: v } })); void state.reload(); }} />
                    </li>
                  ))}
                </ul>
              </Card>
              <Card title="Recently sent">
                <Loader state={log}>
                  {(l) =>
                    l.notifications.length === 0 ? (
                      <p className="text-[0.85rem] text-charcoal/70">Nothing yet.</p>
                    ) : (
                      <ul className="divide-y divide-charcoal/8 text-[0.82rem]">
                        {l.notifications.map((n) => (
                          <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                            <span className="min-w-0 flex-1 truncate">{n.subject ?? n.template_code} <span className="text-charcoal/70">to {n.recipient}</span></span>
                            <span className="text-charcoal/70">{dateTimeLabel(n.created_at)}</span>
                            <StatusBadge status={n.status} />
                            {n.status_reason && <span className="w-full text-[0.72rem] text-charcoal/70">{n.status_reason}</span>}
                          </li>
                        ))}
                      </ul>
                    )
                  }
                </Loader>
              </Card>
            </div>
          );
        }}
      </Loader>
      <Modal title={editing?.name ?? ''} open={Boolean(editing)} onClose={() => setEditing(null)} wide>
        {editing && (
          <div className="space-y-3">
            {editing.channel === 'email' && <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>}
            <Field label="Message" hint={editing.channel === 'sms' ? 'Keep the business name and the STOP wording. Carriers require them.' : undefined}><Textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
            <details className="text-[0.8rem]">
              <summary className="cursor-pointer">Placeholders you can use</summary>
              <p className="mt-1 text-charcoal/70">{state.data?.variables.map((v) => `{{${v}}}`).join('  ')}</p>
            </details>
            <Checkbox label="Send this message" checked={enabled} onChange={setEnabled} />
            {preview && (
              <div className="rounded-lg border border-charcoal/15 bg-ivory-deep/40 p-3 text-[0.85rem]">
                <p className="eyebrow text-charcoal/70">Preview with sample data</p>
                {preview.subject && <p className="mt-1 font-medium">{preview.subject}</p>}
                <p className="mt-1 whitespace-pre-line">{preview.text}</p>
                {preview.segments !== null && <p className="mt-1 text-[0.75rem] text-charcoal/70">About {preview.segments} text message {preview.segments === 1 ? 'segment' : 'segments'}.</p>}
              </div>
            )}
          </div>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Btn onClick={() => setEditing(null)}>Close</Btn>
          <Btn disabled={busy} onClick={async () => { if (!editing) return; const res = await run(() => api<{ subject: string; text: string; segments: number | null }>(`/api/admin/templates/${editing.id}/preview`, { body: { subject, body } })); if (res) setPreview(res); }}>Preview</Btn>
          {editing?.channel === 'email' && <Btn disabled={busy} onClick={async () => { if (!editing) return; const res = await run(() => api<{ sent_to: string }>(`/api/admin/templates/${editing.id}/test`, { body: {} })); if (res) setPreview({ subject: 'Test queued', text: `A test using the last saved version is on its way to ${res.sent_to}.`, segments: null }); }}>Send me a test</Btn>}
          <Btn tone="primary" disabled={busy} onClick={async () => { if (!editing) return; const ok = await run(() => api(`/api/admin/templates/${editing.id}`, { method: 'PUT', body: { subject: editing.channel === 'email' ? subject : null, body, enabled } }), 'Saved.'); if (ok !== undefined) { setEditing(null); void state.reload(); } }}>Save</Btn>
        </div>
      </Modal>
    </>
  );
}
