import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { dateTimeLabel } from '../../lib/format';
import { useSession } from '../session';
import { Badge, Btn, Card, Checkbox, Field, Input, Loader, Modal, PageHeader, Select, StatusBadge, Textarea, useAction, useLoad } from '../ui';

type Task = { id: string; title: string; description: string | null; status: string; priority: string; due_at: string | null; est_minutes: number | null; required_capability: string | null; assigned_to: string | null; subject_type: string | null; subject_id: string | null; assignee: string | null };

export default function Tasks() {
  const { can } = useSession();
  const [mine, setMine] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const state = useLoad<{ tasks: Task[] }>(`/api/admin/tasks?status=${showDone ? 'done' : 'open'}${mine ? '&mine=true' : ''}`);
  const team = useLoad<{ staff: Array<{ id: string; display_name: string }> }>(can('staff.view') ? '/api/admin/team' : null);
  const { busy, run } = useAction();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', priority: 'normal', assigned_to: '', due: '' });
  const manage = can('tasks.manage');
  const link = (t: Task) => (t.subject_type === 'order' ? `/admin/orders/${t.subject_id}` : t.subject_type === 'project' ? `/admin/weddings/projects/${t.subject_id}` : t.subject_type === 'inquiry' ? `/admin/weddings/${t.subject_id}` : null);
  const patch = async (id: string, body: Record<string, unknown>) => {
    const ok = await run(() => api(`/api/admin/tasks/${id}`, { method: 'PATCH', body }));
    if (ok !== undefined) void state.reload();
  };
  return (
    <>
      <PageHeader title="Tasks" actions={manage && <Btn tone="primary" onClick={() => setAdding(true)}>Add task</Btn>} />
      <Card>
        <div className="mb-3 flex flex-wrap gap-4">
          <Checkbox label="Only mine" checked={mine} onChange={setMine} />
          <Checkbox label="Show completed" checked={showDone} onChange={setShowDone} />
        </div>
        <Loader state={state}>
          {(d) =>
            d.tasks.length === 0 ? (
              <p className="py-6 text-center text-[0.88rem] text-charcoal/70">Nothing to do here.</p>
            ) : (
              <ul className="divide-y divide-charcoal/8 text-[0.88rem]">
                {d.tasks.map((t) => {
                  const href = link(t);
                  return (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{href ? <Link className="hover:underline" to={href}>{t.title}</Link> : t.title}{t.priority !== 'normal' && <span className="ml-1.5"><Badge tone={t.priority === 'urgent' || t.priority === 'high' ? 'bad' : 'neutral'}>{t.priority}</Badge></span>}</p>
                        {t.description && <p className="text-[0.78rem] text-charcoal/70">{t.description}</p>}
                        <p className="text-[0.75rem] text-charcoal/70">{t.due_at && `Due ${dateTimeLabel(t.due_at)}`}{t.est_minutes ? ` · about ${t.est_minutes} minutes` : ''}{t.assignee ? ` · ${t.assignee}` : ''}</p>
                      </div>
                      <StatusBadge status={t.status} />
                      {manage && team.data && (
                        <label>
                          <span className="sr-only">Assign {t.title}</span>
                          <Select className="h-8 w-36 py-0 text-[0.78rem]" value={t.assigned_to ?? ''} onChange={(e) => patch(t.id, { assigned_to: e.target.value || null })}>
                            <option value="">Unassigned</option>
                            {team.data.staff.map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
                          </Select>
                        </label>
                      )}
                      {manage && t.status !== 'done' && <Btn small disabled={busy} onClick={() => patch(t.id, { status: 'done' })}>Done</Btn>}
                      {manage && t.status === 'done' && <Btn small disabled={busy} onClick={() => patch(t.id, { status: 'open' })}>Reopen</Btn>}
                    </li>
                  );
                })}
              </ul>
            )
          }
        </Loader>
      </Card>
      <Modal title="Add a task" open={adding} onClose={() => setAdding(false)}>
        <div className="space-y-3">
          <Field label="Title" required><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Details"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Priority"><Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></Select></Field>
            <Field label="Assign to"><Select value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}><option value="">Nobody yet</option>{team.data?.staff.map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}</Select></Field>
            <Field label="Due"><Input type="datetime-local" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} /></Field>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setAdding(false)}>Cancel</Btn>
          <Btn tone="primary" disabled={busy || !form.title.trim()} onClick={async () => { const ok = await run(() => api('/api/admin/tasks', { body: { title: form.title, description: form.description || null, priority: form.priority, assigned_to: form.assigned_to || null, due_at: form.due ? new Date(form.due).toISOString() : null } }), 'Added.'); if (ok !== undefined) { setAdding(false); setForm({ title: '', description: '', priority: 'normal', assigned_to: '', due: '' }); void state.reload(); } }}>Add</Btn>
        </div>
      </Modal>
    </>
  );
}
