import { useState } from 'react';
import { api } from '../../lib/api';
import { dateTimeLabel } from '../../lib/format';
import { useSession } from '../session';
import { Badge, Btn, Card, Checkbox, Field, Input, Loader, Modal, PageHeader, Select, StatusBadge, useAction, useLoad } from '../ui';

type Shift = { id: string; weekday: number; starts_at: string; ends_at: string };
type TimeOff = { id: string; starts_on: string; ends_on: string; kind: string; note: string | null };
type Member = { id: string; user_id: string; display_name: string; phone_e164: string | null; job_title: string | null; capabilities: string[]; active: boolean; max_appointments_per_day: number | null; max_events_per_day: number | null; email: string; status: string; last_login_at: string | null; role_ids: string[]; availability: Shift[]; time_off: TimeOff[] };
type Role = { id: string; code: string; name: string; description: string | null; system: boolean; permissions: string[] };
type Data = { staff: Member[]; roles: Role[]; permissions: Array<{ code: string; category: string; description: string }>; resources: Array<{ id: string; kind: string; name: string; active: boolean }> };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CAPABILITIES = [
  { key: 'production', label: 'Prepares orders' },
  { key: 'delivery', label: 'Drives deliveries' },
  { key: 'event_crew', label: 'Works events' },
  { key: 'consultation', label: 'Takes consultations' },
];

type DayDraft = { on: boolean; start: string; end: string };

function ScheduleModal({ member, onClose, onSaved }: { member: Member; onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useAction();
  const [days, setDays] = useState<DayDraft[]>(() =>
    WEEKDAYS.map((_, i) => {
      const s = member.availability.find((a) => a.weekday === i);
      return { on: Boolean(s), start: s?.starts_at.slice(0, 5) ?? '09:00', end: s?.ends_at.slice(0, 5) ?? '17:00' };
    }),
  );
  const [off, setOff] = useState({ starts_on: '', ends_on: '', kind: 'day_off' });
  const save = async () => {
    const shifts = days.flatMap((d, weekday) => (d.on ? [{ weekday, starts_at: d.start, ends_at: d.end }] : []));
    const ok = await run(() => api(`/api/admin/team/${member.id}/availability`, { method: 'PUT', body: { shifts } }), 'Schedule saved.');
    if (ok !== undefined) onSaved();
  };
  return (
    <Modal title={`${member.display_name}: schedule`} open onClose={onClose} wide>
      <h3 className="mb-2 font-sans text-[0.9rem] font-semibold tracking-normal">Usual week</h3>
      <div className="space-y-1.5">
        {days.map((d, i) => (
          <div key={WEEKDAYS[i]} className="flex flex-wrap items-center gap-3">
            <div className="w-20"><Checkbox label={WEEKDAYS[i]} checked={d.on} onChange={(v) => setDays((s) => s.map((x, j) => (j === i ? { ...x, on: v } : x)))} /></div>
            <label><span className="sr-only">{WEEKDAYS[i]} start</span><Input type="time" className="w-32" disabled={!d.on} value={d.start} onChange={(e) => setDays((s) => s.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} /></label>
            <span aria-hidden="true">to</span>
            <label><span className="sr-only">{WEEKDAYS[i]} end</span><Input type="time" className="w-32" disabled={!d.on} value={d.end} onChange={(e) => setDays((s) => s.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} /></label>
          </div>
        ))}
      </div>
      <Btn tone="primary" className="mt-3" disabled={busy} onClick={save}>Save usual week</Btn>
      <h3 className="mt-6 mb-2 font-sans text-[0.9rem] font-semibold tracking-normal">Days off and vacation</h3>
      <ul className="mb-3 space-y-1 text-[0.85rem]">
        {member.time_off.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-3">
            <span>{o.starts_on}{o.ends_on !== o.starts_on ? ` to ${o.ends_on}` : ''} · {o.kind.replace('_', ' ')}</span>
            <Btn small tone="ghost" disabled={busy} onClick={async () => { await run(() => api(`/api/admin/time-off/${o.id}`, { method: 'DELETE' })); onSaved(); }}>Remove</Btn>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="From"><Input type="date" value={off.starts_on} onChange={(e) => setOff({ ...off, starts_on: e.target.value, ends_on: off.ends_on || e.target.value })} /></Field>
        <Field label="To"><Input type="date" value={off.ends_on} onChange={(e) => setOff({ ...off, ends_on: e.target.value })} /></Field>
        <Field label="Kind"><Select value={off.kind} onChange={(e) => setOff({ ...off, kind: e.target.value })}><option value="day_off">Day off</option><option value="vacation">Vacation</option><option value="sick">Sick</option><option value="other">Other</option></Select></Field>
        <Btn disabled={busy || !off.starts_on || !off.ends_on} onClick={async () => { const ok = await run(() => api(`/api/admin/team/${member.id}/time-off`, { body: off }), 'Added.'); if (ok !== undefined) onSaved(); }}>Add</Btn>
      </div>
    </Modal>
  );
}

function EditModal({ member, roles, onClose, onSaved }: { member: Member; roles: Role[]; onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ display_name: member.display_name, job_title: member.job_title ?? '', phone: member.phone_e164 ?? '', capabilities: member.capabilities, max_appointments_per_day: member.max_appointments_per_day?.toString() ?? '', max_events_per_day: member.max_events_per_day?.toString() ?? '', role_ids: member.role_ids });
  const save = async () => {
    const ok = await run(async () => {
      await api(`/api/admin/team/${member.id}`, { method: 'PATCH', body: { display_name: f.display_name, job_title: f.job_title || null, phone: f.phone || null, capabilities: f.capabilities, max_appointments_per_day: f.max_appointments_per_day ? Number(f.max_appointments_per_day) : null, max_events_per_day: f.max_events_per_day ? Number(f.max_events_per_day) : null } });
      await api(`/api/admin/team/${member.id}/roles`, { method: 'PUT', body: { role_ids: f.role_ids } });
      return true;
    }, 'Saved.');
    if (ok) onSaved();
  };
  return (
    <Modal title={`Edit ${member.display_name}`} open onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required><Input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
        <Field label="Job title"><Input value={f.job_title} onChange={(e) => setF({ ...f, job_title: e.target.value })} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Most consultations a day"><Input inputMode="numeric" value={f.max_appointments_per_day} onChange={(e) => setF({ ...f, max_appointments_per_day: e.target.value })} /></Field>
      </div>
      <fieldset className="mt-3">
        <legend className="mb-1 text-[0.8rem] font-medium">What they do</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {CAPABILITIES.map((c) => <Checkbox key={c.key} label={c.label} checked={f.capabilities.includes(c.key)} onChange={(v) => setF({ ...f, capabilities: v ? [...f.capabilities, c.key] : f.capabilities.filter((x) => x !== c.key) })} />)}
        </div>
      </fieldset>
      <fieldset className="mt-3">
        <legend className="mb-1 text-[0.8rem] font-medium">Roles (what they can see and do)</legend>
        <div className="space-y-1.5">
          {roles.map((r) => <Checkbox key={r.id} label={r.name} hint={r.description} checked={f.role_ids.includes(r.id)} onChange={(v) => setF({ ...f, role_ids: v ? [...f.role_ids, r.id] : f.role_ids.filter((x) => x !== r.id) })} />)}
        </div>
      </fieldset>
      <div className="mt-4 flex justify-end gap-2">
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn tone="primary" disabled={busy || !f.role_ids.length} onClick={save}>Save</Btn>
      </div>
    </Modal>
  );
}

function RoleModal({ role, permissions, onClose, onSaved }: { role: Role; permissions: Data['permissions']; onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useAction();
  const [chosen, setChosen] = useState(new Set(role.permissions));
  const categories = [...new Set(permissions.map((p) => p.category))];
  return (
    <Modal title={`What ${role.name} can do`} open onClose={onClose} wide>
      <p className="mb-3 text-[0.85rem] text-charcoal/70">Give each role only what it needs. Changes apply the next time someone in this role loads a page.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {categories.map((category) => (
          <fieldset key={category}>
            <legend className="mb-1 text-[0.82rem] font-semibold">{category}</legend>
            <div className="space-y-1.5">
              {permissions.filter((p) => p.category === category).map((p) => (
                <Checkbox key={p.code} label={p.description} checked={chosen.has(p.code)} onChange={(v) => setChosen((s) => { const next = new Set(s); if (v) next.add(p.code); else next.delete(p.code); return next; })} />
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn tone="primary" disabled={busy} onClick={async () => { const ok = await run(() => api(`/api/admin/roles/${role.id}/permissions`, { method: 'PUT', body: { permissions: [...chosen] } }), 'Role updated.'); if (ok !== undefined) onSaved(); }}>Save</Btn>
      </div>
    </Modal>
  );
}

export default function Staff() {
  const state = useLoad<Data>('/api/admin/team');
  const { can, user } = useSession();
  const { busy, run } = useAction();
  const [inviting, setInviting] = useState(false);
  const [invite, setInvite] = useState({ email: '', display_name: '', job_title: '', role_codes: [] as string[], capabilities: [] as string[] });
  const [schedule, setSchedule] = useState<Member | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);
  const [crew, setCrew] = useState('');
  const [role, setRole] = useState<Role | null>(null);
  const isOwner = user?.roles.includes('owner');
  const manage = can('staff.manage');
  return (
    <>
      <PageHeader title="Team" subtitle="Who works when, and what they can do. Schedules drive the capacity checks customers see." actions={manage && <Btn tone="primary" onClick={() => setInviting(true)}>Invite someone</Btn>} />
      <Loader state={state}>
        {(d) => (
          <div className="space-y-4">
            <Card>
              <ul className="divide-y divide-charcoal/8">
                {d.staff.map((m) => {
                  const shifts = m.availability.map((a) => WEEKDAYS[a.weekday]).join(', ');
                  return (
                    <li key={m.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-[0.88rem]">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{m.display_name} {m.job_title && <span className="font-normal text-charcoal/70">· {m.job_title}</span>}</p>
                        <p className="text-[0.78rem] break-all text-charcoal/70">{m.email}{m.last_login_at ? ` · last signed in ${dateTimeLabel(m.last_login_at)}` : ''}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {d.roles.filter((r) => m.role_ids.includes(r.id)).map((r) => <Badge key={r.id} tone="info">{r.name}</Badge>)}
                          {m.capabilities.map((c) => <Badge key={c}>{CAPABILITIES.find((x) => x.key === c)?.label ?? c}</Badge>)}
                        </div>
                        <p className="mt-1 text-[0.75rem] text-charcoal/70">{shifts ? `Works ${shifts}` : 'No schedule set'}</p>
                      </div>
                      <StatusBadge status={m.status} />
                      {manage && (
                        <div className="flex flex-wrap gap-1.5">
                          <Btn small onClick={() => setSchedule(m)}>Schedule</Btn>
                          <Btn small onClick={() => setEditing(m)}>Edit</Btn>
                          {m.status !== 'disabled' ? (
                            <Btn small tone="ghost" disabled={busy} onClick={async () => { const ok = await run(() => api(`/api/admin/team/${m.id}/deactivate`, { body: {} }), 'Deactivated, and signed out everywhere.'); if (ok !== undefined) void state.reload(); }}>Deactivate</Btn>
                          ) : (
                            <Btn small tone="ghost" disabled={busy} onClick={async () => { const ok = await run(() => api(`/api/admin/team/${m.id}/reactivate`, { body: {} }), 'Reactivated.'); if (ok !== undefined) void state.reload(); }}>Reactivate</Btn>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
            <Card title="Event crews">
              <p className="mb-2 text-[0.8rem] text-charcoal/70">Each crew can be at one event's setup or teardown at a time. This is what stops a date being overbooked.</p>
              <ul className="mb-3 flex flex-wrap gap-2 text-[0.85rem]">
                {d.resources.filter((r) => r.kind === 'crew').map((r) => (
                  <li key={r.id} className="flex items-center gap-1.5">
                    <Badge tone={r.active ? 'info' : 'neutral'}>{r.name}{r.active ? '' : ' (retired)'}</Badge>
                    {can('settings.manage') && <Btn small tone="ghost" disabled={busy} onClick={async () => { const ok = await run(() => api(`/api/admin/resources/${r.id}`, { method: 'PUT', body: { kind: r.kind, name: r.name, active: !r.active } })); if (ok !== undefined) void state.reload(); }}>{r.active ? 'Retire' : 'Bring back'}</Btn>}
                  </li>
                ))}
              </ul>
              {can('settings.manage') && (
                <div className="flex gap-2">
                  <label className="flex-1"><span className="sr-only">Crew name</span><Input placeholder="Crew name" value={crew} onChange={(e) => setCrew(e.target.value)} /></label>
                  <Btn disabled={busy || !crew.trim()} onClick={async () => { const ok = await run(() => api('/api/admin/resources', { body: { kind: 'crew', name: crew } }), 'Crew added.'); if (ok !== undefined) { setCrew(''); void state.reload(); } }}>Add crew</Btn>
                </div>
              )}
            </Card>
            <Card title="Roles">
              <ul className="space-y-2 text-[0.85rem]">
                {d.roles.map((r) => (
                  <li key={r.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{r.name}</p>
                      {isOwner && r.code !== 'owner' && <Btn small tone="ghost" onClick={() => setRole(r)}>Edit what they can do</Btn>}
                    </div>
                    <p className="text-[0.78rem] text-charcoal/70">{r.description} ({r.permissions.length} permissions)</p>
                  </li>
                ))}
              </ul>
            </Card>
            {role && <RoleModal role={role} permissions={d.permissions} onClose={() => setRole(null)} onSaved={() => { setRole(null); void state.reload(); }} />}
            {schedule && <ScheduleModal member={d.staff.find((s) => s.id === schedule.id) ?? schedule} onClose={() => setSchedule(null)} onSaved={() => void state.reload()} />}
            {editing && <EditModal member={editing} roles={d.roles} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void state.reload(); }} />}
            <Modal title="Invite a team member" open={inviting} onClose={() => setInviting(false)}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name" required><Input value={invite.display_name} onChange={(e) => setInvite({ ...invite, display_name: e.target.value })} /></Field>
                <Field label="Email" required><Input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} /></Field>
                <Field label="Job title" className="sm:col-span-2"><Input value={invite.job_title} onChange={(e) => setInvite({ ...invite, job_title: e.target.value })} /></Field>
              </div>
              <fieldset className="mt-3">
                <legend className="mb-1 text-[0.8rem] font-medium">What they do</legend>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {CAPABILITIES.map((c) => <Checkbox key={c.key} label={c.label} checked={invite.capabilities.includes(c.key)} onChange={(v) => setInvite({ ...invite, capabilities: v ? [...invite.capabilities, c.key] : invite.capabilities.filter((x) => x !== c.key) })} />)}
                </div>
              </fieldset>
              <fieldset className="mt-3">
                <legend className="mb-1 text-[0.8rem] font-medium">Roles</legend>
                <div className="space-y-1.5">
                  {d.roles.map((r) => <Checkbox key={r.id} label={r.name} hint={r.description} checked={invite.role_codes.includes(r.code)} onChange={(v) => setInvite({ ...invite, role_codes: v ? [...invite.role_codes, r.code] : invite.role_codes.filter((x) => x !== r.code) })} />)}
                </div>
              </fieldset>
              <div className="mt-4 flex justify-end gap-2">
                <Btn onClick={() => setInviting(false)}>Cancel</Btn>
                <Btn tone="primary" disabled={busy || !invite.email.trim() || !invite.display_name.trim() || !invite.role_codes.length} onClick={async () => { const ok = await run(() => api('/api/admin/team/invite', { body: { ...invite, job_title: invite.job_title || null } }), 'Invitation sent.'); if (ok !== undefined) { setInviting(false); setInvite({ email: '', display_name: '', job_title: '', role_codes: [], capabilities: [] }); void state.reload(); } }}>Send invitation</Btn>
              </div>
            </Modal>
          </div>
        )}
      </Loader>
    </>
  );
}
